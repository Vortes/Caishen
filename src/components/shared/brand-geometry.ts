// Pinwheel mark on a lit violet tile, shared by the in-app brand and the
// generated favicon and app icons. Geometry is on a 100-unit grid; colors are
// the sRGB equivalents of oklch(0.66..0.49 0.2 283).
export const BRAND_BLADES = [
  "M15 48 Q10 48 10 43 V15 Q10 10 14.99 10.33 A38 38 0 0 1 47.67 43.01 Q48 48 43 48 Z",
  "M52 15 Q52 10 57 10 H85 Q90 10 89.67 14.99 A38 38 0 0 1 56.99 47.67 Q52 48 52 43 Z",
  "M85 52 Q90 52 90 57 V85 Q90 90 85.01 89.67 A38 38 0 0 1 52.33 56.99 Q52 52 57 52 Z",
  "M48 85 Q48 90 43 90 H15 Q10 90 10.33 85.01 A38 38 0 0 1 43.01 52.33 Q48 52 48 57 Z",
];

export const BRAND_TILE_STOPS: [number, string][] = [
  [0, "#867dfe"],
  [0.22, "#7a6df8"],
  [0.52, "#6c5de7"],
  [0.8, "#5f4dd5"],
  [1, "#5843cb"],
];

export const BRAND_TILE_RADIUS = 22.6;

// Small renders (favicon, in-app mark) draw the mark larger on the tile.
export const BRAND_SMALL_MARK_SCALE = 0.72;
