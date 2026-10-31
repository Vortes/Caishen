"use client";

import { ChevronDownIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Section } from "./cards";
import { AssignMoneyPopover } from "./assign-money";
import { money } from "./model";
import styles from "./shell.module.css";

// The shell's card, titled Ready to Assign whatever the amount: its action opens the Assign Money popover, which reads
// the live budget.
export function RtaCard({ amount }: { amount: number }) {
  const state = amount > 0 ? "positive" : amount < 0 ? "over" : "zero";
  const action =
    state === "over"
      ? "Fix overassigned money"
      : state === "positive"
        ? "Assign money"
        : undefined;
  return (
    <Section id="ready-to-assign" title="Ready to Assign">
      <div className={styles.rtaCard} data-state={state}>
        <strong>{money(amount)}</strong>
        {action ? (
          <div className={styles.rtaAction}>
            <AssignMoneyPopover>
              <Button variant="primary">
                {action}
                <ChevronDownIcon aria-hidden />
              </Button>
            </AssignMoneyPopover>
          </div>
        ) : (
          <p>Every dollar has a job this month.</p>
        )}
      </div>
    </Section>
  );
}
