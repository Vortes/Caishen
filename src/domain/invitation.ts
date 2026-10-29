// An invitation by email, as both the composer and the server read it
// (ADR 0011).

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

/** What the invitation calls its sender: their first name. */
export const firstName = (name: string) => name.split(" ")[0]!;
