"use client";

import { CheckIcon, UsersIcon } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { readAmount } from "~/components/budget/amount";
import { AmountInput } from "~/components/ui/amount-input";
import { Checkbox } from "~/components/ui/checkbox";
import { Field } from "~/components/ui/field";
import { PopoverSteps } from "./popover-steps";
import { Button } from "~/components/ui/button";
import { Popover } from "~/components/ui/popover";
import {
  halfOf,
  keepShare,
  type ShareBasis,
} from "~/components/transactions/transaction-share";
import type { CounterpartyShare } from "~/domain/engine";
import { reimbursementPeople } from "~/domain/counterparty";
import { money } from "./model";
import { sameAmount } from "./move-money";
import { useShellData } from "./shell-data";
import { useTransactionEntry } from "./transaction-entry";
import moveStyles from "./move-money.module.css";
import styles from "./share.module.css";

// Who a line's cost is for: nothing shared, half or all of it the
// partner's, a custom partner amount, or someone else's, tracked in the
// Reimbursements account. Presets cover the common cases in one pick.

type Preset = "mine" | "split" | "theirs" | "custom" | "other";

// Half is a fixed 50/50; the partner's half rounds down to the cent.
export { halfOf } from "~/components/transactions/transaction-share";

// Who a share can be with: the partner, by the name the shell shows, and
// the people already in the Reimbursements account, most recent first.
export function useShareParties() {
  const { accounts } = useShellData();
  const { view } = useTransactionEntry();
  const partner = accounts.find((item) => item.kind === "partner");
  const reimbursements = accounts.find(
    (item) => item.kind === "reimbursements",
  );
  const people = reimbursementPeople(view.budget);
  const who = (share: CounterpartyShare) =>
    share.counterpartyName ??
    accounts.find((item) => item.id === share.accountId)?.name ??
    "Someone";
  return { view, partner, reimbursements, people, who };
}

function presetOf(
  share: CounterpartyShare | null | undefined,
  amount: number,
  partnerId: string | undefined,
): Preset {
  if (!share?.amount) return "mine";
  if (share.accountId !== partnerId) return "other";
  if (share.amount === halfOf(amount)) return "split";
  if (share.amount === amount) return "theirs";
  return "custom";
}

export { keepShare } from "~/components/transactions/transaction-share";

export function ShareLabel({ share }: { share?: CounterpartyShare | null }) {
  const { who } = useShareParties();
  if (!share?.amount) return null;
  return (
    <>
      <UsersIcon size={12} aria-hidden className={styles.shareIcon} />
      <span className={styles.shareWho}>{who(share)}</span>
      <span className={styles.shareAmount}>{money(share.amount)}</span>
    </>
  );
}

// The menu that opens from a Share cell. Picking a preset applies it at
// once; a custom amount and someone else open a field first. onChange
// returns why the share can't apply, which keeps the menu open.
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
  const { partner, reimbursements, people } = useShareParties();
  const amount = Math.min(...amounts);
  const multiple = amounts.length > 1;
  const [error, setError] = useState("");
  const current = presetOf(share, amount, partner?.id);
  const [form, setForm] = useState<"custom" | "other" | null>(
    current === "custom" || current === "other" ? current : null,
  );
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
  const half = halfOf(amount);
  const options: {
    id: Preset;
    label: string;
    detail: string;
    apply?: () => void;
  }[] = [
    {
      id: "mine",
      label: "Just mine",
      detail: "Nothing shared",
      apply: () => pick(null),
    },
    ...(partner
      ? [
          {
            id: "split" as const,
            label: `Split with ${partner.name}`,
            detail: multiple ? "50% of each" : money(half),
            apply: () => pick({ accountId: partner.id, amount: half }, "half"),
          },
          {
            id: "theirs" as const,
            label: `All ${partner.name}'s`,
            detail: multiple ? "Full amount each" : money(amount),
            apply: () => pick({ accountId: partner.id, amount }, "full"),
          },
          {
            id: "custom" as const,
            label: `${partner.name}'s share is…`,
            detail: "",
          },
        ]
      : []),
    ...(reimbursements
      ? [{ id: "other" as const, label: "Someone else owes…", detail: "" }]
      : []),
  ];
  return (
    <PopoverSteps step={confirmation ? "confirmation" : (form ?? "presets")}>
      {confirmation ?? (
        <div
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.target instanceof HTMLInputElement) return;
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                "[data-share-option]",
              ),
            ];
            if (/^[1-9]$/.test(event.key)) {
              items[Number(event.key) - 1]?.click();
              event.preventDefault();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              const index = items.indexOf(
                document.activeElement as HTMLElement,
              );
              items[
                (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length
              ]?.focus();
              event.preventDefault();
            }
          }}
        >
          <div className={moveStyles.header}>
            <strong>Who is this for?</strong>
            <span className={moveStyles.balance}>
              {money(amounts.reduce((sum, value) => sum + value, 0))}
            </span>
          </div>
          <div className={styles.shareOptions} role="group">
            {options.map((option, index) => (
              <button
                key={option.id}
                type="button"
                data-share-option
                autoFocus={option.id === current}
                className={`${moveStyles.option} ${styles.shareOption}`}
                aria-pressed={option.id === current}
                onClick={() =>
                  option.apply
                    ? option.apply()
                    : setForm(option.id as "custom" | "other")
                }
              >
                <span className={moveStyles.check}>
                  {option.id === current && <CheckIcon size={14} aria-hidden />}
                </span>
                <span>{option.label}</span>
                <span className={styles.optionDetail}>{option.detail}</span>
                <kbd className={styles.optionKey}>{index + 1}</kbd>
              </button>
            ))}
          </div>
          {form === "custom" && partner && (
            <CustomShare
              key="custom"
              label={`${partner.name}'s share${multiple ? " per transaction" : ""}`}
              amount={amount}
              initial={
                share?.accountId === partner.id && share.amount
                  ? share.amount
                  : half
              }
              onApply={(value) =>
                pick({ accountId: partner.id, amount: value })
              }
            />
          )}
          {form === "other" && reimbursements && (
            <OtherShare
              amounts={amounts}
              people={people}
              initial={share?.accountId === reimbursements.id ? share : null}
              onApply={(name, value, basis) =>
                pick(
                  {
                    accountId: reimbursements.id,
                    amount: value,
                    counterpartyName: name,
                  },
                  basis,
                )
              }
            />
          )}
          {error && (
            <p className={`${moveStyles.error} ${styles.popoverHint}`}>
              {error}
            </p>
          )}
          {remembered && (
            <p className={styles.popoverHint}>
              Prefilled from {remembered} last time.
            </p>
          )}
        </div>
      )}
    </PopoverSteps>
  );
}

// A share typed in a field, in cents, or why it can't be one.
function readShare(text: string, most: number) {
  const reading = readAmount(text);
  if (!reading.ok) return reading;
  if (reading.cents < 0)
    return { ok: false as const, message: "Enter an amount, like 24.50." };
  if (reading.cents > most)
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
      className={styles.shareForm}
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

function OtherShare({
  amounts,
  people,
  initial,
  onApply,
}: {
  amounts: number[];
  people: string[];
  initial: CounterpartyShare | null;
  onApply: (name: string, value: number, basis: ShareBasis) => void;
}) {
  const amount = Math.min(...amounts);
  const multiple = amounts.length > 1;
  const [full, setFull] = useState(multiple && !initial);
  const nameId = useId();
  const listId = useId();
  const [name, setName] = useState(initial?.counterpartyName ?? "");
  const [text, setText] = useState(
    ((initial?.amount ?? amount) / 100).toFixed(2),
  );
  const [error, setError] = useState<{
    field: "name" | "amount";
    message: string;
  } | null>(null);
  return (
    <form
      className={styles.shareForm}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!name.trim())
          return setError({ field: "name", message: "Name who owes it." });
        const share = full
          ? { ok: true as const, cents: amount }
          : readShare(text, amount);
        if (!share.ok)
          return setError({ field: "amount", message: share.message });
        onApply(name.trim(), share.cents, full ? "full" : "fixed");
      }}
    >
      <div className={styles.shareFormRow}>
        <div className={styles.shareFormField}>
          <label htmlFor={nameId}>Who owes it</label>
          <div className={moveStyles.amountInput}>
            <input
              id={nameId}
              list={listId}
              value={name}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="Name or company"
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
            <datalist id={listId}>
              {people.map((person) => (
                <option key={person} value={person} />
              ))}
            </datalist>
          </div>
        </div>
        {!full && (
          <div className={styles.shareFormField} data-narrow>
            <Field
              label={multiple ? "Amount each" : "Amount"}
              error={error?.field === "amount" ? error.message : undefined}
            >
              <AmountInput
                value={text}
                onChange={(value) => {
                  if (!sameAmount(text, value)) setError(null);
                  setText(value);
                }}
              />
            </Field>
          </div>
        )}
      </div>
      {multiple && (
        <label className={styles.fullShare}>
          <Checkbox
            checked={full}
            onCheckedChange={(value) => {
              setFull(value === true);
              setError(null);
            }}
          />
          Full amount of each transaction
        </label>
      )}
      {error?.field === "name" && (
        <p className={moveStyles.error}>{error.message}</p>
      )}
      <p className={styles.formHint}>
        Tracked in your Reimbursements account. Only you see it.
      </p>
      <div className={styles.shareFormActions}>
        <Button size="sm" variant="primary" type="submit">
          Apply
        </Button>
      </div>
    </form>
  );
}
