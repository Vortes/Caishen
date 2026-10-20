"use client";

import { overfunded, underfunded } from "~/domain/auto-assign";
import type { Category } from "./model";
import { useShellData } from "./shell-data";
import styles from "./shell.module.css";

// YNAB's preset Focused Views on the web
// (support.ynab.com, "Focused Views in YNAB: A Guide"). Underfunded and
// Overfunded share Auto-Assign's rules, so a view lists exactly the
// categories its Auto-Assign option would change.
export type PlanView =
  "overspent" | "snoozed" | "underfunded" | "overfunded" | "available";

const views: {
  id: PlanView;
  label: string;
  matches: (category: Category) => boolean;
  empty: { title: string; body: string };
}[] = [
  {
    // Shown only while something is overspent.
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
    // Targets still short this month, and overspending.
    id: "underfunded",
    label: "Underfunded",
    matches: (category) => underfunded(category.autoAssign) > 0,
    empty: {
      title: "Nothing is underfunded.",
      body: "Every target is funded and nothing is overspent.",
    },
  },
  {
    // More assigned than the target needs to stay on track.
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

// The view chips above the plan. Picking the selected view again goes back
// to every category, as in YNAB.
export function PlanViews({
  value,
  onChange,
}: {
  value: PlanView | null;
  onChange: (value: PlanView | null) => void;
}) {
  const { categories } = useShellData();
  const overspent = categories.filter((category) => category.available < 0);
  // YNAB colors Overspent red when any of it is cash, yellow when it's all
  // on credit.
  const overspentTone = overspent.some(
    (category) => category.funding === "overspent",
  )
    ? "red"
    : "amber";
  return (
    <div className={styles.views} role="group" aria-label="Plan views">
      <button
        type="button"
        className={`${styles.control} ${styles.filterChip}`}
        aria-pressed={value === null}
        onClick={() => onChange(null)}
      >
        All
      </button>
      {views.map((view) => {
        const count = categories.filter(view.matches).length;
        // Overspent stays while it's selected, so covering the last one
        // doesn't pull the view out from under you.
        if (view.id === "overspent" && count === 0 && value !== "overspent")
          return null;
        return (
          <button
            type="button"
            key={view.id}
            className={`${styles.control} ${styles.filterChip}`}
            aria-pressed={value === view.id}
            data-tone={
              view.id === "overspent" && count > 0 ? overspentTone : undefined
            }
            onClick={() => onChange(value === view.id ? null : view.id)}
          >
            {view.label}
            <span className={styles.chipCount}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
