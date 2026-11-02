"use client";

import { useEffect, useRef, useState } from "react";
import { readAmount, sameAmount } from "~/components/budget/amount";
import { isLinked } from "~/components/app-shell/people";
import { money } from "~/components/app-shell/model";
import {
  halfOf,
  keepShare,
  useShareParties,
} from "~/components/app-shell/share-field";
import { AmountInput } from "~/components/ui/amount-input";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import type { ShareBasis } from "~/components/transactions/transaction-share";
import type { CounterpartyShare } from "~/domain/engine";
import { personKey } from "~/domain/people";
import shareStyles from "~/components/app-shell/share.module.css";

// What the prototype variants share with ShareChoices: who can be picked,
// what each choice comes to, and how a pick applies. Only the layout and the
// keys differ between them.

export type VariantProps = {
  amounts: number[];
  share: CounterpartyShare | null;
  saved: CounterpartyShare | null;
  onChange: (share: CounterpartyShare | null, basis: ShareBasis) => string | null;
  onClose: () => void;
};

export type Preset = "half" | "all" | "amount";
export type Option = {
  id: Preset;
  label: string;
  detail: string;
  disabled: boolean;
};

// Stands for a person named here and added once a share applies.
export const NEW_PERSON = "\u0000person:new";
// Stands for Just mine in a list of people.
export const MINE = "\u0000mine";
export const PERSON_NAME_MAX = 120;

export function useShareModel({ amounts, share, saved, onChange }: VariantProps) {
  const { people, partner, addPerson } = useShareParties();
  const amount = Math.min(...amounts);
  const multiple = amounts.length > 1;
  const half = halfOf(amount);
  const sized = multiple || amount > 0;
  const [error, setError] = useState("");
  const current: Preset | "mine" = !share?.amount
    ? "mine"
    : share.amount === half
      ? "half"
      : share.amount === amount
        ? "all"
        : "amount";
  const [only] = people;
  // Whoever a share would be with before anything is picked.
  const initialPerson = share?.amount
    ? share.accountId
    : (partner?.id ?? (people.length === 1 && only ? only.id : ""));

  const options: Option[] = [
    {
      id: "half",
      label: "Half",
      detail: multiple ? "50% of each" : money(half),
      disabled: !sized,
    },
    {
      id: "all",
      label: "All of it",
      detail: multiple ? "Full amount each" : money(amount),
      disabled: !sized,
    },
    { id: "amount", label: "An amount…", detail: "", disabled: false },
  ];
  // The preset that stands for a person: the share's, while it is theirs.
  const chosenFor = (personId: string) =>
    share?.amount && share.accountId === personId && current !== "mine"
      ? current
      : null;

  const pick = (next: CounterpartyShare | null, basis: ShareBasis = "fixed") => {
    const failure = onChange(
      multiple && basis !== "fixed" ? next : keepShare(saved, next, partner?.id),
      basis,
    );
    if (failure) setError(failure);
  };
  // A share for a listed person, or for a typed name added first.
  const apply = (
    personId: string,
    newName: string,
    cents: number,
    basis: ShareBasis,
  ) => {
    let accountId = personId;
    if (personId === NEW_PERSON) {
      if (!newName.trim()) return setError("Enter their name.");
      const added = addPerson(newName.trim().replace(/\s+/g, " "));
      if (added.failure !== undefined) return setError(added.failure);
      accountId = added.accountId;
    }
    if (!accountId) return setError("Choose who this is for.");
    pick({ accountId, amount: cents }, basis);
  };
  const applyPreset = (personId: string, newName: string, preset: Preset) => {
    if (preset === "half") apply(personId, newName, half, "half");
    if (preset === "all") apply(personId, newName, amount, "full");
  };
  // People whose name holds the typed text, and whether a New row is due.
  const filter = (query: string) => {
    const typed = query.trim().toLowerCase();
    const matches = typed
      ? people.filter((item) => item.name.toLowerCase().includes(typed))
      : people;
    const exact = people.some(
      (item) => !isLinked(item) && personKey(item.name) === personKey(query.trim()),
    );
    return { matches, offerNew: typed.length > 0 && !exact };
  };
  return {
    people,
    partner,
    amount,
    multiple,
    half,
    current,
    initialPerson,
    options,
    chosenFor,
    pick,
    apply,
    applyPreset,
    filter,
    error,
    setError,
  };
}

// A share typed in a field, in cents, or why it can't be one.
function readShare(text: string, most: number) {
  const reading = readAmount(text);
  if (!reading.ok) return reading;
  if (reading.cents < 0)
    return { ok: false as const, message: "Enter an amount, like 24.50." };
  if (most > 0 && reading.cents > most)
    return {
      ok: false as const,
      message: `A share can be at most ${money(most)}.`,
    };
  return reading;
}

// ShareChoices' amount field, unchanged: Enter or Apply sends it.
export function AmountForm({
  label,
  amount,
  initial,
  onApply,
}: {
  label: string;
  amount: number;
  initial: number;
  onApply: (value: number) => void;
}) {
  const [text, setText] = useState((initial / 100).toFixed(2));
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const share = readShare(text, amount);
        if (!share.ok) return setError(share.message);
        onApply(share.cents);
      }}
    >
      <Field label={label} error={error || undefined}>
        <div className={shareStyles.shareFormRow}>
          <AmountInput
            inputRef={input}
            value={text}
            onChange={(value) => {
              if (!sameAmount(text, value)) setError("");
              setText(value);
            }}
          />
          <Button size="sm" variant="primary" type="submit">
            Apply
          </Button>
        </div>
      </Field>
    </form>
  );
}

// "Aleksandra’s share", for a field's label.
export const possessive = (name: string) => `${name}’s share`;
