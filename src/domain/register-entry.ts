import type { Account, Budget, Loan, Transaction } from "./engine";
import { counterpartyLines } from "./counterparty";
import {
  isTransfer,
  transferCounterparts,
  transferNeedsCategory,
} from "./transfers";

export const TRANSACTION_ACTION_LIMIT = 500;

type RegisterBudget = Pick<Budget, "accounts" | "loans" | "transactions">;

export const alreadyLinkedImportMessage =
  "This bank activity is already linked to a budget transaction. Review the existing transaction rather than creating it again.";
export const loanActivityReviewMessage =
  "Review this loan activity with your lender. Record payments using the confirmed principal and interest, then dismiss this update. Loan balances are not changed automatically.";
export const quarantinedImportMessage =
  "This bank transaction wasn't imported. Record it yourself if it affects your budget, then dismiss it.";

export type BankInboxItem = {
  eligibility: ImportEligibility;
  accountId: string | null;
  loanId?: string;
  transactionId?: string;
  removed: boolean;
  quarantined: boolean;
  amount: number;
  pending: boolean;
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
  const eligibilityIssue = importEligibilityIssue(imported.eligibility);
  if (eligibilityIssue) return eligibilityIssue;
  if (
    imported.loanId ||
    budget.loans.some((loan) => loan.id === imported.accountId)
  )
    return loanActivityReviewMessage;
  if (!budget.accounts.some((account) => account.id === imported.accountId))
    return unmappedImportMessage;
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
  enter: Capability;
  reject: Capability;
  remove: Capability;
  categorize: Capability;
  share: { mode: "edit" } | { mode: "none" };
  record: Capability;
  link: Capability;
};
// The intrinsic structure of a transaction: what it is, before any rule about
// what the register may do with it. Every capability below is derived from
// this shape, the account it sits on, and the transaction's own flags.
export type TransactionShape =
  // uncategorized: neither a purpose category nor any share is recorded yet.
  | {
      kind: "purchase";
      share: ShareState;
      split: boolean;
      uncategorized: boolean;
    }
  | { kind: "income" }
  | { kind: "refund"; share: ShareState }
  // counterpart is the single other side; null when it is missing or
  // ambiguous. counterparts lists everything that matched.
  | {
      kind: "transfer";
      counterpart: Transaction | null;
      counterparts: Transaction[];
    }
  | {
      kind: "card-payment";
      counterpart: Transaction | null;
      counterparts: Transaction[];
    }
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
type RegisterTransactionInput = Pick<
  Transaction,
  "id" | "accountId" | "date" | "amount" | "payee"
> &
  Partial<
    Omit<Transaction, "id" | "accountId" | "date" | "amount" | "payee">
  > & { transferAccountId?: string; loanId?: string };

export type RegisterEntry =
  | {
      origin: "transaction";
      shape: TransactionShape;
      transaction: Transaction;
      account: Account;
      capabilities: Capabilities;
      fields: {
        category: "purpose" | "none" | "boundary" | "payment";
        split: boolean;
        needsCategory: boolean;
        clearCategory: boolean;
        readyToAssign: boolean;
        budgetAmount: number;
        budgetSide: "here" | "other";
        loanPayment: boolean;
        repayment: boolean;
      };
    }
  | {
      origin: "import";
      eligibility: ImportEligibility;
      item: BankInboxItem;
      capabilities: Capabilities;
    };
export const splitPurchaseAmountMessage =
  "Change a split purchase's amounts on the purchase itself";
export const purposeCategoryMessage =
  "Choose a purpose category for your part of it";
const removedMessage = "This transaction was removed";
const otherSideMissingMessage = "The other side of this transfer is missing";
const otherSideAmbiguousMessage =
  "The other side of this transfer is missing or ambiguous";

const capability = (reason: string | null): Capability =>
  reason ? { ok: false, reason } : { ok: true };
const unavailable: Capability = {
  ok: false,
  reason: "This action does not apply to this register entry",
};

// Shapes the register edits and rejects. The others are written by the
// engine as consequences of something else: a repayment or statement credit.
const registerShapes: Record<TransactionShape["kind"], boolean> = {
  purchase: true,
  income: true,
  refund: true,
  transfer: true,
  "card-payment": true,
  "loan-payment": true,
  reimbursement: false,
  "statement-credit": false,
  adjustment: true,
};
// Shapes whose purpose category is set directly on the entry.
const categorizedShapes: Record<TransactionShape["kind"], boolean> = {
  purchase: true,
  income: true,
  refund: true,
  transfer: false,
  "card-payment": false,
  "loan-payment": false,
  reimbursement: false,
  "statement-credit": false,
  adjustment: false,
};

function shapeOf(
  budget: RegisterBudget,
  item: Transaction,
  loan: Loan | undefined,
): TransactionShape {
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
  switch (item.kind) {
    case "purchase":
      return {
        kind: item.kind,
        share,
        split: Boolean(item.lines?.length),
        uncategorized: lines.length === 0,
      };
    case "refund":
      return { kind: item.kind, share };
    case "transfer":
    case "card-payment": {
      const counterparts = transferCounterparts(budget, item);
      return {
        kind: item.kind,
        counterpart: counterparts.length === 1 ? counterparts[0]! : null,
        counterparts,
      };
    }
    case "loan-payment":
      return { kind: item.kind, loan: loan ?? null };
    default:
      return { kind: item.kind };
  }
}

function transactionCapabilities(
  budget: RegisterBudget,
  item: Transaction,
  account: Account,
  shape: TransactionShape,
): Capabilities {
  const removed = item.removed ? removedMessage : null;
  const counterparts = "counterparts" in shape ? shape.counterparts : [];

  const edit = (): EditCapability => {
    if (removed) return { ok: false, reason: removed };
    if (!directAccountKinds[account.kind])
      return { ok: false, reason: directEntryAccountMessage };
    if (
      !registerShapes[shape.kind] &&
      !(shape.kind === "statement-credit" && item.status === "pending")
    )
      return {
        ok: false,
        reason: "This kind of transaction cannot be edited in the register",
      };
    return { ok: true, command: "transaction.upsert" };
  };

  const approve = (): string | null =>
    removed ??
    (shape.kind === "purchase" &&
    item.amount < 0 &&
    shape.uncategorized &&
    account.kind !== "tracking"
      ? "Categorize purchases before approval"
      : null);

  const reject = (): string | null => {
    if (removed) return removed;
    if ("counterparts" in shape && counterparts.length !== 1)
      return otherSideAmbiguousMessage;
    for (const side of [item, ...counterparts]) {
      if (side.reviewed) return "Only unapproved transactions can be rejected";
      if (!registerShapes[side.kind])
        return "This transaction cannot be rejected from the register";
    }
    return null;
  };

  const categorize = (): string | null => {
    if (removed) return removed;
    if ("counterparts" in shape) {
      if (!counterparts.length) return otherSideMissingMessage;
      if (!shape.counterpart) return otherSideAmbiguousMessage;
      const other = budget.accounts.find(
        (candidate) => candidate.id === shape.counterpart!.accountId,
      );
      if (!other) return "Account access denied";
      return transferNeedsCategory(account, other)
        ? null
        : "This transfer does not use a category";
    }
    if (!categorizedShapes[shape.kind])
      return "Use the dedicated operation for transfers and repayments";
    if (account.kind === "tracking")
      return "Tracking activity does not use budget categories";
    return null;
  };

  const share = (): Capabilities["share"] => {
    if (
      removed ||
      (account.kind !== "cash" && account.kind !== "credit") ||
      (shape.kind !== "purchase" && shape.kind !== "refund")
    )
      return { mode: "none" };
    return { mode: "edit" };
  };

  return {
    edit: edit(),
    approve: capability(approve()),
    enter: unavailable,
    reject: capability(reject()),
    remove: capability(
      removed ??
        (["purchase", "refund", "income", "adjustment"].includes(shape.kind)
          ? null
          : "Dedicated payment records cannot be deleted through transaction removal"),
    ),
    categorize: capability(categorize()),
    share: share(),
    record: unavailable,
    link: unavailable,
  };
}

export function classifyRegisterEntry(
  budget: RegisterBudget,
  item: RegisterTransactionInput,
): Extract<RegisterEntry, { origin: "transaction" }>;
export function classifyRegisterEntry(
  budget: RegisterBudget,
  item: BankInboxItem,
): Extract<RegisterEntry, { origin: "import" }>;
export function classifyRegisterEntry(
  budget: RegisterBudget,
  item: RegisterTransactionInput | BankInboxItem,
): RegisterEntry;
export function classifyRegisterEntry(
  budget: RegisterBudget,
  input: RegisterTransactionInput | BankInboxItem,
): RegisterEntry {
  if ("quarantined" in input) {
    const item = input;
    const record = capability(bankImportActionIssue(budget, item, "record"));
    const account = budget.accounts.find(
      (account) => account.id === item.accountId,
    );
    const review = capability(
      !record.ok
        ? record.reason
        : (item.error ??
            (item.needsMatchReview || item.partnerMatches?.length
              ? "Review the possible match before recording this bank activity"
              : null)),
    );
    return {
      origin: "import",
      item,
      eligibility: item.eligibility,
      capabilities: {
        edit: { ok: false, reason: "Record this bank activity first" },
        approve: item.pending
          ? capability("Use Enter now for pending bank activity")
          : review,
        enter: item.pending
          ? review
          : capability("Posted bank activity uses Approve"),
        reject: record,
        remove: unavailable,
        categorize:
          record.ok &&
          (account?.kind === "cash" || account?.kind === "credit") &&
          !item.error &&
          !item.needsMatchReview &&
          !item.partnerMatches?.length
            ? record
            : unavailable,
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
    (account) => account.id === input.accountId,
  );
  if (!account) throw new Error("Account access denied");
  const destination =
    "transferAccountId" in input
      ? budget.accounts.find(
          (account) => account.id === input.transferAccountId,
        )
      : undefined;
  const loan = budget.loans.find(
    (loan) =>
      ("loanId" in input && loan.id === input.loanId) ||
      loan.payments.some((payment) => payment.id === input.linkedId),
  );
  const sending = input.amount < 0 ? account : destination;
  const receiving = input.amount < 0 ? destination : account;
  const item: Transaction = {
    ...input,
    kind:
      input.kind ??
      (loan
        ? "loan-payment"
        : destination
          ? sending?.kind === "cash" && receiving?.kind === "credit"
            ? "card-payment"
            : "transfer"
          : input.amount < 0
            ? "purchase"
            : input.categoryId || input.lines || input.counterpartyShare
              ? "refund"
              : account.kind === "credit"
                ? "statement-credit"
                : "income"),
    status: input.status ?? "posted",
    revision: input.revision ?? 1,
    history: input.history ?? [],
    reviewed: input.reviewed ?? false,
    expenseMonth: input.expenseMonth ?? input.date.slice(0, 7),
  };
  const shape = shapeOf(budget, item, loan);
  const counterpart = "counterpart" in shape ? shape.counterpart : null;
  const other =
    destination ??
    budget.accounts.find((account) => account.id === counterpart?.accountId);
  const boundary = Boolean(other && transferNeedsCategory(account, other));
  const category = isTransfer(item)
    ? boundary
      ? "boundary"
      : "none"
    : shape.kind === "loan-payment"
      ? "payment"
      : account.kind === "tracking" ||
          (shape.kind === "adjustment" && account.kind !== "cash")
        ? "none"
        : "purpose";
  return {
    origin: "transaction",
    transaction: item,
    account,
    shape,
    fields: {
      category,
      split:
        (shape.kind === "purchase" || shape.kind === "refund") &&
        category === "purpose",
      needsCategory:
        shape.kind === "purchase" &&
        shape.share === "none" &&
        !item.categoryId &&
        !item.lines &&
        account.kind !== "tracking",
      clearCategory:
        isTransfer(item) || shape.kind === "loan-payment" || !item.categoryId,
      readyToAssign: boundary || account.kind !== "credit",
      budgetAmount: account.kind === "tracking" ? -item.amount : item.amount,
      budgetSide: account.kind === "tracking" ? "other" : "here",
      loanPayment: account.kind === "cash",
      repayment: Boolean(item.linkedCounterpartyAccountId),
    },
    capabilities: transactionCapabilities(budget, item, account, shape),
  };
}

export const directEntryAccountMessage =
  "Entries on Partner and Reimbursements come from shares and settlements, not from the register";
/** What a former partner's account is called when their name isn't known. */
export const FORMER_PARTNER = "Former partner";
export const accountKindLabels: Record<Account["kind"], string> = {
  cash: "Cash",
  credit: "Credit",
  tracking: "Tracking",
  partner: "Partner",
  reimbursements: "Reimbursements",
  "former-partner": FORMER_PARTNER,
};
const directAccountKinds: Record<Account["kind"], boolean> = {
  cash: true,
  credit: true,
  tracking: true,
  partner: false,
  reimbursements: false,
  "former-partner": false,
};
export function directEntryAccounts<T extends Account>(accounts: T[]): T[] {
  return accounts.filter((account) => directAccountKinds[account.kind]);
}

export const openingSnapshotChangedMessage =
  "This activity may already be included in this account's opening balance. Investigate the bank's changes or uncertain matches before recording an adjustment; importing it could count it twice.";
export const beforeStartMessage =
  "This activity is already included in the opening balance or predates the import start date. Ignore it rather than duplicating opening history.";
export const openingSnapshotMessage = beforeStartMessage;
export const unmappedImportMessage =
  "Map this provider account to your own ledger account first.";
export function importEligibilityIssue(
  eligibility: ImportEligibility,
): string | null {
  switch (eligibility) {
    case "eligible":
      return null;
    case "before_start":
      return beforeStartMessage;
    case "opening_snapshot":
      return openingSnapshotMessage;
    case "opening_snapshot_changed":
      return openingSnapshotChangedMessage;
    case "loan_activity":
      return loanActivityReviewMessage;
    case "unmapped":
      return unmappedImportMessage;
  }
}
