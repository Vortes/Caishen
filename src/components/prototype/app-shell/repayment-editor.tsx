"use client";

import { useState, type ReactNode } from "react";
import { newId } from "~/components/budget/format";
import { Button } from "~/components/ui/button";
import { money, shortDay, type Transaction } from "./model";
import { useTransactionEntry } from "./transaction-entry";
import { approveCommand } from "./transaction-review";
import entry from "./transaction-entry.module.css";
import shell from "./shell.module.css";
import styles from "./repayment-editor.module.css";

// A repayment, or one partner's side of a settlement, opened in its cash or
// card register. Its amount and date come from the bank, so the row only
// reads; what's left is saying what it is and confirming it, like approving
// any other transaction. Confirming a settlement confirms both sides.
export function RepaymentEditor({
  transaction,
  accountName,
  onClose,
}: {
  transaction: Transaction & {
    repayment: NonNullable<Transaction["repayment"]>;
  };
  // The account column's name, when the register shows one.
  accountName?: string;
  onClose: () => void;
}) {
  const { saveCommand } = useTransactionEntry();
  const [error, setError] = useState("");
  const { from, account, settlementId } = transaction.repayment;
  const paid = transaction.amount < 0;
  return (
    <form
      className={entry.form}
      aria-label={
        settlementId
          ? `Settlement ${paid ? "to" : "from"} ${from}`
          : `Repayment from ${from}`
      }
      onSubmit={(event) => {
        event.preventDefault();
        // A repayment recorded here is confirmed already; one the bank
        // brought in waits for this.
        if (!transaction.needsReview) return onClose();
        const failure = settlementId
          ? saveCommand(
              {
                type: "partner.settlement.confirm",
                id: newId(),
                settlementId,
              },
              `Confirmed. ${from}’s side is confirmed too.`,
            )
          : saveCommand(
              approveCommand([transaction.id]),
              `Confirmed ${money(transaction.amount)} from ${from}.`,
            );
        if (!failure) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className={`${shell.txColumns} ${entry.entryRow}`}>
        {accountName !== undefined && (
          <StaticCell>
            <span className={shell.faint}>{accountName}</span>
          </StaticCell>
        )}
        <StaticCell>
          <span className={shell.muted}>{shortDay(transaction.date)}</span>
        </StaticCell>
        <StaticCell>{transaction.payee}</StaticCell>
        <StaticCell>
          <span className={shell.muted}>{transaction.categoryLabel}</span>
        </StaticCell>
        <StaticCell />
        <StaticCell numeric>
          {paid && (
            <span className={shell.numeric}>{money(-transaction.amount)}</span>
          )}
        </StaticCell>
        <StaticCell numeric>
          {!paid && (
            <span className={shell.numeric} data-inflow>
              {money(transaction.amount)}
            </span>
          )}
        </StaticCell>
        <span />
      </div>
      <p className={styles.note}>
        {settlementId
          ? `A transfer ${paid ? "to" : "from"} ${from}, recognized in both budgets by amount, date, and direction. It moves your ${account} account, not Ready to Assign. Confirming here confirms ${from}’s side too.`
          : `A transfer from your ${account} account: ${from} paid you back. It refills the ${account} envelope, not Ready to Assign.`}
        {settlementId &&
          " Reject a wrong match to review both bank imports separately."}
      </p>
      {error && (
        <p className={entry.formError} role="alert">
          {error}
        </p>
      )}
      <div className={entry.rowFooter}>
        <div className={entry.actions}>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          {settlementId && (
            <Button
              size="sm"
              onClick={() => {
                const failure = saveCommand(
                  {
                    type: "partner.settlement.reject",
                    id: newId(),
                    settlementId,
                  },
                  "Match rejected. Both bank imports are back in review.",
                );
                if (failure) setError(failure);
                else onClose();
              }}
            >
              Reject match
            </Button>
          )}
          <Button size="sm" variant="primary" type="submit" autoFocus>
            Confirm transfer
          </Button>
        </div>
      </div>
    </form>
  );
}

function StaticCell({
  numeric,
  children,
}: {
  numeric?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={`${entry.cell} ${styles.staticCell}`}
      data-numeric={numeric ? "" : undefined}
    >
      <span className={shell.truncate}>{children}</span>
    </div>
  );
}
