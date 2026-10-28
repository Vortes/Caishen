import { CatmullRomCurve3, Matrix4, Quaternion, Vector3 } from "three";
import { config } from "./config";
import { clamp, easeOut } from "./motion";
import { CAMERA_DISTANCE, LANDING, SCENE } from "./geometry";

// The plane is thrown from the far side and loops in from the distance
// (see farRoute), then glides down, touches down, and skids to a stop.

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
  // When the camera starts following the plane in to land.
  follow: number;
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

// Leans the whole scene back like a tabletop seen at an angle, so depth
// reads; it eases to straight overhead as the card settles.
export function viewTilt(settled = 0) {
  const angle = (-config.plane.tilt * (1 - settled) * Math.PI) / 180;
  return new Matrix4()
    .makeTranslation(LANDING.x, -LANDING.y, 0)
    .multiply(new Matrix4().makeRotationX(angle))
    .multiply(new Matrix4().makeTranslation(-LANDING.x, LANDING.y, 0));
}

// The far-side throw, traced from a sketch: it starts as a speck in the
// distance, curls up and out to the left, loops down the left side, sweeps
// across the front at its biggest, and rises over a small hump. From
// there it glides on the way it was going, flattening out as it skims onto
// the table. Far away, each point is where it sits on screen and how big
// it looks there (0 is the far size, 1 the near size). Close in, points sit
// over the table itself (SVG x and y, height above it), so the glide stays
// above the table. The flight between is a smooth curve.
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
// Off the hump, along the line it came over on, curving gently right and
// flattening out to touch down near the middle of the table.
const GLIDE = [
  { x: 465, y: 520, z: 58 },
  { x: 545, y: 430, z: 16 },
  { x: 620, y: 360, z: 0 },
];
const FAR_SAMPLES = 1600;

function farRoute(): Route {
  const { far, near, loop, slide } = config.flight;

  // Points on screen at a given apparent size sit along the camera's line
  // of sight to that spot, closer the bigger they look. Work in the
  // table's frame (the view's lean undone), where y points up the screen.
  const camera = new Vector3(
    SCENE.width / 2,
    -SCENE.height / 2,
    CAMERA_DISTANCE,
  );
  const tilt = viewTilt();
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
    ...[...SWOOP, ...GLIDE].map(
      (point) => new Vector3(point.x, -point.y, point.z),
    ),
  ];
  const curve = new CatmullRomCurve3(controls, false, "centripetal");
  const spaced = curve.getSpacedPoints(FAR_SAMPLES);
  // It skids on the way it was heading at touchdown.
  const line = spaced[FAR_SAMPLES]!.clone()
    .sub(spaced[FAR_SAMPLES - 8]!)
    .setZ(0)
    .normalize();
  const along = { x: line.x, y: -line.y };

  // Speed in proportion to distance from the camera, so the plane crosses
  // the screen at a steady pace while it grows, and slows as it nears.
  // The loop takes its set time to reach the hump; the glide takes however
  // long it takes at that pace.
  const away = spaced.map((point) =>
    point.clone().applyMatrix4(tilt).distanceTo(camera),
  );
  const hump = controls[LOOP.length + SWOOP.length - 1]!;
  const over = spaced.reduce(
    (best, point, i) =>
      point.distanceTo(hump) < spaced[best]!.distanceTo(hump) ? i : best,
    0,
  );
  let total = 0;
  for (let i = 1; i <= over; i++)
    total += spaced[i]!.distanceTo(spaced[i - 1]!) / away[i]!;
  const rate = total / loop;

  const points: { t: number; x: number; y: number; z: number }[] = [];
  let t = 0;
  let apex = 0;
  let follow = 0;
  let highest = -Infinity;
  spaced.forEach((point, i) => {
    if (i > 0) t += spaced[i]!.distanceTo(spaced[i - 1]!) / away[i]! / rate;
    if (i === over) follow = t;
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
    follow,
    air: t,
    landing,
    skid,
    along,
  };
}

// Traced once, on first use.
let traced: Route | null = null;
const route = () => (traced ??= farRoute());

// Time in the air, before touchdown.
export const airSeconds = () => route().air;

export const flightSeconds = () => {
  const { air, skid } = route();
  return air + skid;
};

// Which sample a moment in the air falls after, and how far on to the next.
function locate(samples: Sample[], t: number) {
  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (samples[middle]!.t <= t) low = middle;
    else high = middle;
  }
  const a = samples[low]!;
  const b = samples[high]!;
  return { low, high, f: clamp((t - a.t) / (b.t - a.t || 1)) };
}

// How far along the card it has skidded, a given time after touchdown.
// Friction bites hardest at first. The curve's steepness matches the speed
// it touched down at, so it doesn't brake the instant it lands.
function skidded(path: Route, since: number) {
  const into = path.skid ? clamp(since / path.skid) : 1;
  const { slide } = config.flight;
  const bite = slide > 0 ? Math.max(2, (path.landing * path.skid) / slide) : 2;
  return { into, slid: slide * (1 - (1 - into) ** bite) };
}

// Distance covered over the table, at each sample of the flight.
let covered: number[] | null = null;
function ground(path: Route) {
  if (covered) return covered;
  covered = [0];
  for (let i = 1; i < path.samples.length; i++) {
    const a = path.samples[i - 1]!;
    const b = path.samples[i]!;
    covered.push(covered[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return covered;
}

// How far over the table the plane has come since the camera started
// following it, out of the whole way to where it stops.
export function followed(at: number) {
  const path = route();
  const covered = ground(path);
  const along = (t: number) => {
    if (t >= path.air)
      return covered[covered.length - 1]! + skidded(path, t - path.air).slid;
    const { low, high, f } = locate(path.samples, t);
    return covered[low]! + (covered[high]! - covered[low]!) * f;
  };
  const from = along(path.follow);
  const whole = along(path.air + path.skid) - from;
  return whole > 0
    ? clamp((along(Math.max(at, path.follow)) - from) / whole)
    : 1;
}

type FlightPose = {
  // World x, SVG y, and height above the table, all in scene units.
  x: number;
  y: number;
  z: number;
  // Which way the plane faces, in the table's frame (y up the screen): nose
  // along +x and top along +z when it lies flat along the card.
  facing: Quaternion;
};

export function flightPose(at: number): FlightPose {
  const path = route();
  const { samples } = path;
  const { stall } = config.flight;
  // The scene's first frame can read a hair before the start.
  const t = Math.max(0, at);

  if (t < path.air) {
    const { low, high, f } = locate(samples, t);
    const a = samples[low]!;
    const b = samples[high]!;
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

  // On the table: friction eases it to a stop in the line it touched down
  // on, and it settles flat, still facing the way it was going.
  const last = samples[samples.length - 1]!;
  const { into, slid } = skidded(path, t - path.air);
  const heading = Math.atan2(-path.along.y, path.along.x);
  const level = new Quaternion().setFromAxisAngle(
    new Vector3(0, 0, 1),
    heading,
  );
  return {
    x: last.x + path.along.x * slid,
    y: last.y + path.along.y * slid,
    z: 0,
    facing: last.facing.clone().slerp(level, easeOut(into)),
  };
}
