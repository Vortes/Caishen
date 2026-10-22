// The prototype's design choices. A plain module, so the server-rendered
// index can read them.

// Each design choice the owner can flip, with the one variable it moves.
export const choices = {
  entry: {
    variable: "Share entry point",
    options: [
      ["card", "Shared card"],
      ["menu", "Title ⋯ menu"],
    ],
  },
  split: {
    variable: "Split input",
    options: [
      ["presets", "Presets"],
      ["percent", "Percent field"],
    ],
  },
  stop: {
    variable: "Stop-sharing confirmation",
    options: [
      ["inline", "Inline"],
      ["dialog", "Dialog"],
      ["undo", "Undo only"],
    ],
  },
  detail: {
    variable: "Statement detail",
    options: [
      ["drill", "Drill in"],
      ["expand", "Expand in place"],
    ],
  },
  amount: {
    variable: "Settle-up amount",
    options: [
      ["editable", "Editable"],
      ["full", "Full net only"],
    ],
  },
  receipt: {
    variable: "Confirm-receipt friction",
    options: [
      ["form", "Inline form"],
      ["one-click", "One click"],
    ],
  },
} as const;

export type ChoiceKey = keyof typeof choices;
export type Variants = {
  [K in ChoiceKey]: (typeof choices)[K]["options"][number][0];
};

export const defaultVariants: Variants = {
  entry: "card",
  split: "presets",
  stop: "inline",
  detail: "drill",
  amount: "editable",
  receipt: "form",
};
