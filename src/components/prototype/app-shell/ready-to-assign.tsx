"use client";

import { ChevronDownIcon } from "lucide-react";
import { money } from "./data";
import styles from "./shell.module.css";

export type RtaState = "positive" | "zero" | "over";

const states: Record<
  RtaState,
  { amount: number; label: string; action?: string }
> = {
  positive: {
    amount: 128416,
    label: "Ready to Assign",
    action: "Assign money",
  },
  zero: { amount: 0, label: "All money assigned" },
  over: {
    amount: -21350,
    label: "Overassigned",
    action: "Fix overassigned money",
  },
};

export function RtaCard({ state }: { state: RtaState }) {
  const { amount, label, action } = states[state];
  return (
    <section className={`${styles.card} ${styles.rtaCard}`} data-state={state}>
      <span className={styles.rtaCardLabel}>{label}</span>
      <strong>{money(amount)}</strong>
      {action ? (
        <button type="button" className={styles.rtaButton}>
          {action}
          <ChevronDownIcon size={13} aria-hidden />
        </button>
      ) : (
        <p>Every dollar has a job this month.</p>
      )}
    </section>
  );
}
