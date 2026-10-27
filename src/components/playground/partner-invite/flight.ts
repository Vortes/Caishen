import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from "three";
import { clamp, easeOut, type Config } from "./config";
import { CAMERA_DISTANCE, CARD, LANDING, SCENE } from "./geometry";
import { PLANE_CENTER } from "./harrier";

// Two throws. From the far side, it loops in from the distance (see
// farRoute). From in front, it flies in from the foreground: It leaves a hand
// just in front of the viewer, below the frame, climbs steeply as it heads
// into the scene, rounds over the top, and glides down in a long descent
// that flattens onto the table. Over the ground it curves in, leaning into
// the turn, touches down still angled into the scene, and slews straight
// along the card as it skids to a stop.
//
// The height follows a drawn shape; the timing comes from energy. Speed at
// any height is what the plane had over the top plus what it gains falling
// from there (v² = top² + 2g·drop), so it's fastest out of the hand, slowest
// over the top, and picks up again on the way down. The wings' drag takes
// a share of the descent, so it lands gently.

// Where the plane's middle sits once the sheet lies on the card.
const REST_X = LANDING.x + (PLANE_CENTER - CARD.width / 2);
const SAMPLES = 800;
// How many samples either side the lean is averaged over, so it eases in
// and out of turns rather than twitching with every wiggle in the path.
const LEAN_SMOOTHING = 24;
// The plane's facing is blended over this many seconds either side, so even
// a tight bend in the path turns it smoothly.
const FACING_SMOOTHING = 0.06;
// Settling flat and skidding to a stop take at least this long.
const SETTLE = 0.35;

// A moment on the flight: when, where (world x, SVG y, height), and which
// way the plane faces.
type Sample = {
  t: number;
  x: number;
  y: number;
  z: number;
  facing: Quaternion;
};
type Route = {
  samples: Sample[];
  apex: number;
  air: number;
  landing: number;
  skid: number;
  // Direction of the skid, in SVG terms.
  along: { x: number; y: number };
};

// Which way the plane faces along a path, from the path itself: the nose
// points along its full 3D direction of travel, the wings stay level with
// the table, and it leans into each turn by how hard the turn pulls it
// sideways. Working from the 3D direction (never a compass heading) keeps
// it steady even when the plane dives straight at the camera.
function orient(
  points: { t: number; x: number; y: number; z: number }[],
  bank: number,
): Quaternion[] {
  const at = (i: number) => {
    const point = points[Math.max(0, Math.min(points.length - 1, i))]!;
    // Table frame with y up the screen.
    return new Vector3(point.x, -point.y, point.z);
  };
  const time = (i: number) =>
    points[Math.max(0, Math.min(points.length - 1, i))]!.t;
  const up = new Vector3(0, 0, 1);
  const noses: Vector3[] = [];
  const lefts: Vector3[] = [];
  const pulls: number[] = [];
  let left = new Vector3(0, 1, 0);
  points.forEach((_, i) => {
    const nose = at(i + 1)
      .sub(at(i - 1))
      .normalize();
    const candidate = up.clone().cross(nose);
    if (candidate.lengthSq() > 1e-6) left = candidate.normalize();
    noses.push(nose);
    lefts.push(left.clone());
    const velocity = (j: number) =>
      at(j + 1)
        .sub(at(j - 1))
        .divideScalar(time(j + 1) - time(j - 1) || 1);
    const pull = velocity(i + 1)
      .sub(velocity(i - 1))
      .divideScalar(time(i + 1) - time(i - 1) || 1)
      .dot(left);
    pulls.push(pull);
  });
  const smooth = pulls.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = i - LEAN_SMOOTHING; j <= i + LEAN_SMOOTHING; j++) {
      if (j < 0 || j >= pulls.length) continue;
      sum += pulls[j]!;
      count++;
    }
    return sum / count;
  });
  const strongest = Math.max(...smooth.map(Math.abs), 1e-6);
  const raw = noses.map((nose, i) => {
    const side = lefts[i]!;
    const top = nose.clone().cross(side);
    const facing = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(nose, side, top),
    );
    // A pull to the left drops the left wing.
    const lean = (-bank * Math.PI * smooth[i]!) / 180 / strongest;
    return facing.multiply(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), lean),
    );
  });
  // A Gaussian-weighted average of nearby facings in time. Neighbors are
  // close, so a normalized, sign-aligned sum is a faithful average.
  return raw.map((center, i) => {
    const sum = [0, 0, 0, 0];
    const t = time(i);
    for (let j = i; j >= 0 && t - time(j) < 3 * FACING_SMOOTHING; j--) add(j);
    for (
      let j = i + 1;
      j < raw.length && time(j) - t < 3 * FACING_SMOOTHING;
      j++
    )
      add(j);
    function add(j: number) {
      const q = raw[j]!;
      const weight = Math.exp(-(((time(j) - t) / FACING_SMOOTHING) ** 2) / 2);
      const sign = q.dot(center) < 0 ? -1 : 1;
      sum[0]! += q.x * weight * sign;
      sum[1]! += q.y * weight * sign;
      sum[2]! += q.z * weight * sign;
      sum[3]! += q.w * weight * sign;
    }
    return new Quaternion(sum[0], sum[1], sum[2], sum[3]).normalize();
  });
}

const withFacing = (
  points: { t: number; x: number; y: number; z: number }[],
  bank: number,
): Sample[] => {
  const facings = orient(points, bank);
  return points.map((point, i) => ({ ...point, facing: facings[i]! }));
};

let cache: { key: string; value: Route } | null = null;

function height(config: Config, p: number) {
  const { height: top, start, peak, tail } = config.flight;
  if (p <= peak) {
    // An S up: flat out of the hand, steep in the middle, round at the top.
    return start + ((top - start) * (1 - Math.cos((Math.PI * p) / peak))) / 2;
  }
  // Down: steepest just past the top, flattening into a long, level tail.
  const q = 1 - (1 - (p - peak) / (1 - peak)) ** tail;
  return (top * (1 + Math.cos(Math.PI * q))) / 2;
}

// Leans the whole scene back like a tabletop seen at an angle, so depth
// reads; it eases to straight overhead as the card settles.
export function viewTilt(config: Config, settled = 0) {
  const angle = (-config.plane.tilt * (1 - settled) * Math.PI) / 180;
  return new Matrix4()
    .makeTranslation(LANDING.x, -LANDING.y, 0)
    .multiply(new Matrix4().makeRotationX(angle))
    .multiply(new Matrix4().makeTranslation(-LANDING.x, LANDING.y, 0));
}

// The far-side throw, traced from a sketch: it starts as a speck in the
// distance, curls up and out to the left, loops down the left side, sweeps
// across the front at its biggest, then rises over a small hump and
// settles onto the card. Far away, each point is where it sits on screen
// and how big it looks there (0 is the far size, 1 the near size). Close
// in, points sit over the table itself (SVG x and y, height above it), so
// the swoop to the card stays above the table. The flight between is a
// smooth curve.
const LOOP = [
  { x: 760, y: 397, size: 0 },
  { x: 610, y: 250, size: 0.15 },
  { x: 420, y: 165, size: 0.32 },
  { x: 245, y: 300, size: 0.5 },
];
const SWOOP = [
  { x: 210, y: 560, z: 150 },
  { x: 300, y: 690, z: 85 },
  { x: 395, y: 610, z: 95 },
];
const FAR_SAMPLES = 1600;

function farRoute(config: Config): Route {
  const { far, near, loop, slide } = config.flight;

  // Points on screen at a given apparent size sit along the camera's line
  // of sight to that spot, closer the bigger they look. Work in the
  // table's frame (the view's lean undone), where y points up the screen.
  const camera = new Vector3(
    SCENE.width / 2,
    -SCENE.height / 2,
    CAMERA_DISTANCE,
  );
  const tilt = viewTilt(config);
  const untilt = tilt.clone().invert();
  const sighted = (x: number, y: number, size: number) =>
    camera
      .clone()
      .add(new Vector3(x, -y, 0).sub(camera).divideScalar(size))
      .applyMatrix4(untilt);
  const controls = [
    ...LOOP.map((point) =>
      sighted(point.x, point.y, far * (near / far) ** point.size),
    ),
    ...SWOOP.map((point) => new Vector3(point.x, -point.y, point.z)),
  ];
  // From the hump it runs straight down onto the card, touches down, and
  // skids on in the same line, so the path never doubles back.
  const hump = controls[controls.length - 1]!;
  const rest = new Vector3(REST_X, -LANDING.y, 0);
  const line = rest.clone().sub(hump).setZ(0).normalize();
  const touchdown = rest.clone().addScaledVector(line, -slide);
  const lead = Math.min(80, touchdown.distanceTo(hump) / 3);
  controls.push(
    touchdown.clone().addScaledVector(line, -lead).setZ(25),
    touchdown,
  );
  const along = { x: line.x, y: -line.y };
  const curve = new CatmullRomCurve3(controls, false, "centripetal");
  const spaced = curve.getSpacedPoints(FAR_SAMPLES);

  // Speed in proportion to distance from the camera, so the plane crosses
  // the screen at a steady pace while it grows, and slows as it nears.
  const away = spaced.map((point) =>
    point.clone().applyMatrix4(tilt).distanceTo(camera),
  );
  let total = 0;
  for (let i = 1; i < spaced.length; i++)
    total += spaced[i]!.distanceTo(spaced[i - 1]!) / away[i]!;
  const rate = total / loop;

  const points: { t: number; x: number; y: number; z: number }[] = [];
  let t = 0;
  let apex = 0;
  let highest = -Infinity;
  spaced.forEach((point, i) => {
    if (i > 0) t += spaced[i]!.distanceTo(spaced[i - 1]!) / away[i]! / rate;
    points.push({ t, x: point.x, y: -point.y, z: point.z });
    // Over the top of the loop, where it hangs for a moment.
    const screenY = point.clone().applyMatrix4(tilt).y;
    if (screenY > highest) {
      highest = screenY;
      apex = t;
    }
  });
  const landing = rate * away[away.length - 1]!;
  const skid = Math.max(SETTLE, slide > 0 ? (2 * slide) / landing : 0);
  return {
    samples: withFacing(points, config.flight.bank),
    apex,
    air: t,
    landing,
    skid,
    along,
  };
}

function route(config: Config): Route {
  const key = JSON.stringify([config.thrown, config.flight, config.plane.tilt]);
  if (cache?.key === key) return cache.value;
  const value =
    config.thrown === "background" ? farRoute(config) : nearRoute(config);
  cache = { key, value };
  return value;
}

function nearRoute(config: Config): Route {
  const { top, gravity, glide, slide, depth, offset, peak } = config.flight;
  // From in front, it heads into the scene (up the screen, so SVG y runs
  // negative).
  const toward = -1;
  const angle = (config.flight.approach * Math.PI) / 180;
  const along = { x: Math.cos(angle), y: toward * Math.sin(angle) };

  // Over the ground: a curve from the thrower, in front of the scene, to
  // touchdown, arriving along the approach so the skid carries straight on
  // to the card.
  const from = { x: REST_X + offset, y: LANDING.y + depth };
  const to = { x: REST_X - along.x * slide, y: LANDING.y - along.y * slide };
  const reach = Math.hypot(to.x - from.x, to.y - from.y);
  const bend = {
    x: to.x - along.x * reach * 0.45,
    y: to.y - along.y * reach * 0.45,
  };
  const ground = (u: number) => ({
    x: (1 - u) ** 2 * from.x + 2 * (1 - u) * u * bend.x + u * u * to.x,
    y: (1 - u) ** 2 * from.y + 2 * (1 - u) * u * bend.y + u * u * to.y,
  });

  const speed = (z: number, descending: boolean) =>
    Math.sqrt(
      top * top +
        2 * gravity * (descending ? glide : 1) * (config.flight.height - z),
    );

  const points: { t: number; x: number; y: number; z: number }[] = [];
  let t = 0;
  let apex = 0;
  for (let i = 0; i <= SAMPLES; i++) {
    const p = i / SAMPLES;
    const point = { t, ...ground(p), z: height(config, p) };
    if (i > 0) {
      const previous = points[i - 1]!;
      const distance = Math.hypot(
        point.x - previous.x,
        point.y - previous.y,
        point.z - previous.z,
      );
      const descending = p > peak;
      t +=
        distance /
        ((speed(previous.z, descending) + speed(point.z, descending)) / 2);
      point.t = t;
    }
    if (p <= peak) apex = t;
    points.push(point);
  }
  const landing = speed(0, true);
  const skid = Math.max(SETTLE, slide > 0 ? (2 * slide) / landing : 0);
  return {
    samples: withFacing(points, config.flight.bank),
    apex,
    air: t,
    landing,
    skid,
    along,
  };
}

// Time in the air, before touchdown.
export const airSeconds = (config: Config) => route(config).air;

export const flightSeconds = (config: Config) => {
  const { air, skid } = route(config);
  return air + skid;
};

type FlightPose = {
  // World x, SVG y, and height above the table, all in scene units.
  x: number;
  y: number;
  z: number;
  // Which way the plane faces, in the table's frame (y up the screen): nose
  // along +x and top along +z when it lies flat along the card.
  facing: Quaternion;
};

export function flightPose(config: Config, at: number): FlightPose {
  const path = route(config);
  const { samples } = path;
  const { stall } = config.flight;
  // The scene's first frame can read a hair before the start.
  const t = Math.max(0, at);

  if (t < path.air) {
    let low = 0;
    let high = samples.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (samples[middle]!.t <= t) low = middle;
      else high = middle;
    }
    const a = samples[low]!;
    const b = samples[high]!;
    const f = clamp((t - a.t) / (b.t - a.t || 1));
    // The nose lifts a touch as it slows over the top.
    const width = 0.3 * path.apex + 0.1;
    const nose = stall * Math.exp(-(((t - path.apex) / width) ** 2));
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      z: a.z + (b.z - a.z) * f,
      facing: a.facing
        .clone()
        .slerp(b.facing, f)
        .multiply(
          new Quaternion().setFromAxisAngle(
            new Vector3(0, 1, 0),
            (-nose * Math.PI) / 180,
          ),
        ),
    };
  }

  // On the table: friction eases it to a stop while it slews straight
  // along the card and settles flat.
  const last = samples[samples.length - 1]!;
  const into = path.skid ? clamp((t - path.air) / path.skid) : 1;
  const slid = config.flight.slide * (1 - (1 - into) ** 2);
  return {
    x: last.x + path.along.x * slid,
    y: last.y + path.along.y * slid,
    z: 0,
    facing: last.facing.clone().slerp(new Quaternion(), easeOut(into)),
  };
}
