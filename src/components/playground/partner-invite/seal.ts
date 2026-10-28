import { CanvasTexture, NoColorSpace } from "three";
import { config } from "./config";
import { lerp } from "./motion";
import { random } from "./random";
import { oklchLinear } from "./paper-material";

// The tally seal: a hanko stamped across both halves once they overlap.
// The mark is cut into the stone, so the characters print as bare
// paper inside a field of seal ink.

// Where the seal lands on the bonded card, and how the halves sit when it
// does: a hand never stamps quite straight, or lays the halves quite level.
const placementRng = random(config.seed, "seal");
export const sealPlacement = {
  y: 34,
  tilt: ((placementRng() - 0.5) * 8 * Math.PI) / 180,
  drop: (placementRng() < 0.5 ? -1 : 1) * 4,
};

// The impression as masks, for the paper shader to ink: red is the field,
// green where ink pooled, blue the gloss along the lit edges while wet.
// Worn spots, where the stone didn't take ink, are missing from all three.
// The texture spans twice the seal's size, centered on it.
const RESOLUTION = 4;
export function sealTexture() {
  const { size, wear } = config.seal;
  const { pool } = config.ink;
  const span = size * 2;
  const pixels = Math.round(span * RESOLUTION);
  const half = size / 2;
  const rx = size * 0.14;
  const layer = (draw: (context: CanvasRenderingContext2D) => void) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = pixels;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "black";
    context.fillRect(0, 0, pixels, pixels);
    context.scale(RESOLUTION, RESOLUTION);
    context.translate(size, size);
    context.fillStyle = context.strokeStyle = "white";
    draw(context);
    // The characters are cut into the stone: bare paper in every layer.
    context.globalCompositeOperation = "destination-out";
    context.font = `700 ${size * 0.36}px "Songti SC", "STSong", "Noto Serif CJK SC", serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("財神", 0, size * 0.05);
    context.globalCompositeOperation = "source-over";
    return context.getImageData(0, 0, pixels, pixels).data;
  };

  const field = layer((context) => {
    context.beginPath();
    context.roundRect(-half, -half, size, size, rx);
    context.fill();
  });
  // Ink pools where the stone's edge meets the paper, and in a corner or
  // two where the hand pressed hardest.
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  const poolRng = random(config.seed, "seal-pool");
  const pooled = corners.filter(() => poolRng() < 0.5);
  const pools = layer((context) => {
    if (pool <= 0) return;
    context.lineWidth = 0.6 + pool * 2.6;
    context.beginPath();
    context.roundRect(
      -half + 0.8,
      -half + 0.8,
      size - 1.6,
      size - 1.6,
      rx - 0.8,
    );
    context.stroke();
    for (const [cx, cy] of pooled) {
      context.beginPath();
      context.arc(
        cx * (half - size * 0.09),
        cy * (half - size * 0.09),
        pool * size * 0.07,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  });
  const gloss = layer((context) => {
    context.lineWidth = 1.2;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(-half + 3, half - size * 0.2);
    context.lineTo(-half + 3, -half + size * 0.14 + 3);
    context.quadraticCurveTo(
      -half + 3,
      -half + 3,
      -half + size * 0.14 + 3,
      -half + 3,
    );
    context.lineTo(half - size * 0.2, -half + 3);
    context.stroke();
  });

  const worn = wearNoise(config.seed, pixels, 0.55 / RESOLUTION);
  const threshold = 0.5 + (0.74 - wear * 0.22 - 0.5) * 1.4;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = pixels;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(pixels, pixels);
  for (let i = 0; i < pixels * pixels; i++) {
    const kept = 1 - Math.min(1, Math.max(0, 14 * (worn[i]! - threshold)));
    image.data[i * 4] = field[i * 4]! * kept;
    image.data[i * 4 + 1] = pools[i * 4]! * kept;
    image.data[i * 4 + 2] = gloss[i * 4]! * kept;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  return texture;
}

// Two octaves of value noise, about as speckled as the stone's wear.
function wearNoise(seed: number, pixels: number, frequency: number) {
  const rng = random(seed * 7, "seal-wear");
  const octave = (scale: number) => {
    const cells = Math.ceil(pixels * scale) + 2;
    const grid = Float32Array.from({ length: cells * cells }, rng);
    return (x: number, y: number) => {
      const gx = x * scale;
      const gy = y * scale;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = gx - ix;
      const fy = gy - iy;
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      const at = (i: number, j: number) => grid[j * cells + i]!;
      return lerp(
        lerp(at(ix, iy), at(ix + 1, iy), ux),
        lerp(at(ix, iy + 1), at(ix + 1, iy + 1), ux),
        uy,
      );
    };
  };
  const coarse = octave(frequency);
  const fine = octave(frequency * 2);
  const values = new Float32Array(pixels * pixels);
  for (let y = 0; y < pixels; y++) {
    for (let x = 0; x < pixels; x++) {
      values[y * pixels + x] = 0.65 * coarse(x, y) + 0.35 * fine(x, y);
    }
  }
  return values;
}

// Seal ink is darker and richer while wet, like the pen's.
export function sealInk(wet: number) {
  const { hue, chroma } = config.accent;
  return {
    field: oklchLinear(lerp(0.56, 0.47, wet), chroma * lerp(1, 1.12, wet), hue),
    pool: oklchLinear(lerp(0.45, 0.38, wet), chroma * 1.05, hue),
  };
}
