"use client";

import { useIsMutating } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { createContext, useContext, useEffect } from "react";
import { newId } from "~/components/budget/format";
import type { Command } from "~/domain/engine";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { IconButton } from "~/components/ui/icon-button";
import { Tooltip } from "~/components/ui/tooltip";
import { money, type Transaction } from "./model";
import shell from "./shell.module.css";
import { editGuidance, useTransactionEntry } from "./transaction-entry";
import styles from "./transaction-review.module.css";

// transaction.approve takes at most this many transactions at once.
export const APPROVE_LIMIT = 500;

export function approveCommand(transactionIds: string[]): Command {
  return { type: "transaction.approve", id: newId(), transactionIds };
}

export type TransactionReview = {
  // Sends one transaction.approve for these transactions through the shared
  // command path. Ignored while another change saves, a month loads, or the
  // budget couldn't refresh.
  approve: (transactionIds: string[]) => void;
  // True while one of those applies, so review controls stay disabled.
  busy: boolean;
};

const TransactionReviewContext = createContext<TransactionReview | null>(null);

export const TransactionReviewProvider = TransactionReviewContext.Provider;

function useTransactionReview() {
  const value = useContext(TransactionReviewContext);
  if (!value)
    throw new Error("useTransactionReview needs a TransactionReviewProvider.");
  return value;
}

// Only recorded transactions can be selected; bank imports keep their own
// review, which isn't built yet. The selection on screen is what's checked
// among the rows showing. Once nothing is saving, checked rows that are no longer showing
// are dropped, so a row that comes back later doesn't return selected.
// While an approval saves they're kept: if it fails, the rows it hid come
// back still selected for another try.
export function useReviewSelection({
  rows,
  checked,
  onCheck,
}: {
  rows: Transaction[];
  checked: string[];
  onCheck: (ids: string[], value: boolean) => void;
}) {
  const idle = useIsMutating() === 0;
  const selectable = rows.filter((item) => item.source === "budget");
  const showing = new Set(selectable.map((item) => item.id));
  const stale = checked.filter((id) => !showing.has(id));
  useEffect(() => {
    if (idle && stale.length) onCheck(stale, false);
  });
  const selected = selectable.filter((item) => checked.includes(item.id));
  return {
    selectable,
    selected,
    // Approval counts only what still needs review.
    approvable: selected
      .filter((item) => item.needsReview)
      .map((item) => item.id),
    net: selected.reduce((total, item) => total + item.amount, 0),
  };
}

// Sits in the column header's checkbox gutter, over the rows' checkboxes.
export function SelectAll({
  selection: { selectable, selected },
  onCheck,
}: {
  selection: ReturnType<typeof useReviewSelection>;
  onCheck: (ids: string[], value: boolean) => void;
}) {
  if (!selectable.length) return null;
  const all = selectable.map((item) => item.id);
  return (
    <label className={shell.checkboxSlot}>
      <Checkbox
        aria-label="Select all"
        checked={
          selected.length === 0
            ? false
            : selected.length === all.length
              ? true
              : "indeterminate"
        }
        onCheckedChange={(value) => onCheck(all, value === true)}
      />
    </label>
  );
}

// Floats over the bottom of the register while rows are selected, in place
// of a details panel: what's selected, and what can be done to it. Edit
// shows for one transaction the register can edit. Categorize isn't built
// yet.
export function SelectionIsland({
  selection: { selected, approvable, net },
  onCheck,
}: {
  selection: ReturnType<typeof useReviewSelection>;
  onCheck: (ids: string[], value: boolean) => void;
}) {
  const review = useTransactionReview();
  const entry = useTransactionEntry();
  if (!selected.length) return null;
  const only = selected.length === 1 ? selected[0]!.id : null;
  const transaction = entry.view.budget.transactions.find(
    (item) => item.id === only && !item.removed,
  );
  // Transfers, card payments, and the like aren't edited here yet, so
  // they offer no Edit.
  const editable =
    transaction && !editGuidance(transaction) ? transaction : undefined;
  const overLimit = approvable.length > APPROVE_LIMIT;
  return (
    <div className={styles.islandSlot}>
      <div
        className={styles.island}
        role="toolbar"
        aria-label="Selected transactions"
      >
        <IconButton
          size="sm"
          label="Clear selection"
          shortcut="Esc"
          onClick={() =>
            onCheck(
              selected.map((item) => item.id),
              false,
            )
          }
        >
          <XIcon aria-hidden />
        </IconButton>
        <span className={styles.summary} aria-live="polite">
          <span className={styles.count}>
            {selected.length} selected
            <span aria-hidden> · </span>
            <span className={shell.numeric}>{money(net, true)}</span>
          </span>
          {overLimit && (
            <span className={styles.hint}>
              Approve up to {APPROVE_LIMIT} at a time.
            </span>
          )}
        </span>
        <span className={styles.divider} aria-hidden />
        <div className={styles.actions}>
          {editable && (
            <Tooltip label="Edit this transaction" shortcut="E">
              <Button
                size="sm"
                data-transaction-opener={editable.id}
                disabled={Boolean(entry.session) || entry.busy}
                onClick={() => entry.start({ transactionId: editable.id })}
              >
                Edit
              </Button>
            </Tooltip>
          )}
          <Button size="sm">Categorize</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={review.busy || !approvable.length || overLimit}
            onClick={() => review.approve(approvable)}
          >
            Approve ({approvable.length})
          </Button>
        </div>
      </div>
    </div>
  );
}
