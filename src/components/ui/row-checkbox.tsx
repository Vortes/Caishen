"use client";

import { Checkbox } from "./checkbox";
import styles from "./row-checkbox.module.css";

// Lives in the row's left padding; shows on hover, focus, or once anything
// in the list is checked. The label is the hit area: the full row height.
export function RowCheckbox({
  label,
  state,
  onChange,
  onShiftClick,
}: {
  label: string;
  state: boolean | "mixed";
  onChange: () => void;
  // Takes over a shift-click, which otherwise toggles just this box.
  onShiftClick?: () => void;
}) {
  return (
    <label
      className={styles.slot}
      onClickCapture={(event) => {
        if (!onShiftClick || !event.shiftKey) return;
        event.preventDefault();
        onShiftClick();
      }}
    >
      <Checkbox
        aria-label={label}
        checked={state === "mixed" ? "indeterminate" : state}
        onCheckedChange={onChange}
      />
    </label>
  );
}
