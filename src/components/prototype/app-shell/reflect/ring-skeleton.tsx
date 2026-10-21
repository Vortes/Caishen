"use client";

import { useEffect, useRef } from "react";
import {
  BAYER,
  CELL,
  easeInOutCubic,
  OFF_TIER,
  prefersReducedMotion,
} from "~/components/dither-kit/dither-paint";

// The breakdown ring's bone: the donut's own ordered-dither texture, dense at
// the rim and thinning toward the hole, in the skeleton's colors instead of a
// series hue. The shine is the same band the Skeleton primitive sweeps, with
// the same angle, width, and period, laid out in window coordinates, so it
// crosses the ring as it crosses the bones around it. The shine only blends
// each cell's color; it never changes which cells are lit. With 16 dither
// thresholds, a moving band that thinned or filled the pattern switched
// whole sixteenths of the ring at once, and the ring flickered.
//
// When the spending arrives, the chart sweeps its slices in clockwise from
// the top. With `sweep` set, the ring follows the same sweep, clearing where
// the slices have reached, so the color replaces it instead of starting from
// an empty stage.

// The loaded chart's innerRadius, so the hole lines up.
const INNER = 0.62;
// The gradient's 100deg direction, and the shine's half-width as a share of
// the gradient line (transparent at 40%, peak at 50%).
const DIRECTION = {
  x: Math.sin((100 * Math.PI) / 180),
  y: -Math.cos((100 * Math.PI) / 180),
};
const HALF_BAND = 0.1;
const TOP = -Math.PI / 2;
const TAU = Math.PI * 2;
const TRAIL = 0.12;
// Bone weight: lit cells near the rim are the full bone, thinning to this
// toward the hole, so the ring reads as heavy as the bones beside it.
const FLOOR = 0.6;

type Rgb = [number, number, number];

// A CSS time in ms. Browsers may report a token written as "1600ms" as
// "1.6s", so the unit has to be read, not assumed.
function milliseconds(time: string) {
  const value = parseFloat(time);
  return time.trim().endsWith("ms") ? value : value * 1000;
}

export function RingSkeleton({
  size,
  sweep,
  onSwept,
}: {
  size: number;
  // The chart's sweep-in duration, in ms.
  sweep?: number;
  onSwept?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const cells = Math.max(8, Math.round(size / CELL));
    canvas.width = cells;
    canvas.height = cells;
    const image = context.createImageData(cells, cells);

    // Token values can be any CSS color (the palettes use oklch), so a 1px
    // canvas turns each into the sRGB bytes the image data needs.
    const probe = document.createElement("canvas").getContext("2d", {
      willReadFrequently: true,
    })!;
    const toRgb = (color: string): Rgb => {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = color;
      probe.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    };
    let colors = { key: "", bone: [0, 0, 0] as Rgb, shine: [0, 0, 0] as Rgb };
    const readColors = () => {
      const style = getComputedStyle(canvas);
      const bone = style.getPropertyValue("--skeleton-bone");
      const shine = style.getPropertyValue("--skeleton-shine");
      const key = `${bone}|${shine}`;
      if (key !== colors.key)
        colors = { key, bone: toRgb(bone), shine: toRgb(shine) };
      return colors;
    };

    const still = prefersReducedMotion();
    const period = milliseconds(
      getComputedStyle(canvas).getPropertyValue("--duration-shimmer"),
    );
    const start = performance.now();
    const radius = cells / 2;
    const rim = radius - 1;
    const hole = radius * INNER;

    const paint = (now: number) => {
      const { bone, shine } = readColors();
      // The chart starts its sweep a frame or two after this one, so the
      // ring trails it slightly: an overlap, never a gap.
      const revealed = sweep
        ? TOP + easeInOutCubic(Math.min(1, (now - start) / sweep)) * TAU - TRAIL
        : TOP;
      // Where the band's center sits, in window pixels along its direction:
      // from past the right edge to past the left over one period.
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const line = 2 * vw * DIRECTION.x + vh * Math.abs(DIRECTION.y);
      const progress = ((now - start) % period) / period;
      const centerX = 2 * vw * (1 - progress);
      const rect = canvas.getBoundingClientRect();
      const scale = rect.width / cells;
      const data = image.data;
      for (let y = 0; y < cells; y++) {
        for (let x = 0; x < cells; x++) {
          const i = (y * cells + x) * 4;
          const r = Math.hypot(x + 0.5 - radius, y + 0.5 - radius);
          let angle = Math.atan2(y + 0.5 - radius, x + 0.5 - radius);
          while (angle < TOP) angle += TAU;
          if (r < hole || r > radius || angle < revealed) {
            data[i + 3] = 0;
            continue;
          }
          let glow = 0;
          if (!still) {
            const along =
              (rect.left + (x + 0.5) * scale - centerX) * DIRECTION.x +
              (rect.top + (y + 0.5) * scale - vh / 2) * DIRECTION.y;
            glow = Math.max(0, 1 - Math.abs(along) / (HALF_BAND * line));
          }
          const density = (r - hole) / (radius - hole);
          const lit = r >= rim || density > BAYER[y & 3]![x & 3]!;
          const strength = FLOOR + density * (1 - FLOOR);
          data[i] = bone[0] + (shine[0] - bone[0]) * glow;
          data[i + 1] = bone[1] + (shine[1] - bone[1]) * glow;
          data[i + 2] = bone[2] + (shine[2] - bone[2]) * glow;
          data[i + 3] = 255 * (lit ? strength : strength * OFF_TIER);
        }
      }
      context.putImageData(image, 0, 0);
    };

    // Without motion the chart appears whole, so there's nothing to hand off.
    if (still) {
      if (sweep) onSwept?.();
      else paint(start);
      return;
    }
    let frame = requestAnimationFrame(function loop(now) {
      paint(now);
      if (sweep && now - start >= sweep + 100) onSwept?.();
      else frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [size, sweep, onSwept]);

  return (
    <canvas
      ref={canvasRef}
      width={0}
      height={0}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}
