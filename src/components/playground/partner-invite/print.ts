import { CanvasTexture, SRGBColorSpace } from "three";
import { colors, type Config } from "./config";
import { CARD } from "./geometry";
import { signature, strokeSegments, wetness, type Stroke } from "./ink";

// What's printed on the card, shared by the SVG card and the 3D sheet.
export const PARTNER = "Jordan Lee";
export const PARTNER_SIGNATURE = { x: -250, y: 34, width: 180, height: 46 };

// The invitation reads as one sentence from the partner, set flush left on
// their half. It stays clear of the seam: when the halves bond they overlap
// there, and the seal stamps across it.
export const INVITE = {
  left: -250,
  // The sentence never runs past this, so the bond's overlap can't hide it.
  measure: 200,
  name: { y: -108 },
  sentence: {
    y: -80,
    leading: 28,
    lines: ["invited you to join", "Caishen together!"],
  },
  // A signing rule on each half; the partner's sits under their signature.
  rule: {
    y: 92,
    partner: { x1: -250, x2: -50 },
    you: { x1: 40, x2: 240 },
  },
  labels: { y: 112 },
};

// The sentence is set at 24px; a long name shrinks until it fits the
// measure. Serif italic sets at about 0.58em per character.
export const SENTENCE_SIZE = 24;
export const nameSize = (name: string) =>
  Math.min(SENTENCE_SIZE, INVITE.measure / (name.length * 0.58));

const RESOLUTION = 3;
// Labels print lighter than the sentence; matches .cardMeta.
const META_ALPHA = 0.75;
const serif = "ui-serif, Georgia, serif";

// The invitation as a texture for the inside of the folded sheet, laid out
// like the SVG card so the two match when the sheet lies flat. The tear
// prints the user's own signature too, as wet as it is at `now`.
export function printTexture(config: Config, strokes: Stroke[] = [], now = 0) {
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
    align: CanvasTextAlign = "center",
    alpha = 1,
  ) => {
    context.font = font;
    context.letterSpacing = `${spacing}px`;
    context.textAlign = align;
    context.fillStyle = palette.printed;
    context.globalAlpha = alpha;
    context.fillText(value, x, y);
    context.globalAlpha = 1;
  };
  const meta = `10px ${serif}`;
  text(
    PARTNER,
    INVITE.left,
    INVITE.name.y,
    `italic ${nameSize(PARTNER)}px ${serif}`,
    0,
    "left",
  );
  INVITE.sentence.lines.forEach((line, index) =>
    text(
      line,
      INVITE.left,
      INVITE.sentence.y + index * INVITE.sentence.leading,
      `italic ${SENTENCE_SIZE}px ${serif}`,
      0,
      "left",
    ),
  );

  context.strokeStyle = palette.printed;
  context.globalAlpha = 0.35;
  context.lineWidth = 0.6;
  for (const { x1, x2 } of [INVITE.rule.partner, INVITE.rule.you]) {
    context.beginPath();
    context.moveTo(x1, INVITE.rule.y);
    context.lineTo(x2, INVITE.rule.y);
    context.stroke();
  }
  context.globalAlpha = 1;
  const label = PARTNER.split(" ")[0]!.toUpperCase();
  text(label, INVITE.left, INVITE.labels.y, meta, 1.6, "left", META_ALPHA);
  text(
    "YOU",
    INVITE.rule.you.x1,
    INVITE.labels.y,
    meta,
    1.6,
    "left",
    META_ALPHA,
  );

  // The partner signed before folding, so their ink is dry.
  context.lineCap = "round";
  const pool = config.ink.thick * 0.42 * config.ink.pool;
  const partner = signature(config.seed, "partner", PARTNER_SIGNATURE);
  for (const stroke of [...partner, ...strokes]) {
    const ink = palette.ink(wetness(stroke, now, config));
    context.strokeStyle = ink;
    context.fillStyle = ink;
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
