"use client";

import { CircleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import {
  ChoiceField,
  type ChoiceOption,
} from "../app-shell/transaction-fields";
import entry from "../app-shell/transaction-entry.module.css";
import { money, PARTNER, PEOPLE, type Share } from "./model";
import { useStore } from "./store";
import styles from "./shared-costs.module.css";

export const parseCents = (text: string) => {
  const value = Number(text.replace(/[$,\s]/g, ""));
  return text.trim() && Number.isFinite(value) ? Math.round(value * 100) : null;
};

const plain = (cents: number) => (Math.abs(cents) / 100).toFixed(2);

type Preset = "none" | "split" | "all" | "custom";

// The one fact only the payer knows: how much of a line is someone else's.
// Share zero means the line is entirely yours.
export function ShareControl({
  id,
  lineAmount,
  share,
  onChange,
  layout = "row",
}: {
  id: string;
  // Negative for a refund; the share follows its sign.
  lineAmount: number;
  share?: Share;
  onChange: (share: Share | undefined) => void;
  layout?: "row" | "stack";
}) {
  const { world, budget, variants } = useStore();
  const partnerName = world.partnered ? PEOPLE[budget.partner].name : null;
  const [names, setNames] = useState<string[]>(() =>
    ["Sam Ortiz", "Acme Corp"].concat(
      share &&
        share.who !== PARTNER &&
        !["Sam Ortiz", "Acme Corp"].includes(share.who)
        ? [share.who]
        : [],
    ),
  );
  const sign = lineAmount < 0 ? -1 : 1;
  const whole = Math.abs(lineAmount);
  const amount = Math.abs(share?.amount ?? 0);
  const who = share?.who ?? (partnerName ? PARTNER : (names[0] ?? ""));
  const percent = who === PARTNER ? world.split[budget.partner] : 50;
  const equal = Math.round((whole * percent) / 100);
  const preset: Preset =
    !share || amount === 0
      ? "none"
      : amount === equal
        ? "split"
        : amount === whole
          ? "all"
          : "custom";
  const [custom, setCustom] = useState(preset === "custom");
  const [text, setText] = useState(amount ? plain(amount) : "");
  const shown: Preset = custom && preset !== "none" ? "custom" : preset;
  const whoName = who === PARTNER ? (partnerName ?? "Partner") : who;
  const over = amount > whole;

  const set = (cents: number, to = who) => {
    setText(cents ? plain(cents) : "");
    onChange(cents ? { who: to, amount: sign * cents } : undefined);
  };
  const options: ChoiceOption[] = [
    ...(partnerName
      ? [{ value: PARTNER, label: partnerName, group: "Partner" }]
      : []),
    ...names.map((name) => ({
      value: name,
      label: name,
      group: "Reimbursements",
    })),
  ];
  const whoField = (
    <div className={styles.shareWho}>
      <ChoiceField
        id={`${id}-who`}
        label="Shared with"
        value={who}
        options={options}
        placeholder="Who"
        wide={false}
        onChange={(next) => {
          const nextAmount =
            shown === "split"
              ? Math.round(
                  (whole *
                    (next === PARTNER ? world.split[budget.partner] : 50)) /
                    100,
                )
              : amount;
          if (nextAmount) set(nextAmount, next);
          else onChange(share ? { ...share, who: next } : undefined);
        }}
        onCreate={{
          noun: "person",
          create: (name) => {
            setNames((list) => [...list, name]);
            if (amount) set(amount, name);
          },
        }}
      />
    </div>
  );
  const amountField = (
    <div
      className={`${entry.well} ${styles.shareAmount}`}
      data-invalid={over || undefined}
      data-amount
    >
      <span className={entry.prefix} aria-hidden>
        $
      </span>
      <input
        id={`${id}-amount`}
        className={entry.input}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={`${whoName}'s share`}
        aria-invalid={over || undefined}
        placeholder="0.00"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const cents = parseCents(event.target.value);
          onChange(cents ? { who, amount: sign * cents } : undefined);
        }}
        onBlur={() => setText(amount ? plain(amount) : "")}
      />
    </div>
  );
  const summary = (
    <span className={styles.shareSummary} aria-live="polite">
      {over ? (
        <span className={styles.shareError}>
          <CircleAlertIcon size={13} aria-hidden />
          Can&rsquo;t be more than the line&rsquo;s {money(whole)}
        </span>
      ) : amount === 0 ? (
        "All yours"
      ) : (
        <>
          {whoName}&rsquo;s share <strong>{money(amount)}</strong>
          <span aria-hidden> · </span>
          your spending <strong>{money(whole - amount)}</strong>
        </>
      )}
    </span>
  );

  if (variants.input === "amount") {
    return (
      <div className={styles.share} data-layout={layout}>
        {whoField}
        <span className={styles.shareWord}>owes</span>
        {amountField}
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            setCustom(false);
            set(equal);
          }}
        >
          Split equally
        </Button>
        {summary}
      </div>
    );
  }
  const splitLabel = percent === 50 ? "Half" : `${100 - percent}/${percent}`;
  return (
    <div className={styles.share} data-layout={layout}>
      <SegmentedControl
        aria-label="Share"
        value={shown}
        onValueChange={(value) => {
          const next = value as Preset;
          setCustom(next === "custom");
          if (next === "none") set(0);
          else if (next === "split") set(equal);
          else if (next === "all") set(whole);
          else setText(amount ? plain(amount) : "");
        }}
      >
        <SegmentedControlItem value="none">Yours</SegmentedControlItem>
        <SegmentedControlItem value="split">{splitLabel}</SegmentedControlItem>
        <SegmentedControlItem value="all">Theirs</SegmentedControlItem>
        <SegmentedControlItem value="custom">Amount</SegmentedControlItem>
      </SegmentedControl>
      {shown !== "none" && (
        <>
          <span className={styles.shareWord}>with</span>
          {whoField}
        </>
      )}
      {shown === "custom" && amountField}
      {summary}
    </div>
  );
}
