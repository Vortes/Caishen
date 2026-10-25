"use client";

import { PlusIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useRef, useState } from "react";
import { newId, today } from "~/components/budget/format";
import { Button } from "~/components/ui/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { usePortalContainer } from "~/components/ui/tooltip";
import { POPOVER_GAP } from "~/components/ui/tokens";
import { rememberedSpendingCategory } from "~/domain/partner-ledger";
import { money, type Account } from "./model";
import moveStyles from "./move-money.module.css";
import { AmountWell, halfOf, parseCents } from "./share-field";
import { useTransactionEntry } from "./transaction-entry";
import { ChoiceField, type ChoiceOption } from "./transaction-fields";
import local from "./partner-register.module.css";

type Field = "payee" | "amount" | "share";

// Either partner records a shared purchase, including one the other paid.
// It counts at once in both budgets; the payer's bank import matches it
// when it arrives.
export function RecordPurchase({ account }: { account: Account }) {
  const id = useId();
  const { view, saveCommand } = useTransactionEntry();
  const container = usePortalContainer();
  const you = view.budget.userId;
  const partnerId = view.members.find(
    (member) => member.userId !== you,
  )?.userId;
  const payeeInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [payee, setPayee] = useState("");
  const [amountText, setAmountText] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [even, setEven] = useState(true);
  const [shareText, setShareText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  // Once you pick a category, the payee's memory leaves it alone.
  const [categoryChosen, setCategoryChosen] = useState(false);
  const [error, setError] = useState<{ field?: Field; message: string } | null>(
    null,
  );
  const amount = parseCents(amountText) ?? 0;
  const youPaid = paidBy === you;
  const shareLabel = youPaid ? `${account.name}'s share` : "Your share";
  const options: ChoiceOption[] = view.categories
    .filter(
      (category) =>
        !category.pairedAccountId &&
        !category.pairedLoanId &&
        !category.counterpartyAccountId,
    )
    .map((category) => ({
      value: category.id,
      label: category.name,
      group: category.group,
      amount: category.available,
    }));
  const fail = (message: string, field?: Field) => setError({ field, message });
  const fieldError = (field: Field) =>
    error?.field === field && (
      <p className={moveStyles.error}>{error.message}</p>
    );
  if (!partnerId) return null;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setPayee("");
        setAmountText("");
        setPaidBy(partnerId);
        setEven(true);
        setShareText("");
        setCategoryId("");
        setCategoryChosen(false);
        setError(null);
      }}
    >
      <Popover.Trigger asChild>
        <Button size="sm">
          <PlusIcon aria-hidden />
          Record purchase
        </Button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={moveStyles.popover}
          align="end"
          sideOffset={POPOVER_GAP}
          collisionPadding={12}
          aria-label="Record a shared purchase"
          // The payee comes first; on touch, no keyboard until it's tapped.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (window.matchMedia("(pointer: fine)").matches)
              payeeInput.current?.focus();
          }}
        >
          <form
            className={moveStyles.form}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const name = payee.trim();
              if (!name) return fail("Add who was paid.", "payee");
              if (!amount)
                return fail("Enter the amount, like 54.00.", "amount");
              const share = even ? halfOf(amount) : parseCents(shareText);
              if (!share || share > amount)
                return fail(
                  `Enter a share above $0.00 and at most ${money(amount)}.`,
                  "share",
                );
              const failure = saveCommand(
                {
                  type: "partner.record",
                  id: newId(),
                  entryId: newId(),
                  recordedAt: new Date().toISOString(),
                  payerId: paidBy,
                  date: today(view.budget.settings.timezone),
                  payee: name,
                  amount,
                  share,
                  ...(categoryId ? { categoryId } : {}),
                },
                youPaid
                  ? `Recorded ${name}. ${account.name} owes you ${money(share)}; your bank import will match it.`
                  : `Recorded ${name}. You owe ${account.name} ${money(share)}; ${account.name}'s bank import will match it.`,
              );
              if (failure) return fail(failure);
              setOpen(false);
            }}
          >
            <div className={moveStyles.header}>
              <strong>Record a shared purchase</strong>
            </div>
            <div className={moveStyles.field}>
              <span id={`${id}-paid`}>Who paid</span>
              <SegmentedControl
                fill
                aria-labelledby={`${id}-paid`}
                value={paidBy}
                onValueChange={setPaidBy}
              >
                <SegmentedControlItem value={partnerId}>
                  {account.name}
                </SegmentedControlItem>
                <SegmentedControlItem value={you}>You</SegmentedControlItem>
              </SegmentedControl>
            </div>
            <div className={moveStyles.field}>
              <label htmlFor={`${id}-payee`}>Payee</label>
              <div
                className={moveStyles.amountInput}
                data-invalid={error?.field === "payee" ? "" : undefined}
              >
                <input
                  ref={payeeInput}
                  id={`${id}-payee`}
                  value={payee}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Bi-Rite Market"
                  aria-invalid={error?.field === "payee" || undefined}
                  onChange={(event) => {
                    setPayee(event.target.value);
                    if (error?.field === "payee") setError(null);
                    if (categoryChosen) return;
                    setCategoryId(
                      rememberedSpendingCategory(
                        view.budget,
                        event.target.value.trim(),
                      ) ?? "",
                    );
                  }}
                />
              </div>
              {fieldError("payee")}
            </div>
            <div className={local.fieldPair}>
              <div className={moveStyles.field}>
                <label htmlFor={`${id}-amount`}>Total paid</label>
                <AmountWell
                  id={`${id}-amount`}
                  value={amountText}
                  invalid={error?.field === "amount"}
                  onChange={(value) => {
                    setAmountText(value);
                    if (error?.field === "amount") setError(null);
                  }}
                />
              </div>
              <div className={moveStyles.field}>
                <label htmlFor={`${id}-share`}>{shareLabel}</label>
                {even ? (
                  <button
                    type="button"
                    id={`${id}-share`}
                    className={`${moveStyles.amountInput} ${local.evenButton}`}
                    onClick={() => {
                      setEven(false);
                      setShareText((halfOf(amount) / 100).toFixed(2));
                    }}
                  >
                    <span>Half</span>
                    <span className={local.evenAmount}>
                      {money(halfOf(amount))}
                    </span>
                  </button>
                ) : (
                  <AmountWell
                    id={`${id}-share`}
                    value={shareText}
                    autoFocus
                    invalid={error?.field === "share"}
                    onChange={(value) => {
                      setShareText(value);
                      if (error?.field === "share") setError(null);
                    }}
                  />
                )}
              </div>
            </div>
            {(error?.field === "amount" || error?.field === "share") && (
              <div className={moveStyles.formError}>
                <p className={moveStyles.error}>{error.message}</p>
              </div>
            )}
            <div className={moveStyles.field}>
              <label htmlFor={`${id}-category`}>
                Your category{youPaid ? "" : " for your share"}
              </label>
              <div className={local.choiceWell}>
                <ChoiceField
                  id={`${id}-category`}
                  label="Your category"
                  value={categoryId}
                  options={options}
                  placeholder="Pick later"
                  onChange={(next) => {
                    setCategoryId(next);
                    setCategoryChosen(true);
                  }}
                />
              </div>
            </div>
            {error && !error.field && (
              <div className={moveStyles.formError}>
                <p className={moveStyles.error} role="alert">
                  {error.message}
                </p>
              </div>
            )}
            <div className={moveStyles.footer}>
              <Button size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" type="submit">
                Record
              </Button>
            </div>
          </form>
          <Popover.Arrow className={moveStyles.arrow} width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
