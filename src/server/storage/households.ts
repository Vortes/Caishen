import { applyChangeSet, rowsIn, toRowSet } from "~/domain/change-sets";
import {
  budgetReferenceIssues,
  sharedCategoryReferencesValid,
  type Book,
  type Budget,
} from "~/domain/engine";
import { rowIssues } from "~/domain/row-schemas";
import {
  rowKeyParts,
  rowOwner,
  rowsToBook,
  rowsToPersonalLedger,
  rowVisibleTo,
  tombstone,
  type ChangeSet,
  type RowSet,
  type TableName,
  type WireRow,
} from "~/domain/rows";
import type { PersonalLedger } from "~/domain/shared-ledger";
import type { Prisma, PrismaClient } from "~/generated/prisma";
import {
  loadHouseholdRows,
  writeChangeSet,
  type Database,
  type OperationRecord,
  type StoredIssue,
  type UnreadableRow,
} from "./rows";

// Each household's rows, kept in memory per server process (ADR 0006). A
// request loads only the rows changed since the revision held here, which
// is one small query, instead of the whole household. Another server
// instance may have written since: every write is checked against the
// stored revision, so a stale copy here can only make a write retry, never
// lose a change.

export type StoredDataIssue = StoredIssue;

/** A part of the household that can't be read, and why. */
export type StoredDataFailure = (
  | { part: "household" }
  | { part: "budget"; ownerId: string }
  | { part: "partner-facts"; viewerId: string }
) & { issues: StoredDataIssue[] };

export type Household = {
  workspaceId: string;
  revision: number;
  /** Browsers holding a revision older than this must download everything. */
  resetRevision: number;
  /** Every row that reads, deleted rows included once seen deleted. */
  rows: RowSet;
  /** Rows that don't read, by table and id. */
  unreadable: ReadonlyMap<string, UnreadableRow>;
};

/**
 * One partner's view of the household. Ready with the whole household when
 * everything reads; ready with their personal ledger when only their
 * partner's budget doesn't; under maintenance when their own numbers can't
 * be trusted.
 */
export type HouseholdLedger =
  | {
      status: "ready";
      state: Book | PersonalLedger;
      budget: Budget;
      /** The partner's budget doesn't read; the state is a personal ledger. */
      personal: boolean;
      failures: StoredDataFailure[];
    }
  | { status: "maintenance"; failures: StoredDataFailure[] };

const unreadableKey = (row: Pick<WireRow, "table" | "id">) =>
  `${row.table} ${row.id}`;

// Splits rows into those that read and those that don't. A row reads when
// its columns hold valid values and its data matches its table's schema.
function readRows(rows: WireRow[], unreadable: UnreadableRow[]) {
  const readable: WireRow[] = [];
  const failed = new Map(unreadable.map((row) => [unreadableKey(row), row]));
  for (const row of rows) {
    const issues = rowIssues(row);
    if (!issues) readable.push(row);
    else
      failed.set(unreadableKey(row), {
        table: row.table,
        id: row.id,
        issues: issues.map(({ path, code, message }) => ({
          path,
          code,
          message,
        })),
      });
  }
  return { readable, failed };
}

const rowCount = (household: Household) =>
  [...household.rows.values()].reduce((total, table) => total + table.size, 0);

/**
 * The households one server process holds in memory, least recently used
 * first out. Each is replaced, never changed, so a request keeps a
 * consistent copy while others move on.
 */
export class HouseholdCache {
  private readonly households = new Map<string, Household>();
  private readonly workspaceOf = new Map<string, string>();

  constructor(private readonly limits = { households: 8, rows: 400_000 }) {}

  /**
   * The household of a member, as of now, or null when they have none.
   * Reads only the rows changed since the copy held in memory, if any.
   */
  async load(db: Database, userId: string): Promise<Household | null> {
    const workspaceId = this.workspaceOf.get(userId);
    const held = workspaceId ? this.households.get(workspaceId) : undefined;
    let loaded = await loadHouseholdRows(
      db,
      userId,
      held && { workspaceId: held.workspaceId, since: held.revision },
    );
    // The stored household is older than the copy here: it was restored.
    if (loaded?.since !== undefined && loaded.revision < held!.revision)
      loaded = await loadHouseholdRows(db, userId);
    if (!loaded) {
      this.workspaceOf.delete(userId);
      return null;
    }
    this.workspaceOf.set(userId, loaded.workspaceId);
    const { readable, failed } = readRows(loaded.rows, loaded.unreadable);
    let household: Household;
    if (loaded.since === undefined || !held)
      household = {
        workspaceId: loaded.workspaceId,
        revision: loaded.revision,
        resetRevision: loaded.resetRevision,
        rows: toRowSet(readable),
        unreadable: failed,
      };
    else if (!readable.length && !failed.size)
      household =
        held.revision === loaded.revision
          ? held
          : { ...held, revision: loaded.revision };
    else {
      // Rows that read replace their earlier copies; rows that no longer
      // read leave the readable set, as deleted rows, until they do.
      const unreadable = new Map(held.unreadable);
      for (const row of readable) unreadable.delete(unreadableKey(row));
      for (const [key, row] of failed) unreadable.set(key, row);
      household = {
        workspaceId: held.workspaceId,
        revision: loaded.revision,
        resetRevision: loaded.resetRevision,
        rows: applyChangeSet(held.rows, {
          operationId: "",
          revision: loaded.revision,
          before: [],
          after: [
            ...readable,
            ...[...failed.values()].map((row) =>
              tombstone(row, loaded.revision),
            ),
          ],
        }),
        unreadable,
      };
    }
    this.remember(household);
    return household;
  }

  /** The household after its change set was written at the next revision. */
  written(household: Household, stamped: ChangeSet): Household {
    const next: Household = {
      ...household,
      revision: stamped.revision,
      rows: applyChangeSet(household.rows, stamped),
    };
    this.remember(next);
    return next;
  }

  /** Forgets every household, as a new server process would. */
  clear() {
    this.households.clear();
    this.workspaceOf.clear();
  }

  private remember(household: Household) {
    const held = this.households.get(household.workspaceId);
    if (held && held.revision > household.revision) return;
    this.households.delete(household.workspaceId);
    this.households.set(household.workspaceId, household);
    let rows = [...this.households.values()].reduce(
      (total, item) => total + rowCount(item),
      0,
    );
    for (const [workspaceId, item] of this.households) {
      if (
        this.households.size <= this.limits.households &&
        rows <= this.limits.rows
      )
        break;
      if (item === household) continue;
      this.households.delete(workspaceId);
      rows -= rowCount(item);
    }
  }
}

/** This server process's households. */
export const households = new HouseholdCache();

/**
 * Writes one operation's change set at the household's next revision, with
 * anything else the operation writes in the same transaction, and keeps the
 * result in memory once committed. Every row written must read. Throws
 * RevisionConflictError when the household changed since it was loaded.
 */
export async function writeOperation(
  db: PrismaClient,
  household: Household,
  input: {
    changeSet: ChangeSet;
    operation: OperationRecord;
    /** Writes to other tables that commit or fail with the change set. */
    alongside?: (tx: Prisma.TransactionClient) => Promise<void>;
  },
  cache: HouseholdCache = households,
): Promise<{ revision: number; changeSet: ChangeSet; household: Household }> {
  for (const row of input.changeSet.after) {
    const issues = rowIssues(row);
    if (issues)
      throw new Error(
        `The ${row.table} row ${JSON.stringify(row.id)} can't be saved: ${issues[0]!.message} at ${issues[0]!.path.join(".")}`,
      );
  }
  const written = await db.$transaction(
    async (tx) => {
      const result = await writeChangeSet(tx, {
        workspaceId: household.workspaceId,
        baseRevision: household.revision,
        changeSet: input.changeSet,
        operation: input.operation,
      });
      await input.alongside?.(tx);
      return result;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
  return {
    ...written,
    household: cache.written(household, written.changeSet),
  };
}

// Reading each partner's view ----------------------------------------------

type Parts = {
  memberIds: string[];
  failures: StoredDataFailure[];
  book?: Book;
};
const partsMemo = new WeakMap<RowSet, Parts>();
const ledgerMemo = new WeakMap<RowSet, Map<string, HouseholdLedger>>();

function failureOf(row: UnreadableRow): StoredDataFailure {
  const issues = row.issues.map((issue) => ({
    ...issue,
    path: [row.table, row.id, ...issue.path],
  }));
  const owner = rowOwner(row);
  if (owner) return { part: "budget", ownerId: owner, issues };
  if (row.table === "partnerFact")
    return {
      part: "partner-facts",
      viewerId: rowKeyParts(row.id)[0]!,
      issues,
    };
  return { part: "household", issues };
}

// One failure per part, with the issues of every row in it.
function mergeFailures(failures: StoredDataFailure[]): StoredDataFailure[] {
  const merged = new Map<string, StoredDataFailure>();
  for (const failure of failures) {
    const key = JSON.stringify([
      failure.part,
      "ownerId" in failure ? failure.ownerId : "",
      "viewerId" in failure ? failure.viewerId : "",
    ]);
    const held = merged.get(key);
    if (held) held.issues.push(...failure.issues);
    else merged.set(key, { ...failure, issues: [...failure.issues] });
  }
  return [...merged.values()];
}

const tableRows = (household: Household, table: TableName) =>
  [...(household.rows.get(table)?.values() ?? [])].filter(
    (row) => !row.deleted,
  );

function readParts(household: Household): Parts {
  const memo = partsMemo.get(household.rows);
  if (memo) return memo;
  const failures = [...household.unreadable.values()].map(failureOf);
  const memberIds = tableRows(household, "member").map(
    (row) => rowKeyParts(row.id)[0]!,
  );
  const settings = new Set(
    tableRows(household, "budgetSettings").map(
      (row) => rowKeyParts(row.id)[0]!,
    ),
  );
  for (const ownerId of memberIds)
    if (!settings.has(ownerId))
      failures.push({
        part: "budget",
        ownerId,
        issues: [
          {
            path: ["budgetSettings", ownerId],
            code: "custom",
            message: "The budget's settings are missing",
          },
        ],
      });
  if (!memberIds.length || memberIds.length > 2)
    failures.push({
      part: "household",
      issues: [
        { path: ["member"], code: "custom", message: "Invalid membership" },
      ],
    });
  const failed = new Set(
    failures.flatMap((failure) =>
      failure.part === "budget" ? [failure.ownerId] : [],
    ),
  );
  const rows = rowsIn(household.rows);
  // Each readable budget, checked as a whole: its references hold.
  const budgets = new Map<string, Budget>();
  const whole = !failures.length ? rowsToBook(rows) : undefined;
  for (const ownerId of memberIds) {
    if (failed.has(ownerId)) continue;
    const budget =
      whole?.budgets[ownerId] ??
      rowsToPersonalLedger(
        rows.filter((row) => rowVisibleTo(row, ownerId)),
        ownerId,
      ).budget;
    const issues = budgetReferenceIssues(budget);
    if (issues.length) {
      failed.add(ownerId);
      failures.push({
        part: "budget",
        ownerId,
        issues: issues.map((message) => ({
          path: ["budget", ownerId],
          code: "custom",
          message,
        })),
      });
    } else budgets.set(ownerId, budget);
  }
  // Each shared category names a category in each readable participant's
  // budget. An unreadable budget's owner is already under maintenance.
  const shared = tableRows(household, "sharedCategory").map(
    (row) => row.data as Book["sharedCategories"][number],
  );
  if (
    !sharedCategoryReferencesValid(
      shared.map((category) => ({
        ...category,
        participants: category.participants.filter((id) => !failed.has(id)),
      })),
      (id) => budgets.get(id)?.categories.map((category) => category.id),
    )
  )
    failures.push({
      part: "household",
      issues: [
        {
          path: ["sharedCategory"],
          code: "custom",
          message: "Invalid shared category reference",
        },
      ],
    });
  const parts: Parts = {
    memberIds,
    failures: mergeFailures(failures),
    book: whole && !failures.length ? whole : undefined,
  };
  partsMemo.set(household.rows, parts);
  return parts;
}

/** One partner's view of the household (see HouseholdLedger). */
export function householdLedger(
  household: Household,
  viewerId: string,
): HouseholdLedger {
  let memo = ledgerMemo.get(household.rows);
  if (!memo)
    ledgerMemo.set(household.rows, (memo = new Map<string, HouseholdLedger>()));
  const held = memo.get(viewerId);
  if (held) return held;
  const parts = readParts(household);
  const { failures } = parts;
  let ledger: HouseholdLedger;
  if (
    !parts.memberIds.includes(viewerId) ||
    failures.some(
      (failure) =>
        failure.part === "household" ||
        (failure.part === "budget" && failure.ownerId === viewerId) ||
        (failure.part === "partner-facts" && failure.viewerId === viewerId),
    )
  )
    ledger = { status: "maintenance", failures };
  else if (parts.book)
    ledger = {
      status: "ready",
      state: parts.book,
      budget: parts.book.budgets[viewerId]!,
      personal: false,
      failures,
    };
  else {
    const state = rowsToPersonalLedger(
      rowsIn(household.rows).filter((row) => rowVisibleTo(row, viewerId)),
      viewerId,
    );
    ledger = {
      status: "ready",
      state,
      budget: state.budget,
      personal: true,
      failures,
    };
  }
  memo.set(viewerId, ledger);
  return ledger;
}
