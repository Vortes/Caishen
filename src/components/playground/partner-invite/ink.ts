import { clamp, lerp, random, type Config } from "./config";

// A pen stroke in card coordinates; t is milliseconds since the pen went
// down. `dried` is when the pen lifted (performance.now()), or 0 for ink
// that was dry before the scene began.
export type Stroke = {
  points: { x: number; y: number; t: number }[];
  dried: number;
};

// How wet a stroke still is, 1 while drawing down to 0 once dry.
export function wetness(stroke: Stroke, now: number, config: Config) {
  if (stroke.dried === 0) return 0;
  if (stroke.dried < 0) return 1;
  return 1 - clamp((now - stroke.dried) / (config.ink.dry * 1000));
}

// Slow pen, wide line; fast pen, thin line. Smoothed so width never jumps.
export function strokeSegments(stroke: Stroke, config: Config) {
  const { thin, thick } = config.ink;
  const segments: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
  }[] = [];
  let width = thick * 0.8;
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1]!;
    const b = stroke.points[i]!;
    const speed = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t);
    width = lerp(width, lerp(thick, thin, clamp(speed / 1.1)), 0.35);
    segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, width });
  }
  return segments;
}

// A loopy signature from a prolate cycloid, one loop per letter, with a
// capital up front and an underline flourish. Seeded, so the partner signs
// the same way every time for the same config.
export function signature(
  seed: number,
  salt: string,
  box: { x: number; y: number; width: number; height: number },
): Stroke[] {
  const rng = random(seed, salt);
  const letters = 4 + Math.floor(rng() * 4);
  const advance = 1;
  // A tall capital, then lowercase loops with the odd ascender.
  const loops = Array.from({ length: letters + 2 }, (_, index) => ({
    width: advance * (1.2 + rng() * 0.8),
    height:
      index === 0
        ? 2.6 + rng() * 0.6
        : rng() < 0.25
          ? 2.1 + rng() * 0.5
          : 0.9 + rng() * 0.8,
  }));
  const slant = 0.3 + rng() * 0.2;
  const raw: { x: number; y: number; t: number }[] = [];
  let time = 0;
  let last: { x: number; y: number } | null = null;
  for (let s = -Math.PI; s <= letters * 2 * Math.PI; s += 0.09) {
    const index = Math.max(0, Math.floor((s + Math.PI) / (2 * Math.PI)));
    const loop = loops[index]!;
    const y = -loop.height * Math.cos(s) - s * 0.03;
    const point = { x: advance * s - loop.width * Math.sin(s) - y * slant, y };
    if (last) {
      // Slow at the top and bottom of each loop, quick through the middle.
      const speed = 0.035 * (0.3 + 0.7 * Math.abs(Math.sin(s)));
      time += Math.hypot(point.x - last.x, point.y - last.y) / speed;
    }
    raw.push({ ...point, t: time });
    last = point;
  }
  const end = raw[raw.length - 1]!;
  const flourish: { x: number; y: number; t: number }[] = [];
  const startX = raw[0]!.x + (end.x - raw[0]!.x) * (0.1 + rng() * 0.2);
  for (let i = 0; i <= 30; i++) {
    const u = i / 30;
    flourish.push({
      x: lerp(startX, end.x + 1.5, u),
      y: 2.4 + Math.sin(u * Math.PI) * 0.4 - u * (0.5 + rng() * 0.05),
      t: u * u * 260,
    });
  }

  const all = [...raw, ...flourish];
  const minX = Math.min(...all.map((point) => point.x));
  const maxX = Math.max(...all.map((point) => point.x));
  const minY = Math.min(...all.map((point) => point.y));
  const maxY = Math.max(...all.map((point) => point.y));
  const scale = Math.min(box.width / (maxX - minX), box.height / (maxY - minY));
  const fit = (point: { x: number; y: number; t: number }) => ({
    x:
      box.x +
      (point.x - minX) * scale +
      (box.width - (maxX - minX) * scale) / 2,
    y:
      box.y +
      (point.y - minY) * scale +
      (box.height - (maxY - minY) * scale) / 2,
    // Scaling the shape changes speeds; scale time too so widths hold.
    t: point.t * (scale / 20),
  });
  return [
    { points: raw.map(fit), dried: 0 },
    { points: flourish.map(fit), dried: 0 },
  ];
}
