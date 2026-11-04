"use client";

import { useState, type ComponentProps } from "react";
import { readAmount } from "~/components/budget/amount";
import type { DraftShare } from "~/components/transactions/transaction-draft";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Popover } from "~/components/ui/popover";
import { type SearchListOption } from "~/components/ui/search-list";
import { TextInput } from "~/components/ui/text-input";
import { personKey } from "~/domain/people";
import { CategoryField } from "./category-field";
import { isLinked } from "./people";
import { useShareParties } from "./share-field";
import styles from "./share.module.css";

const PERSON = "\u0000person:";
const NEW_PERSON = "\u0000person:new";

// The name box takes focus as the form opens.
const focusName = (input: HTMLInputElement | null) => input?.focus();

// A draft share's amount in cents, or null while it doesn't read.
function shareCents(text: string) {
  const reading = readAmount(text);
  return reading.ok ? reading.cents : null;
}

// The category field a transaction's editor extends: People, which share
// the whole line with someone instead of giving it a category.
export function TransactionCategoryField({
  amount,
  share,
  peopleEnabled,
  onChange,
  ...field
}: Omit<ComponentProps<typeof CategoryField>, "onChange"> & {
  amount: number;
  share?: DraftShare | null;
  peopleEnabled: boolean;
  onChange: (categoryId: string, share?: DraftShare | null) => void;
}) {
  const { people, addPerson } = useShareParties();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  // A person in the category list owes the whole line.
  const full = share && shareCents(share.amount) === Math.abs(amount);
  const value = (accountId: string) => `${PERSON}${accountId}`;
  const selected = full
    ? people.find((person) => person.id === share.accountId)
    : undefined;
  const options: SearchListOption[] = [
    ...field.options,
    ...(peopleEnabled
      ? people.map((person) => ({
          value: value(person.id),
          label: person.name,
          group: "People",
        }))
      : []),
    ...(peopleEnabled
      ? [{ value: NEW_PERSON, label: "New person…", group: "People" }]
      : []),
  ];
  const pickPerson = (accountId: string) =>
    onChange("", {
      accountId,
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
          <CategoryField
            {...field}
            value={selected ? value(selected.id) : field.value}
            displayValue={selected?.name ?? field.displayValue}
            options={options}
            onChange={(next) => {
              if (next === NEW_PERSON) {
                setName("");
                setError("");
                setAdding(true);
                return;
              }
              const person = people.find((item) => value(item.id) === next);
              if (person) pickPerson(person.id);
              else onChange(next, full ? null : undefined);
            }}
            onPicked={(next) => {
              if (next !== NEW_PERSON) field.onPicked?.(next);
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
          const trimmed = name.trim().replace(/\s+/g, " ");
          if (!trimmed) return setError("Enter their name.");
          const known = people.find(
            (person) =>
              !isLinked(person) &&
              personKey(person.name) === personKey(trimmed),
          );
          const added = known ? { accountId: known.id } : addPerson(trimmed);
          if (added.failure !== undefined) return setError(added.failure);
          pickPerson(added.accountId);
          setAdding(false);
        }}
      >
        <Field
          label="New person"
          hint="They owe you the full amount. Only you see them."
          error={error || undefined}
        >
          <TextInput
            inputRef={focusName}
            maxLength={120}
            value={name}
            placeholder="Name or company"
            onChange={(next) => {
              setName(next);
              setError("");
            }}
          />
        </Field>
        <div className={styles.shareFormRow}>
          <Button size="sm" onClick={() => setAdding(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Add
          </Button>
        </div>
      </form>
    </Popover>
  );
}
