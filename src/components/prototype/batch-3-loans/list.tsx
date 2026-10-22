"use client";

import { LandmarkIcon, PlusIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tag } from "~/components/ui/tag";
import shell from "../app-shell/shell.module.css";
import {
  balanceOn,
  endOf,
  forecast,
  monthLabel,
  money,
  paidOffOn,
  percent,
  rateDue,
  rateOn,
} from "./data";
import { AddLoanRow } from "./editors";
import { useStore } from "./store";
import styles from "./loans.module.css";

export function LoansList() {
  const store = useStore();
  const { state, month, selected, editor, variants } = store;
  const adding = editor?.kind === "add" && variants.add === "row";
  if (!state.loans.length && !adding)
    return (
      <div className={shell.empty}>
        <LandmarkIcon size={18} aria-hidden />
        <div className={shell.emptyBody}>
          <p>
            <strong>No loans yet.</strong>
            Add a student loan, car loan, or mortgage to plan its payments and
            see when it’s paid off.
          </p>
          <div>
            <Button
              disabled={editor?.kind === "add"}
              onClick={() => store.open({ kind: "add" })}
            >
              <PlusIcon aria-hidden />
              Add loan
            </Button>
          </div>
        </div>
      </div>
    );
  // Paid-off loans sink below the ones still owed.
  const loans = [...state.loans].sort(
    (a, b) =>
      Number(balanceOn(a, endOf(month)) === 0) -
      Number(balanceOn(b, endOf(month)) === 0),
  );
  return (
    <div className={shell.list} role="group" aria-label="Loans">
      <div className={`${shell.loanColumns} ${shell.columnHeader}`} aria-hidden>
        <span>Loan</span>
        <span data-optional>Rate</span>
        <span data-optional>Payoff</span>
        <span className={shell.numeric}>Balance</span>
      </div>
      {adding && <AddLoanRow />}
      {loans.map((loan) => {
        const balance = balanceOn(loan, endOf(month));
        const paidOff = paidOffOn(loan, endOf(month));
        const result = paidOff ? null : forecast(loan, month);
        return (
          <button
            type="button"
            key={loan.id}
            data-row
            className={`${shell.loanColumns} ${shell.row}`}
            aria-current={selected === loan.id ? "true" : undefined}
            onClick={() => store.select(loan.id)}
          >
            <span className={styles.loanName}>
              <span className={shell.truncate}>{loan.name}</span>
              {rateDue(loan) && <Tag tone="attention">Rate due</Tag>}
            </span>
            <span className={shell.muted} data-optional>
              {percent(rateOn(loan, endOf(month)).annualRateBps)}
            </span>
            <span className={shell.muted} data-optional>
              {paidOff
                ? "Paid off"
                : result?.payoffMonth
                  ? monthLabel(result.payoffMonth)
                  : "No payoff"}
            </span>
            <span className={shell.numeric}>{money(-balance)}</span>
          </button>
        );
      })}
    </div>
  );
}
