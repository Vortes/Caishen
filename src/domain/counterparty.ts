import type {
  Budget,
  CounterpartyShare,
  Transaction,
  TransactionLine,
} from "./engine";

export function counterpartyLines(
  transaction: Pick<
    Transaction,
    "id" | "categoryId" | "amount" | "lines" | "counterpartyShare"
  >,
): TransactionLine[] {
  return (
    transaction.lines ??
    (transaction.categoryId
      ? [
          {
            id: transaction.id,
            categoryId: transaction.categoryId,
            amount: transaction.amount,
            counterpartyShare: transaction.counterpartyShare,
          },
        ]
      : [])
  );
}

export function shareContribution(
  amount: number,
  share?: CounterpartyShare,
): number {
  return share ? -Math.sign(amount) * share.amount : 0;
}

export type CounterpartyRegisterEntry = {
  id: string;
  transactionId: string;
  lineId?: string;
  accountId: string;
  cashAccountId: string;
  date: string;
  payee: string;
  counterpartyName?: string;
  amount: number;
  kind: "share" | "refund" | "repayment";
};

export function counterpartyRegisterEntries(
  budget: Budget,
  filter: {
    accountId?: string;
    counterpartyName?: string;
    cutoff?: string;
  } = {},
): CounterpartyRegisterEntry[] {
  return budget.transactions
    .flatMap((transaction): CounterpartyRegisterEntry[] => {
      if (
        transaction.removed ||
        (filter.cutoff && transaction.date > filter.cutoff) ||
        (transaction.status === "pending" && transaction.amount > 0)
      )
        return [];
      if (transaction.linkedCounterpartyAccountId)
        return [
          {
            id: `${transaction.id}:repayment`,
            transactionId: transaction.id,
            accountId: transaction.linkedCounterpartyAccountId,
            cashAccountId: transaction.accountId,
            date: transaction.date,
            payee: transaction.payee,
            counterpartyName: transaction.counterpartyName,
            amount: -transaction.amount,
            kind: "repayment",
          },
        ];
      return counterpartyLines(transaction).flatMap((line) =>
        line.counterpartyShare
          ? [
              {
                id: `${transaction.id}:${line.id}`,
                transactionId: transaction.id,
                lineId: line.id,
                accountId: line.counterpartyShare.accountId,
                cashAccountId: transaction.accountId,
                date: transaction.date,
                payee: transaction.payee,
                counterpartyName: line.counterpartyShare.counterpartyName,
                amount: shareContribution(line.amount, line.counterpartyShare),
                kind: transaction.amount > 0 ? "refund" : "share",
              },
            ]
          : [],
      );
    })
    .filter(
      (entry) =>
        (!filter.accountId || entry.accountId === filter.accountId) &&
        (!filter.counterpartyName ||
          entry.counterpartyName === filter.counterpartyName),
    );
}
