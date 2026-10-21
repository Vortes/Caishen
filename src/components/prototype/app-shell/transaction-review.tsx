"use client";

import { useIsMutating } from "@tanstack/react-query";
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
import { isTransfer } from "~/domain/transfers";
import type { Command } from "~/domain/engine";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { IconButton } from "~/components/ui/icon-button";
import { usePortalContainer } from "~/components/ui/tooltip";
import type { Transaction } from "./model";
import shell from "./shell.module.css";
import { useTransactionEntry } from "./transaction-entry";
import { ChoiceField, type ChoiceOption } from "./transaction-fields";
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
  reject: (transactionIds: string[]) => void;
  categorize: (transactionIds: string[], categoryId: string) => Promise<void>;
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

// The selection on screen is what's checked among the rows showing.
// Once nothing is saving, checked rows that are no longer showing
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
  selection: { selected, approvable },
  onCheck,
}: {
  selection: ReturnType<typeof useReviewSelection>;
  onCheck: (ids: string[], value: boolean) => void;
}) {
  const review = useTransactionReview();
  const entry = useTransactionEntry();
  if (!selected.length) return null;
  const overLimit = approvable.length > APPROVE_LIMIT;
  const busy = review.busy || Boolean(entry.session);
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
              Approve up to {APPROVE_LIMIT} at a time.
            </span>
          )}
        </span>
        <span className={styles.divider} aria-hidden />
        <div className={styles.actions}>
          {approvable.length > 0 && (
            <>
              <Button
                variant="primary"
                size="sm"
                disabled={busy || overLimit}
                onClick={() => review.approve(approvable)}
              >
                <CircleCheckIcon aria-hidden />
                Approve ({approvable.length})
              </Button>
              <Button
                size="sm"
                disabled={busy || overLimit}
                onClick={() => review.reject(approvable)}
              >
                <CircleXIcon aria-hidden />
                Reject
              </Button>
            </>
          )}
          <CategorizeAction selected={selected} disabled={busy} />
        </div>
      </div>
    </div>
  );
}

function CategorizeAction({
  selected,
  disabled,
}: {
  selected: Transaction[];
  disabled: boolean;
}) {
  const review = useTransactionReview();
  const { view, holdOpen } = useTransactionEntry();
  const container = usePortalContainer();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  const transactions = view.budget.transactions.filter(
    (item) => !item.removed && selected.some((row) => row.id === item.id),
  );
  const options: ChoiceOption[] = view.categories
    .filter(
      (category) =>
        !category.pairedAccountId &&
        !category.pairedLoanId &&
        transactions.every(
          (item) => !item.sharedCategoryId || item.categoryId === category.id,
        ),
    )
    .map((category) => ({ value: category.id, label: category.name }));
  const available =
    selected.length <= APPROVE_LIMIT &&
    selected.every((item) => !item.categoryNotNeeded) &&
    transactions.length === selected.length &&
    transactions.every(
      (item) =>
        isTransfer(item) ||
        ["purchase", "income", "refund"].includes(item.kind),
    );
  const submit = async () => {
    if (!categoryId || saving || disabled) return;
    setSaving(true);
    setError("");
    try {
      await review.categorize(
        selected.map((item) => item.id),
        categoryId,
      );
      setOpen(false);
    } catch {
      setError("Couldn’t save the category. Try again.");
    } finally {
      setSaving(false);
    }
  };
  if (!open && (disabled || !available || !options.length)) return null;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        if (next) {
          setCategoryId("");
          setError("");
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <Button size="sm" disabled={disabled || saving}>
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
          onInteractOutside={(event) => {
            if (saving) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          <form
            className={styles.categoryForm}
            aria-label="Categorize transactions"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
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
              readOnly={saving}
              onChange={setCategoryId}
            />
            {error && (
              <p className={styles.error} role="alert">
                <CircleAlertIcon aria-hidden size={14} />
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <Button
                size="sm"
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                type="submit"
                disabled={saving || !categoryId || disabled}
              >
                {saving ? "Saving…" : "Apply"}
              </Button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
