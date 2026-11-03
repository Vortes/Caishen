"use client";

import {
  CircleCheckIcon,
  CircleXIcon,
  EllipsisIcon,
  TagsIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import { newId } from "~/components/budget/format";
import { useBudgetSelector } from "~/components/sync/hooks";
import type { BudgetSnapshot } from "~/components/sync/budget-store";
import type { Command } from "~/domain/engine";
import { TRANSACTION_ACTION_LIMIT } from "~/domain/register-entry";
import { transactionSelectionActions } from "~/components/transactions/transaction-actions";
import { Button } from "~/components/ui/button";
import { ActionBar, type Way } from "~/components/ui/action-bar";
import barStyles from "~/components/ui/action-bar.module.css";
import { Menu, MenuItem, MenuSub } from "~/components/ui/menu";
import type { Transaction } from "./model";
import { useTransactionEntry } from "./transaction-entry";
import { ShareSelection } from "./share-selection";

export function approveCommand(transactionIds: string[]): Command {
  return { type: "transaction.approve", id: newId(), transactionIds };
}

export type TransactionReview = {
  approve: (transactionIds: string[]) => void;
  enter: (transactionIds: string[]) => void;
  reject: (transactionIds: string[]) => void;
  remove: (transactionIds: string[]) => void;
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

// Floats over the bottom of the register while rows are selected, in place
// of a details panel. Review actions disappear once the selection is approved.
// A transaction opened from the plan leads it with the way back, which stays
// once the selection clears.
export function TransactionActions({
  selection: { selected, actions },
  onCheck,
  back,
}: {
  selection: ReturnType<typeof useReviewSelection>;
  onCheck: (ids: string[], value: boolean) => void;
  back: Way | null;
}) {
  const review = useTransactionReview();
  const entry = useTransactionEntry();
  // With nothing selected, the action bar keeps just the way back.
  if (!selected.length) return <ActionBar count={0} way={back} />;
  const { approve: approvable, enter: enterable, reject: rejectable } = actions;
  const approvals = [
    { label: "Approve", ids: approvable, save: review.approve },
    { label: "Enter now", ids: enterable, save: review.enter },
  ].filter((action) => action.ids.length > 0);
  const overLimit =
    approvable.length > TRANSACTION_ACTION_LIMIT ||
    enterable.length > TRANSACTION_ACTION_LIMIT ||
    rejectable.length > TRANSACTION_ACTION_LIMIT;
  const busy = Boolean(entry.session);
  const ids = selected.map((item) => item.id);
  return (
    <ActionBar
      count={selected.length}
      onClear={() => onCheck(ids, false)}
      way={back}
      hint={overLimit && `Review up to ${TRANSACTION_ACTION_LIMIT} at a time.`}
    >
      {approvals.map((action, index) => (
        <Button
          key={action.label}
          variant={index === 0 ? "primary" : "secondary"}
          size="sm"
          disabled={busy || action.ids.length > TRANSACTION_ACTION_LIMIT}
          onClick={() => action.save(action.ids)}
        >
          <CircleCheckIcon aria-hidden />
          {action.label} ({action.ids.length})
        </Button>
      ))}
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
      <CategorizeAction
        count={actions.categorize.length}
        disabled={busy}
        onCheck={onCheck}
        categorize={(categoryId) =>
          entry.categorizeSelection(actions.categorize, categoryId, (rowId) =>
            onCheck([rowId], true),
          )
        }
      />
      <ShareSelection selected={selected} disabled={busy} onCheck={onCheck} />
      {actions.remove.length > 0 && (
        <MoreAction ids={actions.remove} disabled={busy} />
      )}
    </ActionBar>
  );
}

function MoreAction({ ids, disabled }: { ids: string[]; disabled: boolean }) {
  const review = useTransactionReview();
  const { holdOpen } = useTransactionEntry();
  const [open, setOpen] = useState(false);
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  return (
    <Menu
      label="More transaction actions"
      trigger={
        <Button variant="subtle" size="sm" disabled={disabled}>
          <EllipsisIcon aria-hidden />
          More
        </Button>
      }
      anchor={<span className={barStyles.anchor} aria-hidden />}
      side="top"
      align="end"
      open={open}
      onOpenChange={setOpen}
    >
      <MenuItem
        title="Delete"
        disabled={disabled}
        onSelect={() => review.remove(ids)}
      />
    </Menu>
  );
}

// Puts every row it's given in one category, picked from the plan's groups.
// count is how many rows the pick would change.
export function CategorizeAction({
  count,
  disabled,
  onCheck,
  categorize,
}: {
  count: number;
  disabled: boolean;
  onCheck: (ids: string[], value: boolean) => void;
  categorize: (categoryId: string) => { queuedIds: string[]; error?: string };
}) {
  const { view, holdOpen } = useTransactionEntry();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  const categories = view.categories.filter(
    (category) =>
      !category.pairedAccountId &&
      !category.pairedLoanId &&
      !category.counterpartyAccountId,
  );
  const groups = new Map<string, typeof categories>();
  for (const category of categories) {
    const group = groups.get(category.group) ?? [];
    group.push(category);
    groups.set(category.group, group);
  }
  if (
    !open &&
    (disabled ||
      count === 0 ||
      count > TRANSACTION_ACTION_LIMIT ||
      !categories.length)
  )
    return null;
  return (
    <Menu
      label="Categorize transactions"
      trigger={
        <Button size="sm" disabled={disabled}>
          <TagsIcon aria-hidden />
          Categorize
        </Button>
      }
      anchor={<span className={barStyles.anchor} aria-hidden />}
      side="top"
      align="end"
      open={open}
      onOpenChange={(next) => {
        if (next) setError("");
        setOpen(next);
      }}
      error={error}
    >
      {Array.from(groups, ([name, choices]) => (
        <MenuSub
          key={name}
          title={name}
          label={`${name} categories`}
          disabled={disabled}
        >
          {choices.map((category) => (
            <MenuItem
              key={category.id}
              title={category.name}
              disabled={disabled}
              onSelect={(event) => {
                const result = categorize(category.id);
                if (result.error) {
                  onCheck(result.queuedIds, false);
                  event.preventDefault();
                  setError(result.error);
                }
              }}
            />
          ))}
        </MenuSub>
      ))}
    </Menu>
  );
}
