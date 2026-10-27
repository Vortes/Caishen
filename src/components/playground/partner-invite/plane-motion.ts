import { Matrix4, Vector3 } from "three";
import { clamp, easeInOut, span, type Config } from "./config";
import { airSeconds, flightPose, flightSeconds, viewTilt } from "./flight";
import { CARD, LANDING } from "./geometry";
import {
  PLANE_CENTER,
  folded,
  shapeSheet,
  unfoldOrder,
  type PlaneShape,
} from "./harrier";

// The 3D plane at one moment: its shape, where the sheet sits in the world
// (SVG x, flipped SVG y, z toward the viewer), and how visible it is.
export type PlaneFrame = {
  shape: PlaneShape;
  matrix: Matrix4;
  opacity: number;
  trails: Trail[];
};

// A vapor trail: where a wingtip has been, newest first, and how many
// seconds ago it was at each point.
export type Trail = { points: Vector3[]; ages: number[] };
const TRAIL_POINTS = 48;

// Sheet (u across, v along, z) to card-centered world axes: the length
// runs along x with the nose to the right, the center crease along y = 0.
// prettier-ignore
const sheet = new Matrix4().set(
  0, 1, 0, -CARD.width / 2,
  -1, 0, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
);
// Card-local x of the folded plane's middle, so it flies centered.
const middle = PLANE_CENTER - CARD.width / 2;
// How the unfolding is divided: open the fuselage while turning the sheet
// over (a plane's wing tops are the back of the sheet, and the invitation
// is on the front), then undo the flat folds, last first.
const SEGMENTS = [0.34, 0.14, 0.2, 0.16, 0.16];

const world = (x: number, y: number, z: number) =>
  new Matrix4().makeTranslation(x, -y, z);

const tilt = viewTilt;

export function arrivalProgress(config: Config, elapsed: number) {
  const flying = flightSeconds(config);
  return {
    flying: Math.min(elapsed, flying),
    open: clamp((elapsed - flying) / config.unfold.duration),
  };
}

export const arrivalSeconds = (config: Config) =>
  flightSeconds(config) + config.unfold.duration;

// Flying keel-down (rolled half a turn from the sheet's frame), nose
// pitched along its path, leaning as the throw dictates. The plane's middle
// follows the flight; at rest it sits exactly where the unfold begins.
function flyingMatrix(config: Config, seconds: number) {
  const pose = flightPose(config, seconds);
  return (
    tilt(config, 0)
      .multiply(world(pose.x, pose.y, pose.z))
      .multiply(new Matrix4().makeRotationFromQuaternion(pose.facing))
      // Keel down: the sheet's frame is half a turn from the flying plane's.
      .multiply(new Matrix4().makeRotationX(Math.PI))
      .multiply(new Matrix4().makeTranslation(-middle, 0, 0))
      .multiply(sheet)
  );
}

// The trailing wingtips of the folded plane, in sheet coordinates: the
// furthest-out points on each side among those near the tail, so vapor
// streams back from behind the wings.
let tipCache: { key: string; tips: Vector3[] } | null = null;
function wingtips(config: Config) {
  const { keel, dihedral } = config.plane;
  const key = `${keel}:${dihedral}`;
  if (tipCache?.key === key) return tipCache.tips;
  const { positions } = shapeSheet(folded(keel, dihedral));
  const points: Vector3[] = [];
  for (let i = 0; i < positions.length; i += 3)
    points.push(new Vector3(positions[i], positions[i + 1], positions[i + 2]));
  const length = Math.max(...points.map((point) => point.y));
  const tail = points.filter((point) => point.y < length * 0.15);
  const tips = [-1, 1].map((side) =>
    tail.reduce((best, point) =>
      point.x * side > best.x * side ? point : best,
    ),
  );
  tipCache = { key, tips };
  return tips;
}

// Each wingtip sheds vapor while the plane is in the air. The flight is a
// pure function of time, so the trail is just where each tip was over the
// last moments, recomputed every frame; it stops growing at touchdown and
// fades out on its own.
function vaporTrails(config: Config, elapsed: number): Trail[] {
  const { life, opacity } = config.trail;
  if (life <= 0 || opacity <= 0) return [];
  const newest = Math.min(elapsed, airSeconds(config));
  const oldest = Math.max(0, elapsed - life);
  if (newest <= oldest) return [];
  const tips = wingtips(config);
  const trails = tips.map(() => ({
    points: [] as Vector3[],
    ages: [] as number[],
  }));
  for (let i = 0; i < TRAIL_POINTS; i++) {
    const at = newest - ((newest - oldest) * i) / (TRAIL_POINTS - 1);
    const matrix = flyingMatrix(config, at);
    tips.forEach((tip, index) => {
      trails[index]!.points.push(tip.clone().applyMatrix4(matrix));
      trails[index]!.ages.push(elapsed - at);
    });
  }
  return trails;
}

export function arrivalFrame(config: Config, elapsed: number): PlaneFrame {
  const { keel, dihedral } = config.plane;
  const { flying, open } = arrivalProgress(config, elapsed);
  const trails = vaporTrails(config, elapsed);

  if (open === 0) {
    return {
      shape: folded(keel, dihedral),
      matrix: flyingMatrix(config, flying),
      opacity: 1,
      trails,
    };
  }

  // Each step starts a little before the last finishes, by the stagger.
  const steps: number[] = [];
  let start = 0;
  for (const length of SEGMENTS) {
    const from = Math.max(0, start - length * config.unfold.stagger);
    steps.push(easeInOut(span(open, from, start + length)));
    start += length;
  }
  const [body, ...flat] = steps as [number, ...number[]];
  const angles = folded(keel, dihedral).folds.slice();
  unfoldOrder.forEach((group, index) => {
    for (const fold of group) angles[fold] = Math.PI * (1 - flat[index]!);
  });
  return {
    shape: { folds: angles, body: 1 - body, keel, dihedral },
    matrix: tilt(config, easeInOut(span(open, 0.4, 0.93)))
      .multiply(world(LANDING.x, LANDING.y, 60 * Math.sin(Math.PI * body)))
      .multiply(new Matrix4().makeRotationX(Math.PI * (1 - body)))
      .multiply(sheet),
    opacity: 1 - span(open, 0.94, 1),
    trails,
  };
}
