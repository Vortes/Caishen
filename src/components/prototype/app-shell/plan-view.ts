import { overfunded, underfunded } from "~/domain/auto-assign";
import type { Category } from "./model";

// Focused Views share Auto-Assign's funding rules. Kept separate from their
// controls so filtering can be tested without mounting a browser or CSS.
export type PlanView =
  "overspent" | "snoozed" | "underfunded" | "overfunded" | "available";

export const views: {
  id: PlanView;
  label: string;
  matches: (category: Category) => boolean;
  empty: { title: string; body: string };
}[] = [
  {
    id: "overspent",
    label: "Overspent",
    matches: (category) => category.available < 0,
    empty: {
      title: "Nothing is overspent.",
      body: "Every category has the money it spent.",
    },
  },
  {
    id: "snoozed",
    label: "Snoozed",
    matches: (category) => Boolean(category.autoAssign.targetProgress?.snoozed),
    empty: {
      title: "No targets are snoozed this month.",
      body: "Snooze a target to skip it for a month.",
    },
  },
  {
    id: "underfunded",
    label: "Underfunded",
    matches: (category) =>
      category.funding === "underfunded" ||
      underfunded(category.autoAssign) > 0,
    empty: {
      title: "Nothing is underfunded.",
      body: "Every target is funded and nothing is overspent.",
    },
  },
  {
    id: "overfunded",
    label: "Overfunded",
    matches: (category) => overfunded(category.autoAssign) > 0,
    empty: {
      title: "Nothing is overfunded.",
      body: "Overfunded compares what's assigned with your targets, so categories without one never show here.",
    },
  },
  {
    id: "available",
    label: "Money available",
    matches: (category) => category.available > 0,
    empty: {
      title: "No category has money available.",
      body: "Assign money to a category to see it here.",
    },
  },
];

export function viewOf(id: PlanView) {
  return views.find((view) => view.id === id)!;
}
