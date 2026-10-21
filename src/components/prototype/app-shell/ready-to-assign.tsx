"use client";

import { ChevronDownIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { AssignMoneyPopover } from "./assign-money";
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
    <Card>
      <div className={styles.rtaCard} data-state={state}>
        <span className={styles.rtaCardLabel}>{label}</span>
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
    </Card>
  );
}
