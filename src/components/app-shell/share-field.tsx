"use client";

import { UsersIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { readAmount, sameAmount } from "~/components/budget/amount";
import { AmountInput } from "~/components/ui/amount-input";
import { Field, FormError } from "~/components/ui/field";
import { PopoverSteps } from "./popover-steps";
import { Button } from "~/components/ui/button";
import { Popover } from "~/components/ui/popover";
import { SearchList } from "~/components/ui/search-list";
import {
  halfOf,
  keepShare,
  type ShareBasis,
} from "~/components/transactions/transaction-share";
import type { CounterpartyShare } from "~/domain/engine";
import { personKey } from "~/domain/people";
import { money } from "./model";
import { isLinked, usePeople } from "./people";
import moveStyles from "./move-money.module.css";
import styles from "./share.module.css";

// Who a line's cost is for: nobody else, or one person, for half of it,
// all of it, or an amount. Every person is picked the same way; the one
// also on Caishen is listed first.

type Preset = "mine" | "half" | "all" | "amount";

// Half is a fixed 50/50; the person's half rounds down to the cent.
export { halfOf } from "~/components/transactions/transaction-share";

// Who a share can be with, and the name each share goes by.
export function useShareParties() {
  const { view, people, partner, nameOf, addPerson } = usePeople();
  const who = (share: CounterpartyShare) => nameOf(share.accountId);
  return { view, people, partner, who, addPerson };
}

function presetOf(
  share: CounterpartyShare | null | undefined,
  amount: number,
): Preset {
  if (!share?.amount) return "mine";
  if (share.amount === halfOf(amount)) return "half";
  if (share.amount === amount) return "all";
  return "amount";
}

export { keepShare } from "~/components/transactions/transaction-share";

export function ShareLabel({
  share,
  name,
}: {
  share?: CounterpartyShare | null;
  // Who it's with, when that isn't the share's own person: several
  // people's shares on one split.
  name?: string;
}) {
  const { who } = useShareParties();
  if (!share?.amount) return null;
  return (
    <>
      <UsersIcon size={12} aria-hidden className={styles.shareIcon} />
      <span className={styles.shareWho}>{name ?? who(share)}</span>
      <span className={styles.shareAmount}>{money(share.amount)}</span>
    </>
  );
}

// The popover that opens from a Share cell. Picking Half, All, or Just
// mine applies at once; Amount opens a field first. onChange returns why
// the share can't apply, which keeps the popover open.
export function ShareMenu({
  amount,
  share,
  saved,
  remembered,
  onChange,
  children,
}: {
  // The line's amount, unsigned, in cents.
  amount: number;
  share?: CounterpartyShare | null;
  // The share as last saved, which "Just mine" writes off.
  saved?: CounterpartyShare | null;
  // The payee whose last categorization prefilled this share.
  remembered?: string;
  onChange: (share: CounterpartyShare | null) => string | null;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      label="Who this is for"
      trigger={children}
      open={open}
      onOpenChange={setOpen}
      size="form"
      arrow
    >
      <ShareChoices
        key={String(open)}
        amounts={[amount]}
        share={share}
        saved={saved}
        remembered={remembered}
        onChange={(next) => {
          const failure = onChange(next);
          if (!failure) setOpen(false);
          return failure;
        }}
      />
    </Popover>
  );
}

// Stands for a person named here and added once a share is applied, so
// closing the popover leaves nobody behind.
const NEW_PERSON = "\u0000person:new";

export function ShareChoices({
  confirmation,
  amounts,
  share,
  saved,
  remembered,
  onChange,
}: {
  confirmation?: ReactNode;
  amounts: number[];
  share?: CounterpartyShare | null;
  saved?: CounterpartyShare | null;
  remembered?: string;
  onChange: (
    share: CounterpartyShare | null,
    basis: ShareBasis,
  ) => string | null;
}) {
  const { people, partner, addPerson } = useShareParties();
  const amount = Math.min(...amounts);
  const multiple = amounts.length > 1;
  const current = presetOf(share, amount);
  const [error, setError] = useState("");
  // Whoever the share is with. With no share yet, the partner, or the only
  // person there is; among several others, nobody is a safe guess.
  const [personId, setPersonId] = useState(
    share?.amount
      ? share.accountId
      : (partner?.id ?? (people.length === 1 ? people[0]!.id : "")),
  );
  // A new person's name, typed in the list and added once a share applies.
  const [pending, setPending] = useState<string | null>(null);
  // New person was picked before a name was typed.
  const [naming, setNaming] = useState(false);
  const [form, setForm] = useState(current === "amount");
  const personInput = useRef<HTMLInputElement>(null);
  const firstOption = useRef<HTMLButtonElement>(null);
  const person =
    personId === NEW_PERSON
      ? { id: NEW_PERSON, name: pending ?? "" }
      : people.find((item) => item.id === personId);
  // The share already set shows as chosen while its person is.
  const chosen = share?.amount && share.accountId === personId ? current : null;
  useEffect(() => {
    if (current === "mine") personInput.current?.focus();
  }, [current]);

  const pick = (
    next: CounterpartyShare | null,
    basis: ShareBasis = "fixed",
  ) => {
    const failure = onChange(
      multiple && basis !== "fixed"
        ? next
        : keepShare(saved, next, partner?.id),
      basis,
    );
    if (failure) setError(failure);
  };
  // A share for whoever is chosen, adding them first when they're new.
  const apply = (cents: number, basis: ShareBasis) => {
    if (!person) return setError("Choose who this is for.");
    let accountId = person.id;
    if (accountId === NEW_PERSON) {
      const added = addPerson(person.name);
      if (added.failure !== undefined) return setError(added.failure);
      accountId = added.accountId;
    }
    pick({ accountId, amount: cents }, basis);
  };
  // The New row: a typed name becomes the chosen person at once; with
  // nothing typed, the well clears and asks for the name.
  const name = (typed: string) => {
    const trimmed = typed.trim().replace(/\s+/g, " ");
    setError("");
    if (!trimmed) {
      setNaming(true);
      setPersonId("");
      setPending(null);
      requestAnimationFrame(() => personInput.current?.focus());
      return;
    }
    const known = people.find(
      (item) => !isLinked(item) && personKey(item.name) === personKey(trimmed),
    );
    setNaming(false);
    if (known) {
      setPersonId(known.id);
      setPending(null);
    } else {
      setPending(trimmed);
      setPersonId(NEW_PERSON);
    }
    requestAnimationFrame(() => firstOption.current?.focus());
  };

  const half = halfOf(amount);
  const options: {
    id: Exclude<Preset, "mine">;
    label: string;
    detail: string;
    apply?: () => void;
  }[] = [
    {
      id: "half",
      label: "Half",
      detail: multiple ? "50% of each" : money(half),
      apply: () => apply(half, "half"),
    },
    {
      id: "all",
      label: "All of it",
      detail: multiple ? "Full amount each" : money(amount),
      apply: () => apply(amount, "full"),
    },
    { id: "amount", label: "An amount…", detail: "" },
  ];
  const optionButton = (
    id: Preset,
    label: string,
    detail: string,
    onClick: () => void,
    first = false,
  ) => (
    <button
      key={id}
      ref={first ? firstOption : undefined}
      type="button"
      data-share-option
      autoFocus={id === current && current !== "mine"}
      disabled={id !== "mine" && !person}
      className={styles.shareOption}
      aria-pressed={id === "mine" ? current === "mine" : id === chosen}
      onClick={onClick}
    >
      <span className={styles.optionLabel}>{label}</span>
      {detail && <span className={styles.optionDetail}>{detail}</span>}
    </button>
  );
  const hint =
    naming || personId === NEW_PERSON
      ? "Only you see new people. They get an envelope in People."
      : remembered
        ? `Prefilled from ${remembered} last time.`
        : undefined;
  return (
    <PopoverSteps step={confirmation ? "confirmation" : "choices"}>
      {confirmation ?? (
        <div
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.target instanceof HTMLInputElement) return;
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                "[data-share-option]:not(:disabled)",
              ),
            ];
            const index = items.indexOf(document.activeElement as HTMLElement);
            items[
              (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length
            ]?.focus();
            event.preventDefault();
          }}
        >
          <div className={moveStyles.header}>
            <strong>Who is this for?</strong>
          </div>
          <div className={styles.whoField}>
            <Field label="Who is this for" labelHidden hint={hint}>
              <SearchList
                inputRef={personInput}
                value={personId}
                options={[
                  ...(pending !== null
                    ? [{ value: NEW_PERSON, label: pending, group: "New" }]
                    : []),
                  ...people.map((item) => ({
                    value: item.id,
                    label: item.name,
                    group: isLinked(item) ? "On Caishen" : "People",
                    amount: item.balance,
                  })),
                ]}
                placeholder={
                  naming ? "Their name or company" : "Choose or add a person"
                }
                onChange={(value) => {
                  setPersonId(value);
                  setNaming(false);
                  setError("");
                }}
                onPicked={() =>
                  requestAnimationFrame(() => firstOption.current?.focus())
                }
                onCreate={{ noun: "person", create: name }}
              />
            </Field>
          </div>
          <div
            className={styles.shareOptions}
            role="group"
            aria-label={person ? `How much is for ${person.name}` : "How much"}
          >
            {options.map((option, index) =>
              optionButton(
                option.id,
                option.label,
                option.detail,
                () => (option.apply ? option.apply() : setForm(true)),
                index === 0,
              ),
            )}
          </div>
          {form && person && (
            <CustomShare
              key="custom"
              label={`${person.name}’s share${multiple ? " per transaction" : ""}`}
              amount={amount}
              initial={chosen === "amount" ? share!.amount : half}
              onApply={(value) => apply(value, "fixed")}
            />
          )}
          <div className={styles.shareOptions} data-after>
            {optionButton("mine", "Just mine", "Nothing shared", () =>
              pick(null),
            )}
          </div>
          {error && (
            <div className={styles.popoverError}>
              <FormError>{error}</FormError>
            </div>
          )}
        </div>
      )}
    </PopoverSteps>
  );
}

// A share typed in a field, in cents, or why it can't be one. A line with
// no amount yet takes the share as its amount, so nothing caps it.
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

function CustomShare({
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
      className={styles.customShare}
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
        <div className={styles.shareFormRow}>
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
