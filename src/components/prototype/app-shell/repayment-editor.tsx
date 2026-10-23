"use client";

import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { money, shortDay, type Transaction } from "./model";
import { useTransactionEntry } from "./transaction-entry";
import { approveCommand } from "./transaction-review";
import entry from "./transaction-entry.module.css";
import shell from "./shell.module.css";
import styles from "./repayment-editor.module.css";

// A repayment opened in its cash register. Its amount and date come from
// the counterparty account, so the row only reads; what's left is saying
// what it is and confirming it, like approving any other transaction.
export function RepaymentEditor({
  transaction,
  accountName,
  onClose,
}: {
  transaction: Transaction & { repayment: { from: string; account: string } };
  // The account column's name, when the register shows one.
  accountName?: string;
  onClose: () => void;
}) {
  const { saveCommand } = useTransactionEntry();
  const { from, account } = transaction.repayment;
  return (
    <form
      className={entry.form}
      aria-label={`Repayment from ${from}`}
      onSubmit={(event) => {
        event.preventDefault();
        // A repayment recorded here is confirmed already; one the bank
        // brought in waits for this.
        if (!transaction.needsReview) return onClose();
        const failure = saveCommand(
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
        <StaticCell numeric />
        <StaticCell numeric>
          <span className={shell.numeric} data-inflow>
            {money(transaction.amount)}
          </span>
        </StaticCell>
        <span />
      </div>
      <p className={styles.note}>
        A transfer from your {account} account: {from} paid you back. It refills
        the {account} envelope, not Ready to Assign.
      </p>
      <div className={entry.rowFooter}>
        <div className={entry.actions}>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
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
