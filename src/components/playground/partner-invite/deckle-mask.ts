import { CanvasTexture, NoColorSpace } from "three";
import { CARD, DECKLE } from "./geometry";

// The printed card's deckled outline as a mask for the 3D paper, cut from
// the same points as the SVG card so the edges match where they hand over.

const RESOLUTION = 3;

let mask: CanvasTexture | null = null;

export function deckleMask() {
  if (mask) return mask;
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
  DECKLE.forEach((point, index) =>
    index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y),
  );
  context.closePath();
  context.fill();

  mask = new CanvasTexture(canvas);
  mask.colorSpace = NoColorSpace;
  mask.flipY = false;
  mask.anisotropy = 4;
  return mask;
}
