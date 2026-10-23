"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  TagsIcon,
  XIcon,
} from "lucide-react";
import { Popover } from "radix-ui";
import { createContext, useContext, useEffect, useId, useState } from "react";
import { newId } from "~/components/budget/format";
import { useBudgetSelector } from "~/components/sync/hooks";
import type { BudgetSnapshot } from "~/components/sync/budget-store";
import type { Command } from "~/domain/engine";
import { TRANSACTION_ACTION_LIMIT } from "~/domain/register-entry";
import { transactionSelectionActions } from "~/components/transactions/transaction-actions";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { IconButton } from "~/components/ui/icon-button";
import { usePortalContainer } from "~/components/ui/tooltip";
import type { Transaction } from "./model";
import shell from "./shell.module.css";
import { useTransactionEntry } from "./transaction-entry";
import { ChoiceField, type ChoiceOption } from "./transaction-fields";
import styles from "./transaction-review.module.css";
import { ShareSelection } from "./share-selection";

export function approveCommand(transactionIds: string[]): Command {
  return { type: "transaction.approve", id: newId(), transactionIds };
}

export type TransactionReview = {
  // Sends one transaction.approve for these transactions; it shows at once
  // and saves in the background.
  approve: (transactionIds: string[]) => void;
  reject: (transactionIds: string[]) => void;
  // Returns why the category can't apply, or null once it's on its way.
  categorize: (transactionIds: string[], categoryId: string) => string | null;
};

const TransactionReviewContext = createContext<TransactionReview | null>(null);

export const TransactionReviewProvider = TransactionReviewContext.Provider;

function useTransactionReview() {
  const value = useContext(TransactionReviewContext);
  if (!value)
    throw new Error("useTransactionReview needs a TransactionReviewProvider.");
  return value;
}

const saved = (snapshot: BudgetSnapshot) => snapshot.pending.length === 0;

// The selection on screen is what's checked among the rows showing.
// Once nothing is saving, checked rows that are no longer showing
// are dropped, so a row that comes back later doesn't return selected.
// While an approval saves they're kept: if the server refuses it, the rows
// it hid come back still selected for another try.
export function useReviewSelection({
  rows,
  checked,
  onCheck,
}: {
  rows: Transaction[];
  checked: string[];
  onCheck: (ids: string[], value: boolean) => void;
}) {
  const idle = useBudgetSelector(saved);
  const selectable = rows.filter((item) => item.actions.select);
  const showing = new Set(selectable.map((item) => item.id));
  const stale = checked.filter((id) => !showing.has(id));
  useEffect(() => {
    if (idle && stale.length) onCheck(stale, false);
  });
  const selected = selectable.filter((item) => checked.includes(item.id));
  return {
    selectable,
    selected,
    actions: transactionSelectionActions(selected),
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
// of a details panel. Review actions disappear once the selection is approved.
export function SelectionIsland({
  selection: { selected, actions },
  onCheck,
}: {
  selection: ReturnType<typeof useReviewSelection>;
  onCheck: (ids: string[], value: boolean) => void;
}) {
  const review = useTransactionReview();
  const entry = useTransactionEntry();
  if (!selected.length) return null;
  const { approve: approvable, reject: rejectable, refund: refundId } = actions;
  const overLimit =
    approvable.length > TRANSACTION_ACTION_LIMIT ||
    rejectable.length > TRANSACTION_ACTION_LIMIT;
  const busy = Boolean(entry.session);
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
            {selected.length}{" "}
            {selected.length === 1 ? "transaction" : "transactions"}
          </span>
          {overLimit && (
            <span className={styles.hint}>
              Review up to {TRANSACTION_ACTION_LIMIT} at a time.
            </span>
          )}
        </span>
        <span className={styles.divider} aria-hidden />
        <div className={styles.actions}>
          {approvable.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              disabled={busy || approvable.length > TRANSACTION_ACTION_LIMIT}
              onClick={() => review.approve(approvable)}
            >
              <CircleCheckIcon aria-hidden />
              Approve ({approvable.length})
            </Button>
          )}
          {rejectable.length > 0 && (
            <Button
              size="sm"
              disabled={busy || rejectable.length > TRANSACTION_ACTION_LIMIT}
              onClick={() => review.reject(rejectable)}
            >
              <CircleXIcon aria-hidden />
              Reject
            </Button>
          )}
          {refundId && (
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                entry.start({
                  accountId: selected[0]!.accountId,
                  refundOfTransactionId: refundId,
                  field: "inflow",
                })
              }
            >
              Refund
            </Button>
          )}
          <CategorizeAction
            selected={selected}
            available={actions.categorize}
            disabled={busy}
          />
          <ShareSelection
            selected={selected}
            disabled={busy}
            onCheck={onCheck}
          />
        </div>
      </div>
    </div>
  );
}

function CategorizeAction({
  selected,
  available,
  disabled,
}: {
  selected: Transaction[];
  available: boolean;
  disabled: boolean;
}) {
  const review = useTransactionReview();
  const { view, holdOpen } = useTransactionEntry();
  const container = usePortalContainer();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  const options: ChoiceOption[] = view.categories
    .filter(
      (category) =>
        !category.pairedAccountId &&
        !category.pairedLoanId &&
        !category.counterpartyAccountId,
    )
    .map((category) => ({ value: category.id, label: category.name }));
  const submit = () => {
    if (!categoryId || disabled) return;
    const blocked = review.categorize(
      selected.map((item) => item.id),
      categoryId,
    );
    if (blocked) setError(blocked);
    else setOpen(false);
  };
  if (
    !open &&
    (disabled ||
      !available ||
      selected.length > TRANSACTION_ACTION_LIMIT ||
      !options.length)
  )
    return null;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setCategoryId("");
          setError("");
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <Button size="sm" disabled={disabled}>
          <TagsIcon aria-hidden />
          Categorize
        </Button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={styles.categoryPopover}
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <form
            className={styles.categoryForm}
            aria-label="Categorize transactions"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label htmlFor={id}>Category</label>
            <ChoiceField
              id={id}
              label="Category"
              value={categoryId}
              options={options}
              wide={false}
              placeholder="Choose a category"
              onChange={setCategoryId}
            />
            {error && (
              <p className={styles.error} role="alert">
                <CircleAlertIcon aria-hidden size={14} />
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <Button size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                type="submit"
                disabled={!categoryId || disabled}
              >
                Apply
              </Button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
