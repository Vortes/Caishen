import { counterpartyLines, shareContribution } from "./counterparty";
import {
  isPersonalLedger,
  ledgerSharedPurchases,
  type AccountingState,
} from "./shared-ledger";

// One transaction's contribution to a person's personal spending: their share of
// a purchase or refund, wherever it was paid from, and the interest part of a
// loan payment, with a split counted line by line. Repayments, card payments, income, and reimbursements are not
// spending. See "Personal spending" in docs/GLOSSARY.md and ADR 0001.
export type SpendingEntry = {
  id: string;
  transactionId: string;
  // False when a partner paid and this person owes a share.
  paidByYou: boolean;
  // The expense period, which can differ from the transaction date.
  month: string;
  date: string;
  payee: string;
  // Only set for this person's own transactions.
  accountId?: string;
  // This person's category; a partner's shared purchase maps to the paired one.
  categoryId?: string;
  // Positive cents spent; negative when refunds outweigh spending.
  amount: number;
};

export function personalSpendingEntries(
  state: AccountingState,
  userId: string,
): SpendingEntry[] {
  const budget = isPersonalLedger(state)
    ? state.budget.userId === userId
      ? state.budget
      : undefined
    : Object.hasOwn(state.budgets, userId)
      ? state.budgets[userId]
      : undefined;
  const payments = budget?.loans.flatMap((loan) => loan.payments) ?? [];
  const entries: SpendingEntry[] = [];
  for (const transaction of budget?.transactions ?? []) {
    if (
      transaction.removed ||
      budget?.accounts.find((item) => item.id === transaction.accountId)
        ?.kind === "tracking"
    )
      continue;
    let amount = 0;
    if (
      transaction.kind === "purchase" ||
      transaction.kind === "refund" ||
      (transaction.kind === "transfer" && transaction.categoryId)
    )
      amount = transaction.shares?.[userId] ?? -transaction.amount;
    else if (transaction.kind === "loan-payment")
      amount =
        payments.find((payment) => payment.id === transaction.linkedId)
          ?.interest ?? 0;
    if (!amount) continue;
    if (
      (transaction.lines || transaction.counterpartyShare) &&
      !transaction.shares
    ) {
      for (const line of counterpartyLines(transaction))
        entries.push({
          id: `${userId}:${transaction.id}:${line.id}`,
          transactionId: transaction.id,
          paidByYou: true,
          month: transaction.expenseMonth,
          date: transaction.date,
          payee: transaction.payee,
          accountId: transaction.accountId,
          categoryId: line.categoryId,
          amount:
            -line.amount -
            shareContribution(line.amount, line.counterpartyShare),
        });
      continue;
    }
    entries.push({
      id: `${userId}:${transaction.id}`,
      transactionId: transaction.id,
      paidByYou: true,
      month: transaction.expenseMonth,
      date: transaction.date,
      payee: transaction.payee,
      accountId: transaction.accountId,
      categoryId: transaction.categoryId,
      amount,
    });
  }
  for (const purchase of ledgerSharedPurchases(state)) {
    const amount = purchase.shares[userId];
    if (purchase.payerId === userId || !amount) continue;
    entries.push({
      id: `${purchase.payerId}:${purchase.id}`,
      transactionId: purchase.id,
      paidByYou: false,
      month: purchase.expenseMonth,
      date: purchase.date,
      payee: purchase.payee,
      categoryId: state.sharedCategories.find(
        (shared) => shared.id === purchase.sharedCategoryId,
      )?.categoryIds[userId],
      amount,
    });
  }
  return entries;
}
