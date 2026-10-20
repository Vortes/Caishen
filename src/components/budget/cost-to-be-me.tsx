"use client";

import { useId, useState, type FormEvent } from "react";
import type { Command } from "~/domain/engine";
import type { View } from "~/components/budget/types";
import { money, monthName, newId } from "~/components/budget/format";
import { Amount } from "~/components/shared";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

const cents = (value: number | null) =>
  value === null ? "" : (value / 100).toFixed(2);

export function CostToBeMe({
  view,
  run,
}: {
  view: View;
  run: (command: Command) => void;
}) {
  const income = view.expectedIncome;
  const cost = view.costToBeMe;
  const id = useId();
  const [draft, setDraft] = useState(cents(income));
  const [error, setError] = useState("");
  const [focused, setFocused] = useState(false);
  const [saved, setSaved] = useState(income);
  // Enter submits and the following blur would submit the same value again.
  const [submitted, setSubmitted] = useState<number | null>();
  // A slow save must not overwrite what is being typed.
  if (saved !== income && !focused) {
    setSaved(income);
    setDraft(cents(income));
    setSubmitted(undefined);
  }
  const save = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const data = new FormData();
    data.set("income", draft);
    let amount: number | null = null;
    try {
      amount = draft.trim() ? money(data, "income") : null;
      if (amount !== null && amount < 0)
        throw new Error("Expected income can’t be negative.");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Check the amount.",
      );
      return;
    }
    setError("");
    if (!event) setDraft(cents(amount));
    if (amount === income || amount === submitted) return;
    setSubmitted(amount);
    run({ type: "income.expect", id: newId(), month: view.month, amount });
  };
  const gap = income === null ? 0 : income - cost;
  return (
    <section className="inspector-section cost-to-be-me">
      <h3>Cost to be me</h3>
      <div className="inspector-hero">
        <span>{monthName(view.month).split(" ")[0]} targets</span>
        <Amount value={cost} />
      </div>
      <form className="cost-income" onSubmit={save}>
        <label htmlFor={id}>Expected income</label>
        <Input
          id={id}
          inputMode="decimal"
          placeholder="$0.00"
          autoComplete="off"
          value={draft}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            save();
          }}
        />
      </form>
      {error && (
        <p id={`${id}-error`} className="form-error" role="alert">
          {error}
        </p>
      )}
      {income !== null && cost > 0 && (
        <>
          <div
            className={cn("cost-meter", gap < 0 && "is-short")}
            role="meter"
            aria-label="Targets as a share of expected income"
            aria-valuemin={0}
            aria-valuemax={income}
            aria-valuenow={Math.min(cost, income)}
          >
            <span
              style={{
                width: `${income ? Math.min(100, (cost / income) * 100) : 100}%`,
              }}
            />
          </div>
          <p className={cn("cost-verdict", gap < 0 ? "caution" : "positive")}>
            {gap < 0 ? (
              <>
                Your targets need <Amount value={-gap} /> more than you expect
                to earn.
              </>
            ) : (
              <>
                Your income covers your targets with <Amount value={gap} /> to
                spare.
              </>
            )}
          </p>
        </>
      )}
      {cost === 0 && (
        <p className="inspector-note">
          Add targets to see what this month costs you.
        </p>
      )}
    </section>
  );
}
