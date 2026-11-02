"use client";

import { ArrowLeftIcon, ArrowUpRightIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { Tooltip } from "./tooltip";
import styles from "./action-bar.module.css";

// Somewhere the action bar can take you, named on its button: the plan
// category a transaction was opened from, or the transaction a row came
// from. label says where it goes in full.
export type Way = {
  name: string;
  label: string;
  forward?: boolean;
  onGo: () => void;
};

// The action bar's frame: how many rows are selected, with the way to clear
// them, then what can be done with them. A register's own action bar fills in
// its actions.
export function ActionBar({
  count,
  onClear,
  way = null,
  hint,
  children,
}: {
  count: number;
  onClear?: () => void;
  way?: Way | null;
  hint?: string | false;
  children?: ReactNode;
}) {
  // With nothing selected, the action bar keeps just its way somewhere else.
  if (!count)
    return way ? (
      <div className={styles.slot}>
        <div className={styles.actionBar}>
          <WayButton way={way} />
        </div>
      </div>
    ) : null;
  return (
    <div className={styles.slot}>
      <div
        className={styles.actionBar}
        role="toolbar"
        aria-label="Selected transactions"
      >
        {way && (
          <>
            <WayButton way={way} />
            <span className={styles.divider} aria-hidden />
          </>
        )}
        <span className={styles.summary} aria-live="polite">
          <Tooltip label="Clear selection" shortcut="Esc">
            <Button
              variant="subtle"
              size="sm"
              aria-label="Clear selection"
              onClick={onClear}
            >
              <XIcon aria-hidden />
              <span className={styles.count}>
                {count} {count === 1 ? "transaction" : "transactions"}
              </span>
            </Button>
          </Tooltip>
          {hint && <span className={styles.hint}>{hint}</span>}
        </span>
        <span className={styles.divider} aria-hidden />
        <div className={styles.actions}>{children}</div>
      </div>
    </div>
  );
}

function WayButton({ way }: { way: Way }) {
  const Icon = way.forward ? ArrowUpRightIcon : ArrowLeftIcon;
  return (
    <Tooltip label={way.label}>
      <Button
        variant="subtle"
        size="sm"
        aria-label={way.label}
        onClick={way.onGo}
      >
        <Icon aria-hidden />
        <span className={styles.backName}>{way.name}</span>
      </Button>
    </Tooltip>
  );
}
