import { Clock3Icon, CopyrightIcon, LockIcon } from "lucide-react";
import styles from "./shell.module.css";

// YNAB's C column. Cleared is a green C, uncleared a gray one. A pending
// transaction that isn't cleared yet shows a clock, and reconciling locks it.
export type ClearedState = "cleared" | "uncleared" | "pending" | "reconciled";

export function clearedState(item: {
  cleared: boolean;
  reconciled?: boolean;
  status: "pending" | "posted";
}): ClearedState {
  if (item.reconciled) return "reconciled";
  if (item.cleared) return "cleared";
  return item.status === "pending" ? "pending" : "uncleared";
}

const marks = {
  cleared: { icon: CopyrightIcon, label: "Cleared" },
  uncleared: { icon: CopyrightIcon, label: "Uncleared" },
  pending: { icon: Clock3Icon, label: "Pending" },
  reconciled: { icon: LockIcon, label: "Reconciled" },
};

// Labeled for the row it sits in; hidden when a button names it instead.
export function ClearedMark({
  state,
  labeled = true,
}: {
  state: ClearedState;
  labeled?: boolean;
}) {
  const { icon: Icon, label } = marks[state];
  return (
    <Icon
      size={14}
      className={styles.statusIcon}
      data-status={state}
      {...(labeled ? { "aria-label": label } : { "aria-hidden": true })}
    />
  );
}
