"use client";

import { CircleAlertIcon, UsersIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { isFullShare } from "~/domain/counterparty";
import {
  shareForAmount,
  type ShareChoice,
} from "~/components/transactions/transaction-share";
import { Button } from "~/components/ui/button";
import { Popover } from "~/components/ui/popover";
import { money, type Transaction } from "./model";
import { ShareChoices, useShareParties } from "./share-field";
import { useTransactionEntry } from "./transaction-entry";
import { ChoiceField } from "./transaction-fields";
import styles from "./transaction-review.module.css";

export function ShareSelection({
  selected,
  disabled,
  onCheck,
}: {
  selected: Transaction[];
  disabled: boolean;
  onCheck: (ids: string[], value: boolean) => void;
}) {
  const entry = useTransactionEntry();
  const { holdOpen } = entry;
  const { partner, reimbursements, who } = useShareParties();
  const id = useId();
  const categoryInput = useRef<HTMLInputElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<Transaction[]>([]);
  const [choice, setChoice] = useState<ShareChoice | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  const eligible = selected.filter(
    (row) =>
      row.actions.share === "edit" &&
      !entry.view.budget.transactions.some(
        (item) => item.id === row.id && Boolean(item.lines?.length),
      ),
  );
  const options = entry.view.categories
    .filter(
      (category) =>
        !category.pairedAccountId &&
        !category.pairedLoanId &&
        !category.counterpartyAccountId,
    )
    .map((category) => ({ value: category.id, label: category.name }));
  const needsCategory =
    choice &&
    targets.some(
      (row) =>
        !row.categoryId &&
        !isFullShare({
          amount: row.amount,
          counterpartyShare: shareForAmount(choice, row.amount),
        }),
    );
  const total = choice
    ? targets.reduce(
        (sum, row) => sum + (shareForAmount(choice, row.amount)?.amount ?? 0),
        0,
      )
    : 0;
  useEffect(() => {
    if (choice)
      (needsCategory ? categoryInput.current : confirmButton.current)?.focus({
        preventScroll: true,
      });
  }, [choice, needsCategory]);
  const save = () => {
    if (!choice) return;
    setError("");
    const result = entry.shareSelection(
      targets.map((row) => row.id),
      choice,
      categoryId,
      (rowId) => onCheck([rowId], true),
    );
    onCheck(result.queuedIds, false);
    if (result.error) {
      setTargets((rows) =>
        rows.filter((row) => !result.queuedIds.includes(row.id)),
      );
      setError(result.error);
    } else setOpen(false);
  };
  if (!open && (!eligible.length || (!partner && !reimbursements))) return null;
  return (
    <Popover
      label="Share selected transactions"
      trigger={
        <Button size="sm" disabled={disabled}>
          <UsersIcon aria-hidden />
          Share
        </Button>
      }
      // Hangs from the island's outer border, not the button inside it.
      anchor={<div className={styles.islandAnchor} aria-hidden />}
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setTargets(eligible);
          setChoice(null);
          setCategoryId("");
          setError("");
        }
        setOpen(next);
      }}
      side="top"
      align="end"
      size="form"
    >
      {/* Keys typed here stay out of the island and register around it. */}
      <div
        className={styles.sharePanel}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <ShareChoices
          amounts={targets.map((row) => Math.abs(row.amount))}
          onChange={(share, basis) => {
            setChoice({ share, basis });
            return null;
          }}
          confirmation={
            choice ? (
              <form
                className={styles.shareConfirmation}
                aria-label="Share transactions"
                onSubmit={(event) => {
                  event.preventDefault();
                  save();
                }}
              >
                <strong>
                  {choice.share
                    ? `Share with ${who(choice.share)}`
                    : "Keep these just yours"}
                </strong>
                <p className={styles.shareSummary}>
                  {targets.length}{" "}
                  {targets.length === 1 ? "transaction" : "transactions"} ·{" "}
                  {money(total)} shared
                  {choice.basis === "half" ? " · 50/50 each" : ""}
                </p>
                {needsCategory && (
                  <>
                    <label htmlFor={id}>Category for your portion</label>
                    <ChoiceField
                      id={id}
                      label="Category for your portion"
                      value={categoryId}
                      options={options}
                      placement="inline"
                      placeholder="Choose a category"
                      onChange={setCategoryId}
                      inputRef={categoryInput}
                    />
                    <p className={styles.shareSummary}>
                      Applies to your uncategorized portions.
                    </p>
                  </>
                )}
                {error && (
                  <p className={styles.error} role="alert">
                    <CircleAlertIcon size={14} aria-hidden />
                    {error}
                  </p>
                )}
                <div className={styles.actions}>
                  <Button
                    size="sm"
                    onClick={() => {
                      setChoice(null);
                      setError("");
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    size="sm"
                    ref={confirmButton}
                    variant="primary"
                    type="submit"
                    disabled={disabled || Boolean(needsCategory && !categoryId)}
                  >
                    {`Share ${targets.length} ${targets.length === 1 ? "transaction" : "transactions"}`}
                  </Button>
                </div>
              </form>
            ) : undefined
          }
        />
      </div>
    </Popover>
  );
}
