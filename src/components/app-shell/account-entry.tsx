"use client";

import { CircleAlertIcon, PlusIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import { newId, parseMoney, today } from "~/components/budget/format";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { usePortalContainer } from "~/components/ui/tooltip";
import type { Command } from "~/domain/engine";
import { useTransactionEntry } from "./transaction-entry";
import styles from "./account-entry.module.css";

// The kinds a person adds; counterparty accounts are the system's.
type NewAccountKind = Extract<Command, { type: "account.add" }>["kind"];

export function AccountEntry() {
  const entry = useTransactionEntry();
  const container = usePortalContainer();
  const id = useId();
  const [open, setOpen] = useState(false);
  const { holdOpen } = entry;
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<NewAccountKind>("cash");
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(today(entry.view.budget.settings.timezone));
  const [error, setError] = useState("");
  const attempt = useRef<Extract<Command, { type: "account.add" }> | null>(
    null,
  );
  const save = () => {
    try {
      const amount = parseMoney(balance);
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
        openingBalance: kind === "credit" ? -Math.abs(amount) : amount,
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
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next && entry.holdForDraft()) return;
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <IconButton label="Add account">
          <PlusIcon aria-hidden />
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={styles.popover}
          side="top"
          align="start"
          collisionPadding={12}
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
                onChange={(event) =>
                  setKind(event.target.value as NewAccountKind)
                }
              >
                <option value="cash">Cash / checking / savings</option>
                <option value="credit">Credit card</option>
                <option value="tracking">Tracking / brokerage</option>
              </select>
              <p id={`${id}-kind-help`}>
                {kind === "tracking"
                  ? "Track an investment or other account outside your budget. Its balance is not available to assign."
                  : kind === "credit"
                    ? "Enter the amount owed as a positive number."
                    : "The opening balance becomes available to assign."}
              </p>
            </div>
            <div className={styles.field}>
              <label htmlFor={`${id}-balance`}>Opening balance ($)</label>
              <input
                id={`${id}-balance`}
                value={balance}
                inputMode="decimal"
                placeholder="0.00"
                required
                onChange={(event) => setBalance(event.target.value)}
              />
            </div>
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
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
