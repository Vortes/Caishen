"use client";

import { CircleAlertIcon, PlusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { readAmount } from "~/components/budget/amount";
import { newId, today } from "~/components/budget/format";
import { AmountInput } from "~/components/ui/amount-input";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { IconButton } from "~/components/ui/icon-button";
import { Popover } from "~/components/ui/popover";
import type { Command } from "~/domain/engine";
import { useTransactionEntry } from "./transaction-entry";
import styles from "./account-entry.module.css";

// The kinds a person adds; counterparty accounts are the system's.
type NewAccountKind = Extract<Command, { type: "account.add" }>["kind"];

export function AccountEntry() {
  const entry = useTransactionEntry();
  const id = useId();
  const [open, setOpen] = useState(false);
  const { holdOpen } = entry;
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<NewAccountKind>("cash");
  const [balance, setBalance] = useState("");
  const [balanceError, setBalanceError] = useState<string>();
  const [date, setDate] = useState(today(entry.view.budget.settings.timezone));
  const [error, setError] = useState("");
  const attempt = useRef<Extract<Command, { type: "account.add" }> | null>(
    null,
  );
  const save = () => {
    const reading = readAmount(balance);
    if (!reading.ok) {
      setBalanceError(reading.message);
      setError("");
      return;
    }
    try {
      const amount = reading.cents;
      if (!name.trim()) throw new Error("Enter an account name.");
      if (
        !date ||
        date < `${entry.view.budget.startMonth}-01` ||
        date > today(entry.view.budget.settings.timezone)
      )
        throw new Error("Choose a date between your budget start and today.");
      const facts = {
        name: name.trim(),
        kind,
        openingBalance: kind === "credit" ? -amount : amount,
        date,
      };
      const previous = attempt.current;
      if (
        !previous ||
        Object.entries(facts).some(
          ([key, value]) => previous[key as keyof typeof facts] !== value,
        )
      )
        attempt.current = {
          type: "account.add",
          id: newId(),
          accountId: newId(),
          ...facts,
        };
      const blocked = entry.addAccount(attempt.current!);
      if (blocked) throw new Error(blocked);
      setError("");
      setOpen(false);
      setName("");
      setBalance("");
      attempt.current = null;
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The account could not be saved.",
      );
    }
  };
  return (
    <Popover
      label="Add account"
      trigger={
        <IconButton label="Add account">
          <PlusIcon aria-hidden />
        </IconButton>
      }
      open={open}
      onOpenChange={(next) => {
        if (next && entry.holdForDraft()) return;
        setOpen(next);
      }}
      side="top"
      size="form"
      motion="occasional"
    >
      <form
        className={styles.form}
        aria-labelledby={`${id}-title`}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <h2 id={`${id}-title`}>Add account</h2>
        <div className={styles.field}>
          <label htmlFor={`${id}-name`}>Account name</label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={120}
            required
            placeholder={
              kind === "tracking"
                ? "Fidelity"
                : kind === "credit"
                  ? "Visa"
                  : "Checking"
            }
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-kind`}>Account type</label>
          <select
            id={`${id}-kind`}
            value={kind}
            aria-describedby={`${id}-kind-help`}
            onChange={(event) => setKind(event.target.value as NewAccountKind)}
          >
            <option value="cash">Cash / checking / savings</option>
            <option value="credit">Credit card</option>
            <option value="tracking">Tracking / brokerage</option>
          </select>
          <p id={`${id}-kind-help`}>
            {kind === "tracking"
              ? "Track an investment or other account outside your budget. Its balance is not available to assign."
              : kind === "credit"
                ? "Enter the amount owed as a positive number, or an overpaid credit as a negative number."
                : "The opening balance becomes available to assign."}
          </p>
        </div>
        <Field label="Opening balance" error={balanceError}>
          <AmountInput
            value={balance}
            placeholder="0.00"
            onChange={(next) => {
              setBalance(next);
              setBalanceError(undefined);
            }}
          />
        </Field>
        <div className={styles.field}>
          <label htmlFor={`${id}-date`}>Balance as of</label>
          <input
            id={`${id}-date`}
            type="date"
            value={date}
            min={`${entry.view.budget.startMonth}-01`}
            max={today(entry.view.budget.settings.timezone)}
            required
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
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
          <Button size="sm" variant="primary" type="submit">
            Add account
          </Button>
        </div>
      </form>
    </Popover>
  );
}
