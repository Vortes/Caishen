"use client";

import { useState, type ComponentProps } from "react";
import type { DraftShare } from "~/components/transactions/transaction-draft";
import { Button } from "~/components/ui/button";
import { Popover } from "~/components/ui/popover";
import { parseCents, useShareParties } from "./share-field";
import { ChoiceField, type ChoiceOption } from "./transaction-fields";
import moveStyles from "./move-money.module.css";
import styles from "./share.module.css";

const NEW_PERSON = "\u0000person:new";

export function TransactionCategoryField({
  amount,
  share,
  peopleEnabled,
  onChange,
  ...field
}: Omit<ComponentProps<typeof ChoiceField>, "onChange"> & {
  amount: number;
  share?: DraftShare | null;
  peopleEnabled: boolean;
  onChange: (categoryId: string, share?: DraftShare | null) => void;
}) {
  const { partner, reimbursements, people, who } = useShareParties();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const full = share && parseCents(share.amount) === Math.abs(amount);
  const parties = [
    ...(partner ? [{ accountId: partner.id, name: partner.name }] : []),
    ...(reimbursements
      ? [
          ...new Set([
            ...people,
            ...(share?.counterpartyName ? [share.counterpartyName] : []),
          ]),
        ].map((name) => ({ accountId: reimbursements.id, name }))
      : []),
  ].map((party) => ({
    ...party,
    value: `\u0000person:${JSON.stringify([party.accountId, party.name])}`,
  }));
  const selected = full
    ? parties.find(
        (party) =>
          party.accountId === share.accountId &&
          party.name ===
            who({ ...share, amount: parseCents(share.amount) ?? 0 }),
      )
    : undefined;
  const options: ChoiceOption[] = [
    ...field.options,
    ...(peopleEnabled
      ? parties.map((party) => ({
          value: party.value,
          label: party.name,
          group: "People",
        }))
      : []),
    ...(peopleEnabled && reimbursements
      ? [{ value: NEW_PERSON, label: "Someone else…", group: "People" }]
      : []),
  ];
  const pickPerson = (accountId: string, name: string) =>
    onChange("", {
      accountId,
      ...(accountId === reimbursements?.id ? { counterpartyName: name } : {}),
      amount: (Math.abs(amount) / 100).toFixed(2),
    });
  return (
    <Popover
      label="Who owes this purchase"
      size="form"
      open={adding}
      onOpenChange={setAdding}
      autoFocus
      anchor={
        <div>
          <ChoiceField
            {...field}
            value={selected?.value ?? field.value}
            displayValue={selected?.name ?? field.displayValue}
            options={options}
            onChange={(value) => {
              if (value === NEW_PERSON) {
                setName("");
                setError("");
                setAdding(true);
                return;
              }
              const party = parties.find((party) => party.value === value);
              if (party) pickPerson(party.accountId, party.name);
              else onChange(value, full ? null : undefined);
            }}
            onPicked={(value) => {
              if (value !== NEW_PERSON) field.onPicked?.(value);
            }}
          />
        </div>
      }
    >
      {/* Keys typed here stay out of the editor around the field. */}
      <form
        className={styles.shareForm}
        noValidate
        onKeyDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!name.trim()) return setError("Name who owes it.");
          pickPerson(reimbursements!.id, name.trim());
          setAdding(false);
        }}
      >
        <label htmlFor={`${field.id}-person`}>Who owes it</label>
        <div className={moveStyles.amountInput}>
          <input
            id={`${field.id}-person`}
            autoFocus
            maxLength={240}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
            aria-invalid={Boolean(error)}
          />
        </div>
        <p className={styles.popoverHint}>
          The full amount goes to Reimbursements.
        </p>
        {error && <p className={moveStyles.error}>{error}</p>}
        <div className={styles.shareFormRow}>
          <Button size="sm" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Apply
          </Button>
        </div>
      </form>
    </Popover>
  );
}
