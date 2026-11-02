"use client";

import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  TagsIcon,
  XIcon,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { newId } from "~/components/budget/format";
import { useBudgetSelector } from "~/components/sync/hooks";
import type { BudgetSnapshot } from "~/components/sync/budget-store";
import type { Command } from "~/domain/engine";
import { TRANSACTION_ACTION_LIMIT } from "~/domain/register-entry";
import { transactionSelectionActions } from "~/components/transactions/transaction-actions";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Tooltip } from "~/components/ui/tooltip";
import { Menu, MenuItem, MenuSub } from "~/components/ui/menu";
import type { Transaction } from "./model";
import shell from "./shell.module.css";
import { useTransactionEntry } from "./transaction-entry";
import styles from "./transaction-review.module.css";
import { ShareSelection } from "./share-selection";

export function approveCommand(transactionIds: string[]): Command {
  return { type: "transaction.approve", id: newId(), transactionIds };
}

export type TransactionReview = {
  approve: (transactionIds: string[]) => void;
  enter: (transactionIds: string[]) => void;
  reject: (transactionIds: string[]) => void;
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
  selection: { selectable: { id: string }[]; selected: { id: string }[] };
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
        // With anything checked, the box clears the selection.
        onCheckedChange={() => onCheck(all, selected.length === 0)}
      />
    </label>
  );
}

// Somewhere the island can take you, named on its button: the plan
// category a transaction was opened from, or the transaction a row came
// from. label says where it goes in full.
export type Way = {
  name: string;
  label: string;
  forward?: boolean;
  onGo: () => void;
};

// Floats over the bottom of the register while rows are selected, in place
// of a details panel. Review actions disappear once the selection is approved.
// A transaction opened from the plan leads it with the way back, which stays
// once the selection clears.
export function SelectionIsland({
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
  // With nothing selected, the island keeps just the way back.
  if (!selected.length) return <SelectionBar count={0} way={back} />;
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
    <SelectionBar
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
    </SelectionBar>
  );
}

// The island's frame: how many rows are selected, with the way to clear
// them, then what can be done with them. A register's own island fills in
// its actions.
export function SelectionBar({
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
  // With nothing selected, the island keeps just its way somewhere else.
  if (!count)
    return way ? (
      <div className={styles.islandSlot}>
        <div className={styles.island}>
          <WayButton way={way} />
        </div>
      </div>
    ) : null;
  return (
    <div className={styles.islandSlot}>
      <div
        className={styles.island}
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
      anchor={<span className={styles.islandAnchor} aria-hidden />}
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
