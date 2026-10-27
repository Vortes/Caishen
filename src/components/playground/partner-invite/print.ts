import { CanvasTexture, SRGBColorSpace } from "three";
import { colors, type Config } from "./config";
import { CARD } from "./geometry";
import { signature, strokeSegments } from "./ink";

// What's printed on the card, shared by the SVG card and the 3D sheet.
export const PARTNER = "Jordan Lee";
export const PARTNER_SIGNATURE = { x: -250, y: 34, width: 180, height: 46 };

const RESOLUTION = 3;
const serif = "ui-serif, Georgia, serif";

// The invitation as a texture for the inside of the folded sheet, laid out
// like the SVG card so the two match when the sheet lies flat.
export function printTexture(config: Config) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD.width * RESOLUTION;
  canvas.height = CARD.height * RESOLUTION;
  const context = canvas.getContext("2d")!;
  context.scale(RESOLUTION, RESOLUTION);
  context.translate(CARD.width / 2, CARD.height / 2);
  const palette = colors(config);

  const text = (
    value: string,
    x: number,
    y: number,
    font: string,
    spacing = 0,
  ) => {
    context.font = font;
    context.letterSpacing = `${spacing}px`;
    context.textAlign = "center";
    context.fillStyle = palette.printed;
    context.fillText(value, x, y);
  };
  text("Jordan & you", 0, -112, `italic 28px ${serif}`);
  text("ARE INVITED TO SHARE COSTS ON CAISHEN", 0, -84, `10.5px ${serif}`, 2.3);
  text("October 26, 2026", 0, -62, `9px ${serif}`, 1.8);
  context.save();
  context.translate(0, 46);
  context.rotate(-Math.PI / 2);
  context.globalAlpha = 0.7;
  text("CAISHEN · CAISHEN", 0, 0, `8px ${serif}`, 4);
  context.restore();

  context.strokeStyle = palette.printed;
  context.globalAlpha = 0.5;
  context.lineWidth = 0.6;
  for (const side of [-1, 1]) {
    context.beginPath();
    context.moveTo(side * 40, 92);
    context.lineTo(side * 240, 92);
    context.stroke();
  }
  context.globalAlpha = 1;
  text(PARTNER.toUpperCase(), -140, 110, `9px ${serif}`, 1.8);
  text("YOU", 140, 110, `9px ${serif}`, 1.8);

  // The partner signed before folding, so their ink is dry.
  const ink = palette.ink(0);
  context.strokeStyle = ink;
  context.fillStyle = ink;
  context.lineCap = "round";
  const pool = config.ink.thick * 0.42 * config.ink.pool;
  for (const stroke of signature(config.seed, "partner", PARTNER_SIGNATURE)) {
    for (const segment of strokeSegments(stroke, config)) {
      context.lineWidth = segment.width;
      context.beginPath();
      context.moveTo(segment.x1, segment.y1);
      context.lineTo(segment.x2, segment.y2);
      context.stroke();
    }
    const ends = [stroke.points[0], stroke.points[stroke.points.length - 1]];
    for (const end of ends) {
      if (!end || pool <= 0) continue;
      context.beginPath();
      context.arc(end.x, end.y, pool + 0.4, 0, Math.PI * 2);
      context.fill();
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.anisotropy = 4;
  return texture;
}
