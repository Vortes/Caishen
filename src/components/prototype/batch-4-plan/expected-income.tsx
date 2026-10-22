"use client";

import { PencilIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { parseMoney } from "~/components/budget/format";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { money } from "../app-shell/model";
import { FieldError } from "../app-shell/move-money";
import shellStyles from "../app-shell/shell.module.css";
import styles from "./batch-4.module.css";

// inline: the amount is always a field. edit: the amount reads as text and
// opens into a field with Save, like YNAB's web pencil.
export type IncomeEditing = "inline" | "edit";
// blank: a month without income starts empty. last: it offers the most
// recent earlier month's amount, since YNAB carries income forward and
// Caishen stores it per month.
export type IncomeOffer = "blank" | "last";

const asField = (amount: number | null) =>
  amount === null ? "" : (amount / 100).toFixed(2);

// Returns the amount in cents, null to clear it, or a message.
function read(draft: string): number | null | { error: string } {
  if (!draft.trim()) return null;
  try {
    const cents = parseMoney(draft);
    if (cents < 0) return { error: "Expected income can't be negative." };
    return cents;
  } catch {
    return { error: "Enter a dollar amount, like 6,200 or 6200.50." };
  }
}

export function ExpectedIncome({
  monthKey,
  monthShort,
  cost,
  amount,
  editing,
  offer,
  last,
  onSave,
}: {
  monthKey: string;
  monthShort: string;
  cost: number;
  amount: number | null;
  editing: IncomeEditing;
  offer: IncomeOffer;
  last: { label: string; amount: number } | null;
  onSave: (amount: number | null) => void;
}) {
  const suggestion = offer === "last" && amount === null && last ? last : null;
  return (
    <>
      {editing === "inline" ? (
        <InlineField
          key={`${monthKey}-${amount}`}
          amount={amount}
          suggestion={suggestion}
          onSave={onSave}
        />
      ) : (
        <ClickToEdit
          key={monthKey}
          monthShort={monthShort}
          amount={amount}
          suggestion={suggestion}
          onSave={onSave}
        />
      )}
      {amount !== null && <Comparison cost={cost} income={amount} />}
    </>
  );
}

function Comparison({ cost, income }: { cost: number; income: number }) {
  const short = income < cost;
  return (
    <div
      className={shellStyles.meter}
      data-state={short ? "underfunded" : "funded"}
    >
      <span className={shellStyles.meterTrack}>
        <span
          style={{
            transform: `scaleX(${cost ? Math.min(1, income / cost) : 1})`,
          }}
        />
      </span>
      <span>
        {short
          ? `Your targets need ${money(cost - income)} more than you expect to earn`
          : `${money(income - cost)} left after your targets`}
      </span>
    </div>
  );
}

function Suggestion({
  suggestion,
  onUse,
}: {
  suggestion: { label: string; amount: number };
  onUse: () => void;
}) {
  return (
    <div className={styles.suggestion}>
      <Button variant="quiet" size="sm" onClick={onUse}>
        Use {suggestion.label}&rsquo;s {money(suggestion.amount)}
      </Button>
    </div>
  );
}

// Variant A: always a field. Enter or leaving it saves; Escape puts back
// what was saved.
function InlineField({
  amount,
  suggestion,
  onSave,
}: {
  amount: number | null;
  suggestion: { label: string; amount: number } | null;
  onSave: (amount: number | null) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(asField(amount));
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    const value = read(draft);
    if (value !== null && typeof value === "object") {
      setError(value.error);
      return;
    }
    setError(null);
    setDraft(asField(value));
    if (value !== amount) onSave(value);
  };
  return (
    <div className={styles.incomeBlock}>
      <div className={`${shellStyles.property} ${styles.incomeRow}`}>
        <label className={shellStyles.propertyLabel} htmlFor={id}>
          Expected income
        </label>
        <span
          className={styles.amountWell}
          data-invalid={error ? true : undefined}
        >
          <span aria-hidden>$</span>
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={draft.replace(/^\$/, "")}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape" && draft !== asField(amount)) {
                event.stopPropagation();
                setDraft(asField(amount));
                setError(null);
              }
            }}
          />
        </span>
      </div>
      {error && <FieldError id={`${id}-error`} message={error} />}
      {amount === null && !error && (
        <p className={styles.note}>
          Add what you expect to earn this month to see whether it covers your
          targets.
        </p>
      )}
      {suggestion && (
        <Suggestion
          suggestion={suggestion}
          onUse={() => onSave(suggestion.amount)}
        />
      )}
    </div>
  );
}

// Variant B: reads as text with a pencil; opens into a field with Save and
// Cancel. With no income yet, the empty state's button opens it.
function ClickToEdit({
  monthShort,
  amount,
  suggestion,
  onSave,
}: {
  monthShort: string;
  amount: number | null;
  suggestion: { label: string; amount: number } | null;
  onSave: (amount: number | null) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) input.current?.select();
    else if (wasOpen.current) opener.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const start = () => {
    setDraft(asField(amount));
    setError(null);
    setOpen(true);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    const value = read(draft);
    if (value !== null && typeof value === "object") {
      setError(value.error);
      input.current?.focus();
      return;
    }
    if (value !== amount) onSave(value);
    setOpen(false);
  };

  if (open)
    return (
      <form className={styles.incomeBlock} onSubmit={save}>
        <div className={`${shellStyles.property} ${styles.incomeRow}`}>
          <label className={shellStyles.propertyLabel} htmlFor={id}>
            Expected income
          </label>
          <span
            className={styles.amountWell}
            data-invalid={error ? true : undefined}
          >
            <span aria-hidden>$</span>
            <input
              ref={input}
              id={id}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={draft}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : `${id}-hint`}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                setOpen(false);
              }}
            />
          </span>
        </div>
        {error ? (
          <FieldError id={`${id}-error`} message={error} />
        ) : (
          <p className={styles.note} id={`${id}-hint`}>
            Everything you expect to earn in {monthShort}. Leave it empty to
            remove it.
          </p>
        )}
        <div className={styles.formActions}>
          <Button size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Save
          </Button>
        </div>
      </form>
    );

  if (amount === null)
    return (
      <div className={shellStyles.tabEmpty}>
        <p>
          Add what you expect to earn in {monthShort} to see whether it covers
          your targets.
        </p>
        <div className={styles.inlineActions}>
          <Button ref={opener} variant="quiet" onClick={start}>
            Add expected income
          </Button>
          {suggestion && (
            <Button variant="quiet" onClick={() => onSave(suggestion.amount)}>
              Use {suggestion.label}&rsquo;s {money(suggestion.amount)}
            </Button>
          )}
        </div>
      </div>
    );

  return (
    <div className={`${shellStyles.property} ${styles.incomeRow}`}>
      <span className={shellStyles.propertyLabel}>Expected income</span>
      <span className={styles.editableValue}>
        <span>{money(amount)}</span>
        <IconButton
          ref={opener}
          size="sm"
          label="Edit expected income"
          onClick={start}
        >
          <PencilIcon aria-hidden />
        </IconButton>
      </span>
    </div>
  );
}
