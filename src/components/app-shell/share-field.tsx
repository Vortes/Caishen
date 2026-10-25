"use client";

import { groupAmountInput } from "~/components/budget/amount-input";
import { CheckIcon, UsersIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useState, type ReactNode } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { PopoverSteps } from "./popover-steps";
import { Button } from "~/components/ui/button";
import { usePortalContainer } from "~/components/ui/tooltip";
import { POPOVER_GAP } from "~/components/ui/tokens";
import {
  halfOf,
  keepShare,
  type ShareBasis,
} from "~/components/transactions/transaction-share";
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
  children: ReactNode;
}) {
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={moveStyles.popover}
          align="start"
          sideOffset={POPOVER_GAP}
          collisionPadding={12}
          aria-label="Who this is for"
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
          <Popover.Arrow className={moveStyles.arrow} width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
        const value = full ? amount : parseCents(text);
        if (!name.trim()) return setError("Name who owes it.");
        if (value === null) return setError("Enter an amount, like 24.50.");
        if (value > amount)
          return setError(`A share can be at most ${money(amount)}.`);
        onApply(name.trim(), value, full ? "full" : "fixed");
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
        {!full && (
          <div className={styles.shareFormField} data-narrow>
            <label htmlFor={amountId}>
              {multiple ? "Amount each" : "Amount"}
            </label>
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
        )}
      </div>
      {multiple && (
        <label className={styles.fullShare}>
          <Checkbox
            checked={full}
            onCheckedChange={(value) => {
              setFull(value === true);
              setError("");
            }}
          />
          Full amount of each transaction
        </label>
      )}
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
        onChange={(event) => onChange(groupAmountInput(event.target))}
      />
    </div>
  );
}
