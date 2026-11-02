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
import {
  DetailOption,
  DetailSeparator,
  SearchListDetail,
  type SearchListHighlight,
} from "~/components/ui/search-list";
import {
  halfOf,
  keepShare,
  type ShareBasis,
} from "~/components/transactions/transaction-share";
import type { CounterpartyShare } from "~/domain/engine";
import { money } from "./model";
import { isLinked, usePeople } from "./people";
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

// The popover that opens from a Share cell. Picking Half, All of it, or
// Just mine applies at once; An amount… opens a field first. onChange returns why
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
      size="wide"
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

// The longest name person.add takes.
const PERSON_NAME_MAX = 120;

// Who it's for on the left, searched by typing, with the partner first;
// how much for whoever is highlighted on the right. A typed name nobody has
// is a New row, and the person is added only once a share applies. Just
// mine, last on the right, clears a share there is.
export function ShareChoices({
  confirmation,
  amounts,
  share,
  saved,
  remembered,
  clearable = false,
  onChange,
}: {
  confirmation?: ReactNode;
  amounts: number[];
  share?: CounterpartyShare | null;
  saved?: CounterpartyShare | null;
  remembered?: string;
  // Some of several lines have a share that Just mine would clear.
  clearable?: boolean;
  onChange: (
    share: CounterpartyShare | null,
    basis: ShareBasis,
  ) => string | null;
}) {
  const { people, partner, addPerson } = useShareParties();
  const amount = Math.min(...amounts);
  const multiple = amounts.length > 1;
  const current = presetOf(share, amount);
  // Whoever the share is with. With no share yet, the partner, or the only
  // person there is; among several others, nobody is a safe guess.
  const [only] = people;
  const initial = share?.amount
    ? share.accountId
    : (partner?.id ?? (people.length === 1 && only ? only.id : undefined));
  // A refusal, for the person it was about.
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null,
  );
  // The person whose amount field is open, and whether it takes focus as it
  // shows: on a click, or at open, not when the highlight comes back to it.
  const [form, setForm] = useState<{ key: string; focus: boolean } | null>(
    current === "amount" && initial ? { key: initial, focus: true } : null,
  );

  const pick = (
    next: CounterpartyShare | null,
    basis: ShareBasis,
    key: string,
  ) => {
    const failure = onChange(
      multiple && basis !== "fixed"
        ? next
        : keepShare(saved, next, partner?.id),
      basis,
    );
    if (failure) setError({ key, message: failure });
  };
  // A share for the highlighted person, adding them first when they're new.
  const apply = (
    highlight: SearchListHighlight,
    cents: number,
    basis: ShareBasis,
  ) => {
    const key = keyOf(highlight);
    let accountId: string;
    if (highlight.kind === "create") {
      const added = addPerson(highlight.name);
      if (added.failure !== undefined)
        return setError({ key, message: added.failure });
      accountId = added.accountId;
    } else accountId = highlight.option.value;
    pick({ accountId, amount: cents }, basis, key);
  };

  const half = halfOf(amount);
  // A line with no amount yet has no half or whole to share; only an
  // amount typed here can be the share.
  const sized = multiple || amount > 0;
  const options = [
    {
      id: "half",
      label: "Half",
      detail: multiple ? "50% of each" : money(half),
      cents: half,
      basis: "half",
    },
    {
      id: "all",
      label: "All of it",
      detail: multiple ? "Full amount each" : money(amount),
      cents: amount,
      basis: "full",
    },
  ] as const;
  // Nothing to clear without a share.
  const mine = current !== "mine" || clearable;
  if (confirmation)
    return <PopoverSteps step="confirmation">{confirmation}</PopoverSteps>;
  return (
    // The keys typed here stay out of the register around the popover.
    <div
      className={styles.sharePicker}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <SearchListDetail
        label="Who is this for"
        placeholder={
          people.length === 0 ? "Their name or company" : "Find or add a person"
        }
        empty="Type a name to share with someone"
        maxLength={PERSON_NAME_MAX}
        createNoun="person"
        value={share?.amount ? share.accountId : ""}
        defaultHighlight={initial}
        options={people.map((item) => ({
          value: item.id,
          label: item.name,
          tag: isLinked(item) ? "On Caishen" : undefined,
          amount: item.balance,
        }))}
        detail={(highlight) => {
          const key = highlight ? keyOf(highlight) : "";
          const name =
            highlight?.kind === "option"
              ? highlight.option.label
              : highlight?.name;
          // The share as it stands shows as chosen while its person is.
          const chosen =
            highlight?.kind === "option" &&
            share?.amount &&
            share.accountId === highlight.option.value
              ? current
              : null;
          return {
            label: name ? `How much is for ${name}` : "How much",
            title:
              name ??
              (people.length === 0
                ? "Who is this for?"
                : "Choose who it’s for"),
            children: (
              <>
                {options.map((option) => (
                  <DetailOption
                    key={option.id}
                    title={option.label}
                    detail={option.detail}
                    pressed={option.id === chosen}
                    disabled={!highlight || !sized}
                    onClick={() =>
                      highlight && apply(highlight, option.cents, option.basis)
                    }
                  />
                ))}
                <DetailOption
                  title="An amount…"
                  pressed={chosen === "amount"}
                  disabled={!highlight}
                  onClick={() => setForm({ key, focus: true })}
                />
                {highlight && form?.key === key && name && (
                  <CustomShare
                    key={key}
                    label={`${name}’s share${multiple ? " per transaction" : ""}`}
                    amount={amount}
                    initial={chosen === "amount" ? share!.amount : half}
                    focus={form.focus}
                    onFocused={() => setForm({ key, focus: false })}
                    onApply={(cents) => apply(highlight, cents, "fixed")}
                  />
                )}
                {mine && (
                  <>
                    <DetailSeparator />
                    <DetailOption
                      title="Just mine"
                      detail="Nothing shared"
                      onClick={() => pick(null, "fixed", key)}
                    />
                  </>
                )}
                {remembered && chosen && (
                  <p className={styles.shareNote}>
                    Prefilled from {remembered} last time.
                  </p>
                )}
                {error?.key === key && (
                  <div className={styles.shareNote}>
                    <FormError>{error.message}</FormError>
                  </div>
                )}
              </>
            ),
          };
        }}
      />
    </div>
  );
}

// Which highlight a refusal or an open amount field belongs to.
const keyOf = (highlight: SearchListHighlight) =>
  highlight.kind === "create"
    ? `\u0000new:${highlight.name}`
    : highlight.option.value;

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
  focus,
  onFocused,
  onApply,
}: {
  label: string;
  amount: number;
  initial: number;
  // Takes focus as it shows, then says so.
  focus: boolean;
  onFocused: () => void;
  onApply: (value: number) => void;
}) {
  const [text, setText] = useState((initial / 100).toFixed(2));
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focus) return;
    input.current?.focus();
    onFocused();
  }, [focus, onFocused]);
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
