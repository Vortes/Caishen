import type { Budget } from "./engine";

// The matching window for a bank import and activity entered by hand.
export const MANUAL_MATCH_DAYS = 10;

export const reviewImportsBeforeReconciliation =
  "Review imported bank activity before reconciling this account so it is not counted again as an adjustment.";

export type BalanceImport = {
  accountId: string | null;
  transactionId?: string;
  date: string;
  amount: number;
  pending: boolean;
  removed: boolean;
  needsMatchReview: boolean;
  error: string | null;
  quarantined: boolean;
  partnerMatches?: readonly unknown[];
  history: readonly {
    before: { providerTransactionId: string } | null;
    after: { providerTransactionId: string } | null;
  }[];
};

// The inbox has already left out opening history and dismissed imports.
// Bank activity can affect an account before its purpose is decided.
export function balanceImports(
  budget: Pick<Budget, "accounts" | "transactions">,
  imports: readonly BalanceImport[],
  cutoff: string,
) {
  return imports.filter((item) => {
    const account = budget.accounts.find(({ id }) => id === item.accountId);
    const providerIds = new Set(
      item.history.flatMap((entry) => [
        entry.before?.providerTransactionId,
        entry.after?.providerTransactionId,
      ]),
    );
    const recorded = budget.transactions.some(
      (transaction) =>
        transaction.accountId === item.accountId &&
        ((transaction.providerId !== undefined &&
          providerIds.has(transaction.providerId)) ||
          (!transaction.removed &&
            !transaction.providerId &&
            transaction.amount === item.amount &&
            Math.abs(Date.parse(transaction.date) - Date.parse(item.date)) <=
              MANUAL_MATCH_DAYS * 86_400_000)),
    );
    return (
      (account?.kind === "cash" || account?.kind === "credit") &&
      !item.transactionId &&
      !item.removed &&
      (!item.pending || item.amount < 0) &&
      !item.needsMatchReview &&
      !item.quarantined &&
      !item.error &&
      !item.partnerMatches?.length &&
      !recorded &&
      item.date <= cutoff
    );
  });
}
