"use client";

import { useIsMutating } from "@tanstack/react-query";
import { createContext, useContext, useEffect } from "react";
import { newId } from "~/components/budget/format";
import type { Command } from "~/domain/engine";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { money, type Transaction } from "./model";
import shell from "./shell.module.css";
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

// Only recorded transactions can be selected; bank imports are reviewed one
// at a time. The selection on screen is what's checked among the rows
// showing. Once nothing is saving, checked rows that are no longer showing
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

export function ReviewBar({
  selection: { selectable, selected, approvable, net },
  onCheck,
}: {
  selection: ReturnType<typeof useReviewSelection>;
  onCheck: (ids: string[], value: boolean) => void;
}) {
  const review = useTransactionReview();
  if (!selectable.length) return null;
  const all = selectable.map((item) => item.id);
  const overLimit = approvable.length > APPROVE_LIMIT;
  return (
    <div className={styles.bar}>
      <label className={styles.selectAll}>
        <Checkbox
          checked={
            selected.length === 0
              ? false
              : selected.length === all.length
                ? true
                : "indeterminate"
          }
          onCheckedChange={(value) => onCheck(all, value === true)}
        />
        <span>Select all</span>
      </label>
      <span className={styles.summary} aria-live="polite">
        {selected.length > 0 && (
          <>
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
          </>
        )}
      </span>
      {selected.length > 0 && (
        <div className={styles.actions}>
          <Button
            variant="quiet"
            size="sm"
            onClick={() =>
              onCheck(
                selected.map((item) => item.id),
                false,
              )
            }
          >
            Clear
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={review.busy || !approvable.length || overLimit}
            onClick={() => review.approve(approvable)}
          >
            Approve ({approvable.length})
          </Button>
        </div>
      )}
    </div>
  );
}

// The details card's action for a transaction waiting on review. A recorded
// transaction is marked reviewed with the same approval as the register; a
// bank import is resolved through its own review, which isn't built yet.
export function ReviewAction({ item }: { item: Transaction }) {
  const review = useTransactionReview();
  if (item.source === "bank")
    return <Button variant="primary">Review import</Button>;
  return (
    <Button
      variant="primary"
      disabled={review.busy}
      onClick={() => review.approve([item.id])}
    >
      Mark reviewed
    </Button>
  );
}
