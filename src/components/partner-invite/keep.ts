import {
  CAMERA_DISTANCE,
  LANDING,
  SCENE,
  type Point,
  type View,
} from "./geometry";
import { clamp, spring } from "./motion";
import { timeline } from "./timeline";
import {
  KEPT_BOX,
  KEPT_FROM,
  fullReach,
  peelShift,
  type Kept,
  type Peel,
} from "./torn-card";
import type { Thrown } from "./use-peel";

// Your half once it's free. It carries on the way it was pulled, as fast
// as it was going, while the peel rolls back out of it and it rises toward
// you, flat and face up. It's held a moment for a sheen of light to sweep
// across it once, then poured down into the bottom of the screen, the way
// a window goes into the Dock.

// How far it rises toward you, and how far inside the screen's edge it
// comes to rest, at the least.
const KEEP_LIFT = 280;
const KEEP_MARGIN = 48;

// The scene's middle, in card coordinates.
const middle = {
  x: SCENE.width / 2 - LANDING.x,
  y: SCENE.height / 2 - LANDING.y,
};

// Where your half's middle can come to rest in the plane `z` above the
// table with all of it still on screen.
function room(z: number, view: View) {
  const near = (CAMERA_DISTANCE - z) / CAMERA_DISTANCE;
  const x = Math.max(
    0,
    (view.width / 2) * near -
      (KEPT_BOX.right - KEPT_BOX.left) / 2 -
      KEEP_MARGIN,
  );
  const y = Math.max(
    0,
    (view.height / 2) * near -
      (KEPT_BOX.bottom - KEPT_BOX.top) / 2 -
      KEEP_MARGIN,
  );
  return {
    x: [middle.x - x, middle.x + x] as const,
    y: [middle.y - y, middle.y + y] as const,
  };
}

// The bottom middle of the screen, just past its edge, as a point in the
// plane `z` above the table: where your half pours in.
export function intoBottom(z: number, view: View): Point {
  const center = SCENE.height / 2;
  const bottom = view.y + view.height + 12;
  return {
    x: middle.x,
    y:
      center +
      ((bottom - center) * (CAMERA_DISTANCE - z)) / CAMERA_DISTANCE -
      LANDING.y,
  };
}

// Your half, `since` seconds after it came free. The peel rolls back out of
// it, carried on a little by the pull that freed it, then settling without
// overshoot so it never curls the other way. Meanwhile its middle carries
// on from where the pull had it, the way it was going and as fast, then
// rises to you: the half moves as one sheet, so the paper never rolls back
// against the pull.
export function freed(
  { along, reach, velocity }: Thrown,
  since: number,
  view: View,
  reducedMotion: boolean,
): { keep: Kept; peel: Peel } {
  if (reducedMotion)
    return { keep: { x: 0, y: 0, z: KEEP_LIFT }, peel: { along, reach: 0 } };
  const { rise, uncurl } = timeline.keep;
  const peel = {
    along,
    reach: clamp(
      spring({ from: reach, to: 0, velocity, duration: uncurl }, since),
      0,
      fullReach(along),
    ),
  };
  const from = peelShift({ along, reach });
  const ahead = peelShift({ along, reach: reach + 1 });
  const shift = peelShift(peel);
  const start = (axis: "x" | "y" | "z") => KEPT_FROM[axis] + from[axis];
  const push = (axis: "x" | "y" | "z") => (ahead[axis] - from[axis]) * velocity;
  // Across the table it glides to a stop where its own speed takes it,
  // short of leaving the screen; toward you it rises with a little give.
  const coast = rise / (2 * Math.PI);
  const bounds = room(KEEP_LIFT, view);
  const glide = (axis: "x" | "y") =>
    clamp(start(axis) + push(axis) * coast, ...bounds[axis]);
  const carry = (axis: "x" | "y" | "z", to: number, bounce: number) =>
    spring(
      {
        from: start(axis),
        to,
        velocity: push(axis),
        duration: rise,
        bounce,
      },
      since,
    ) - shift[axis];
  return {
    keep: {
      x: carry("x", glide("x"), 0),
      y: carry("y", glide("y"), 0),
      z: carry("z", KEEP_LIFT, 0.12),
    },
    peel,
  };
}
