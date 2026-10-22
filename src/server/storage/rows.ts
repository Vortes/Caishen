import { randomUUID } from "node:crypto";
import { z } from "zod";
import { stampChangeSet, toRowSet } from "~/domain/change-sets";
import type { CommandSource } from "~/domain/engine";
import {
  sameJson,
  tableNames,
  tombstone,
  type ChangeSet,
  type TableName,
  type WireRow,
} from "~/domain/rows";
import { Prisma, type PrismaClient } from "~/generated/prisma";
import {
  fromColumns,
  keyColumns,
  keyOf,
  postgresTypes,
  rowIdOf,
  StoredRowError,
  tableSpec,
  tableSpecs,
  toColumns,
  type TableSpec,
} from "./row-tables";

// The data-access layer for household rows and operations (ADR 0006): the
// only code that reads or writes those tables (a lint rule enforces it). It
// leaves out deleted rows unless asked, and writes each change set together
// with the household revision it is written at.

export type Database = PrismaClient | Prisma.TransactionClient;

const identifier = (name: string) => Prisma.raw(`"${name}"`);
const columnList = (names: string[]) =>
  Prisma.raw(names.map((name) => `"${name}"`).join(", "));

export type RowQuery = {
  /** Only the rows this partner's browser holds (rowVisibleTo). */
  viewerId?: string;
  /** Only rows changed after this household revision. */
  since?: number;
  /** Include deleted rows (tombstones), which are otherwise left out. */
  includeDeleted?: boolean;
};

function rowFilter(spec: TableSpec, workspace: Prisma.Sql, query: RowQuery) {
  const conditions = [Prisma.sql`x."workspaceId" = ${workspace}`];
  if (!query.includeDeleted) conditions.push(Prisma.sql`NOT x."deleted"`);
  if (query.since !== undefined)
    conditions.push(Prisma.sql`x."revision" > ${query.since}`);
  if (query.viewerId !== undefined && spec.visibleTo)
    conditions.push(
      Prisma.sql`x.${identifier(spec.visibleTo)} = ${query.viewerId}`,
    );
  return Prisma.join(conditions, " AND ");
}

// A table's stored columns as one JSON array, each row an object keyed by
// column name, in key order. The household id is left out: every row has
// the same.
function aggregate(spec: TableSpec, from: Prisma.Sql) {
  const names = [
    ...(spec.key === "key" ? keyColumns(spec) : []),
    ...spec.columns,
  ].map((column) => column.name);
  const order = keyColumns(spec)
    .map((column) => `r."${column.name}"`)
    .join(", ");
  return Prisma.sql`SELECT ${spec.table}::text AS "table", (SELECT coalesce(json_agg(r ORDER BY ${Prisma.raw(order)}), '[]'::json) FROM (SELECT ${Prisma.raw([...names, "revision", "deleted"].map((name) => `x."${name}"`).join(", "))} ${from}) r) AS "rows"`;
}

export type StoredIssue = {
  path: (string | number)[];
  code: string;
  message: string;
};

/** A stored row whose columns can't be read. */
export type UnreadableRow = {
  table: TableName;
  id: string;
  issues: StoredIssue[];
};

// Each stored row, or why it can't be read, in the order read.
function readStored(
  results: { table: string; rows: Record<string, unknown>[] }[],
): (WireRow | UnreadableRow)[] {
  return results.flatMap(({ table, rows }) => {
    const spec = tableSpec(table as TableName);
    return rows.map((stored): WireRow | UnreadableRow => {
      try {
        return fromColumns(spec, stored);
      } catch (error) {
        if (!(error instanceof StoredRowError)) throw error;
        return {
          table: spec.table,
          id: spec.key === "key" ? String(stored.key) : rowIdOf(spec, stored),
          issues: [{ path: [], code: "custom", message: error.message }],
        };
      }
    });
  });
}

const isUnreadable = (row: WireRow | UnreadableRow): row is UnreadableRow =>
  "issues" in row;

function fromStored(
  results: { table: string; rows: Record<string, unknown>[] }[],
): WireRow[] {
  return readStored(results).map((row) => {
    if (isUnreadable(row))
      throw new StoredRowError(
        tableSpec(row.table),
        row.id,
        row.issues[0]!.message,
      );
    return row;
  });
}

/**
 * One household's rows, read in one consistent snapshot. Deleted rows are
 * left out unless the query asks for them.
 */
export async function loadRows(
  db: Database,
  workspaceId: string,
  query: RowQuery = {},
): Promise<WireRow[]> {
  const results = await db.$queryRaw<
    { table: string; rows: Record<string, unknown>[] }[]
  >`${Prisma.join(
    tableSpecs.map((spec) =>
      aggregate(
        spec,
        Prisma.sql`FROM ${identifier(spec.model)} x WHERE ${rowFilter(spec, Prisma.sql`${workspaceId}`, query)}`,
      ),
    ),
    " UNION ALL ",
  )}`;
  return fromStored(results);
}

/**
 * A member's household as of now, read in one statement: its revision, the
 * revision browsers must reset before, and its rows, or null when the
 * member has none. With `since`, only rows changed after that revision are
 * read, deleted rows included; `since` is left out of the result when it
 * can't be used (the member's household is another one, or rows were
 * removed outright since), and every live row is read instead.
 */
export async function loadHouseholdRows(
  db: Database,
  userId: string,
  since?: { workspaceId: string; since: number },
): Promise<{
  workspaceId: string;
  revision: number;
  resetRevision: number;
  since?: number;
  rows: WireRow[];
  unreadable: UnreadableRow[];
} | null> {
  const read = async (delta?: typeof since) => {
    const workspace = delta
      ? Prisma.sql`(SELECT "id" FROM m WHERE "id" = ${delta.workspaceId} AND "resetRevision" <= ${delta.since})`
      : Prisma.sql`(SELECT "id" FROM m)`;
    const results = await db.$queryRaw<
      { table: string; rows: Record<string, unknown>[] }[]
    >`WITH m AS (
        SELECT w."id", w."revision", w."resetRevision"
        FROM "WorkspaceMember" wm JOIN "Workspace" w ON w."id" = wm."workspaceId"
        WHERE wm."clerkUserId" = ${userId}
      )
      SELECT '' AS "table", (SELECT coalesce(json_agg(m), '[]'::json) FROM m) AS "rows"
      UNION ALL ${Prisma.join(
        tableSpecs.map((spec) =>
          aggregate(
            spec,
            Prisma.sql`FROM ${identifier(spec.model)} x WHERE ${rowFilter(
              spec,
              workspace,
              delta ? { since: delta.since, includeDeleted: true } : {},
            )}`,
          ),
        ),
        " UNION ALL ",
      )}`;
    const [meta] = results.find((result) => result.table === "")!.rows as {
      id: string;
      revision: number;
      resetRevision: number;
    }[];
    if (!meta) return null;
    const rows = readStored(results.filter((result) => result.table !== ""));
    return {
      workspaceId: meta.id,
      revision: meta.revision,
      resetRevision: meta.resetRevision,
      rows: rows.filter((row): row is WireRow => !isUnreadable(row)),
      unreadable: rows.filter(isUnreadable),
    };
  };
  if (since) {
    const delta = await read(since);
    if (
      !delta ||
      (delta.workspaceId === since.workspaceId &&
        delta.resetRevision <= since.since)
    )
      return delta && { ...delta, since: since.since };
  }
  return read();
}

/** Where a page of a pull ended: the last row's table and key. */
export type PullPosition = { table: TableName; id: string };

/**
 * One page of the rows a partner's browser holds, as of a fixed revision:
 * rows changed after `since` (deleted rows included), or with `since` null
 * every live row. Rows are read in table order, then key order, starting
 * after `after`. Rows changed after `revision` are left out; the browser
 * learns of them by pulling from `revision` next.
 */
export async function pullRows(
  db: Database,
  input: {
    workspaceId: string;
    viewerId: string;
    since: number | null;
    revision: number;
    after?: PullPosition;
    limit: number;
  },
): Promise<{
  rows: (WireRow | UnreadableRow)[];
  next?: PullPosition;
}> {
  const start = input.after
    ? tableSpecs.findIndex((spec) => spec.table === input.after!.table)
    : 0;
  if (start < 0) throw new Error("The pull position names no table");
  const specs = tableSpecs.slice(start);
  const results = await db.$queryRaw<
    { table: string; rows: Record<string, unknown>[] }[]
  >`${Prisma.join(
    specs.map((spec) => {
      const conditions = [
        rowFilter(spec, Prisma.sql`${input.workspaceId}`, {
          viewerId: input.viewerId,
          ...(input.since === null
            ? {}
            : { since: input.since, includeDeleted: true }),
        }),
        Prisma.sql`x."revision" <= ${input.revision}`,
      ];
      const after = input.after;
      if (after?.table === spec.table) {
        const columns = keyColumns(spec);
        conditions.push(
          Prisma.sql`(${Prisma.raw(columns.map((column) => `x."${column.name}"`).join(", "))}) > (SELECT ${Prisma.raw(columns.map((column) => `k."${column.name}"`).join(", "))} FROM jsonb_to_record(${JSON.stringify(keyOf(spec, after.id))}::jsonb) AS k(${recordType(columns)}))`,
        );
      }
      return aggregate(
        spec,
        Prisma.sql`FROM ${identifier(spec.model)} x WHERE ${Prisma.join(conditions, " AND ")} ORDER BY ${Prisma.raw(
          keyColumns(spec)
            .map((column) => `x."${column.name}"`)
            .join(", "),
        )} LIMIT ${input.limit + 1}`,
      );
    }),
    " UNION ALL ",
  )}`;
  // Tables in order: the union's order isn't guaranteed.
  const order = new Map(specs.map((spec, index) => [spec.table, index]));
  results.sort(
    (a, b) =>
      order.get(a.table as TableName)! - order.get(b.table as TableName)!,
  );
  const rows = readStored(results);
  if (rows.length <= input.limit) return { rows };
  const page = rows.slice(0, input.limit);
  const last = page.at(-1)!;
  return { rows: page, next: { table: last.table, id: last.id } };
}

// Rows by table and id, deleted rows included, as they are now.
async function loadKeys(
  db: Database,
  workspaceId: string,
  keys: Pick<WireRow, "table" | "id">[],
): Promise<WireRow[]> {
  const byTable = groupKeys(keys);
  if (!byTable.size) return [];
  const results = await db.$queryRaw<
    { table: string; rows: Record<string, unknown>[] }[]
  >`${Prisma.join(
    [...byTable].map(([spec, ids]) => {
      const columns = keyColumns(spec);
      return aggregate(
        spec,
        Prisma.sql`FROM ${identifier(spec.model)} x JOIN jsonb_to_recordset(${JSON.stringify(ids.map((id) => keyOf(spec, id)))}::jsonb) AS k(${recordType(columns)}) ON ${keyMatch(spec, "x", "k")} WHERE x."workspaceId" = ${workspaceId}`,
      );
    }),
    " UNION ALL ",
  )}`;
  return fromStored(results);
}

function groupKeys(keys: Pick<WireRow, "table" | "id">[]) {
  const byTable = new Map<TableSpec, string[]>();
  for (const spec of tableSpecs) {
    const ids = keys
      .filter((key) => key.table === spec.table)
      .map((key) => key.id);
    if (ids.length) byTable.set(spec, ids);
  }
  return byTable;
}

const recordType = (columns: { name: string; type: string }[]) =>
  Prisma.raw(
    columns
      .map(
        (column) =>
          `"${column.name}" ${postgresTypes[column.type as keyof typeof postgresTypes]}`,
      )
      .join(", "),
  );

const keyMatch = (spec: TableSpec, left: string, right: string) =>
  Prisma.raw(
    keyColumns(spec)
      .map((column) => `${left}."${column.name}" = ${right}."${column.name}"`)
      .join(" AND "),
  );

/**
 * Writes rows at a revision in one statement: live rows are inserted or
 * replace the rows with the same keys, and deleted rows mark existing rows
 * deleted, keeping their last values. Every row a change removes must exist.
 */
async function writeRows(
  db: Database,
  workspaceId: string,
  rows: WireRow[],
  revision: number,
) {
  const steps: Prisma.Sql[] = [];
  const removals: { spec: TableSpec; step: string; count: number }[] = [];
  for (const spec of tableSpecs) {
    const live = rows.filter((row) => row.table === spec.table && !row.deleted);
    const removed = rows.filter(
      (row) => row.table === spec.table && row.deleted,
    );
    const key = keyColumns(spec);
    if (live.length) {
      const columns = [...(spec.key === "key" ? key : []), ...spec.columns];
      const names = columns.map((column) => column.name);
      const conflict = ["workspaceId", ...key.map((column) => column.name)];
      steps.push(Prisma.sql`${Prisma.raw(`"w${steps.length}"`)} AS (
        INSERT INTO ${identifier(spec.model)} ("workspaceId", "revision", "deleted", ${columnList(names)})
        SELECT ${workspaceId}, ${revision}, false, ${Prisma.raw(names.map((name) => `x."${name}"`).join(", "))}
        FROM jsonb_to_recordset(${JSON.stringify(live.map((row) => toColumns(spec, row)))}::jsonb) AS x(${recordType(columns)})
        ON CONFLICT (${columnList(conflict)}) DO UPDATE SET "revision" = EXCLUDED."revision", "deleted" = false, ${Prisma.raw(
          names
            .filter((name) => !conflict.includes(name))
            .map((name) => `"${name}" = EXCLUDED."${name}"`)
            .join(", "),
        )}
        RETURNING 1)`);
    }
    if (removed.length) {
      const step = `w${steps.length}`;
      removals.push({ spec, step, count: removed.length });
      steps.push(Prisma.sql`${Prisma.raw(`"${step}"`)} AS (
        UPDATE ${identifier(spec.model)} x SET "deleted" = true, "revision" = ${revision}
        FROM jsonb_to_recordset(${JSON.stringify(removed.map((row) => keyOf(spec, row.id)))}::jsonb) AS k(${recordType(key)})
        WHERE x."workspaceId" = ${workspaceId} AND ${keyMatch(spec, "x", "k")}
        RETURNING 1)`);
    }
  }
  if (!steps.length) return;
  const [counts] = await db.$queryRaw<
    Record<string, bigint>[]
  >`WITH ${Prisma.join(steps, ", ")}
    SELECT ${Prisma.raw(
      steps
        .map((_, index) => `(SELECT count(*) FROM "w${index}") AS "w${index}"`)
        .join(", "),
    )}`;
  for (const removal of removals)
    if (Number(counts![removal.step]) !== removal.count)
      throw new Error(
        `A change removes ${removal.spec.table} rows that don't exist`,
      );
}

/** The household changed since the revision a change was based on. */
export class RevisionConflictError extends Error {
  constructor(readonly revision: number) {
    super("The household changed since this change was made");
    this.name = "RevisionConflictError";
  }
}

export type OperationRecord = {
  actorId: string;
  source: CommandSource;
  type: string;
  /** operationHash of the input exactly as submitted (PR #39). */
  inputHash: string;
  command: unknown;
};

const inTransaction = async <T>(
  db: Database,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> =>
  "$transaction" in db
    ? db.$transaction(run, { timeout: 30_000, maxWait: 10_000 })
    : run(db);

/**
 * Writes one operation's change set as the household's next revision, all
 * or nothing: bumps the household revision from `baseRevision` (refusing with
 * RevisionConflictError when it has moved), stamps the change set, writes
 * its rows, and records the operation with the stamped change set.
 *
 * The change set must be the engine's for rows at `baseRevision`: its rows
 * before must be the stored rows, or the write is refused.
 */
export async function writeChangeSet(
  db: Database,
  input: {
    workspaceId: string;
    baseRevision: number;
    changeSet: ChangeSet;
    operation: OperationRecord;
    /**
     * The household changed shape: every browser downloads all rows again.
     * The revision moves past `after` too, so a browser holding a revision
     * of another household can't mistake it for this one's.
     */
    reset?: { after: number };
  },
): Promise<{ revision: number; changeSet: ChangeSet }> {
  const { workspaceId, baseRevision, changeSet, operation, reset } = input;
  if (changeSet.before.length !== changeSet.after.length)
    throw new Error("A change set pairs each row before with its row after");
  return inTransaction(db, async (tx) => {
    const revision = Math.max(baseRevision, reset?.after ?? 0) + 1;
    // Taking the household row first serializes writers: a concurrent one
    // waits here, then finds the revision moved.
    const bumped = await tx.workspace.updateMany({
      where: { id: workspaceId, revision: baseRevision },
      data: { revision, ...(reset ? { resetRevision: revision } : {}) },
    });
    if (bumped.count !== 1) {
      const workspace = await tx.workspace.findUnique({
        where: { id: workspaceId },
        select: { revision: true },
      });
      throw new RevisionConflictError(workspace?.revision ?? 0);
    }
    const current = await loadKeys(tx, workspaceId, changeSet.after);
    const currentSet = toRowSet(current);
    changeSet.after.forEach((after, index) => {
      const before = changeSet.before[index]!;
      const stored = currentSet.get(after.table)?.get(after.id);
      if (
        before.table !== after.table ||
        before.id !== after.id ||
        after.deleted !== (after.data === null) ||
        (before.deleted
          ? stored !== undefined && !stored.deleted
          : !stored || stored.deleted || !sameJson(stored.data, before.data))
      )
        throw new Error(
          `The change set's ${after.table} row ${JSON.stringify(after.id)} doesn't match the stored row`,
        );
    });
    const stamped = stampChangeSet(changeSet, revision, currentSet);
    await writeRows(
      tx,
      workspaceId,
      stamped.after.filter(
        (row, index) => !row.deleted || !stamped.before[index]!.deleted,
      ),
      revision,
    );
    await tx.operation.create({
      data: {
        workspaceId,
        operationId: changeSet.operationId,
        actorId: operation.actorId,
        source: operation.source,
        type: operation.type,
        inputHash: operation.inputHash,
        revision,
        command: json(operation.command),
        changeSet: json(stamped),
      },
    });
    return { revision, changeSet: stamped };
  });
}

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/**
 * Replaces all of a household's rows with these, at a revision. Only the
 * one-time copy from stored books (scripts/copy-books-to-rows.ts) uses it;
 * it neither bumps the revision nor records an operation.
 */
export async function replaceRows(
  db: Database,
  workspaceId: string,
  rows: WireRow[],
  revision: number,
) {
  await inTransaction(db, async (tx) => {
    // Children go with their parents.
    await tx.$executeRaw`WITH ${Prisma.join(
      tableSpecs.map(
        (spec, index) =>
          Prisma.sql`${Prisma.raw(`"d${index}"`)} AS (DELETE FROM ${identifier(spec.model)} WHERE "workspaceId" = ${workspaceId})`,
      ),
      ", ",
    )} SELECT 1`;
    await writeRows(tx, workspaceId, rows, revision);
  });
}

/**
 * Replaces all of a household's rows with these at its next revision, and
 * has every browser download them again: rows removed here leave no deleted
 * rows behind. Development seeding uses it.
 */
export async function resetHouseholdRows(
  db: Database,
  workspaceId: string,
  rows: WireRow[],
): Promise<number> {
  return inTransaction(db, async (tx) => {
    const { revision } = await tx.workspace.update({
      where: { id: workspaceId },
      data: { revision: { increment: 1 } },
      select: { revision: true },
    });
    await tx.workspace.update({
      where: { id: workspaceId },
      data: { resetRevision: revision },
    });
    await replaceRows(tx, workspaceId, rows, revision);
    return revision;
  });
}

/** An operation applied to a household, with its command and change set while kept. */
export async function findOperation(
  db: Database,
  workspaceId: string,
  operationId: string,
) {
  const found = await db.operation.findUnique({
    where: { workspaceId_operationId: { workspaceId, operationId } },
  });
  if (!found) return null;
  return {
    ...found,
    changeSet:
      found.changeSet === null ? null : changeSetSchema.parse(found.changeSet),
  };
}

/** Operations recorded before the operations table, kept for retries. */
export async function recordPastOperations(
  db: Database,
  workspaceId: string,
  operations: (Omit<OperationRecord, "command"> & {
    operationId: string;
    revision: number;
    createdAt?: Date;
  })[],
) {
  await db.operation.createMany({
    data: operations.map((operation) => ({ ...operation, workspaceId })),
    skipDuplicates: true,
  });
}

/**
 * Forgets the commands and change sets of operations recorded before a
 * time (in one household, or all), keeping the rest of each record so
 * retries stay recognized.
 */
export async function pruneOperations(
  db: Database,
  before: Date,
  workspaceId?: string,
) {
  const pruned = await db.operation.updateMany({
    where: {
      workspaceId,
      createdAt: { lt: before },
      NOT: {
        command: { equals: Prisma.DbNull },
        changeSet: { equals: Prisma.DbNull },
      },
    },
    data: { command: Prisma.DbNull, changeSet: Prisma.DbNull },
  });
  return pruned.count;
}

/** Every household operation id recorded, for checks. */
export async function operationIds(db: Database, workspaceId: string) {
  const found = await db.operation.findMany({
    where: { workspaceId },
    select: { operationId: true },
  });
  return found.map((operation) => operation.operationId);
}

// Readers for the operations table's JSON columns (ADR 0006, stored data).
const storedRowSchema = z.object({
  table: z.enum(tableNames),
  id: z.string(),
  revision: z.number().int().nonnegative(),
  deleted: z.boolean(),
  data: z.record(z.unknown()).nullable(),
});
export const changeSetSchema = z.object({
  operationId: z.string(),
  revision: z.number().int().nonnegative(),
  after: z.array(storedRowSchema),
  before: z.array(storedRowSchema),
}) as unknown as z.ZodType<ChangeSet, z.ZodTypeDef, unknown>;
export const operationCommandSchema = z.record(z.unknown());

/** A member's household id, revision, and reset revision, or null. */
export async function readHouseholdRevision(db: Database, userId: string) {
  const member = await db.workspaceMember.findUnique({
    where: { clerkUserId: userId },
    select: {
      workspace: { select: { id: true, revision: true, resetRevision: true } },
    },
  });
  return member
    ? {
        workspaceId: member.workspace.id,
        revision: member.workspace.revision,
        resetRevision: member.workspace.resetRevision,
      }
    : null;
}

/** A member's operations written after one revision, through another. */
export async function confirmedOperationIds(
  db: Database,
  input: {
    workspaceId: string;
    actorId: string;
    after: number;
    through: number;
  },
): Promise<string[]> {
  const found = await db.operation.findMany({
    where: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      revision: { gt: input.after, lte: input.through },
    },
    select: { operationId: true },
    orderBy: { revision: "asc" },
  });
  return found.map((operation) => operation.operationId);
}

/**
 * A household's latest operations, newest first, without their change
 * sets: how many rows each changed (null once forgotten) and, for a
 * revert, the operation it reverted.
 */
export async function recentOperations(
  db: Database,
  workspaceId: string,
  limit: number,
) {
  return db.$queryRaw<
    {
      operationId: string;
      actorId: string;
      source: string;
      type: string;
      revision: number;
      targetOperationId: string | null;
      changes: number | null;
    }[]
  >`SELECT "operationId", "actorId", "source", "type", "revision",
      "command"->>'targetOperationId' AS "targetOperationId",
      CASE WHEN "changeSet" IS NULL THEN NULL
        ELSE jsonb_array_length("changeSet"->'after') END AS "changes"
    FROM "Operation" WHERE "workspaceId" = ${workspaceId}
    ORDER BY "revision" DESC, "createdAt" DESC LIMIT ${limit}`;
}

/** Forgets every operation of a household (development reseeding). */
export async function forgetOperations(db: Database, workspaceId: string) {
  await db.operation.deleteMany({ where: { workspaceId } });
}

/**
 * Records, in another household, that a member's operations were applied,
 * so retrying one after joining that household never applies it twice.
 */
export async function carryOperations(
  db: Database,
  input: { from: string; to: string; actorId: string },
) {
  const operations = await db.operation.findMany({
    where: { workspaceId: input.from, actorId: input.actorId },
    select: {
      operationId: true,
      actorId: true,
      source: true,
      type: true,
      inputHash: true,
      createdAt: true,
    },
  });
  await db.operation.createMany({
    data: operations.map((operation) => ({
      ...operation,
      workspaceId: input.to,
      revision: 0,
    })),
    skipDuplicates: true,
  });
}

/**
 * Marks the import rows of bank connections deleted, in each household
 * holding them, at its next revision, so browsers learn of the removal
 * before the connections themselves are removed.
 */
export async function removeBankImports(
  db: Database,
  connectionIds: string[],
  actorId: string,
) {
  if (!connectionIds.length) return;
  const held = await db.$queryRaw<
    { workspaceId: string; revision: number; rows: Record<string, unknown>[] }[]
  >`SELECT x."workspaceId", w."revision",
      json_agg(json_build_object('userId', x."userId", 'connectionId', x."connectionId", 'logicalId', x."logicalId")) AS "rows"
    FROM "BankImport" x JOIN "Workspace" w ON w."id" = x."workspaceId"
    WHERE x."connectionId" = ANY(${connectionIds}) AND NOT x."deleted"
    GROUP BY x."workspaceId", w."revision"`;
  const spec = tableSpec("bankImport");
  for (const household of held) {
    const ids = household.rows.map((columns) => rowIdOf(spec, columns));
    const current = toRowSet(
      await loadKeys(
        db,
        household.workspaceId,
        ids.map((id) => ({ table: "bankImport" as const, id })),
      ),
    );
    const before = ids.map((id) => current.get("bankImport")!.get(id)!);
    await writeChangeSet(db, {
      workspaceId: household.workspaceId,
      baseRevision: household.revision,
      changeSet: {
        operationId: `bank.imports.remove:${randomUUID()}`,
        revision: 0,
        before,
        after: before.map((row) => tombstone(row)),
      },
      operation: {
        actorId,
        source: "user",
        type: "bank.connection.remove",
        inputHash: "",
        command: { connectionIds },
      },
    });
  }
}
