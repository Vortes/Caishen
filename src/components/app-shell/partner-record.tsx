"use client";

import { PlusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { readAmount } from "~/components/budget/amount";
import { newId, today } from "~/components/budget/format";
import { AmountInput } from "~/components/ui/amount-input";
import { Button } from "~/components/ui/button";
import { Field as FormField } from "~/components/ui/field";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { Popover } from "~/components/ui/popover";
import { rememberedSpendingCategory } from "~/domain/partner-ledger";
import { money, type Account } from "./model";
import moveStyles from "./move-money.module.css";
import { sameAmount } from "./move-money";
import { halfOf } from "./share-field";
import { useTransactionEntry } from "./transaction-entry";
import { ChoiceField, type ChoiceOption } from "./transaction-fields";
import local from "./partner-register.module.css";

type Field = "payee" | "amount" | "share";

// The payee comes first as the form opens; on touch, no keyboard until it's
// tapped.
const focusPayee = (input: HTMLInputElement | null) => {
  if (input && window.matchMedia("(pointer: fine)").matches) input.focus();
};

// Either partner records a shared purchase, including one the other paid.
// It counts at once in both budgets; the payer's bank import matches it
// when it arrives.
export function RecordPurchase({ account }: { account: Account }) {
  const id = useId();
  const { view, saveCommand } = useTransactionEntry();
  const you = view.budget.userId;
  const partnerId = view.members.find(
    (member) => member.userId !== you,
  )?.userId;
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
  const reading = readAmount(amountText);
  const amount = reading.ok ? Math.max(0, reading.cents) : 0;
  // Clicking the even split makes the share editable, ready to type.
  const shareInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!even) shareInput.current?.focus();
  }, [even]);
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
  const fieldMessage = (field: Field) =>
    error?.field === field ? error.message : undefined;
  if (!partnerId) return null;
  return (
    <Popover
      label="Record a shared purchase"
      trigger={
        <Button size="sm">
          <PlusIcon aria-hidden />
          Record purchase
        </Button>
      }
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
      align="end"
      size="form"
      arrow
      autoFocus={false}
    >
      <form
        className={moveStyles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const name = payee.trim();
          if (!name) return fail("Add who was paid.", "payee");
          if (amountText.trim() && !reading.ok)
            return fail(reading.message, "amount");
          if (!amount) return fail("Enter the amount, like 54.00.", "amount");
          const shareReading = readAmount(shareText);
          if (!even && shareText.trim() && !shareReading.ok)
            return fail(shareReading.message, "share");
          const share = even
            ? halfOf(amount)
            : shareReading.ok
              ? shareReading.cents
              : 0;
          if (share <= 0 || share > amount)
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
              ref={focusPayee}
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
          <div className={moveStyles.fieldSlot}>
            <FormField label="Total paid" error={fieldMessage("amount")}>
              <AmountInput
                value={amountText}
                onChange={(value) => {
                  if (
                    error?.field === "amount" &&
                    !sameAmount(amountText, value)
                  )
                    setError(null);
                  setAmountText(value);
                }}
              />
            </FormField>
          </div>
          <div className={moveStyles.fieldSlot}>
            <FormField
              id={`${id}-share`}
              label={shareLabel}
              error={fieldMessage("share")}
            >
              {even ? (
                <button
                  type="button"
                  id={`${id}-share`}
                  className={`${moveStyles.amountInput} ${local.evenButton}`}
                  aria-describedby={
                    fieldMessage("share") ? `${id}-share-error` : undefined
                  }
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
                <AmountInput
                  inputRef={shareInput}
                  value={shareText}
                  onChange={(value) => {
                    if (
                      error?.field === "share" &&
                      !sameAmount(shareText, value)
                    )
                      setError(null);
                    setShareText(value);
                  }}
                />
              )}
            </FormField>
          </div>
        </div>
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
    </Popover>
  );
}
