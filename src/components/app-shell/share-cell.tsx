"use client";

import grid from "~/components/ui/register.module.css";

import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { View } from "~/components/budget/types";
import { lineField } from "~/components/transactions/transaction-draft";
import type { CounterpartyShare, TransactionLine } from "~/domain/engine";
import { money, type Transaction } from "./model";
import { ShareLabel, ShareMenu, useShareParties } from "./share-field";
import { useTransactionEntry } from "./transaction-entry";
import styles from "./share.module.css";

type BudgetTransaction = View["budget"]["transactions"][number];
type Who = (share: CounterpartyShare) => string;

// The lines a share can sit on: a split's lines, or the transaction itself
// as one line, even before it has a category.
function shareLines(transaction: BudgetTransaction): TransactionLine[] {
  return (
    transaction.lines ?? [
      {
        id: transaction.id,
        categoryId: transaction.categoryId ?? "",
        amount: transaction.amount,
        counterpartyShare: transaction.counterpartyShare,
      },
    ]
  );
}

// The shares on a transaction's lines, added up by who owes them.
function shareTotal(who: Who, transaction: BudgetTransaction) {
  const shares = shareLines(transaction)
    .map((line) => line.counterpartyShare)
    .filter((share): share is CounterpartyShare => Boolean(share?.amount));
  if (!shares.length) return null;
  return {
    share: {
      ...shares[0]!,
      amount: shares.reduce((sum, share) => sum + share.amount, 0),
    },
    name: [...new Set(shares.map((share) => who(share)))].join(", "),
  };
}

function shareNotice(
  who: Who,
  payee: string,
  before: CounterpartyShare | null | undefined,
  share: CounterpartyShare | null,
) {
  if (share?.amount)
    return `${who(share)}’s share of ${payee} is ${money(share.amount)}.`;
  return before?.amount && share
    ? `Wrote off the share of ${payee}.`
    : `${payee} is all yours now.`;
}

// The register's Share cell, over its row in the Share column. On one line
// it opens the share menu and saves what's picked; a split opens the editor,
// where each line has its own.
export function ShareCell({
  row,
  accountColumn,
}: {
  row: Transaction;
  accountColumn: boolean;
}) {
  const entry = useTransactionEntry();
  const { view, who } = useShareParties();
  if (!row.actions.share) return null;
  const transactionId = row.id;
  const transaction =
    row.source === "budget"
      ? view.budget.transactions.find((item) => item.id === transactionId)
      : undefined;
  if (row.source === "budget" && !transaction) return null;
  const lines = transaction
    ? shareLines(transaction)
    : [{ id: row.id, categoryId: row.categoryId ?? "", amount: row.amount }];
  const total = transaction ? shareTotal(who, transaction) : null;
  const label = total && <ShareLabel share={total.share} name={total.name} />;
  const payee = row.payee;
  const slot = (content: ReactNode) => (
    <div
      className={`${grid.columns} ${styles.shareActions}`}
      data-accounts={accountColumn || undefined}
    >
      <span className={styles.shareSlot}>{content}</span>
    </div>
  );
  const button = (
    <button
      type="button"
      className={styles.shareButton}
      data-empty={!label || undefined}
      aria-label={
        total
          ? `${total.name}’s share of ${payee}: ${money(total.share.amount)}. Change`
          : `Share ${payee}`
      }
      onClick={
        lines.length > 1
          ? () =>
              entry.start({
                transactionId,
                field: lineField(lines[0]!.id, "counterpartyShare"),
              })
          : undefined
      }
    >
      {label ?? (
        <>
          <PlusIcon size={12} aria-hidden />
          Share
        </>
      )}
    </button>
  );
  if (lines.length > 1) return slot(button);
  const line = lines[0]!;
  return slot(
    <ShareMenu
      amount={Math.abs(line.amount)}
      share={line.counterpartyShare}
      saved={line.counterpartyShare}
      onChange={(share) => {
        // Imports resolve through the editor, with the share already set.
        if (row.source === "bank")
          return entry.start({
            transactionId,
            field: line.categoryId ? "counterpartyShare" : "categoryId",
            counterpartyShare: share,
          })
            ? null
            : "Save or cancel the open transaction first.";
        return entry.saveShare(
          transactionId,
          line.id,
          share,
          shareNotice(who, payee, line.counterpartyShare, share),
        );
      }}
    >
      {button}
    </ShareMenu>,
  );
}
