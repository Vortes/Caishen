"use client";

import { CheckIcon, UsersIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { usePortalContainer } from "~/components/ui/tooltip";
import moveStyles from "../app-shell/move-money.module.css";
import { EQUAL_SPLIT, PARTNER, type Share } from "./data";
import { equalShare, money, parseCents } from "./ledger";
import styles from "./shared-costs.module.css";

// The share on one line: nothing, an equal split with the partner, all of
// it the partner's, a custom amount, or someone else's (the reimbursements
// account). Presets cover the common cases in one pick.

type Preset = "mine" | "split" | "theirs" | "custom" | "other";

export function presetOf(share: Share | null, amount: number): Preset {
  if (!share || share.amount === 0) return "mine";
  if (share.with !== PARTNER) return "other";
  if (share.amount === equalShare(amount, EQUAL_SPLIT)) return "split";
  if (share.amount === amount) return "theirs";
  return "custom";
}

export function shareLabel(
  share: Share | null,
  partnerName: string,
): ReactNode {
  if (!share || share.amount === 0) return null;
  return (
    <>
      <UsersIcon size={12} aria-hidden className={styles.shareIcon} />
      <span className={styles.shareWho}>
        {share.with === PARTNER ? partnerName : share.with}
      </span>
      <span className={styles.shareAmount}>{money(share.amount)}</span>
    </>
  );
}

// The menu that opens from a Share cell. Picking a preset applies it at
// once; Custom and Someone else open a field first.
export function ShareMenu({
  amount,
  share,
  partnerName,
  people,
  remembered,
  onChange,
  children,
}: {
  amount: number;
  share: Share | null;
  partnerName: string;
  // Names already in the reimbursements account.
  people: string[];
  // The payee whose last categorization prefilled this share.
  remembered?: string;
  onChange: (share: Share | null) => void;
  children: ReactNode;
}) {
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  const current = presetOf(share, amount);
  const [form, setForm] = useState<"custom" | "other" | null>(null);
  const pick = (next: Share | null) => {
    onChange(next);
    setOpen(false);
  };
  const half = equalShare(amount, EQUAL_SPLIT);
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
    {
      id: "split",
      label: `Split with ${partnerName}`,
      detail: money(half),
      apply: () => pick({ with: PARTNER, amount: half }),
    },
    {
      id: "theirs",
      label: `All ${partnerName}'s`,
      detail: money(amount),
      apply: () => pick({ with: PARTNER, amount }),
    },
    { id: "custom", label: `${partnerName}'s share is…`, detail: "" },
    { id: "other", label: "Someone else owes…", detail: "" },
  ];
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
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
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                "[data-share-option]",
              ),
            ];
            // Number keys pick an option, as the menu's hints show.
            if (
              /^[1-5]$/.test(event.key) &&
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
          {form === "custom" && (
            <CustomShare
              key="custom"
              label={`${partnerName}'s share`}
              amount={amount}
              initial={share?.with === PARTNER ? share.amount : half}
              onApply={(value) => pick({ with: PARTNER, amount: value })}
            />
          )}
          {form === "other" && (
            <OtherShare
              amount={amount}
              people={people}
              initial={share?.with !== PARTNER ? share : null}
              onApply={pick}
            />
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
  initial: Share | null;
  onApply: (share: Share) => void;
}) {
  const nameId = useId();
  const amountId = useId();
  const listId = useId();
  const [name, setName] = useState(initial?.with ?? "");
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
        const value = parseCents(text);
        if (!name.trim()) return setError("Name who owes it.");
        if (value === null) return setError("Enter an amount, like 24.50.");
        if (value > amount)
          return setError(`A share can be at most ${money(amount)}.`);
        onApply({ with: name.trim(), amount: value });
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
  label,
  onChange,
}: {
  id: string;
  value: string;
  invalid?: boolean;
  autoFocus?: boolean;
  label?: string;
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
        aria-label={label}
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

// The editor's version: the same presets as a segmented control under the
// line, with the amount beside it when it isn't an equal split.
export function ShareBar({
  amount,
  share,
  partnerName,
  people,
  remembered,
  onChange,
}: {
  amount: number;
  share: Share | null;
  partnerName: string;
  people: string[];
  remembered?: string;
  onChange: (share: Share | null) => void;
}) {
  const id = useId();
  const preset = presetOf(share, amount);
  const half = equalShare(amount, EQUAL_SPLIT);
  // "All theirs" is a custom amount here; four segments is the most a
  // segmented control holds.
  const value = preset === "theirs" ? "custom" : preset;
  const [text, setText] = useState(
    share ? (share.amount / 100).toFixed(2) : "",
  );
  const [name, setName] = useState(
    share && share.with !== PARTNER ? share.with : "",
  );
  const nameRef = useRef<HTMLInputElement>(null);
  const commit = (who: string, raw: string) => {
    const cents = parseCents(raw);
    if (cents === null) return;
    onChange({ with: who, amount: Math.min(cents, amount) });
  };
  return (
    <div className={styles.shareBar}>
      <span className={styles.shareBarLabel} id={`${id}-label`}>
        Who is this for?
      </span>
      <SegmentedControl
        aria-labelledby={`${id}-label`}
        value={value}
        onValueChange={(next) => {
          if (next === "mine") onChange(null);
          else if (next === "split") {
            onChange({ with: PARTNER, amount: half });
            setText((half / 100).toFixed(2));
          } else if (next === "custom") {
            const start = share?.with === PARTNER ? share.amount : half;
            onChange({ with: PARTNER, amount: start });
            setText((start / 100).toFixed(2));
          } else {
            const who = name.trim() ? name : (people[0] ?? "Someone");
            onChange({ with: who, amount });
            setName(who);
            setText((amount / 100).toFixed(2));
            requestAnimationFrame(() => nameRef.current?.select());
          }
        }}
      >
        <SegmentedControlItem value="mine">Just mine</SegmentedControlItem>
        <SegmentedControlItem value="split">
          Split with {partnerName}
        </SegmentedControlItem>
        <SegmentedControlItem value="custom">Custom</SegmentedControlItem>
        <SegmentedControlItem value="other">Someone else</SegmentedControlItem>
      </SegmentedControl>
      {value === "split" && (
        <span className={styles.shareBarNote}>
          {partnerName} {money(half)} · you {money(amount - half)}
        </span>
      )}
      {value === "custom" && (
        <span className={styles.shareBarField}>
          <label htmlFor={`${id}-amount`}>{partnerName}&rsquo;s share</label>
          <AmountWell
            id={`${id}-amount`}
            value={text}
            onChange={(next) => {
              setText(next);
              commit(PARTNER, next);
            }}
          />
        </span>
      )}
      {value === "other" && (
        <>
          <span className={styles.shareBarField}>
            <label htmlFor={`${id}-name`}>Who</label>
            <span className={moveStyles.amountInput}>
              <input
                ref={nameRef}
                id={`${id}-name`}
                list={`${id}-people`}
                value={name}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setName(event.target.value);
                  if (event.target.value.trim())
                    commit(event.target.value.trim(), text);
                }}
              />
              <datalist id={`${id}-people`}>
                {people.map((person) => (
                  <option key={person} value={person} />
                ))}
              </datalist>
            </span>
          </span>
          <span className={styles.shareBarField}>
            <label htmlFor={`${id}-other`}>Owes</label>
            <AmountWell
              id={`${id}-other`}
              value={text}
              onChange={(next) => {
                setText(next);
                if (name.trim()) commit(name.trim(), next);
              }}
            />
          </span>
        </>
      )}
      {remembered && value !== "mine" && (
        <span className={styles.shareBarNote}>From {remembered} last time</span>
      )}
    </div>
  );
}
