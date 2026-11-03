"use client";

import { Checkbox } from "./checkbox";
import styles from "./row-checkbox.module.css";

// Sits in the column header's checkbox gutter, over the rows' checkboxes.
export function SelectAll({
  selection: { selectable, selected },
  onCheck,
}: {
  selection: { selectable: { id: string }[]; selected: { id: string }[] };
  onCheck: (ids: string[], value: boolean) => void;
}) {
  if (!selectable.length) return null;
  const all = selectable.map((item) => item.id);
  return (
    <label className={styles.slot}>
      <Checkbox
        aria-label="Select all"
        checked={
          selected.length === 0
            ? false
            : selected.length === all.length
              ? true
              : "indeterminate"
        }
        // With anything checked, the box clears the selection.
        onCheckedChange={() => onCheck(all, selected.length === 0)}
      />
    </label>
  );
}
