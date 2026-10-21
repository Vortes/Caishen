import type { Operation } from "fast-json-patch";
import { applyPatch } from "fast-json-patch/commonjs/core.js";
import { compare } from "fast-json-patch/commonjs/duplex.js";
import { z } from "zod";
import {
  AccountingError,
  bookSchema,
  budgetSchema,
  type Command,
  type Transaction,
} from "~/domain/engine";
import { isPersonalLedger, type AccountingState } from "~/domain/shared-ledger";
import { PARTNER_MAINTENANCE_MESSAGE } from "~/domain/stored-book";

export const WORKSPACE_HISTORY_LIMIT = 50;
const HISTORY_BYTE_LIMIT = 2 * 1024 * 1024;

const patchSchema = z.custom<Operation>((input: unknown) => {
  if (typeof input !== "object" || input === null) return false;
  const patch = input as Record<string, unknown>;
  return (
    typeof patch.path === "string" &&
    patch.path.startsWith("/") &&
    (patch.op === "remove" ||
      (["add", "replace", "test"].includes(String(patch.op)) &&
        Object.hasOwn(patch, "value")))
  );
});
const entrySchema = z.object({
  label: z.string().min(1).max(160),
  undo: z.array(patchSchema).min(1),
  redo: z.array(patchSchema).min(1),
});
export const workspaceHistorySchema = z.object({
  actorId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  past: z.array(entrySchema).max(WORKSPACE_HISTORY_LIMIT),
  future: z.array(entrySchema).max(WORKSPACE_HISTORY_LIMIT),
});
type WorkspaceHistory = z.infer<typeof workspaceHistorySchema>;
export type HistoryDirection = "undo" | "redo";

type HistoryAlert = (error: z.ZodError) => void;

function currentHistory(
  value: unknown,
  actorId: string,
  revision: number,
  alert?: HistoryAlert,
): WorkspaceHistory {
  const result = workspaceHistorySchema.safeParse(value);
  if (
    result.success &&
    result.data.actorId === actorId &&
    result.data.revision === revision
  )
    return result.data;
  // Bank changes reset history to {}; anything else that won't read is an
  // alert. Unreadable history only costs undo, so it is replaced.
  if (
    !result.success &&
    value !== null &&
    !(typeof value === "object" && !Object.keys(value).length)
  )
    alert?.(result.error);
  return { actorId, revision, past: [], future: [] };
}

export function historySummary(
  value: unknown,
  actorId: string,
  revision: number,
  alert?: HistoryAlert,
) {
  const history = currentHistory(value, actorId, revision, alert);
  return {
    undo: history.past.at(-1)?.label ?? null,
    redo: history.future.at(-1)?.label ?? null,
  };
}

// What undo restores: the actor's readable budgets and the household's
// shared records, without the audit or transaction bookkeeping. A personal
// ledger, read while the partner's budget is under maintenance, holds only
// the actor's budget.
function historyBook(state: AccountingState) {
  const book = JSON.parse(JSON.stringify(state)) as AccountingState;
  const budgets = isPersonalLedger(book)
    ? { [book.budget.userId]: book.budget }
    : book.budgets;
  return {
    version: 1,
    budgets: Object.fromEntries(
      Object.entries(budgets).map(([userId, budget]) => [
        userId,
        {
          ...budget,
          transactions: budget.transactions
            .filter((transaction) => !transaction.removed)
            .map(transactionFacts),
        },
      ]),
    ),
    sharedCategories: book.sharedCategories,
    obligations: book.obligations,
    settlements: book.settlements,
  };
}

type TransactionFacts = Omit<Transaction, "history" | "revision" | "removed">;

function transactionFacts(transaction: Transaction): TransactionFacts {
  const facts: TransactionFacts &
    Partial<Pick<Transaction, "history" | "revision" | "removed">> =
    structuredClone(transaction);
  delete facts.history;
  delete facts.revision;
  delete facts.removed;
  return facts;
}

function restoreTransactions(
  facts: TransactionFacts[],
  current: Transaction[],
  direction: HistoryDirection,
  operationId: string,
): Transaction[] {
  const previous = new Map(
    current.map((transaction) => [transaction.id, transaction]),
  );
  const restoredIds = new Set(facts.map((transaction) => transaction.id));
  const mark = (transaction: Transaction): Transaction => ({
    ...transaction,
    revision: transaction.revision + 1,
    history: [
      ...transaction.history,
      {
        revision: transaction.revision + 1,
        amount: transaction.amount,
        status: transaction.status,
        date: transaction.date,
        payee: transaction.payee,
        operationId,
        reason: direction === "undo" ? "undone" : "redone",
      },
    ],
  });
  return [
    ...facts.map((transaction) => {
      const before = previous.get(transaction.id);
      if (!before)
        throw new Error("The transaction history could not be restored.");
      if (
        !before.removed &&
        !compare(transactionFacts(before), transaction).length
      )
        return before;
      return mark({
        ...transaction,
        revision: before.revision,
        history: before.history,
      });
    }),
    ...current
      .filter((transaction) => !restoredIds.has(transaction.id))
      .map((transaction) =>
        transaction.removed
          ? transaction
          : mark({ ...transaction, removed: true }),
      ),
  ];
}

const commandLabels = {
  "account.add": "Add account",
  "account.reconcile": "Reconcile account",
  "group.add": "Add category group",
  "category.add": "Add category",
  "category.import": "Import categories",
  assign: "Assign money",
  "assign.batch": "Assign money",
  cover: "Cover overspending",
  "rule.set": "Update standing rule",
  "target.set": "Update category target",
  "target.snooze": "Snooze category target",
  "transaction.upsert": "Save transaction",
  "transaction.save": "Save transaction",
  "transaction.remove": "Delete transaction",
  "transaction.approve": "Approve transactions",
  "transaction.reject": "Reject transactions",
  "transaction.categorize": "Categorize transaction",
  "transaction.categorize.batch": "Categorize transactions",
  "transaction.merge": "Merge transactions",
  "shared.create": "Share category",
  "shared.rule": "Update shared category",
  "shared.remove": "Unshare category",
  "opening.add": "Add opening shared balance",
  "settlement.record": "Record settlement",
  "settlement.receive": "Receive settlement",
  "reimbursement.expect": "Add reimbursement",
  "reimbursement.receive": "Receive reimbursement",
  "card.payment": "Record card payment",
  "card.credit": "Record statement credit",
  "loan.add": "Add loan",
  "loan.rate": "Update loan rate",
  "loan.payment": "Record loan payment",
  "income.expect": "Update expected income",
  "settings.update": "Update budget settings",
} satisfies Record<Command["type"], string>;

export function workspaceChangeLabel(operations: { type: string }[]): string {
  const types = new Set(operations.map((operation) => operation.type));
  if (types.size === 1) {
    const type = operations[0]!.type;
    if (Object.hasOwn(commandLabels, type))
      return commandLabels[type as keyof typeof commandLabels];
  }
  return "Update budget";
}

export function recordWorkspaceHistory(
  value: unknown,
  actorId: string,
  revision: number,
  before: AccountingState,
  after: AccountingState,
  label: string,
  alert?: HistoryAlert,
): WorkspaceHistory {
  const history = currentHistory(value, actorId, revision, alert);
  const previous = historyBook(before);
  const next = historyBook(after);
  const redo = compare(previous, next, true);
  if (!redo.length) return { ...history, revision: revision + 1 };
  const entry = { label, undo: compare(next, previous, true), redo };
  const updated: WorkspaceHistory = {
    actorId,
    revision: revision + 1,
    past: [...history.past, entry].slice(-WORKSPACE_HISTORY_LIMIT),
    future: [],
  };
  while (
    updated.past.length &&
    Buffer.byteLength(JSON.stringify(updated), "utf8") > HISTORY_BYTE_LIMIT
  )
    updated.past.shift();
  return updated;
}

export function restoreWorkspaceHistory<T extends AccountingState>(
  value: unknown,
  actorId: string,
  revision: number,
  current: T,
  direction: HistoryDirection,
  operationId: string,
  alert?: HistoryAlert,
): { book: T; history: WorkspaceHistory } {
  const history = currentHistory(value, actorId, revision, alert);
  const source = direction === "undo" ? history.past : history.future;
  const entry = source.at(-1);
  if (!entry)
    throw new Error(
      direction === "undo"
        ? "There is nothing to undo."
        : "There is nothing to redo.",
    );
  const personal = isPersonalLedger(current);
  let restored: ReturnType<typeof historyBook>;
  try {
    restored = applyPatch(
      historyBook(current),
      structuredClone(entry[direction]),
      true,
      false,
      true,
    ).newDocument;
  } catch (error) {
    // The change also touched the partner's budget, which can't be read now.
    if (personal) throw new AccountingError(PARTNER_MAINTENANCE_MESSAGE);
    throw error;
  }
  const budgets = Object.fromEntries(
    Object.entries(restored.budgets).map(([userId, budget]) => [
      userId,
      {
        ...budget,
        transactions: restoreTransactions(
          budget.transactions,
          (personal
            ? current.budget.userId === userId
              ? current.budget
              : undefined
            : current.budgets[userId]
          )?.transactions ?? [],
          direction,
          operationId,
        ),
      },
    ]),
  );
  const audit = [
    ...current.audit,
    {
      id: operationId,
      actorId,
      source: "user" as const,
      type: `history.${direction}`,
      sequence: current.audit.length + 1,
      fingerprint: JSON.stringify({
        id: operationId,
        type: `history.${direction}`,
      }),
    },
  ];
  let book: AccountingState;
  if (personal) {
    if (Object.keys(budgets).join() !== current.budget.userId)
      throw new AccountingError(PARTNER_MAINTENANCE_MESSAGE);
    book = {
      ...current,
      budget: budgetSchema.parse(budgets[current.budget.userId]),
      sharedCategories: restored.sharedCategories,
      obligations: restored.obligations,
      settlements: restored.settlements,
      audit,
    };
  } else
    book = bookSchema.parse({
      ...restored,
      version: 1,
      budgets,
      audit,
    });
  return {
    book: book as T,
    history: {
      ...history,
      revision: revision + 1,
      past:
        direction === "undo"
          ? history.past.slice(0, -1)
          : [...history.past, entry],
      future:
        direction === "redo"
          ? history.future.slice(0, -1)
          : [...history.future, entry],
    },
  };
}
