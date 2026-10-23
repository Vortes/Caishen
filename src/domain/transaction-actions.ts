import type { Budget, Transaction } from "./engine";
import { counterpartyLines } from "./counterparty";
import {
  isTransfer,
  transferCounterparts,
  transferNeedsCategory,
} from "./transfers";

type Action = "edit" | "approve" | "reject" | "categorize";

export const TRANSACTION_ACTION_LIMIT = 500;

type EditOperation = "transaction.upsert" | "transaction.save" | null;
const kindActions: Record<
  Transaction["kind"],
  {
    editOperation: EditOperation;
    reject: boolean;
  }
> = {
  purchase: { editOperation: "transaction.upsert", reject: true },
  income: { editOperation: "transaction.upsert", reject: true },
  refund: { editOperation: "transaction.upsert", reject: true },
  transfer: { editOperation: "transaction.save", reject: true },
  "card-payment": { editOperation: "transaction.save", reject: true },
  "loan-payment": { editOperation: "transaction.save", reject: true },
  reimbursement: { editOperation: null, reject: false },
  "statement-credit": { editOperation: null, reject: false },
  adjustment: { editOperation: null, reject: false },
};

export function transactionEditOperation(
  transaction: Transaction,
): EditOperation {
  return kindActions[transaction.kind].editOperation;
}

// Null means the action is supported. Submitted values and permissions still
// need validation against the current ledger when the action runs.
export function transactionActionIssue(
  budget: Budget,
  transaction: Transaction,
  action: Action,
): string | null {
  if (transaction.removed) return "This transaction was removed";
  const account = budget.accounts.find(
    (account) => account.id === transaction.accountId,
  );
  if (!account) return "Account access denied";
  switch (action) {
    case "edit":
      return transactionEditOperation(transaction)
        ? null
        : "This kind of transaction cannot be edited in the register";
    case "approve":
      return transaction.amount < 0 &&
        transaction.kind === "purchase" &&
        !counterpartyLines(transaction).length &&
        account.kind !== "tracking"
        ? "Categorize purchases before approval"
        : null;
    case "reject": {
      const counterparts = transferCounterparts(budget, transaction);
      if (isTransfer(transaction) && counterparts.length !== 1)
        return "The other side of this transfer is missing or ambiguous";
      for (const item of [transaction, ...counterparts]) {
        if (item.reviewed)
          return "Only unapproved transactions can be rejected";
        if (!kindActions[item.kind].reject)
          return "This transaction cannot be rejected from the register";
      }
      return null;
    }
    case "categorize": {
      if (isTransfer(transaction)) {
        const counterparts = transferCounterparts(budget, transaction);
        if (!counterparts.length)
          return "The other side of this transfer is missing";
        if (counterparts.length !== 1)
          return "The other side of this transfer is missing or ambiguous";
        const other = budget.accounts.find(
          (account) => account.id === counterparts[0]!.accountId,
        );
        if (!other) return "Account access denied";
        return transferNeedsCategory(account, other)
          ? null
          : "This transfer does not use a category";
      }
      if (!["purchase", "income", "refund"].includes(transaction.kind))
        return "Use the dedicated operation for transfers and repayments";
      if (account.kind === "tracking")
        return "Tracking activity does not use budget categories";
      return null;
    }
  }
}

export function transactionShareMode(
  budget: Pick<Budget, "accounts">,
  transaction: Transaction,
): "edit" | null {
  const account = budget.accounts.find(
    (account) => account.id === transaction.accountId,
  );
  if (
    transaction.removed ||
    (account?.kind !== "cash" && account?.kind !== "credit") ||
    (transaction.kind !== "purchase" && transaction.kind !== "refund")
  )
    return null;
  return "edit";
}

export const alreadyLinkedImportMessage =
  "This bank activity is already linked to a budget transaction. Review the existing transaction rather than creating it again.";
export const loanActivityReviewMessage =
  "Review this loan activity with your lender. Record payments using the confirmed principal and interest, then dismiss this update. Loan balances are not changed automatically.";
export const quarantinedImportMessage =
  "This bank transaction wasn't imported. Record it yourself if it affects your budget, then dismiss it.";

type BankImport = {
  accountId: string | null;
  loanId?: string;
  transactionId?: string;
  removed: boolean;
  quarantined: boolean;
};

export function bankImportActionIssue(
  budget: Pick<Budget, "accounts" | "loans">,
  imported: BankImport,
  action: "record" | "link",
): string | null {
  if (imported.quarantined) return quarantinedImportMessage;
  if (
    imported.loanId ||
    budget.loans.some((loan) => loan.id === imported.accountId)
  )
    return loanActivityReviewMessage;
  if (!budget.accounts.some((account) => account.id === imported.accountId))
    return "Map this provider account to your own ledger account first.";
  if (action === "record") {
    if (imported.transactionId) return alreadyLinkedImportMessage;
    if (imported.removed)
      return "This provider record was removed; do not create a new purchase from it.";
  }
  return null;
}
