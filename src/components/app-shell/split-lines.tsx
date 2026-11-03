"use client";

import grid from "~/components/ui/register.module.css";

import { CircleAlertIcon, PlusIcon, XIcon } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { money } from "./model";
import styles from "./transaction-entry.module.css";

// A split's parts every register's editor shares. Each register lays its
// lines out on its own columns; the lines, their remove buttons, and the
// footer below them read the same in all of them.

/** What the lines leave of the total: still to split, or split past it. */
export function remainingLabel(remaining: number, total: number) {
  return remaining === 0 || Math.sign(remaining) === Math.sign(total)
    ? `Remaining ${money(Math.abs(remaining))}`
    : `Over by ${money(Math.abs(remaining))}`;
}

/** The lines under the entry row, as one group named Split. */
export function SplitLines({ children }: { children: ReactNode }) {
  return (
    <div role="group" aria-label="Split" className={styles.lines}>
      {children}
    </div>
  );
}

/** One line's row on the register's grid, with its remove button last. */
export function SplitLine({
  number,
  accountColumn = false,
  onRemove,
  children,
}: {
  number: number;
  accountColumn?: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`${grid.columns} ${styles.entryRow} ${styles.lineRow}`}
      data-accounts={accountColumn || undefined}
    >
      {children}
      <div className={styles.removeLine} data-column="status">
        <IconButton
          label={`Remove line ${number}`}
          size="sm"
          onClick={onRemove}
        >
          <XIcon aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}

/**
 * Add line under the categories, and what the lines leave of the total
 * under the amounts. `leading` holds the columns before Category; `column`
 * names the amount column the remainder sits under, when it's one column.
 */
export function SplitFooter({
  leading,
  accountColumn = false,
  addRef,
  onAdd,
  remainingRef,
  remaining,
  total,
  error,
  errorId,
  column,
}: {
  leading: ReactNode;
  accountColumn?: boolean;
  addRef?: Ref<HTMLButtonElement>;
  onAdd: () => void;
  remainingRef?: Ref<HTMLDivElement>;
  remaining: number;
  total: number;
  error?: string;
  errorId?: string;
  column?: string;
}) {
  return (
    <div
      className={`${grid.columns} ${styles.splitFooter}`}
      data-accounts={accountColumn || undefined}
    >
      {leading}
      <div data-column="category">
        <Button ref={addRef} variant="quiet" size="sm" onClick={onAdd}>
          <PlusIcon aria-hidden />
          Add line
        </Button>
      </div>
      <div
        ref={remainingRef}
        tabIndex={-1}
        className={styles.remaining}
        data-column={column}
        data-unsplit={remaining ? "" : undefined}
        aria-live="polite"
      >
        <p>{remainingLabel(remaining, total)}</p>
        {error && (
          <p id={errorId} className={styles.formError}>
            <CircleAlertIcon size={13} aria-hidden />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
