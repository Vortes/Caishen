// Every taste decision in the partner invite lab. The scene is a pure
// function of this object (plus the user's own pen strokes), so a saved
// config replays the exact same arrival, paper, and bond.

// Chiyogami prints: waves, hemp leaf, seven treasures, or plain kami.
export type Pattern = "seigaiha" | "asanoha" | "shippo" | "plain";

export type Config = {
  seed: number;
  pattern: Pattern;
  flight: {
    far: number;
    near: number;
    loop: number;
    stall: number;
    bank: number;
    slide: number;
  };
  unfold: { duration: number; stagger: number };
  paper: {
    lightness: number;
    warmth: number;
    deckle: number;
    crease: number;
  };
  ink: {
    thin: number;
    thick: number;
    pool: number;
    dry: number;
  };
  accent: { hue: number; chroma: number };
  // Tearing the card in two before the bond: how long, how far the right
  // flap rises toward you (px), and how ragged the line and fibers are.
  tear: { duration: number; lift: number; ragged: number };
  bondDuration: number;
  seal: { size: number; overlap: number; wear: number };
  // Peeling your half off: how far its tip has to travel before letting go
  // takes it (px), how far the corner curls back to show it peels (px),
  // and which way that corner curls (° left of straight down).
  part: { pull: number; curl: number; angle: number };
  washi: {
    hue: number;
    chroma: number;
    lightness: number;
    inkHue: number;
    inkLightness: number;
    scale: number;
    fibers: number;
    mottle: number;
    gold: number;
  };
  trail: { life: number; width: number; spread: number; opacity: number };
  // How hazy the day sky is, from clear (0) to hazy (1), how fast its
  // clouds drift (× their natural speed), and how much of the open sky
  // they fill (0 to 1).
  sky: { haze: number; drift: number; clouds: number };
  // Where on the flight the plane crashes into a cloud (a fraction of its
  // time in the air), how big it is (× the card's width), and how long the
  // poof takes.
  cloud: { at: number; size: number; poof: number };
  // When what's underneath starts coming up through the parting clouds (a
  // fraction of the parting) and how long it takes to settle.
  reveal: { at: number; duration: number };
  // Jordan's half filed away as the Partner mark: when it starts shrinking
  // (seconds after yours is gone), how long that takes, and how long the
  // mark holds before the clouds close.
  filed: { at: number; duration: number; hold: number };
  // The clouds closing over the stage once the mark has held: how long they
  // take to close in, when they start to part (seconds after they start
  // closing), and how long parting takes. The mark's plate fades out when
  // they start closing, give or take `plateAt` seconds, over `plateFade`.
  veil: {
    gather: number;
    partAt: number;
    part: number;
    plateAt: number;
    plateFade: number;
  };
  // How wide the joined card shows on the Partner page.
  partnerPage: { width: number };
  plane: {
    keel: number;
    dihedral: number;
    light: number;
    tilt: number;
  };
};

// The papers a partner can choose from when they send the invitation.
export const papers: {
  name: string;
  pattern: Pattern;
  washi: Pick<
    Config["washi"],
    "hue" | "chroma" | "lightness" | "inkHue" | "inkLightness" | "gold"
  >;
}[] = [
  {
    name: "Indigo waves",
    pattern: "seigaiha",
    washi: {
      hue: 262,
      chroma: 0.09,
      lightness: 0.4,
      inkHue: 85,
      inkLightness: 0.92,
      gold: 0.1,
    },
  },
  {
    name: "Vermilion hemp leaf",
    pattern: "asanoha",
    washi: {
      hue: 32,
      chroma: 0.16,
      lightness: 0.56,
      inkHue: 60,
      inkLightness: 0.93,
      gold: 0.2,
    },
  },
  {
    name: "Plum treasures",
    pattern: "shippo",
    washi: {
      hue: 345,
      chroma: 0.1,
      lightness: 0.42,
      inkHue: 85,
      inkLightness: 0.82,
      gold: 0.35,
    },
  },
  {
    name: "Matcha waves",
    pattern: "seigaiha",
    washi: {
      hue: 135,
      chroma: 0.08,
      lightness: 0.62,
      inkHue: 100,
      inkLightness: 0.95,
      gold: 0.05,
    },
  },
  {
    name: "Sakura kami",
    pattern: "plain",
    washi: {
      hue: 5,
      chroma: 0.07,
      lightness: 0.82,
      inkHue: 5,
      inkLightness: 0.9,
      gold: 0,
    },
  },
];

export const choosePaper = (config: Config, name: string): Config => {
  const paper = papers.find((option) => option.name === name)!;
  return {
    ...config,
    pattern: paper.pattern,
    washi: { ...config.washi, ...paper.washi },
  };
};

export const defaultConfig: Config = {
  seed: 1729,
  pattern: "seigaiha",
  flight: {
    far: 0.065,
    near: 1.3,
    loop: 3.45,
    stall: 10,
    bank: 6,
    slide: 90,
  },
  unfold: { duration: 1.8, stagger: 0.25 },
  paper: {
    lightness: 0.95,
    warmth: 0.018,
    deckle: 2.5,
    crease: 0.25,
  },
  ink: { thin: 0.9, thick: 3.2, pool: 0.6, dry: 1.1 },
  accent: { hue: 28, chroma: 0.17 },
  tear: { duration: 1.3, lift: 46, ragged: 1 },
  bondDuration: 2.4,
  seal: { size: 74, overlap: 36, wear: 0.4 },
  part: { pull: 140, curl: 56, angle: 25 },
  // Jordan's choice, "Indigo waves" (see papers).
  washi: {
    hue: 262,
    chroma: 0.09,
    lightness: 0.4,
    inkHue: 85,
    inkLightness: 0.92,
    scale: 22,
    fibers: 0.55,
    mottle: 0.45,
    gold: 0.1,
  },
  trail: { life: 0.2, width: 6, spread: 0, opacity: 1 },
  sky: { haze: 0, drift: 1, clouds: 0.5 },
  cloud: { at: 0.55, size: 1.35, poof: 0.9 },
  reveal: { at: 0.38, duration: 0.5 },
  filed: { at: 0.15, duration: 0.8, hold: 1.6 },
  veil: { gather: 1.4, partAt: 1.7, part: 3.6, plateAt: -0.1, plateFade: 0.3 },
  partnerPage: { width: 320 },
  plane: {
    keel: 8,
    dihedral: 10,
    light: 40,
    tilt: 40,
  },
};

// Tested bounds for every knob. Each group renders as one panel folder.
type Knob = {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
};

export const knobGroups: { title: string; knobs: Knob[] }[] = [
  {
    title: "Flight",
    knobs: [
      {
        path: "flight.stall",
        label: "Nose-up over the top (°)",
        min: 0,
        max: 30,
        step: 1,
      },
      { path: "flight.bank", label: "Lean (°)", min: 0, max: 25, step: 1 },
      {
        path: "flight.slide",
        label: "Skid on landing",
        min: 0,
        max: 200,
        step: 5,
      },
      {
        path: "flight.far",
        label: "Size far away (× card)",
        min: 0.02,
        max: 0.3,
        step: 0.005,
      },
      {
        path: "flight.near",
        label: "Size passing in front",
        min: 0.6,
        max: 1.8,
        step: 0.05,
      },
      {
        path: "flight.loop",
        label: "Time to the hump (s)",
        min: 1.5,
        max: 7,
        step: 0.05,
      },
    ],
  },
  {
    title: "Vapor trails",
    knobs: [
      {
        path: "trail.life",
        label: "How long they linger (s)",
        min: 0,
        max: 2.5,
        step: 0.05,
      },
      {
        path: "trail.width",
        label: "Width at the wingtip",
        min: 0.5,
        max: 12,
        step: 0.1,
      },
      {
        path: "trail.spread",
        label: "Spread as they fade",
        min: 0,
        max: 25,
        step: 0.5,
      },
      { path: "trail.opacity", label: "Opacity", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: "Cloud",
    knobs: [
      {
        path: "cloud.at",
        label: "Where it's hit (of the flight)",
        min: 0.1,
        max: 0.95,
        step: 0.01,
      },
      {
        path: "cloud.size",
        label: "Size (× card)",
        min: 0,
        max: 1.6,
        step: 0.05,
      },
      {
        path: "cloud.poof",
        label: "Poof (s)",
        min: 0.3,
        max: 2,
        step: 0.05,
      },
    ],
  },
  {
    title: "Unfold",
    knobs: [
      {
        path: "unfold.duration",
        label: "Duration (s)",
        min: 0.5,
        max: 2.5,
        step: 0.1,
      },
      {
        path: "unfold.stagger",
        label: "Stagger",
        min: 0,
        max: 0.6,
        step: 0.05,
      },
    ],
  },
  {
    title: "Plane",
    knobs: [
      {
        path: "plane.keel",
        label: "Keel half-angle (°)",
        min: 2,
        max: 30,
        step: 1,
      },
      {
        path: "plane.dihedral",
        label: "Wing dihedral (°)",
        min: -6,
        max: 20,
        step: 1,
      },
      {
        path: "plane.light",
        label: "Light angle (°)",
        min: 0,
        max: 90,
        step: 1,
      },
      { path: "plane.tilt", label: "View tilt (°)", min: 0, max: 60, step: 1 },
    ],
  },
  {
    title: "Washi",
    knobs: [
      { path: "washi.hue", label: "Dye hue", min: 0, max: 360, step: 1 },
      {
        path: "washi.chroma",
        label: "Dye chroma",
        min: 0,
        max: 0.2,
        step: 0.005,
      },
      {
        path: "washi.lightness",
        label: "Dye lightness",
        min: 0.3,
        max: 0.92,
        step: 0.01,
      },
      { path: "washi.inkHue", label: "Pattern hue", min: 0, max: 360, step: 1 },
      {
        path: "washi.inkLightness",
        label: "Pattern lightness",
        min: 0.15,
        max: 0.98,
        step: 0.01,
      },
      { path: "washi.scale", label: "Pattern scale", min: 8, max: 60, step: 1 },
      {
        path: "washi.fibers",
        label: "Kozo fibers",
        min: 0,
        max: 1,
        step: 0.05,
      },
      { path: "washi.mottle", label: "Mottling", min: 0, max: 1, step: 0.05 },
      { path: "washi.gold", label: "Gold flecks", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: "Paper",
    knobs: [
      {
        path: "paper.lightness",
        label: "Lightness",
        min: 0.86,
        max: 0.99,
        step: 0.005,
      },
      {
        path: "paper.warmth",
        label: "Warmth",
        min: 0,
        max: 0.045,
        step: 0.001,
      },
      { path: "paper.deckle", label: "Deckle", min: 0, max: 7, step: 0.25 },
      {
        path: "paper.crease",
        label: "Crease memory",
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
  {
    title: "Ink",
    knobs: [
      {
        path: "ink.thin",
        label: "Fast stroke width",
        min: 0.4,
        max: 2,
        step: 0.1,
      },
      {
        path: "ink.thick",
        label: "Slow stroke width",
        min: 2,
        max: 6,
        step: 0.1,
      },
      { path: "ink.pool", label: "Pooling", min: 0, max: 1, step: 0.05 },
      {
        path: "ink.dry",
        label: "Drying time (s)",
        min: 0.2,
        max: 3,
        step: 0.1,
      },
    ],
  },
  {
    title: "Seal color",
    knobs: [
      { path: "accent.hue", label: "Hue", min: 0, max: 360, step: 1 },
      {
        path: "accent.chroma",
        label: "Chroma",
        min: 0.06,
        max: 0.22,
        step: 0.005,
      },
      {
        path: "bondDuration",
        label: "Bond duration (s)",
        min: 1,
        max: 4.5,
        step: 0.1,
      },
    ],
  },
  {
    title: "Tear",
    knobs: [
      {
        path: "tear.duration",
        label: "Duration (s)",
        min: 0.5,
        max: 3,
        step: 0.05,
      },
      { path: "tear.lift", label: "Flap lift", min: 0, max: 140, step: 1 },
      { path: "tear.ragged", label: "Raggedness", min: 0, max: 3, step: 0.05 },
    ],
  },
  {
    title: "Tally seal",
    knobs: [
      { path: "seal.size", label: "Seal size", min: 40, max: 110, step: 1 },
      {
        path: "seal.overlap",
        label: "Card overlap",
        min: 10,
        max: 80,
        step: 1,
      },
      { path: "seal.wear", label: "Ink wear", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: "Filed as the Partner mark",
    knobs: [
      {
        path: "filed.at",
        label: "Starts shrinking (s after yours is gone)",
        min: 0,
        max: 1.5,
        step: 0.05,
      },
      {
        path: "filed.duration",
        label: "Shrinking (s)",
        min: 0.3,
        max: 1.6,
        step: 0.05,
      },
      {
        path: "filed.hold",
        label: "Mark holds (s)",
        min: 0.4,
        max: 3.5,
        step: 0.05,
      },
      {
        path: "veil.plateAt",
        label: "Plate fades (s from clouds closing)",
        min: -1.5,
        max: 1.4,
        step: 0.05,
      },
      {
        path: "veil.plateFade",
        label: "Plate fade (s)",
        min: 0.05,
        max: 1.4,
        step: 0.05,
      },
      {
        path: "partnerPage.width",
        label: "Card on the Partner page (px)",
        min: 220,
        max: 460,
        step: 5,
      },
    ],
  },
  {
    title: "Clouds closing",
    knobs: [
      {
        path: "veil.gather",
        label: "Close in (s)",
        min: 0.4,
        max: 3,
        step: 0.05,
      },
      {
        path: "veil.partAt",
        label: "Start parting (s from closing)",
        min: 0.4,
        max: 4,
        step: 0.05,
      },
      {
        path: "veil.part",
        label: "Part (s)",
        min: 1,
        max: 6,
        step: 0.1,
      },
    ],
  },
  {
    title: "Reveal",
    knobs: [
      {
        path: "reveal.at",
        label: "Onboarding starts (of the parting)",
        min: 0,
        max: 0.9,
        step: 0.01,
      },
      {
        path: "reveal.duration",
        label: "Onboarding settle (s)",
        min: 0.2,
        max: 1.5,
        step: 0.05,
      },
    ],
  },
  {
    title: "Peeling your half",
    knobs: [
      {
        path: "part.pull",
        label: "Peel to take (px of tip travel)",
        min: 40,
        max: 300,
        step: 5,
      },
      {
        path: "part.curl",
        label: "Corner curl hint (px)",
        min: 0,
        max: 80,
        step: 1,
      },
      {
        path: "part.angle",
        label: "Hint curl direction (°)",
        min: 0,
        max: 60,
        step: 1,
      },
    ],
  },
];

export function readKnob(config: Config, path: string): number {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) => (value as Record<string, unknown>)[key],
      config,
    ) as number;
}

export function writeKnob(config: Config, path: string, value: number) {
  const next = structuredClone(config);
  const keys = path.split(".");
  const last = keys.pop()!;
  const parent = keys.reduce<Record<string, unknown>>(
    (node, key) => node[key] as Record<string, unknown>,
    next as unknown as Record<string, unknown>,
  );
  parent[last] = value;
  return next;
}

// mulberry32, keyed by the config seed plus a salt per random stream, so
// changing one stream (say, the signature) never reshuffles another.
export function random(seed: number, salt: string) {
  let a = seed >>> 0;
  for (const char of salt) a = Math.imul(a ^ char.charCodeAt(0), 2654435761);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
export const lerp = (from: number, to: number, t: number) =>
  from + (to - from) * t;
export const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
// A spring from `from` toward `to`, `t` seconds after it was let go with
// `velocity` (units per second). A pure function of time, so a frame can be
// drawn at any moment. Configured like Apple's: how long it takes to
// settle, and how much it overshoots (0 is critically damped).
export function spring(
  {
    from,
    to,
    velocity = 0,
    duration,
    bounce = 0,
  }: {
    from: number;
    to: number;
    velocity?: number;
    duration: number;
    bounce?: number;
  },
  t: number,
) {
  if (t <= 0) return from;
  const omega = (2 * Math.PI) / duration;
  const x = from - to;
  if (bounce <= 0) {
    return to + (x + (velocity + omega * x) * t) * Math.exp(-omega * t);
  }
  const damping = 1 - bounce;
  const ringing = omega * Math.sqrt(1 - damping * damping);
  return (
    to +
    Math.exp(-damping * omega * t) *
      (x * Math.cos(ringing * t) +
        ((velocity + damping * omega * x) / ringing) * Math.sin(ringing * t))
  );
}

// The slice of an overall progress that belongs to one step.
export const span = (t: number, from: number, to: number) =>
  clamp((t - from) / (to - from));

// Paper and ink. There are no paper tokens in the design
// system yet; these become tokens when a config is harvested.
export function colors(config: Config) {
  const { lightness, warmth } = config.paper;
  return {
    paper: (shade = 0) => `oklch(${lightness + shade} ${warmth} 80)`,
    crease: `oklch(${lightness - 0.16} ${warmth} 80)`,
    printed: `oklch(0.34 ${warmth * 1.4} 60)`,
    ink: (wet: number) =>
      `oklch(${lerp(0.3, 0.17, wet)} ${lerp(0.05, 0.09, wet)} 262)`,
  };
}
