"use client";

import { CheckIcon, UsersIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { usePortalContainer } from "~/components/ui/tooltip";
import type { CounterpartyShare } from "~/domain/engine";
import { money } from "./model";
import { useShellData } from "./shell-data";
import { useTransactionEntry } from "./transaction-entry";
import moveStyles from "./move-money.module.css";
import styles from "./share.module.css";

// Who a line's cost is for: nothing shared, half or all of it the
// partner's, a custom partner amount, or someone else's, tracked in the
// Reimbursements account. Presets cover the common cases in one pick.

type Preset = "mine" | "split" | "theirs" | "custom" | "other";

// Half is a fixed 50/50; the partner's half rounds down to the cent.
export const halfOf = (amount: number) => Math.floor(Math.abs(amount) / 2);

// Who a share can be with: the partner, by the name the shell shows, and
// the people already in the Reimbursements account, most recent first.
export function useShareParties() {
  const { accounts } = useShellData();
  const { view } = useTransactionEntry();
  const partner = accounts.find((item) => item.kind === "partner");
  const reimbursements = accounts.find(
    (item) => item.kind === "reimbursements",
  );
  const people = [
    ...new Set(
      [...view.budget.transactions]
        .filter((item) => !item.removed)
        .sort((a, b) => b.date.localeCompare(a.date))
        .flatMap((item) => [
          item.counterpartyName,
          item.counterpartyShare?.counterpartyName,
          ...(item.lines ?? []).map(
            (line) => line.counterpartyShare?.counterpartyName,
          ),
        ])
        .filter((name): name is string => Boolean(name)),
    ),
  ];
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

// A partner share set to nothing stays on the partner account at $0.00, so
// the write-off and its history stay visible. Any other empty share is just
// no share.
export function keepShare(
  saved: CounterpartyShare | null | undefined,
  next: CounterpartyShare | null,
  partnerId: string | undefined,
): CounterpartyShare | null {
  if (next && next.amount > 0) return next;
  if (
    saved &&
    saved.accountId === partnerId &&
    (!next || next.accountId === partnerId)
  )
    return { accountId: saved.accountId, amount: 0 };
  return null;
}

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
  children: ReactNode;
}) {
  const container = usePortalContainer();
  const { partner, reimbursements, people } = useShareParties();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const current = presetOf(share, amount, partner?.id);
  const [form, setForm] = useState<"custom" | "other" | null>(null);
  const pick = (next: CounterpartyShare | null) => {
    const failure = onChange(keepShare(saved, next, partner?.id));
    if (failure) setError(failure);
    else setOpen(false);
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
            detail: money(half),
            apply: () => pick({ accountId: partner.id, amount: half }),
          },
          {
            id: "theirs" as const,
            label: `All ${partner.name}'s`,
            detail: money(amount),
            apply: () => pick({ accountId: partner.id, amount }),
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
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError("");
        setForm(
          next && (current === "custom" || current === "other")
            ? current
            : null,
        );
      }}
    >
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={moveStyles.popover}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label="Who this is for"
          onKeyDown={(event) => {
            // The register and editor move between rows on arrows; here
            // they move between options.
            event.stopPropagation();
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                "[data-share-option]",
              ),
            ];
            // Number keys pick an option, as the menu's hints show.
            if (
              /^[1-9]$/.test(event.key) &&
              !(event.target instanceof HTMLInputElement)
            ) {
              items[Number(event.key) - 1]?.click();
              event.preventDefault();
              return;
            }
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            const index = items.indexOf(document.activeElement as HTMLElement);
            const next =
              items[
                (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length
              ];
            next?.focus();
            event.preventDefault();
          }}
        >
          <div className={moveStyles.header}>
            <strong>Who is this for?</strong>
            <span className={moveStyles.balance}>{money(amount)}</span>
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
              label={`${partner.name}'s share`}
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
              amount={amount}
              people={people}
              initial={share?.accountId === reimbursements.id ? share : null}
              onApply={(name, value) =>
                pick({
                  accountId: reimbursements.id,
                  amount: value,
                  counterpartyName: name,
                })
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
          <Popover.Arrow className={moveStyles.arrow} width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function parseCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(cleaned)) return null;
  const [whole = "0", fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
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
  const id = useId();
  const [text, setText] = useState((initial / 100).toFixed(2));
  const [error, setError] = useState("");
  return (
    <form
      className={styles.shareForm}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const value = parseCents(text);
        if (value === null) return setError("Enter an amount, like 24.50.");
        if (value > amount)
          return setError(`A share can be at most ${money(amount)}.`);
        onApply(value);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className={styles.shareFormRow}>
        <AmountWell
          id={id}
          value={text}
          invalid={Boolean(error)}
          autoFocus
          onChange={(value) => {
            setText(value);
            if (error) setError("");
          }}
        />
        <Button size="sm" variant="primary" type="submit">
          Apply
        </Button>
      </div>
      {error && <p className={moveStyles.error}>{error}</p>}
    </form>
  );
}

function OtherShare({
  amount,
  people,
  initial,
  onApply,
}: {
  amount: number;
  people: string[];
  initial: CounterpartyShare | null;
  onApply: (name: string, value: number) => void;
}) {
  const nameId = useId();
  const amountId = useId();
  const listId = useId();
  const [name, setName] = useState(initial?.counterpartyName ?? "");
  const [text, setText] = useState(
    ((initial?.amount ?? amount) / 100).toFixed(2),
  );
  const [error, setError] = useState("");
  return (
    <form
      className={styles.shareForm}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const value = parseCents(text);
        if (!name.trim()) return setError("Name who owes it.");
        if (value === null) return setError("Enter an amount, like 24.50.");
        if (value > amount)
          return setError(`A share can be at most ${money(amount)}.`);
        onApply(name.trim(), value);
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
                if (error) setError("");
              }}
            />
            <datalist id={listId}>
              {people.map((person) => (
                <option key={person} value={person} />
              ))}
            </datalist>
          </div>
        </div>
        <div className={styles.shareFormField} data-narrow>
          <label htmlFor={amountId}>Amount</label>
          <AmountWell
            id={amountId}
            value={text}
            invalid={Boolean(error)}
            onChange={(value) => {
              setText(value);
              if (error) setError("");
            }}
          />
        </div>
      </div>
      {error && <p className={moveStyles.error}>{error}</p>}
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

export function AmountWell({
  id,
  value,
  invalid,
  autoFocus,
  onChange,
}: {
  id: string;
  value: string;
  invalid?: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div
      className={moveStyles.amountInput}
      data-invalid={invalid ? "" : undefined}
    >
      <span aria-hidden>$</span>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        value={value}
        aria-invalid={invalid ? true : undefined}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
