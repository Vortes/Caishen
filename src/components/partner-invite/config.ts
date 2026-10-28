import { lerp } from "./motion";

// How the partner invite looks: the paper, the ink, the throw, the sky.
// When things happen is in timeline.ts. Every random stream is keyed off
// `seed`, so the same values always draw the same invite.
export const config = {
  seed: 6943,
  flight: {
    far: 0.065,
    near: 1.3,
    // Seconds from the throw to the hump before the glide.
    loop: 3.45,
    stall: 10,
    bank: 6,
    slide: 90,
  },
  paper: {
    lightness: 0.95,
    warmth: 0.007,
    deckle: 1.5,
    crease: 0.2,
  },
  // `dry` is in seconds.
  ink: { thin: 0.9, thick: 3.2, pool: 0.6, dry: 1.1 },
  accent: { hue: 28, chroma: 0.17 },
  // Tearing the card in two before the bond: how far the right flap rises
  // toward you (px), and how ragged the line and fibers are.
  tear: { lift: 46, ragged: 1 },
  seal: { size: 74, overlap: 36, wear: 0.4 },
  // Peeling your half off: how far its tip has to travel before letting go
  // takes it (px), how far the corner curls back to show it peels (px),
  // and which way that corner curls (° left of straight down).
  part: { pull: 300, curl: 56, angle: 25 },
  // The outside of the plane: seigaiha on dyed washi. The dye and the
  // waves' ink are the sender's choice, from `WASHI`.
  washi: {
    scale: 22,
    fibers: 0.55,
    mottle: 0.45,
    gold: 0.1,
  },
  trail: { life: 0.2, width: 6, spread: 0, opacity: 1 },
  // How hazy the day sky is, from clear (0) to hazy (1), how fast its
  // clouds drift (× their natural speed), and how much of the open sky
  // they fill (0 to 1).
  sky: { haze: 0, drift: 5.4, clouds: 0.67 },
  // Where on the flight the plane crashes into a cloud (a fraction of its
  // time in the air), how big it is (× the card's width), and how long the
  // poof takes (s).
  cloud: { at: 0.55, size: 1.35, poof: 0.9 },
  plane: {
    keel: 8,
    dihedral: 10,
    light: 40,
    tilt: 40,
  },
};

// Paper and ink. There are no paper tokens in the design system.
const { lightness, warmth } = config.paper;
export const palette = {
  paper: (shade = 0) => `oklch(${lightness + shade} ${warmth} 80)`,
  crease: `oklch(${lightness - 0.16} ${warmth} 80)`,
  printed: `oklch(0.34 ${warmth * 1.4} 60)`,
  dye: ({ dye }: Washi) => `oklch(${dye.lightness} ${dye.chroma} ${dye.hue})`,
  ink: (wet: number) =>
    `oklch(${lerp(0.3, 0.17, wet)} ${lerp(0.05, 0.09, wet)} 262)`,
};

// The washi a sender can fold the invitation from: seigaiha waves printed
// in one ink on a dyed ground.
export const WASHI = [
  {
    id: "indigo",
    name: "Indigo",
    dye: { lightness: 0.4, chroma: 0.09, hue: 262 },
    ink: { lightness: 0.92, hue: 85 },
  },
  {
    id: "vermilion",
    name: "Vermilion",
    dye: { lightness: 0.56, chroma: 0.15, hue: 33 },
    ink: { lightness: 0.95, hue: 85 },
  },
  {
    id: "matcha",
    name: "Matcha",
    dye: { lightness: 0.6, chroma: 0.08, hue: 122 },
    ink: { lightness: 0.95, hue: 95 },
  },
  {
    id: "plum",
    name: "Plum",
    dye: { lightness: 0.42, chroma: 0.08, hue: 345 },
    ink: { lightness: 0.92, hue: 70 },
  },
  {
    id: "sumi",
    name: "Sumi",
    dye: { lightness: 0.28, chroma: 0.01, hue: 260 },
    ink: { lightness: 0.82, hue: 85 },
  },
] as const;

export type Washi = (typeof WASHI)[number];
export type WashiId = Washi["id"];

export const washiById = (id: WashiId) =>
  WASHI.find((washi) => washi.id === id)!;
