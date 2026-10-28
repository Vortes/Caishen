import { CanvasTexture, NoColorSpace } from "three";
import type { Config } from "./config";
import { CARD, deckleOutline } from "./geometry";

// The printed card's deckled outline as a mask for the 3D paper, cut from
// the same points as the SVG card so the edges match where they hand over.

const RESOLUTION = 3;

let cached: { key: string; texture: CanvasTexture } | null = null;

export function deckleMask(config: Config) {
  const key = JSON.stringify([config.seed, config.paper.deckle]);
  if (cached?.key === key) return cached.texture;
  cached?.texture.dispose();

  const canvas = document.createElement("canvas");
  canvas.width = CARD.width * RESOLUTION;
  canvas.height = CARD.height * RESOLUTION;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "black";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(RESOLUTION, RESOLUTION);
  context.translate(CARD.width / 2, CARD.height / 2);
  context.fillStyle = "white";
  context.beginPath();
  deckleOutline(config).forEach((point, index) =>
    index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
  );
  context.closePath();
  context.fill();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  texture.anisotropy = 4;
  cached = { key, texture };
  return texture;
}
