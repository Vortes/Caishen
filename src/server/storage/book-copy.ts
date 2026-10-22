import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  bookSchema,
  projectBook,
  type Book,
  type Budget,
} from "~/domain/engine";
import {
  bookToRows,
  foldAssignments,
  rowsToBook,
  rowsToPersonalLedger,
  sameJson,
  type WireRow,
} from "~/domain/rows";
import type { AccountingState } from "~/domain/shared-ledger";
import type { Prisma } from "~/generated/prisma";
import {
  importStateRows,
  importStatesFromRows,
  type ImportRowState,
} from "~/server/services/bank-import-rows";
import { readBankConnection } from "~/server/services/banks";
import {
  loadRows,
  operationIds,
  recordPastOperations,
  replaceRows,
  type Database,
} from "./rows";

// The one-time copy of each household's stored book and bank import state
// into rows (ADR 0006), and the check that the rows hold the same household:
// every month view of every budget, to the cent, and every loan,
// reimbursement, obligation, and settlement, record by record.

type StoredHousehold = {
  workspace: { id: string; revision: number };
  book: Book;
  connections: { id: string; userId: string; state: ImportRowState }[];
  operations: Parameters<typeof recordPastOperations>[2];
};

export type CopyProblem = { workspaceId: string; problem: string };

async function readHousehold(
  db: Database,
  workspaceId: string,
  lock: boolean,
): Promise<StoredHousehold | CopyProblem> {
  // Holds the household and its bank connections still while copying.
  if (lock) {
    await db.$queryRaw`SELECT 1 FROM "Workspace" WHERE id = ${workspaceId} FOR UPDATE`;
    await db.$queryRaw`SELECT 1 FROM "BankConnection" WHERE "clerkUserId" IN (SELECT "clerkUserId" FROM "WorkspaceMember" WHERE "workspaceId" = ${workspaceId}) FOR UPDATE`;
  }
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    include: { members: true, operations: true },
  });
  const parsed = bookSchema.safeParse(workspace.book);
  if (!parsed.success)
    return {
      workspaceId,
      problem: `the stored book can't be read: ${parsed.error.issues[0]?.message}`,
    };
  const book = parsed.data;
  const memberIds = workspace.members.map((member) => member.clerkUserId);
  const connections: StoredHousehold["connections"] = [];
  for (const connection of await db.bankConnection.findMany({
    where: { clerkUserId: { in: memberIds } },
    orderBy: { createdAt: "asc" },
  })) {
    const read = readBankConnection(connection);
    if (read.status === "maintenance")
      return {
        workspaceId,
        problem: `bank connection ${connection.id} can't be read`,
      };
    if (!Object.hasOwn(book.budgets, connection.clerkUserId))
      return {
        workspaceId,
        problem: `bank connection ${connection.id} belongs to a member with no budget`,
      };
    connections.push({
      id: connection.id,
      userId: connection.clerkUserId,
      state: read.state,
    });
  }
  // Operations recorded before the operations table: those saved with
  // their revision, and the rest of the book's command audit, which never
  // recorded one.
  const saved = new Set(workspace.operations.map((op) => op.operationId));
  const operations = [
    ...workspace.operations.map((op) => ({
      operationId: op.operationId,
      actorId: op.actorId,
      source: op.source as Book["audit"][number]["source"],
      type: op.type,
      inputHash: op.commandHash,
      revision: op.revision,
      createdAt: op.createdAt,
    })),
    ...book.audit
      .filter((entry) => !saved.has(entry.id))
      .map((entry) => ({
        operationId: entry.id,
        actorId: entry.actorId,
        source: entry.source,
        type: entry.type,
        // The audit kept the submitted input's canonical JSON, whose hash
        // identifies retries (src/server/services/safety.ts).
        inputHash: createHash("sha256").update(entry.fingerprint).digest("hex"),
        revision: 0,
      })),
  ];
  return {
    workspace: { id: workspace.id, revision: workspace.revision },
    book,
    connections,
    operations,
  };
}

function storedRows(household: StoredHousehold): WireRow[] {
  return [
    ...bookToRows(household.book),
    ...household.connections.flatMap((connection) =>
      importStateRows(connection.userId, connection.id, connection.state),
    ),
  ].map((row) => ({ ...row, revision: household.workspace.revision }));
}

const rowId = (row: WireRow) => `${row.table} ${row.id}`;

function sameRows(left: WireRow[], right: WireRow[]): boolean {
  if (left.length !== right.length) return false;
  const index = new Map(right.map((row) => [rowId(row), row]));
  return left.every((row) => {
    const other = index.get(rowId(row));
    return (
      other?.revision === row.revision &&
      other.deleted === row.deleted &&
      sameJson(other.data, row.data)
    );
  });
}

/**
 * Copies one household's stored book, bank import state, and recorded
 * operations into rows, at the household's revision. Running it again
 * changes nothing unless the stored book changed since.
 */
export async function copyHousehold(
  db: Database,
  workspaceId: string,
): Promise<
  | { status: "copied" | "unchanged"; rows: number; operations: number }
  | CopyProblem
> {
  const run = async (tx: Prisma.TransactionClient) => {
    const household = await readHousehold(tx, workspaceId, true);
    if ("problem" in household) return household;
    const rows = storedRows(household);
    const existing = await loadRows(tx, workspaceId, { includeDeleted: true });
    const unchanged = sameRows(rows, existing);
    if (!unchanged)
      await replaceRows(tx, workspaceId, rows, household.workspace.revision);
    await recordPastOperations(tx, workspaceId, household.operations);
    return {
      status: unchanged ? ("unchanged" as const) : ("copied" as const),
      rows: rows.length,
      operations: household.operations.length,
    };
  };
  return "$transaction" in db
    ? db.$transaction(run, { timeout: 120_000, maxWait: 30_000 })
    : run(db);
}

// Every month a budget's views cover: from its start to the latest month it
// holds anything for, or the current month if later.
function budgetMonths(budget: Budget, currentMonth: string): string[] {
  let latest = currentMonth;
  const consider = (month: string) => {
    if (month > latest) latest = month;
  };
  for (const transaction of budget.transactions) {
    consider(transaction.date.slice(0, 7));
    consider(transaction.expenseMonth);
  }
  for (const assignment of budget.assignments) consider(assignment.month);
  for (const month of Object.keys(budget.expectedIncome)) consider(month);
  const months: string[] = [];
  for (let month = budget.startMonth; month <= latest;) {
    months.push(month);
    const [year, value] = month.split("-").map(Number) as [number, number];
    month =
      value === 12
        ? `${year + 1}-01`
        : `${year}-${String(value + 1).padStart(2, "0")}`;
  }
  return months;
}

// A month view, without the command audit, which moved to operations, and
// with the budget's assignments folded as rows store them (month figures
// only ever sum them).
function view(
  state: AccountingState,
  userId: string,
  month: string,
  currentMonth: string,
) {
  const rest: Partial<ReturnType<typeof projectBook>> &
    Pick<ReturnType<typeof projectBook>, "budget"> = projectBook(
    state,
    userId,
    month,
    currentMonth,
  );
  delete rest.audit;
  return JSON.parse(
    JSON.stringify({
      ...rest,
      budget: {
        ...rest.budget,
        assignments: foldAssignments(rest.budget.assignments),
      },
    }),
  ) as unknown;
}

export type Verification = {
  workspaceId: string;
  rows: number;
  rowsByTable: Partial<Record<WireRow["table"], number>>;
  budgets: number;
  monthViews: number;
  records: number;
  mismatches: string[];
};

/**
 * Compares a household's rows with its stored book and bank import state.
 * Every difference is a mismatch; a copy is good only with none.
 */
export async function verifyHousehold(
  db: Database,
  workspaceId: string,
  currentMonth: string,
): Promise<Verification | CopyProblem> {
  const household = await readHousehold(db, workspaceId, false);
  if ("problem" in household) return household;
  const { book } = household;
  const rows = await loadRows(db, workspaceId);
  const result: Verification = {
    workspaceId,
    rows: rows.length,
    rowsByTable: {},
    budgets: 0,
    monthViews: 0,
    records: 0,
    mismatches: [],
  };
  for (const row of rows)
    result.rowsByTable[row.table] = (result.rowsByTable[row.table] ?? 0) + 1;
  const mismatch = (what: string) => result.mismatches.push(what);
  const compare = (what: string, expected: unknown, actual: unknown) => {
    result.records++;
    if (!sameJson(expected, actual)) mismatch(what);
  };
  if (!sameRows(storedRows(household), rows))
    mismatch("the rows differ from the stored book's rows");
  const restored = rowsToBook(rows);
  for (const budget of Object.values(book.budgets)) {
    result.budgets++;
    const userId = budget.userId;
    const copy = restored.budgets[userId];
    if (!copy) {
      mismatch(`budget ${userId} is missing`);
      continue;
    }
    const ledger = rowsToPersonalLedger(
      await loadRows(db, workspaceId, { viewerId: userId }),
      userId,
    );
    for (const month of budgetMonths(budget, currentMonth)) {
      const expected = view(book, userId, month, currentMonth);
      result.monthViews += 2;
      if (
        !isDeepStrictEqual(
          expected,
          view(restored, userId, month, currentMonth),
        )
      )
        mismatch(`budget ${userId} month ${month} differs`);
      if (
        !isDeepStrictEqual(expected, view(ledger, userId, month, currentMonth))
      )
        mismatch(
          `budget ${userId} month ${month} differs in its partner's rows`,
        );
    }
    const records = <T extends { id: string }>(
      kind: string,
      expected: T[],
      actual: T[],
    ) => {
      if (expected.length !== actual.length)
        mismatch(
          `budget ${userId} has ${actual.length} ${kind}, not ${expected.length}`,
        );
      expected.forEach((item, index) =>
        compare(`budget ${userId} ${kind} ${item.id}`, item, actual[index]),
      );
    };
    records("loans", budget.loans, copy.loans);
    records("reimbursements", budget.reimbursements, copy.reimbursements);
    // Everything else the budget holds; assignments are stored folded.
    compare(
      `budget ${userId}`,
      { ...budget, assignments: foldAssignments(budget.assignments) },
      copy,
    );
  }
  const records = <T extends { id: string }>(
    kind: string,
    expected: T[],
    actual: T[],
  ) => {
    if (expected.length !== actual.length)
      mismatch(`${actual.length} ${kind}, not ${expected.length}`);
    expected.forEach((item, index) =>
      compare(`${kind} ${item.id}`, item, actual[index]),
    );
  };
  // Opening obligations are stored; the rest are derived from purchases.
  records("obligations", book.obligations, restored.obligations);
  records("settlements", book.settlements, restored.settlements);
  records(
    "shared categories",
    book.sharedCategories,
    restored.sharedCategories,
  );
  const states = importStatesFromRows(rows);
  for (const connection of household.connections) {
    const { records: imports, resolved, errors, reviews } = connection.state;
    compare(
      `bank connection ${connection.id} import state`,
      { records: imports, resolved, errors, reviews },
      states.get(connection.id) ?? {
        records: [],
        resolved: {},
        errors: {},
        reviews: {},
      },
    );
  }
  const recorded = new Set(await operationIds(db, workspaceId));
  for (const operation of household.operations) {
    result.records++;
    if (!recorded.has(operation.operationId))
      mismatch(`operation ${operation.operationId} isn't recorded`);
  }
  return result;
}
