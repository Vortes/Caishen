import { lerp, random, type Config } from "./config";

export type Point = { x: number; y: number };

// The scene is drawn in a fixed 1200 × 760 box; the card lands in the middle.
export const SCENE = { width: 1200, height: 760 };
export const CARD = { width: 560, height: 340 };
export const LANDING = { x: 600, y: 360 };
// The 3D camera sits this far straight above the middle of the scene.
export const CAMERA_DISTANCE = 1600;
// The slot sits under the card; the chevron sits halfway across the gap.
export const SLOT = { y: 580, gap: 84 };

const hw = CARD.width / 2;
const hh = CARD.height / 2;

const p = (x: number, y: number): Point => ({ x, y });

// Deckle: a handmade sheet's edge is never straight. Points only move
// inward, so the card keeps its size.
export function deckleOutline(config: Config): Point[] {
  const rng = random(config.seed, "deckle");
  const amount = config.paper.deckle;
  const points: Point[] = [];
  const edge = (from: Point, to: Point, inward: Point) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(2, Math.round(length / 5));
    let drift = 0;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      drift = drift * 0.6 + rng() * 0.4;
      const depth = drift * amount;
      points.push({
        x: lerp(from.x, to.x, t) + inward.x * depth,
        y: lerp(from.y, to.y, t) + inward.y * depth,
      });
    }
  };
  edge(p(-hw, -hh), p(hw, -hh), p(0, 1));
  edge(p(hw, -hh), p(hw, hh), p(-1, 0));
  edge(p(hw, hh), p(-hw, hh), p(0, -1));
  edge(p(-hw, hh), p(-hw, -hh), p(1, 0));
  return points;
}

export const path = (points: Point[], closed = false) =>
  points
    .map(
      (point, index) =>
        `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(" ") + (closed ? " Z" : "");
