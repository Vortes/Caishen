import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  type ShaderMaterial,
  type Texture,
  type Vector2,
} from "three";
import {
  clamp,
  easeInOut,
  easeOut,
  lerp,
  random,
  span,
  type Config,
} from "./config";
import { CARD, LANDING, type Point } from "./geometry";
import type { Stroke } from "./ink";
import { createPaperMaterial, updatePaperMaterial } from "./paper-material";
import { sealInk, sealPlacement } from "./seal";

// The card from the moment it tears to the moment it's taken, in 3D. A tear starts at the top edge and runs down: behind its tip the flap
// on the right rises toward you and curls, the left dips away, and the
// halves part. Still curled, the right flap slides over the left and
// flattens onto it as it lands, and the seal presses into the overlap.
// Then your half is peeled off and lifts away, and Jordan's stays.

const hw = CARD.width / 2;
const hh = CARD.height / 2;
// The tear line has a point every ROW px, top to bottom.
const ROW = 2;
const ROWS = CARD.height / ROW;
// Fibers reach this far past the line, so each half's mesh runs past it.
const REACH = 7;
// Enough that the curl at the outer edge, where columns are sparsest,
// stays round.
const COLUMNS = 80;
// How far behind the tip the halves are fully parted.
const OPENING = 150;
// How far the flaps part while tearing.
const PARTING = 5;

// The tear's timeline, as fractions of its duration: the sheet fades in
// over the printed card, and the tip runs top to bottom.
export const SHOWN = 0.06;
const TORN = 0.7;
// The slide over runs from late in the tear (a fraction of the tear) into
// the start of the bond (a fraction of the bond), so the flap never stops.
const SLIDE_FROM = 0.6;
const SLIDE_TO = 0.25;
// How far through the slide the flap starts flattening onto the left.
const LANDING_FROM = 0.4;

// The bond's timeline, as fractions of its duration: once the halves
// overlap, the seal presses into both. Nothing shows the stone; the paper
// gives under it, and the ink takes from the high spots of the face
// outward, leaving a dent that stays.
const PRESS = [0.36, 0.56] as const;
export const STAMP = 0.42;
const TAKE = [0.4, 0.56] as const;
// How deep the press goes, how much dent the paper keeps, and how much
// the whole card gives.
const DEPTH = 3;
const KEPT = 0.25;
const GIVE = 0.012;
// How much higher the right half rides while sliding over, and where it
// rests on the left.
const OVER = 4;
const RESTS = 0.8;

// A peel of your half: the way it's pulled (a unit vector, card
// coordinates, y down) and how far the peeled tip has traveled. It starts
// from whichever edge or corner of the half leads in that direction.
export type Peel = { along: Point; reach: number };

// Past the fold the paper wraps over a cylinder, then runs on at the angle
// it has been lifted to: lying back across the sheet, face down, while it's
// only a curl, and standing up toward you as the peel grows, so the fold
// keeps pace with the hand instead of trailing it by half. The curl loosens
// as the peel grows. Lifted, the paper never runs quite straight: it keeps
// curling gently the way it was peeled, as a sheet held up by one edge
// does.
const LEAN = { from: 80, to: 320, end: 0.65 * Math.PI, bend: 1 / 700 };
function peelShape(reach: number) {
  const radius = 9 + reach * 0.025;
  const lift =
    Math.PI -
    (Math.PI - LEAN.end) *
      smoothstep((reach - LEAN.from) / (LEAN.to - LEAN.from));
  const arc = radius * lift;
  const bend =
    LEAN.bend * smoothstep((reach - LEAN.from) / (LEAN.to - LEAN.from));
  // The fold keeps pace with the tip until it has rolled over; then the
  // tip, out on the straight, stays about where it's held.
  const fold = reach < arc ? reach : arc + (reach - arc) / (1 - Math.cos(lift));
  return { radius, lift, arc, fold, bend };
}

// Where along the pull your half starts (its leading edge or corner), and
// how far it runs from there.
function extent(along: Point) {
  const ends = [0, hw].flatMap((x) =>
    [-hh, hh].map((y) => x * along.x + y * along.y),
  );
  const lead = Math.min(...ends);
  return { lead, length: Math.max(...ends) - lead };
}

// How far the tip travels before the fold has crossed the whole half and
// it comes free.
export function fullReach(along: Point) {
  const { length } = extent(along);
  let [low, high] = [0, 4000];
  for (let i = 0; i < 32; i++) {
    const reach = (low + high) / 2;
    const { fold, arc } = peelShape(reach);
    if (fold - arc >= length) high = reach;
    else low = reach;
  }
  return high;
}

// A peel's shape, ready to move points of your half by.
const shaped = ({ along, reach }: Peel) => ({
  along,
  lead: extent(along).lead,
  ...peelShape(reach),
});

// How far a peel moves a point of your half (its own card coordinates).
function peelAt(
  x: number,
  y: number,
  { along, lead, radius, lift, arc, fold, bend }: ReturnType<typeof shaped>,
) {
  const s = x * along.x + y * along.y - lead;
  const u = fold - s;
  if (u <= 0) return { x: 0, y: 0, z: 0 };
  let to: number;
  let z: number;
  if (u < arc) {
    const turn = u / radius;
    to = fold - radius * Math.sin(turn);
    z = radius * (1 - Math.cos(turn));
  } else {
    // Turning on by `bend` per px past the cylinder.
    const past = u - arc;
    const turned = lift + bend * past;
    to = fold - radius * Math.sin(lift);
    z = radius * (1 - Math.cos(lift));
    if (bend > 0) {
      to -= (Math.sin(turned) - Math.sin(lift)) / bend;
      z += (Math.cos(lift) - Math.cos(turned)) / bend;
    } else {
      to -= past * Math.cos(lift);
      z += past * Math.sin(lift);
    }
  }
  return { x: along.x * (to - s), y: along.y * (to - s), z };
}

// How far a peel carries your half's middle: the average of how far it
// moves each point of the half.
const SAMPLES = 12;
export function peelShift(peel: Peel) {
  const sum = { x: 0, y: 0, z: 0 };
  if (peel.reach <= 0) return sum;
  const shape = shaped(peel);
  for (let i = 0; i <= SAMPLES; i++) {
    for (let j = 0; j <= SAMPLES; j++) {
      const moved = peelAt(
        (hw * i) / SAMPLES,
        -hh + (CARD.height * j) / SAMPLES,
        shape,
      );
      sum.x += moved.x;
      sum.y += moved.y;
      sum.z += moved.z;
    }
  }
  const count = (SAMPLES + 1) ** 2;
  return { x: sum.x / count, y: sum.y / count, z: sum.z / count };
}

// The box your half fills on its own, in its own coordinates (y down),
// fibers included; and where its middle is.
export const KEPT_BOX = {
  left: -10,
  right: hw + 2,
  top: -hh - 2,
  bottom: hh + 2,
};
export const KEPT_MIDDLE = (KEPT_BOX.left + KEPT_BOX.right) / 2;
// The box the bonded card fills, halves overlapped, in card coordinates
// (y down); and where your half's own box sits inside it.
export const joinedBox = (config: Config) => ({
  left: -hw + config.seal.overlap / 2 - 8,
  right: hw - config.seal.overlap / 2 + 8,
  top: -hh - 10,
  bottom: hh + 10,
});
export const keptInJoined = (config: Config) => {
  const { drop } = sealPlacement(config);
  const x = -config.seal.overlap / 2;
  return {
    left: KEPT_BOX.left + x,
    right: KEPT_BOX.right + x,
    top: KEPT_BOX.top + drop,
    bottom: KEPT_BOX.bottom + drop,
  };
};
// Jordan's half's box, fibers included, in card coordinates, where it lies
// on the bonded card.
export const theirsBox = (config: Config) => ({
  left: -hw - 2 + config.seal.overlap / 2,
  right: 10 + config.seal.overlap / 2,
  top: -hh - 2,
  bottom: hh + 2,
});
// Where your half sits on the card before it's taken, as a place for its
// middle (card coordinates, z toward you).
export const keptFrom = (config: Config) => ({
  x: -config.seal.overlap / 2 + KEPT_MIDDLE,
  y: sealPlacement(config).drop,
  z: RESTS,
});

// Your half once it's free: where its middle is (card coordinates, z
// toward you).
export type Kept = { x: number; y: number; z: number };

// The card at one moment. `tear` and `bond` are progress through each;
// `y` and `size` place the card's middle in the scene; `peels` lift your
// half, `keep` holds it once it's free, and `shown` is how much of each
// half shows; `shimmer` is how far a sheen has swept across your half (off
// outside 0 to 1), and `genie` how far it has poured into a point (card
// coordinates, in its own plane); `inkAt` is when the print was taken,
// which fixes how wet the signature is.
export type CardFrame = {
  tear: number;
  bond: number;
  sealWet: number;
  y: number;
  size: number;
  peels: Peel[];
  keep: Kept | null;
  shown: { yours: number; theirs: number };
  shimmer: number;
  genie: { progress: number; to: Point } | null;
  opacity: number;
  strokes: Stroke[];
  inkAt: number;
};

// Fading in over the printed card while the tear starts, and out into the
// clouds once it's taken.
export const cardOpacity = (frame: CardFrame) =>
  span(frame.tear, 0, SHOWN) * frame.opacity;

// A neat tear still wanders: a slow drift where the hands pulled unevenly,
// and short jags where bundles of fibers gave way.
export function tearLine(config: Config): Point[] {
  const rng = random(config.seed, "tear");
  const [a, b] = [rng() * 6, rng() * 6];
  const lean = (rng() - 0.5) * 4;
  let jag = 0;
  const points: Point[] = [];
  for (let i = 0; i <= ROWS; i++) {
    const t = i / ROWS;
    jag = jag * 0.75 + (rng() - 0.5) * 1.5;
    const drift =
      2.4 * Math.sin(t * 2.3 + a) + 1.2 * Math.sin(t * 6.1 + b) + lean * t;
    points.push({ x: (drift + jag) * config.tear.ragged, y: -hh + i * ROW });
  }
  return points;
}

type Half = Mesh<BufferGeometry, ShaderMaterial> & {
  userData: { side: 1 | -1 };
};

export function createTornCard() {
  const group = new Group();
  group.matrixAutoUpdate = false;
  for (const side of [-1, 1] as const) {
    const material = createPaperMaterial();
    material.transparent = true;
    material.uniforms.uTear!.value = 1;
    // The right flap tears toward you; it's the one on top when they bond.
    material.uniforms.uLifted!.value = side > 0 ? 1 : 0;
    const geometry = new BufferGeometry();
    const vertices = (ROWS + 1) * (COLUMNS + 1);
    for (const [name, size] of [
      ["position", 3],
      ["rest", 2],
      ["seam", 1],
      ["torn", 1],
    ] as const) {
      geometry.setAttribute(
        name,
        new BufferAttribute(new Float32Array(vertices * size), size),
      );
    }
    const index: number[] = [];
    const at = (row: number, column: number) => row * (COLUMNS + 1) + column;
    for (let row = 0; row < ROWS; row++) {
      for (let column = 0; column < COLUMNS; column++) {
        const a = at(row, column);
        const b = at(row, column + 1);
        const c = at(row + 1, column);
        const d = at(row + 1, column + 1);
        // Columns run outward from the seam, so the halves wind opposite
        // ways; both keep the printed side facing the camera.
        if (side > 0) index.push(a, c, b, b, c, d);
        else index.push(a, b, c, b, d, c);
      }
    }
    geometry.setIndex(index);
    const mesh = new Mesh(geometry, material) as Half;
    mesh.userData.side = side;
    mesh.frustumCulled = false;
    // The right half draws over the left.
    mesh.renderOrder = side > 0 ? 2 : 1;
    group.add(mesh);
  }
  return group;
}

export function disposeTornCard(group: Group) {
  for (const child of group.children as Mesh[]) {
    child.geometry.dispose();
    (child.material as ShaderMaterial).dispose();
  }
}

export function updateTornCard(
  group: Group,
  config: Config,
  line: Point[],
  print: Texture,
  seal: Texture,
  frame: CardFrame,
) {
  const tearing = easeInOut(span(frame.tear, SHOWN, TORN));
  // The tip's depth below the top edge. It starts just above the card, and
  // ends far enough past the bottom that the whole tear has opened.
  const tip = lerp(-4, CARD.height + OPENING, tearing);
  const { lift } = config.tear;
  const { overlap, size } = config.seal;
  const placement = sealPlacement(config);
  // Seconds into the bond phase, which starts with the tear.
  const { duration } = config.tear;
  const seconds = frame.tear * duration + frame.bond * config.bondDuration;
  const slide = easeInOut(
    span(
      seconds,
      SLIDE_FROM * duration,
      duration + SLIDE_TO * config.bondDuration,
    ),
  );
  const flat = easeInOut(span(slide, LANDING_FROM, 1));
  const press = Math.sin(Math.PI * span(frame.bond, ...PRESS));
  const take = easeOut(span(frame.bond, ...TAKE));
  const dent = frame.bond >= STAMP ? Math.max(press, KEPT) : press;
  // Each half's offset once flat: parted by the tear, slid together, then
  // pulled apart again.
  const offset = (side: 1 | -1, gap: number) => ({
    x: lerp(side * gap, (-side * overlap) / 2, slide),
    y: side > 0 ? placement.drop * slide : 0,
    z: side > 0 ? OVER * Math.sin(Math.PI * slide) + RESTS * slide : 0,
  });
  const right = offset(1, PARTING);
  const left = offset(-1, PARTING);
  // The paper bends about the tear's overall course, not its jags, or
  // every row would catch the light differently.
  const course = line.map((_, row) => {
    const near = line.slice(Math.max(0, row - 12), row + 13);
    return near.reduce((sum, point) => sum + point.x, 0) / near.length;
  });

  const ink = sealInk(config, frame.sealWet);

  const peels = frame.peels.filter((peel) => peel.reach > 0).map(shaped);

  // A seal-shaped dent, softened over a few px of paper, in a half's own
  // card coordinates.
  const half = size / 2;
  const radius = size * 0.14;
  const dentAt = (x: number, y: number, at: Point) => {
    const qx = Math.abs(x - at.x) - (half - radius);
    const qy = Math.abs(y - at.y) - (half - radius);
    const outside =
      Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
      Math.min(Math.max(qx, qy), 0) -
      radius;
    return 1 - smoothstep((outside + 3) / 6);
  };
  for (const child of group.children) {
    const mesh = child as Half;
    const { side } = mesh.userData;
    // Where the seal meets this half, in its own card coordinates.
    const own = side > 0 ? right : left;
    const sealAt = { x: -own.x, y: placement.y - own.y };
    const attributes = mesh.geometry.attributes;
    const position = attributes.position!.array as Float32Array;
    const rest = attributes.rest!.array as Float32Array;
    const seam = attributes.seam!.array as Float32Array;
    const torn = attributes.torn!.array as Float32Array;
    for (let row = 0; row <= ROWS; row++) {
      const { x: x0, y } = line[row]!;
      const behind = tip - (y + hh);
      const open = smoothstep(behind / OPENING);
      const reached = clamp(behind / 6);
      const width = hw - side * x0 + REACH;
      const shift = offset(side, PARTING * open);
      for (let column = 0; column <= COLUMNS; column++) {
        const i = row * (COLUMNS + 1) + column;
        // Columns crowd toward the seam, where the paper bends.
        const e = -REACH + width * (column / COLUMNS) ** 1.6;
        const x = x0 + side * e;
        const bend = Math.exp(-Math.max(side * (x - course[row]!), 0) / 70);
        const rise = lift * open * bend * (1 - flat);
        const peeled = { x: 0, y: 0, z: 0 };
        if (side > 0) {
          for (const peel of peels) {
            const moved = peelAt(x, y, peel);
            peeled.x += moved.x;
            peeled.y += moved.y;
            peeled.z += moved.z;
          }
        }
        const placed =
          side > 0 && frame.keep
            ? { ...frame.keep, x: frame.keep.x - KEPT_MIDDLE }
            : shift;
        let at = { x: x + peeled.x + placed.x, y: y + peeled.y + placed.y };
        if (side > 0 && frame.keep && frame.genie) {
          at = genie(at, keptBox(frame.keep), frame.genie);
        }
        position[i * 3] = at.x;
        position[i * 3 + 1] = -at.y;
        const pressed = dent > 0 ? DEPTH * dent * dentAt(x, y, sealAt) : 0;
        position[i * 3 + 2] =
          (side > 0 ? rise : -rise * 0.5) + placed.z - pressed + peeled.z;
        rest[i * 2] = y;
        rest[i * 2 + 1] = x + hw;
        seam[i] = e;
        torn[i] = reached;
      }
    }
    for (const name of ["position", "rest", "seam", "torn"]) {
      attributes[name]!.needsUpdate = true;
    }

    const material = mesh.material;
    updatePaperMaterial(material, config);
    const u = material.uniforms;
    u.uPrint!.value = print;
    u.uSeal!.value = seal;
    u.uStamped!.value = take > 0 ? 1 : 0;
    u.uInkTake!.value = take;
    u.uDent!.value = dent;
    (u.uSealAt!.value as Vector2).set(sealAt.x, sealAt.y);
    u.uSealTilt!.value = placement.tilt;
    u.uSealSize!.value = size;
    u.uSealField!.value = ink.field;
    u.uSealPool!.value = ink.pool;
    u.uSealWet!.value = frame.sealWet;
    u.uShown!.value = side > 0 ? frame.shown.yours : frame.shown.theirs;
    u.uShimmer!.value = side > 0 ? frame.shimmer : -1;
    // The curled edge rides higher than the rest of the flap, so its
    // shadow is softer until it lands. Gone, or lifted free, your half
    // shades nothing.
    (u.uOver!.value as Vector2).set(
      frame.keep || !frame.shown.yours ? 1e4 : right.x - left.x,
      right.z + lift * (1 - flat) * 0.5,
    );
  }

  group.matrix.copy(
    new Matrix4()
      .makeTranslation(LANDING.x, -frame.y, 0)
      // The card gives a little under the press.
      .multiply(new Matrix4().makeScale(frame.size, frame.size, frame.size))
      .multiply(new Matrix4().makeTranslation(0, -placement.y, 0))
      .multiply(new Matrix4().makeScale(1 - GIVE * press, 1 - GIVE * press, 1))
      .multiply(new Matrix4().makeTranslation(0, placement.y, 0)),
  );
  group.matrixWorldNeedsUpdate = true;
}

// Your half's box once it's free and lying flat.
const keptBox = (keep: Kept) => ({
  left: KEPT_BOX.left + keep.x - KEPT_MIDDLE,
  right: KEPT_BOX.right + keep.x - KEPT_MIDDLE,
  top: KEPT_BOX.top + keep.y,
  bottom: KEPT_BOX.bottom + keep.y,
});

// The Dock's genie, into a point below: first the bottom pinches, the
// sides curving down into a funnel to the point, then the sheet pours down
// through it, faster and faster, the bottom going first.
const GENIE_PINCH = 0.45;
const GENIE_POUR = 0.3;
function genie(
  at: Point,
  box: { left: number; right: number; top: number; bottom: number },
  { progress, to }: { progress: number; to: Point },
): Point {
  const pinch = easeInOut(span(progress, 0, GENIE_PINCH));
  const pour = span(progress, GENIE_POUR, 1) ** 2;
  const fall = to.y - box.top;
  const y = Math.min(to.y, at.y + pour * fall);
  const funnel = (1 - Math.cos(Math.PI * clamp((y - box.top) / fall))) / 2;
  const narrow = funnel * pinch;
  const left = lerp(box.left, to.x, narrow);
  const right = lerp(box.right, to.x, narrow);
  return {
    x: lerp(left, right, (at.x - box.left) / (box.right - box.left)),
    y,
  };
}

const smoothstep = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
