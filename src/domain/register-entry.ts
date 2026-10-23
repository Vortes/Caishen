import type { Account, Budget, Loan, Transaction } from "./engine";
import { counterpartyLines } from "./counterparty";
import {
  isTransfer,
  transferCounterparts,
  transferNeedsCategory,
} from "./transfers";

type Action = "edit" | "approve" | "reject" | "categorize" | "refund";

type RegisterBudget = Pick<Budget, "accounts" | "loans" | "transactions">;

type EditOperation = "transaction.upsert" | null;
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
  transfer: { editOperation: "transaction.upsert", reject: true },
  "card-payment": { editOperation: "transaction.upsert", reject: true },
  "loan-payment": { editOperation: "transaction.upsert", reject: true },
  reimbursement: { editOperation: null, reject: false },
  "statement-credit": { editOperation: null, reject: false },
  adjustment: { editOperation: null, reject: false },
};

function transactionEditOperation(transaction: Transaction): EditOperation {
  return kindActions[transaction.kind].editOperation;
}

// Null means the action is supported. Submitted values and permissions still
// need validation against the current ledger when the action runs.
function transactionActionIssue(
  budget: RegisterBudget,
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
      if (!directAccountKinds[account.kind]) return directEntryAccountMessage;
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
      if (
        budget.transactions.some(
          (item) =>
            !item.removed && item.refundOfTransactionId === transaction.id,
        )
      )
        return "Remove linked refunds before rejecting their purchase";
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
      return transaction.refundOfTransactionId
        ? "Edit the original purchase to change linked refund categories"
        : null;
    }
    case "refund":
      return transaction.kind === "purchase" && transaction.amount < 0
        ? null
        : "Link refunds to an original purchase";
  }
}

function transactionShareMode(
  budget: Pick<Budget, "accounts">,
  transaction: Transaction,
): "edit" | "read" | null {
  const account = budget.accounts.find(
    (account) => account.id === transaction.accountId,
  );
  if (
    transaction.removed ||
    (account?.kind !== "cash" && account?.kind !== "credit") ||
    (transaction.kind !== "purchase" && transaction.kind !== "refund")
  )
    return null;
  return transaction.refundOfTransactionId ? "read" : "edit";
}

export const alreadyLinkedImportMessage =
  "This bank activity is already linked to a budget transaction. Review the existing transaction rather than creating it again.";
export const loanActivityReviewMessage =
  "Review this loan activity with your lender. Record payments using the confirmed principal and interest, then dismiss this update. Loan balances are not changed automatically.";
export const quarantinedImportMessage =
  "This bank transaction wasn't imported. Record it yourself if it affects your budget, then dismiss it.";

export type BankInboxItem = {
  accountId: string | null;
  loanId?: string;
  transactionId?: string;
  removed: boolean;
  quarantined: boolean;
  amount: number;
  categoryId?: string | null;
  payee?: string;
  error?: string | null;
  needsMatchReview?: boolean;
  partnerMatches?: readonly unknown[];
};

function bankImportActionIssue(
  budget: Pick<Budget, "accounts" | "loans">,
  imported: BankInboxItem,
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

export type ShareState = "none" | "partial" | "full";
export type Capability = { ok: true } | { ok: false; reason: string };
export type EditCapability =
  { ok: true; command: "transaction.upsert" } | { ok: false; reason: string };
export type Capabilities = {
  edit: EditCapability;
  approve: Capability;
  reject: Capability;
  categorize: Capability;
  refund: Capability;
  share: { mode: "edit" } | { mode: "read"; reason: string } | { mode: "none" };
  record: Capability;
  link: Capability;
};
export type TransactionShape =
  | { kind: "purchase"; share: ShareState; split: boolean }
  | { kind: "income" }
  | { kind: "refund"; share: ShareState; linkedTo: string | null }
  | { kind: "transfer"; counterpart: Transaction | null }
  | { kind: "card-payment"; counterpart: Transaction | null }
  | { kind: "loan-payment"; loan: Loan | null }
  | { kind: "reimbursement" }
  | { kind: "statement-credit" }
  | { kind: "adjustment" };
export type ImportEligibility =
  | "eligible"
  | "before_start"
  | "opening_snapshot"
  | "opening_snapshot_changed"
  | "loan_activity"
  | "unmapped";
export type RegisterEntry =
  | {
      origin: "transaction";
      shape: TransactionShape;
      transaction: Transaction;
      account: Account;
      capabilities: Capabilities;
    }
  | {
      origin: "import";
      eligibility: ImportEligibility;
      item: BankInboxItem;
      capabilities: Capabilities;
    };
export const linkedRefundShareMessage =
  "A linked refund's share follows its purchase. Change the purchase";
export const splitPurchaseAmountMessage =
  "Change a split purchase's amounts on the purchase itself";
export const purposeCategoryMessage =
  "Choose a purpose category for your part of it";

const capability = (reason: string | null): Capability =>
  reason ? { ok: false, reason } : { ok: true };
const unavailable: Capability = {
  ok: false,
  reason: "This action does not apply to this register entry",
};

export function classifyRegisterEntry(
  budget: RegisterBudget,
  item: Transaction | BankInboxItem,
): RegisterEntry {
  if (!("kind" in item)) {
    const record = capability(bankImportActionIssue(budget, item, "record"));
    const account = budget.accounts.find(
      (account) => account.id === item.accountId,
    );
    return {
      origin: "import",
      item,
      eligibility: item.loanId
        ? "loan_activity"
        : account
          ? "eligible"
          : "unmapped",
      capabilities: {
        edit: { ok: false, reason: "Record this bank activity first" },
        approve: unavailable,
        reject: unavailable,
        categorize: unavailable,
        refund: unavailable,
        record,
        link: capability(bankImportActionIssue(budget, item, "link")),
        share:
          record.ok &&
          (account?.kind === "cash" || account?.kind === "credit") &&
          !item.error &&
          !item.needsMatchReview &&
          !item.partnerMatches?.length &&
          (item.amount < 0 ||
            (item.amount > 0 &&
              Boolean(item.categoryId) &&
              item.categoryId !== "__ready_to_assign__"))
            ? { mode: "edit" }
            : { mode: "none" },
      },
    };
  }
  const account = budget.accounts.find(
    (account) => account.id === item.accountId,
  );
  if (!account) throw new Error("Account access denied");
  const lines = counterpartyLines(item);
  const totalShare = lines.reduce(
    (total, line) => total + (line.counterpartyShare?.amount ?? 0),
    0,
  );
  const share: ShareState =
    totalShare === 0
      ? "none"
      : totalShare === Math.abs(item.amount)
        ? "full"
        : "partial";
  let shape: TransactionShape;
  switch (item.kind) {
    case "purchase":
      shape = { kind: item.kind, share, split: Boolean(item.lines?.length) };
      break;
    case "refund":
      shape = {
        kind: item.kind,
        share,
        linkedTo: item.refundOfTransactionId ?? null,
      };
      break;
    case "transfer":
    case "card-payment":
      shape = {
        kind: item.kind,
        counterpart: transferCounterparts(budget, item)[0] ?? null,
      };
      break;
    case "loan-payment":
      shape = {
        kind: item.kind,
        loan:
          budget.loans.find((loan) =>
            loan.payments.some((payment) => payment.id === item.linkedId),
          ) ?? null,
      };
      break;
    default:
      shape = { kind: item.kind };
  }
  const edit = transactionActionIssue(budget, item, "edit");
  const shareMode = transactionShareMode(budget, item);
  return {
    origin: "transaction",
    transaction: item,
    account,
    shape,
    capabilities: {
      edit: edit
        ? { ok: false, reason: edit }
        : { ok: true, command: "transaction.upsert" },
      approve: capability(transactionActionIssue(budget, item, "approve")),
      reject: capability(transactionActionIssue(budget, item, "reject")),
      categorize: capability(
        transactionActionIssue(budget, item, "categorize"),
      ),
      refund: capability(transactionActionIssue(budget, item, "refund")),
      share:
        shareMode === "read"
          ? { mode: "read", reason: linkedRefundShareMessage }
          : { mode: shareMode ?? "none" },
      record: unavailable,
      link: unavailable,
    },
  };
}

export const directEntryAccountMessage =
  "Entries on Partner and Reimbursements come from shares and settlements, not from the register";
export const accountKindLabels: Record<Account["kind"], string> = {
  cash: "Cash",
  credit: "Credit",
  tracking: "Tracking",
  partner: "Partner",
  reimbursements: "Reimbursements",
};
const directAccountKinds: Record<Account["kind"], boolean> = {
  cash: true,
  credit: true,
  tracking: true,
  partner: false,
  reimbursements: false,
};
export function directEntryAccounts<T extends Account>(accounts: T[]): T[] {
  return accounts.filter((account) => directAccountKinds[account.kind]);
}
