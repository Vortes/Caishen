"use client";

import { Button } from "~/components/ui/button";
import { views, type PlanView } from "./plan-view";
import { useShellData } from "./shell-data";
import styles from "./shell.module.css";

export { viewOf, type PlanView } from "./plan-view";

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
  // on credit: the funding states of the categories it lists.
  const overspentState = overspent.some(
    (category) => category.funding === "overspent",
  )
    ? "overspent"
    : "credit";
  return (
    <div className={styles.views} role="group" aria-label="Plan views">
      <Button
        size="sm"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
      >
        All
      </Button>
      {views.map((view) => {
        const count = categories.filter(view.matches).length;
        // Overspent stays while it's selected, so covering the last one
        // doesn't pull the view out from under you.
        if (view.id === "overspent" && count === 0 && value !== "overspent")
          return null;
        return (
          <Button
            size="sm"
            key={view.id}
            aria-pressed={value === view.id}
            onClick={() => onChange(value === view.id ? null : view.id)}
          >
            {view.label}
            <span
              className={styles.chipCount}
              data-state={
                view.id === "overspent" && count > 0
                  ? overspentState
                  : undefined
              }
            >
              {count}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
