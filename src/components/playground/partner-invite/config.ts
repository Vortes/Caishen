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
