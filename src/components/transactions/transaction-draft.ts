import { today } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { isCounterparty, type Command } from "~/domain/engine";
import {
  isTransfer,
  registerPayee,
  transferCounterparts,
  transferPayee,
  transferNeedsCategory,
  READY_TO_ASSIGN,
} from "~/domain/transfers";
import { budgetDay } from "~/domain/user-command";

type Transaction = View["budget"]["transactions"][number];

export { READY_TO_ASSIGN } from "~/domain/transfers";

export type TransactionDraft = {
  accountId: string;
  date: string;
  payee: string;
  transferAccountId: string;
  loanId: string;
  interest: string;
  categoryId: string;
  outflow: string;
  inflow: string;
  status: "pending" | "posted";
  expenseMonth: string;
  sharedCategoryId: string;
  ownShare: string;
};

export type TransactionDraftFields = Partial<
  Record<keyof TransactionDraft, string>
>;

export class TransactionDraftError extends Error {
  readonly fields: TransactionDraftFields;

  constructor(fields: TransactionDraftFields) {
    super(Object.values(fields)[0] ?? "Check your transaction details.");
    this.name = "TransactionDraftError";
    this.fields = fields;
  }
}

export function assertTransactionDraftCurrent(
  initial?: Transaction,
  latest?: Transaction,
  savedOperationId?: string,
): void {
  if (!initial) {
    if (!latest) return;
    if (
      !latest.removed &&
      savedOperationId &&
      latest.history.at(-1)?.operationId === savedOperationId
    )
      return;
    throw new Error(
      "This transaction was already saved. Close this editor and reopen it to review the latest values.",
    );
  }
  if (
    latest &&
    !latest.removed &&
    (latest.revision === initial.revision ||
      (savedOperationId &&
        latest.history.at(-1)?.operationId === savedOperationId))
  )
    return;
  throw new Error(
    "This transaction changed in another session. Close this editor and reopen it to review the latest values.",
  );
}

export function createTransactionDraft(
  view: View,
  month: string,
  transaction?: Transaction,
  defaultAccountId?: string,
): TransactionDraft {
  const account = view.accounts.find(
    (item) => item.id === (transaction?.accountId ?? defaultAccountId),
  );
  const counterpart = transaction
    ? transferCounterparts(view.budget, transaction)[0]
    : undefined;
  const loan =
    transaction?.kind === "loan-payment"
      ? view.budget.loans.find((item) =>
          item.payments.some((payment) => payment.id === transaction.linkedId),
        )
      : undefined;
  const payment = loan?.payments.find(
    (item) => item.id === transaction?.linkedId,
  );
  return {
    transferAccountId: counterpart?.accountId ?? "",
    loanId: loan?.id ?? "",
    interest: payment ? (payment.interest / 100).toFixed(2) : "",
    accountId:
      transaction?.accountId ?? account?.id ?? view.accounts[0]?.id ?? "",
    date: transaction?.date ?? today(view.budget.settings.timezone),
    payee: transaction ? registerPayee(view.budget, transaction) : "",
    categoryId:
      transaction?.categoryId ??
      (transaction &&
      (account?.kind === "tracking" && counterpart
        ? counterpart.amount
        : transaction.amount) > 0
        ? READY_TO_ASSIGN
        : ""),
    outflow:
      transaction && transaction.amount < 0
        ? (-transaction.amount / 100).toFixed(2)
        : "",
    inflow:
      transaction && transaction.amount > 0
        ? (transaction.amount / 100).toFixed(2)
        : "",
    status: transaction?.status ?? "posted",
    expenseMonth: transaction?.expenseMonth ?? month,
    sharedCategoryId: transaction?.sharedCategoryId ?? "",
    ownShare: "",
  };
}

export function buildTransactionDraftCommand({
  draft,
  view,
  transaction,
  operationId,
  entityId,
}: {
  draft: TransactionDraft;
  view: View;
  transaction?: Transaction;
  operationId: string;
  entityId: string;
}): Extract<Command, { type: "transaction.upsert" | "transaction.save" }> {
  const fields: TransactionDraftFields = {};
  const account = view.accounts.find((item) => item.id === draft.accountId);
  const date = draft.date.trim();
  const payee = draft.payee.trim();
  const expenseMonth = draft.expenseMonth.trim();
  const categoryId = draft.categoryId.trim();
  const sharedCategoryId = draft.sharedCategoryId.trim();
  const outflowText = draft.outflow.trim();
  const inflowText = draft.inflow.trim();
  const ownShareText = draft.ownShare.trim();
  const transfer = Boolean(draft.transferAccountId || draft.loanId);
  const loan = view.budget.loans.find((item) => item.id === draft.loanId);
  const other = view.accounts.find(
    (item) => item.id === draft.transferAccountId,
  );
  const boundary = Boolean(
    account && other && transferNeedsCategory(account, other),
  );
  if (draft.transferAccountId && (!other || other.id === account?.id))
    fields.payee = "Choose a different account.";
  if (draft.loanId && (!loan || account?.kind !== "cash"))
    fields.payee = "Choose a loan payment from a cash account.";
  if (draft.loanId && draft.transferAccountId)
    fields.payee = "Choose one destination.";

  if (!account) fields.accountId = "Choose an account.";
  else if (transaction && account.id !== transaction.accountId)
    fields.accountId = "An existing transaction cannot move between accounts.";
  if (
    transaction &&
    ![
      "purchase",
      "refund",
      "income",
      "transfer",
      "card-payment",
      "loan-payment",
    ].includes(transaction.kind)
  )
    fields.accountId = "This transaction cannot be edited in the register.";
  if (!payee) fields.payee = "Enter a payee.";
  else if (payee.length > 240)
    fields.payee = "Use no more than 240 characters for the payee.";

  if (!isCalendarDate(date)) fields.date = "Enter a valid transaction date.";
  else if (date < `${view.budget.startMonth}-01`)
    fields.date = "The transaction date must be on or after the budget start.";
  else if (account && date < account.date)
    fields.date =
      "The transaction date must be on or after the account opening date.";
  else if (date > budgetDay(view.budget.settings.timezone))
    fields.date = "The transaction date must be today or earlier.";

  if (expenseMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(expenseMonth))
    fields.expenseMonth = "Enter a valid expense month.";
  if (draft.status !== "pending" && draft.status !== "posted")
    fields.status = "Choose Pending or Posted.";

  let outflow = 0;
  let inflow = 0;
  if (outflowText && inflowText) {
    fields.outflow = "Enter an outflow or an inflow, not both.";
    fields.inflow = fields.outflow;
  } else if (!outflowText && !inflowText) {
    fields.outflow = "Enter an outflow or an inflow.";
    fields.inflow = fields.outflow;
  } else if (outflowText) {
    const parsed = parseAmount(outflowText);
    if (parsed === undefined || parsed <= 0)
      fields.outflow =
        "Enter a positive amount with no more than two decimal places.";
    else outflow = parsed;
  } else {
    const parsed = parseAmount(inflowText);
    if (parsed === undefined || parsed <= 0)
      fields.inflow =
        "Enter a positive amount with no more than two decimal places.";
    else inflow = parsed;
  }

  if (other && date < other.date)
    fields.date = "The date must be on or after both accounts opened.";
  let interest: number | undefined;
  if (loan) {
    interest = parseAmount(draft.interest.trim());
    if (interest === undefined || interest > outflow)
      fields.interest =
        "Enter confirmed interest between zero and the payment total.";
    if (!outflowText) fields.outflow = "Enter the loan payment as an outflow.";
    if (draft.status !== "posted")
      fields.payee = "Loan payments require confirmed posted activity.";
    if (categoryId !== loan.categoryId)
      fields.categoryId = "Choose the loan's payment category.";
  }
  if (boundary) {
    const budgetAmount =
      account?.kind === "tracking" ? outflow - inflow : inflow - outflow;
    const category = view.categories.find((item) => item.id === categoryId);
    if (categoryId === READY_TO_ASSIGN) {
      if (budgetAmount < 0)
        fields.categoryId = "Choose a category for money leaving your budget.";
    } else if (!category || category.pairedAccountId || category.pairedLoanId)
      fields.categoryId =
        "Choose a category for money entering or leaving your budget.";
  }
  if (!transfer && account?.kind !== "tracking") {
    const category = view.categories.find((item) => item.id === categoryId);
    if (categoryId === READY_TO_ASSIGN) {
      if (outflowText)
        fields.categoryId = "Choose a spending category for an outflow.";
      else if (account?.kind === "credit")
        fields.categoryId =
          "Use a card payment or statement credit for card inflows.";
    } else if (!categoryId) fields.categoryId = "Choose a category.";
    else if (!category || category.pairedAccountId || category.pairedLoanId)
      fields.categoryId = "Choose a spending category or Ready to Assign.";
    if (
      transaction?.categoryId &&
      !isTransfer(transaction) &&
      transaction.kind !== "loan-payment" &&
      (categoryId === READY_TO_ASSIGN || !categoryId)
    )
      fields.categoryId =
        "An existing category cannot be cleared. Choose a category.";
  }
  if (transfer && (sharedCategoryId || transaction?.sharedCategoryId))
    fields.payee =
      "Resolve the shared expense before converting it to a transfer.";
  if (transaction?.sharedCategoryId && !sharedCategoryId)
    fields.sharedCategoryId =
      "An existing shared expense cannot be made personal here.";

  let shares: Record<string, number> | undefined;
  const shared = view.sharedCategories.find(
    (item) => item.id === sharedCategoryId,
  );
  if (sharedCategoryId) {
    if (!shared?.participants.includes(view.budget.userId))
      fields.sharedCategoryId = "Choose one of your shared categories.";
    else if (shared.categoryIds[view.budget.userId] !== categoryId)
      fields.categoryId =
        "Use the personal category paired with this shared expense.";
    if (inflowText)
      fields.sharedCategoryId =
        "Shared merchant refunds need manual investigation in this version.";
  } else if (ownShareText)
    fields.ownShare = "Choose a shared category before overriding your share.";

  if (ownShareText && sharedCategoryId) {
    const ownShare = parseAmount(ownShareText);
    if (ownShare === undefined)
      fields.ownShare =
        "Enter a nonnegative share with no more than two decimal places.";
    else if (ownShare > outflow)
      fields.ownShare = "Your share cannot exceed the full outflow.";
    else if (shared) {
      const others = shared.participants.filter(
        (id) => id !== view.budget.userId,
      );
      const partnerId = others.length === 1 ? others[0] : undefined;
      if (!partnerId)
        fields.sharedCategoryId =
          "Shared expenses require one connected partner.";
      else
        shares = {
          [view.budget.userId]: ownShare,
          [partnerId]: outflow - ownShare,
        };
    }
  }

  if (Object.keys(fields).length) throw new TransactionDraftError(fields);
  return {
    type:
      transfer ||
      (transaction &&
        (isTransfer(transaction) || transaction.kind === "loan-payment"))
        ? "transaction.save"
        : "transaction.upsert",
    ...(transfer
      ? {
          transferAccountId: draft.transferAccountId || undefined,
          loanId: draft.loanId || undefined,
          interest,
        }
      : {}),
    id: operationId,
    transactionId: transaction?.id ?? entityId,
    accountId: account!.id,
    date,
    payee,
    amount: inflow || -outflow,
    categoryId: boundary
      ? categoryId
      : draft.transferAccountId ||
          account?.kind === "tracking" ||
          categoryId === READY_TO_ASSIGN
        ? undefined
        : categoryId,
    status: draft.status,
    expenseMonth: expenseMonth || undefined,
    sharedCategoryId: sharedCategoryId || undefined,
    shares,
    revision: transaction ? transaction.revision + 1 : undefined,
  };
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function parseAmount(value: string) {
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value)) return undefined;
  const [whole = "0", fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : undefined;
}

export function paymentPayees(view: View, draft: TransactionDraft) {
  const account = view.accounts.find((item) => item.id === draft.accountId);
  if (!account) return [];
  return [
    ...view.accounts
      .filter((item) => item.id !== account.id && !isCounterparty(item))
      .map((other) => {
        const amount = draft.inflow
          ? 1
          : draft.outflow
            ? -1
            : account.kind === "credit" && other.kind === "cash"
              ? 1
              : -1;
        return {
          value: `account:${other.id}`,
          label: transferPayee(account, other, amount),
          accountId: other.id,
          loanId: "",
        };
      }),
    ...(account.kind === "cash"
      ? view.budget.loans.map((loan) => ({
          value: `loan:${loan.id}`,
          label: `Payment to ${loan.name}`,
          accountId: "",
          loanId: loan.id,
        }))
      : []),
  ];
}
