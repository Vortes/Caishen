// Every taste decision in the partner invite lab. The scene is a pure
// function of this object (plus the user's own pen strokes), so a saved
// config replays the exact same arrival, paper, and bond.

// Chiyogami prints: waves, hemp leaf, seven treasures, or plain kami.
export type Pattern = "seigaiha" | "asanoha" | "shippo" | "plain";
// Where the plane is thrown from: in front of the viewer, or the far side.
export type Thrown = "foreground" | "background";

export type Config = {
  seed: number;
  pattern: Pattern;
  thrown: Thrown;
  flight: {
    far: number;
    near: number;
    loop: number;
    depth: number;
    offset: number;
    approach: number;
    height: number;
    start: number;
    peak: number;
    tail: number;
    top: number;
    gravity: number;
    glide: number;
    stall: number;
    bank: number;
    slide: number;
  };
  unfold: { duration: number; stagger: number };
  paper: {
    lightness: number;
    warmth: number;
    grain: number;
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
  bondDuration: number;
  seal: { size: number; overlap: number; wear: number };
  slot: { scale: number; catch: number; hold: number; pull: number };
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
  thrown: "background",
  flight: {
    far: 0.065,
    near: 1.3,
    loop: 3.6,
    depth: 750,
    offset: 40,
    approach: 40,
    height: 260,
    start: 150,
    peak: 0.36,
    tail: 1.8,
    top: 240,
    gravity: 900,
    glide: 0.35,
    stall: 10,
    bank: 6,
    slide: 90,
  },
  unfold: { duration: 1.3, stagger: 0.25 },
  paper: {
    lightness: 0.95,
    warmth: 0.018,
    grain: 0.12,
    deckle: 2.5,
    crease: 0.55,
  },
  ink: { thin: 0.9, thick: 3.2, pool: 0.6, dry: 1.1 },
  accent: { hue: 28, chroma: 0.17 },
  bondDuration: 2.4,
  seal: { size: 74, overlap: 36, wear: 0.4 },
  slot: { scale: 0.85, catch: 0.66, hold: 1.6, pull: 0.45 },
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
  trail: { life: 0.9, width: 1.6, spread: 7, opacity: 0.55 },
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
        path: "flight.depth",
        label: "Thrown from in front",
        min: 200,
        max: 1400,
        step: 10,
      },
      {
        path: "flight.approach",
        label: "Touchdown angle into the scene (°)",
        min: 0,
        max: 80,
        step: 1,
      },
      {
        path: "flight.offset",
        label: "Thrown from left/right",
        min: -700,
        max: 200,
        step: 10,
      },
      {
        path: "flight.height",
        label: "Height of the climb",
        min: 80,
        max: 420,
        step: 5,
      },
      {
        path: "flight.start",
        label: "Height out of the hand",
        min: 0,
        max: 150,
        step: 5,
      },
      {
        path: "flight.peak",
        label: "Where it tops out",
        min: 0.15,
        max: 0.6,
        step: 0.01,
      },
      {
        path: "flight.tail",
        label: "Length of the glide-out",
        min: 1,
        max: 3,
        step: 0.05,
      },
      {
        path: "flight.top",
        label: "Speed over the top (px/s)",
        min: 100,
        max: 600,
        step: 10,
      },
      {
        path: "flight.gravity",
        label: "Gravity (px/s²)",
        min: 300,
        max: 2500,
        step: 20,
      },
      {
        path: "flight.glide",
        label: "Gravity kept gliding down",
        min: 0.1,
        max: 1,
        step: 0.05,
      },
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
    ],
  },
  {
    title: "Far-side throw",
    knobs: [
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
        label: "Time in the air (s)",
        min: 1.5,
        max: 7,
        step: 0.1,
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
        max: 6,
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
      { path: "paper.grain", label: "Grain", min: 0, max: 0.3, step: 0.01 },
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
    title: "Slot",
    knobs: [
      { path: "slot.scale", label: "Card size", min: 0.6, max: 1, step: 0.01 },
      {
        path: "slot.catch",
        label: "Caught depth",
        min: 0.4,
        max: 0.85,
        step: 0.01,
      },
      {
        path: "slot.hold",
        label: "Reading hold (s)",
        min: 0,
        max: 3.5,
        step: 0.1,
      },
      {
        path: "slot.pull",
        label: "Pull-in (s)",
        min: 0.2,
        max: 1.2,
        step: 0.05,
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
// The slice of an overall progress that belongs to one step.
export const span = (t: number, from: number, to: number) =>
  clamp((t - from) / (to - from));

// Paper, ink, and the bond mark. There are no paper tokens in the design
// system yet; these become tokens when a config is harvested.
export function colors(config: Config) {
  const { lightness, warmth } = config.paper;
  const { hue, chroma } = config.accent;
  return {
    paper: (shade = 0) => `oklch(${lightness + shade} ${warmth} 80)`,
    crease: `oklch(${lightness - 0.16} ${warmth} 80)`,
    printed: `oklch(0.34 ${warmth * 1.4} 60)`,
    faint: `oklch(${lightness - 0.3} ${warmth} 70)`,
    ink: (wet: number) =>
      `oklch(${lerp(0.3, 0.17, wet)} ${lerp(0.05, 0.09, wet)} 262)`,
    accent: `oklch(0.56 ${chroma} ${hue})`,
    // Like pen ink, seal ink is darker and richer while wet.
    seal: (wet: number) =>
      `oklch(${lerp(0.56, 0.47, wet)} ${chroma * lerp(1, 1.12, wet)} ${hue})`,
    sealPool: (wet: number) =>
      `oklch(${lerp(0.45, 0.38, wet)} ${chroma * 1.05} ${hue})`,
    accentDeep: `oklch(0.44 ${chroma} ${hue})`,
  };
}
