"use client";

import { useEffect, useRef, useState } from "react";
import { readAmount, sameAmount } from "~/components/budget/amount";
import { newId } from "~/components/budget/format";
import { AmountInput } from "~/components/ui/amount-input";
import { Field } from "~/components/ui/field";
import { money } from "./model";
import { useMoveMoney } from "./move-money";
import { useShellData } from "./shell-data";
import shell from "./shell.module.css";

// The month's expected income, edited in place as in YNAB's summary: Enter
// or leaving the field saves, Escape puts it back, and an empty amount
// clears it.
export function ExpectedIncomeProperty() {
  const { month, expectedIncome } = useShellData();
  const { move, holdOpen } = useMoveMoney();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returning = useRef(false);
  useEffect(() => (editing ? holdOpen() : undefined), [editing, holdOpen]);
  useEffect(() => {
    if (editing) input.current?.focus();
    else if (returning.current) {
      returning.current = false;
      opener.current?.focus();
    }
  }, [editing]);

  const close = (refocus: boolean) => {
    returning.current = refocus;
    setError(null);
    setEditing(false);
  };
  const save = (refocus: boolean) => {
    let cents: number | null = null;
    if (amount.trim()) {
      const reading = readAmount(amount);
      if (!reading.ok) return setError(reading.message);
      if (reading.cents < 0) return setError("Enter zero or more.");
      cents = reading.cents;
    }
    if (cents === expectedIncome) return close(refocus);
    const blocked = move(
      { type: "income.expect", id: newId(), month: month.key, amount: cents },
      cents === null
        ? `Cleared expected income for ${month.short}`
        : `Expecting ${money(cents)} in ${month.short}`,
    );
    if (blocked) setError(blocked);
    else close(refocus);
  };

  if (editing)
    return (
      <form
        className={shell.inlineAmount}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save(true);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) save(false);
        }}
      >
        <Field
          label={`Expected income in ${month.short}`}
          labelHidden
          error={error ?? undefined}
        >
          <AmountInput
            inputRef={input}
            placeholder="0.00"
            value={amount}
            onChange={(next) => {
              if (!sameAmount(amount, next)) setError(null);
              setAmount(next);
            }}
          />
        </Field>
      </form>
    );
  return (
    <button
      ref={opener}
      type="button"
      className={shell.propertyButton}
      aria-label={
        expectedIncome === null
          ? `Add expected income for ${month.short}`
          : `${money(expectedIncome)} expected income in ${month.short}. Edit`
      }
      data-empty={expectedIncome === null || undefined}
      onClick={() => {
        setAmount(
          expectedIncome === null ? "" : (expectedIncome / 100).toFixed(2),
        );
        setEditing(true);
      }}
    >
      {expectedIncome === null ? "Add expected income" : money(expectedIncome)}
    </button>
  );
}
