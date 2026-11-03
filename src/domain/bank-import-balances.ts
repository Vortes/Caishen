import type { Budget, Transaction } from "./engine";
import {
  importEligibilityIssue,
  type ImportEligibility,
} from "./register-entry";

// The matching window for a bank import and activity entered by hand.
export const MANUAL_MATCH_DAYS = 10;

export function matchesManualImport(
  transaction: Transaction,
  imported: { accountId: string | null; date: string; amount: number },
) {
  return (
    !transaction.removed &&
    !transaction.providerId &&
    transaction.accountId === imported.accountId &&
    transaction.amount === imported.amount &&
    Math.abs(Date.parse(transaction.date) - Date.parse(imported.date)) <=
      MANUAL_MATCH_DAYS * 86_400_000
  );
}

export const reviewImportsBeforeReconciliation =
  "Review imported bank activity before reconciling this account so it is not counted again as an adjustment.";

export type BalanceImport = {
  eligibility: ImportEligibility;
  accountId: string | null;
  transactionId?: string;
  date: string;
  amount: number;
  pending: boolean;
  removed: boolean;
  needsMatchReview: boolean;
  error: string | null;
  quarantined: boolean;
  history: readonly {
    before: { providerTransactionId: string } | null;
    after: { providerTransactionId: string } | null;
  }[];
};

// Eligible bank activity can affect an account before its purpose is decided.
// Opening history in review must not count a second time.
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
          matchesManualImport(transaction, item)),
    );
    return (
      (account?.kind === "cash" || account?.kind === "credit") &&
      !importEligibilityIssue(item.eligibility) &&
      !item.transactionId &&
      !item.removed &&
      !item.pending &&
      !item.needsMatchReview &&
      !item.quarantined &&
      !item.error &&
      !recorded &&
      item.date <= cutoff
    );
  });
}
