import { readAmount } from "~/components/budget/amount";
import { today } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import type { BankImport } from "./import-draft";
import { isCleared, type Command } from "~/domain/engine";
import {
  classifyRegisterEntry,
  directEntryAccounts,
} from "~/domain/register-entry";
import {
  registerPayee,
  transferPayee,
  transferNeedsCategory,
  READY_TO_ASSIGN,
} from "~/domain/transfers";
import { budgetDay } from "~/domain/user-command";
import { reimbursementShareForPayee } from "~/domain/payee-memory";

type Transaction = View["budget"]["transactions"][number];

export type PreparedTransactionChange = {
  rowIds: string[];
  imported?: BankImport;
  command: Command;
  summary: string;
};

export { READY_TO_ASSIGN } from "~/domain/transfers";

// The category list's Split choice, which never names a category.
export const SPLIT = "\u0000split";

export type DraftShare = {
  accountId: string;
  amount: string;
};

// One line of a split: part of the amount, in one category.
export type DraftLine = {
  lineId: string;
  categoryId: string;
  outflow: string;
  inflow: string;
  counterpartyShare?: DraftShare | null;
};

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
  // YNAB's C column. A new transaction starts uncleared, like YNAB's.
  cleared: boolean;
  expenseMonth: string;
  counterpartyShare?: DraftShare | null;
  // Two or more when the amount is split across categories; none otherwise.
  lines: DraftLine[];
};

// A field that can be in error: one of the draft's, one of a split line's,
// or what the split's lines leave unassigned.
export type LineField =
  `lines.${string}.${"categoryId" | "counterpartyShare" | "outflow" | "inflow"}`;
export type DraftFieldKey = keyof TransactionDraft | LineField | "remaining";
export const lineField = (
  lineId: string,
  field: "categoryId" | "counterpartyShare" | "outflow" | "inflow",
): LineField => `lines.${lineId}.${field}`;

export type TransactionDraftFields = Partial<Record<DraftFieldKey, string>>;

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
  const entry = transaction
    ? classifyRegisterEntry(view.budget, transaction)
    : undefined;
  const counterpart =
    entry && "counterpart" in entry.shape ? entry.shape.counterpart : undefined;
  const loan = entry && "loan" in entry.shape ? entry.shape.loan : undefined;
  const payment = loan?.payments.find(
    (item) => item.id === transaction?.linkedId,
  );
  return {
    transferAccountId: counterpart?.accountId ?? "",
    loanId: loan?.id ?? "",
    interest: payment ? (payment.interest / 100).toFixed(2) : "",
    accountId:
      transaction?.accountId ??
      account?.id ??
      directEntryAccounts(view.accounts)[0]?.id ??
      "",
    date: transaction?.date ?? today(view.budget.settings.timezone),
    payee: transaction ? registerPayee(view.budget, transaction) : "",
    categoryId:
      transaction?.categoryId ??
      (transaction?.lines?.length === 1
        ? transaction.lines[0]?.categoryId
        : undefined) ??
      (transaction &&
      !transaction.counterpartyShare &&
      (entry?.fields.budgetSide === "other" && counterpart
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
    cleared: transaction ? isCleared(transaction) : false,
    expenseMonth: transaction?.expenseMonth ?? month,
    counterpartyShare: (() => {
      const share =
        transaction?.counterpartyShare ??
        (transaction?.lines?.length === 1
          ? transaction.lines[0]?.counterpartyShare
          : undefined) ??
        (transaction?.kind === "purchase" &&
        !transaction.categoryId &&
        !transaction.lines?.length
          ? reimbursementShareForPayee(view.budget, transaction)
          : undefined);
      return share
        ? { ...share, amount: (share.amount / 100).toFixed(2) }
        : undefined;
    })(),
    lines: (transaction?.lines?.length === 1
      ? []
      : (transaction?.lines ?? [])
    ).map((line) => ({
      lineId: line.id,
      categoryId: line.categoryId ?? "",
      counterpartyShare: line.counterpartyShare
        ? {
            ...line.counterpartyShare,
            amount: (line.counterpartyShare.amount / 100).toFixed(2),
          }
        : undefined,
      ...amountFields(line.amount),
    })),
  };
}

/** The draft's amount in signed cents, or undefined while it doesn't read. */
// The shares and split lines a draft already carries, so classifying it names
// a shared card inflow a refund rather than a statement credit. Amounts are
// validated later; here they only describe the shape.
export function draftShareFacts(draft: TransactionDraft) {
  const share = (share: DraftShare | null | undefined) =>
    share
      ? {
          accountId: share.accountId,
          amount: parseAmount(share.amount.trim()) ?? 0,
        }
      : undefined;
  return {
    counterpartyShare: share(draft.counterpartyShare),
    lines: draft.lines.length
      ? draft.lines.map((line) => ({
          id: line.lineId,
          categoryId: line.categoryId || undefined,
          amount: draftAmount(line) ?? 0,
          counterpartyShare: share(line.counterpartyShare),
        }))
      : undefined,
  };
}

export function draftAmount(draft: { outflow: string; inflow: string }) {
  const outflow = draft.outflow.trim();
  const inflow = draft.inflow.trim();
  if (outflow && inflow) return undefined;
  if (!outflow && !inflow) return 0;
  const cents = parseAmount(outflow || inflow);
  return cents === undefined ? undefined : outflow ? -cents : cents;
}

/**
 * What a split's lines leave of the amount, in signed cents: negative when
 * outflow is still to be split, positive when inflow is. Undefined while an
 * amount doesn't read.
 */
export function splitRemaining(draft: TransactionDraft) {
  const total = draftAmount(draft);
  const lines = draft.lines.map(draftAmount);
  if (total === undefined || lines.some((line) => line === undefined))
    return undefined;
  return total - lines.reduce<number>((sum, line) => sum + line!, 0);
}

/** Amount fields holding signed cents. */
export function amountFields(cents: number) {
  return {
    outflow: cents < 0 ? (-cents / 100).toFixed(2) : "",
    inflow: cents > 0 ? (cents / 100).toFixed(2) : "",
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
}): Extract<Command, { type: "transaction.upsert" }> {
  const fields: TransactionDraftFields = {};
  const account = view.accounts.find((item) => item.id === draft.accountId);
  const date = draft.date.trim();
  const payee = draft.payee.trim();
  const expenseMonth = draft.expenseMonth.trim();
  const categoryId = draft.categoryId.trim();
  const outflowText = draft.outflow.trim();
  const inflowText = draft.inflow.trim();
  const transfer = Boolean(draft.transferAccountId || draft.loanId);
  const loan = view.budget.loans.find((item) => item.id === draft.loanId);
  const other = view.accounts.find(
    (item) => item.id === draft.transferAccountId,
  );
  const boundary = Boolean(
    account && other && transferNeedsCategory(account, other),
  );
  const entry = account
    ? classifyRegisterEntry(view.budget, {
        id: transaction?.id ?? entityId,
        accountId: account.id,
        date,
        payee,
        amount: draftAmount(draft) ?? 0,
        status: draft.status,
        kind: transaction?.kind === "adjustment" ? "adjustment" : undefined,
        categoryId:
          categoryId === READY_TO_ASSIGN ? undefined : categoryId || undefined,
        transferAccountId: draft.transferAccountId || undefined,
        loanId: draft.loanId || undefined,
        ...draftShareFacts(draft),
      })
    : undefined;
  if (draft.transferAccountId && (!other || other.id === account?.id))
    fields.payee = "Choose a different account.";
  if (draft.loanId && (!loan || !entry?.fields.loanPayment))
    fields.payee = "Choose a loan payment from a cash account.";
  if (draft.loanId && draft.transferAccountId)
    fields.payee = "Choose one destination.";

  if (!account) fields.accountId = "Choose an account.";
  else if (transaction && account.id !== transaction.accountId)
    fields.accountId = "An existing transaction cannot move between accounts.";
  const existingEntry = transaction
    ? classifyRegisterEntry(view.budget, transaction)
    : undefined;
  if (existingEntry && !existingEntry.capabilities.edit.ok)
    fields.accountId = existingEntry.capabilities.edit.reason;
  if (!payee) fields.payee = "Enter a payee.";
  else if (payee.length > 240)
    fields.payee = "Use no more than 240 characters for the payee.";

  if (!isCalendarDate(date)) fields.date = "Enter a valid transaction date.";
  else if (date < `${view.budget.startMonth}-01`)
    fields.date = "The transaction date must be on or after the budget start.";
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
    if (entry?.shape.kind !== "adjustment") {
      fields.outflow = "Enter an outflow or an inflow.";
      fields.inflow = fields.outflow;
    }
  } else if (outflowText) {
    const problem = amountProblem(
      outflowText,
      entry?.shape.kind === "adjustment",
    );
    if (problem) fields.outflow = problem;
    else outflow = parseAmount(outflowText)!;
  } else {
    const problem = amountProblem(
      inflowText,
      entry?.shape.kind === "adjustment",
    );
    if (problem) fields.inflow = problem;
    else inflow = parseAmount(inflowText)!;
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
      entry?.fields.budgetSide === "other"
        ? outflow - inflow
        : inflow - outflow;
    const category = view.categories.find((item) => item.id === categoryId);
    if (categoryId === READY_TO_ASSIGN) {
      if (budgetAmount < 0)
        fields.categoryId = "Choose a category for money leaving your budget.";
    } else if (!category || category.pairedAccountId || category.pairedLoanId)
      fields.categoryId =
        "Choose a category for money entering or leaving your budget.";
  }
  const shareInput = (
    share: DraftShare | null | undefined,
    total: number,
    field: DraftFieldKey,
  ) => {
    if (!share) return share;
    const amount = parseAmount(share.amount.trim());
    if (amount === undefined || amount > Math.abs(total))
      fields[field] = "Enter a share between $0 and the full line amount.";
    // A person added with this share may not be on screen yet; the
    // engine refuses an account that isn't a person's.
    if (!share.accountId) fields[field] = "Choose who this is for.";
    return { ...share, amount: amount ?? 0 };
  };
  const split = draft.lines.length > 0;
  const lines: {
    lineId: string;
    categoryId?: string;
    amount: number;
    counterpartyShare?: ReturnType<typeof shareInput>;
  }[] = [];
  if (split) {
    if (!entry?.fields.split)
      fields.categoryId = "Only a purchase or refund can be split.";
    for (const line of draft.lines) {
      const category = view.categories.find(
        (item) => item.id === line.categoryId,
      );
      const amount = draftAmount(line);
      const fullShare = Boolean(
        amount &&
        line.counterpartyShare &&
        parseAmount(line.counterpartyShare.amount) === Math.abs(amount),
      );
      if (
        (!category && !fullShare) ||
        category?.pairedAccountId ||
        category?.pairedLoanId ||
        category?.counterpartyAccountId
      )
        fields[lineField(line.lineId, "categoryId")] =
          "Choose a category for your part of it.";
      if (line.outflow.trim() && line.inflow.trim())
        fields[lineField(line.lineId, "outflow")] =
          "Enter an outflow or an inflow, not both.";
      else if (amount === undefined)
        fields[lineField(line.lineId, "outflow")] = amountProblem(
          line.outflow.trim() || line.inflow.trim(),
        )!;
      else if (!amount)
        fields[lineField(line.lineId, "outflow")] = "Enter an amount.";
      else
        lines.push({
          lineId: line.lineId,
          categoryId: fullShare ? undefined : line.categoryId,
          amount,
          counterpartyShare: shareInput(
            line.counterpartyShare,
            amount,
            lineField(line.lineId, "counterpartyShare"),
          ),
        });
    }
    const remaining = splitRemaining(draft);
    if (
      lines.length === draft.lines.length &&
      !fields.outflow &&
      remaining !== undefined &&
      remaining !== 0
    )
      fields.remaining =
        "Split the whole amount: the lines must add up to the total.";
  } else if (
    !transfer &&
    entry?.fields.category !== "none" &&
    entry?.shape.kind !== "adjustment"
  ) {
    const category = view.categories.find((item) => item.id === categoryId);
    if (categoryId === READY_TO_ASSIGN) {
      if (outflowText)
        fields.categoryId = "Choose a spending category for an outflow.";
      else if (!entry?.fields.readyToAssign)
        fields.categoryId =
          "Use a card payment or statement credit for card inflows.";
    } else if (
      !categoryId &&
      !(
        draft.counterpartyShare &&
        parseAmount(draft.counterpartyShare.amount) === (inflow || outflow)
      )
    )
      fields.categoryId = "Choose a category for your part of it.";
    else if (
      categoryId &&
      (!category || category.pairedAccountId || category.pairedLoanId)
    )
      fields.categoryId = "Choose a spending category or Ready to Assign.";
    if (
      transaction?.categoryId &&
      !existingEntry?.fields.clearCategory &&
      (categoryId === READY_TO_ASSIGN ||
        (!categoryId &&
          !(
            draft.counterpartyShare &&
            parseAmount(draft.counterpartyShare.amount) === (inflow || outflow)
          )))
    )
      fields.categoryId =
        "An existing category cannot be cleared. Choose a category.";
  }

  const counterpartyShare = shareInput(
    draft.counterpartyShare,
    inflow || -outflow,
    "counterpartyShare",
  );
  if (counterpartyShare && entry?.capabilities.share.mode === "none")
    fields.counterpartyShare = "Shares apply to purchases and refunds.";
  if (Object.keys(fields).length) throw new TransactionDraftError(fields);
  return {
    type: "transaction.upsert",
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
    categoryId: split
      ? undefined
      : boundary
        ? categoryId
        : draft.transferAccountId ||
            entry?.fields.category === "none" ||
            entry?.shape.kind === "adjustment" ||
            categoryId === READY_TO_ASSIGN
          ? undefined
          : categoryId || undefined,
    ...(split ? { lines } : { counterpartyShare }),
    recordedAt: new Date().toISOString(),
    status: draft.status,
    cleared: draft.cleared,
    expenseMonth: expenseMonth || undefined,
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

// Cents from what a person typed, which may be a calculation. The field
// says which way the money goes, so a negative amount doesn't read.
function parseAmount(text: string) {
  const reading = readAmount(text);
  return reading.ok && reading.cents >= 0 ? reading.cents : undefined;
}

// Why the typed amount isn't allowed; adjustments may hold zero.
function amountProblem(text: string, allowZero = false) {
  const reading = readAmount(text);
  if (!reading.ok) return reading.message;
  if (reading.cents < 0 || (!allowZero && reading.cents === 0))
    return "Enter an amount above zero.";
}

export function paymentPayees(view: View, draft: TransactionDraft) {
  const account = view.accounts.find((item) => item.id === draft.accountId);
  if (!account) return [];
  const entry = classifyRegisterEntry(view.budget, {
    id: "payment-choice",
    accountId: account.id,
    date: draft.date,
    payee: draft.payee,
    amount: draftAmount(draft) ?? 0,
  });
  return [
    ...directEntryAccounts(view.accounts)
      .filter((item) => item.id !== account.id)
      .map((other) => {
        const amount = draft.inflow
          ? 1
          : draft.outflow
            ? -1
            : !entry.fields.readyToAssign &&
                classifyRegisterEntry(view.budget, {
                  id: "payment-choice",
                  accountId: other.id,
                  date: draft.date,
                  payee: draft.payee,
                  amount: 0,
                }).fields.loanPayment
              ? 1
              : -1;
        return {
          value: `account:${other.id}`,
          label: transferPayee(account, other, amount),
          accountId: other.id,
          loanId: "",
        };
      }),
    ...(entry.fields.loanPayment
      ? view.budget.loans.map((loan) => ({
          value: `loan:${loan.id}`,
          label: `Payment to ${loan.name}`,
          accountId: "",
          loanId: loan.id,
        }))
      : []),
  ];
}
