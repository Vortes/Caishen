import { Matrix4, Quaternion, Vector3 } from "three";
import { cloudHit, gatherProgress, poofProgress } from "./cloud";
import { config } from "./config";
import { clamp, easeInOut, span } from "./motion";
import { NEAR_DRIFT } from "./sky-shader";
import { timeline } from "./timeline";
import {
  airSeconds,
  flightPose,
  flightSeconds,
  followed,
  viewTilt,
} from "./flight";
import { CAMERA_DISTANCE, CARD, LANDING, SCENE } from "./geometry";
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
  // The cloud on the plane's path: where it sits, how far it has gathered,
  // and how far it has burst.
  cloud: { matrix: Matrix4; gather: number; poof: number };
};

// A vapor trail: where a wingtip has been, newest first, and how many
// seconds ago it was at each point.
export type Trail = { points: Vector3[]; ages: number[] };
const TRAIL_POINTS = 48;

// Sheet (u across, v along, z) to card-centered world axes: the length
// runs along x with the nose to the right, the center crease along y = 0.
// prettier-ignore
export const sheet = new Matrix4().set(
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
export const SEGMENTS = [0.34, 0.14, 0.2, 0.16, 0.16];

const world = (x: number, y: number, z: number) =>
  new Matrix4().makeTranslation(x, -y, z);

export function arrivalProgress(elapsed: number) {
  const flying = flightSeconds();
  return {
    flying: Math.min(elapsed, flying),
    open: clamp((elapsed - flying) / timeline.unfold.duration),
  };
}

export const arrivalSeconds = () => flightSeconds() + timeline.unfold.duration;

// Where the plane's middle has to sit for the opened card to land in the
// middle of the scene.
const CENTER = { x: LANDING.x + middle, y: LANDING.y };

// The camera follows the plane in to land. From where it starts following,
// it pans in step with how far the plane has come over the table, so the
// plane keeps its line on screen, slowing into the middle of the frame
// instead of doubling back. The pan eases in over the first stretch so the
// plane's path doesn't kink where the camera starts moving. While the sheet
// opens, the camera turns to square the card up, about the card's middle.
// As a matrix, it's the world as seen from there.
const EASE_IN = 0.25;
function camera(elapsed: number) {
  const rest = flightPose(flightSeconds());
  const come = followed(elapsed);
  const pan =
    (come < EASE_IN ? (come * come) / (2 * EASE_IN) : come - EASE_IN / 2) /
    (1 - EASE_IN / 2);
  const square = easeInOut(span(arrivalProgress(elapsed).open, 0, 0.4));
  const turn = new Quaternion().slerp(rest.facing.clone().invert(), square);
  return world(CENTER.x, CENTER.y, 0)
    .multiply(new Matrix4().makeRotationFromQuaternion(turn))
    .multiply(world(-CENTER.x, -CENTER.y, 0))
    .multiply(world((CENTER.x - rest.x) * pan, (CENTER.y - rest.y) * pan, 0));
}

// Flying keel-down (rolled half a turn from the sheet's frame), nose
// pitched along its path, leaning as the throw dictates. The plane's middle
// follows the flight, on the table before the camera's view.
function flyingMatrix(seconds: number) {
  const pose = flightPose(seconds);
  const [roll, pitch] = jolt(seconds);
  return (
    world(pose.x, pose.y, pose.z)
      .multiply(new Matrix4().makeRotationFromQuaternion(pose.facing))
      .multiply(new Matrix4().makeRotationX(roll))
      .multiply(new Matrix4().makeRotationY(pitch))
      // Keel down: the sheet's frame is half a turn from the flying plane's.
      .multiply(new Matrix4().makeRotationX(Math.PI))
      .multiply(new Matrix4().makeTranslation(-middle, 0, 0))
      .multiply(sheet)
  );
}

// Hitting the cloud knocks the plane about: a quick, fading wobble in roll
// and pitch.
function jolt(seconds: number): [number, number] {
  if (config.cloud.size <= 0) return [0, 0];
  const since = seconds - cloudHit().contact;
  if (since <= 0) return [0, 0];
  const fade = Math.exp(-since / 0.18);
  return [
    0.2 * Math.sin(since * 34) * fade,
    0.08 * Math.sin(since * 23 + 1) * fade,
  ];
}

// The cloud drifts across the screen with the sky's near clouds, timed so
// it's where the plane meets it at the moment they touch. Its drift is
// across the screen, not the world, so the camera's turn doesn't bend it;
// nearer the camera than the table, it moves less to cover the same ground.
function cloudFrame(elapsed: number) {
  const { center, contact } = cloudHit();
  const speed =
    NEAR_DRIFT *
    SCENE.height *
    config.sky.drift *
    ((CAMERA_DISTANCE - center.z) / CAMERA_DISTANCE);
  const drifted = -speed * (elapsed - contact);
  return {
    matrix: new Matrix4()
      .makeTranslation(drifted, 0, 0)
      .multiply(viewTilt())
      .multiply(camera(elapsed))
      .multiply(new Matrix4().makeTranslation(center.x, center.y, center.z)),
    gather: gatherProgress(elapsed),
    poof: poofProgress(elapsed),
  };
}

// The trailing wingtips of the folded plane, in sheet coordinates: the
// furthest-out points on each side among those near the tail, so vapor
// streams back from behind the wings.
let tips: Vector3[] | null = null;
function wingtips() {
  if (tips) return tips;
  const { keel, dihedral } = config.plane;
  const { positions } = shapeSheet(folded(keel, dihedral));
  const points: Vector3[] = [];
  for (let i = 0; i < positions.length; i += 3)
    points.push(new Vector3(positions[i], positions[i + 1], positions[i + 2]));
  const length = Math.max(...points.map((point) => point.y));
  const tail = points.filter((point) => point.y < length * 0.15);
  tips = [-1, 1].map((side) =>
    tail.reduce((best, point) =>
      point.x * side > best.x * side ? point : best,
    ),
  );
  return tips;
}

// Each wingtip sheds vapor while the plane is in the air. The flight is a
// pure function of time, so the trail is just where each tip was over the
// last moments, recomputed every frame and seen from where the camera is
// now; it stops growing at touchdown and fades out on its own.
function vaporTrails(elapsed: number): Trail[] {
  const { life, opacity } = config.trail;
  if (life <= 0 || opacity <= 0) return [];
  const newest = Math.min(elapsed, airSeconds());
  const oldest = Math.max(0, elapsed - life);
  if (newest <= oldest) return [];
  const trails = wingtips().map(() => ({
    points: [] as Vector3[],
    ages: [] as number[],
  }));
  const view = viewTilt().multiply(camera(elapsed));
  for (let i = 0; i < TRAIL_POINTS; i++) {
    const at = newest - ((newest - oldest) * i) / (TRAIL_POINTS - 1);
    const matrix = view.clone().multiply(flyingMatrix(at));
    wingtips().forEach((tip, index) => {
      trails[index]!.points.push(tip.clone().applyMatrix4(matrix));
      trails[index]!.ages.push(elapsed - at);
    });
  }
  return trails;
}

export function arrivalFrame(elapsed: number): PlaneFrame {
  const { keel, dihedral } = config.plane;
  const { flying, open } = arrivalProgress(elapsed);
  const trails = vaporTrails(elapsed);

  if (open === 0) {
    return {
      shape: folded(keel, dihedral),
      matrix: viewTilt()
        .multiply(camera(elapsed))
        .multiply(flyingMatrix(flying)),
      opacity: 1,
      trails,
      cloud: cloudFrame(elapsed),
    };
  }

  // Each step starts a little before the last finishes, by the stagger.
  const steps: number[] = [];
  let start = 0;
  for (const length of SEGMENTS) {
    const from = Math.max(0, start - length * timeline.unfold.stagger);
    steps.push(easeInOut(span(open, from, start + length)));
    start += length;
  }
  const [body, ...flat] = steps as [number, ...number[]];
  const angles = folded(keel, dihedral).folds.slice();
  unfoldOrder.forEach((group, index) => {
    for (const fold of group) angles[fold] = Math.PI * (1 - flat[index]!);
  });
  // The sheet opens where the plane came to rest; the camera brings it
  // square to the middle of the frame.
  const rest = flightPose(flightSeconds());
  return {
    shape: { folds: angles, body: 1 - body, keel, dihedral },
    matrix: viewTilt(easeInOut(span(open, 0.4, 0.93)))
      .multiply(camera(elapsed))
      .multiply(world(rest.x, rest.y, 60 * Math.sin(Math.PI * body)))
      .multiply(new Matrix4().makeRotationFromQuaternion(rest.facing))
      .multiply(new Matrix4().makeRotationX(Math.PI * (1 - body)))
      .multiply(new Matrix4().makeTranslation(-middle, 0, 0))
      .multiply(sheet),
    opacity: 1 - span(open, 0.94, 1),
    trails,
    cloud: cloudFrame(elapsed),
  };
}
