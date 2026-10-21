"use client";

import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { AssignMoneyPopover } from "./assign-money";
import { money } from "./model";
import styles from "./shell.module.css";

// The shell's card: its action opens the Assign Money popover, which reads
// the live budget.
export function RtaCard({ amount }: { amount: number }) {
  return (
    <RtaCardLayout
      amount={amount}
      wrapAction={(button) => <AssignMoneyPopover>{button}</AssignMoneyPopover>}
    />
  );
}

// The card on its own, for pages outside the shell such as the design
// system's specimens. Its action is a plain button unless wrapped.
export function RtaCardLayout({
  amount,
  wrapAction = (button) => button,
}: {
  amount: number;
  wrapAction?: (button: ReactNode) => ReactNode;
}) {
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
    <Card>
      <div className={styles.rtaCard} data-state={state}>
        <span className={styles.rtaCardLabel}>{label}</span>
        <strong>{money(amount)}</strong>
        {action ? (
          <div className={styles.rtaAction}>
            {wrapAction(
              <Button variant="primary">
                {action}
                <ChevronDownIcon aria-hidden />
              </Button>,
            )}
          </div>
        ) : (
          <p>Every dollar has a job this month.</p>
        )}
      </div>
    </Card>
  );
}
