import { CanvasTexture, SRGBColorSpace } from "three";
import { config, palette, type WashiId } from "./config";
import { CARD } from "./geometry";
import { strokeSegments, wetness, type Stroke } from "./ink";

// One invitation: who sent it, their signature on their half of the card
// (signed before folding, so dry), and the washi it's folded from.
export type Invitation = {
  from: string;
  signature: Stroke[];
  washi: WashiId;
};

export const firstName = (name: string) => name.split(" ")[0]!;

// Who's looking at the card: the sender writing it, or the partner it
// arrives for. It sets the names under the two signing lines, sender's
// first.
export type Viewer = "sender" | "partner";
export const lineLabels = (
  invitation: Invitation,
  viewer: Viewer,
): [string, string] =>
  viewer === "sender"
    ? ["You", "Partner"]
    : [firstName(invitation.from), "You"];

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
    lines: ["wants to share", "a budget with you."],
  },
  // A signing rule on each half; the sender's sits under their signature.
  rule: {
    y: 92,
    from: { x1: -250, x2: -50 },
    to: { x1: 40, x2: 240 },
  },
  labels: { y: 112 },
  // Where a signature made from the sender's name sits, over their line.
  signed: { x: -250, y: 34, width: 180, height: 46 },
  // Where each half takes the pen: more of the half than the line itself,
  // so a fingertip on a phone doesn't have to start inside a 55px strip.
  pen: {
    from: { x: -275, y: -20, width: 260, height: 150 },
    to: { x: 10, y: -20, width: 270, height: 150 },
  },
};

// The sentence is set at 24px (.cardSentence); a long name shrinks until
// it fits the measure. Serif italic sets at about 0.58em per character.
const SENTENCE_SIZE = 24;
export const nameSize = (name: string) =>
  Math.min(SENTENCE_SIZE, INVITE.measure / (name.length * 0.58));

const RESOLUTION = 3;
// Labels print lighter than the sentence; matches .cardMeta.
const META_ALPHA = 0.75;
const serif = "ui-serif, Georgia, serif";

// The invitation as a texture for the inside of the folded sheet, laid out
// like the SVG card so the two match when the sheet lies flat. The tear
// prints the user's own signature too, as wet as it is at `now`.
export function printTexture(
  invitation: Invitation,
  strokes: Stroke[] = [],
  now = 0,
  viewer: Viewer = "partner",
) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD.width * RESOLUTION;
  canvas.height = CARD.height * RESOLUTION;
  const context = canvas.getContext("2d")!;
  context.scale(RESOLUTION, RESOLUTION);
  context.translate(CARD.width / 2, CARD.height / 2);

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
    invitation.from,
    INVITE.left,
    INVITE.name.y,
    `italic ${nameSize(invitation.from)}px ${serif}`,
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
  for (const { x1, x2 } of [INVITE.rule.from, INVITE.rule.to]) {
    context.beginPath();
    context.moveTo(x1, INVITE.rule.y);
    context.lineTo(x2, INVITE.rule.y);
    context.stroke();
  }
  context.globalAlpha = 1;
  const [fromLabel, toLabel] = lineLabels(invitation, viewer);
  for (const [label, x] of [
    [fromLabel, INVITE.rule.from.x1],
    [toLabel, INVITE.rule.to.x1],
  ] as const)
    text(
      label.toUpperCase(),
      x,
      INVITE.labels.y,
      meta,
      1.6,
      "left",
      META_ALPHA,
    );

  context.lineCap = "round";
  const pool = config.ink.thick * 0.42 * config.ink.pool;
  for (const stroke of [...invitation.signature, ...strokes]) {
    const ink = palette.ink(wetness(stroke, now));
    context.strokeStyle = ink;
    context.fillStyle = ink;
    for (const segment of strokeSegments(stroke)) {
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
