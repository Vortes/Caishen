"use client";

import { ChevronDownIcon } from "lucide-react";
import { money } from "./model";
import styles from "./shell.module.css";

export function RtaCard({ amount }: { amount: number }) {
  const state = amount > 0 ? "positive" : amount < 0 ? "over" : "zero";
  const label =
    state === "over"
      ? "Overassigned"
      : state === "zero"
        ? "All money assigned"
        : "Ready to Assign";
  const action =
    state === "over"
      ? "Fix overassigned money"
      : state === "positive"
        ? "Assign money"
        : undefined;
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
