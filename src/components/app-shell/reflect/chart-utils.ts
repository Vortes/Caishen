import {
  PALETTE,
  rgb,
  type DitherColor,
} from "~/components/dither-kit/palette";
import type { DrillPath } from "./report";

// Hover state shared by a chart and the ranked list under it, so pointing at
// either one points at both.
export type Highlight = {
  id: string | null;
  set: (id: string | null) => void;
  drill: (path: DrillPath) => void;
};

// Dither Kit paints only its own named hues: six slots, in an order checked
// for color-vision deficiency, with grey for "Other".
const order: DitherColor[] = [
  "blue",
  "green",
  "purple",
  "orange",
  "pink",
  "red",
];
export const SLOTS = order.length;

export function ditherColor(slot: number | null): DitherColor {
  return slot === null ? "grey" : (order[slot] ?? "grey");
}

// The same hue the chart paints, for swatches beside it.
export function seriesColor(slot: number | null) {
  return rgb(PALETTE[ditherColor(slot)].fill);
}

const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function compactMoney(cents: number) {
  return compact.format(cents / 100);
}
