import { z } from "zod";
import { stampChangeSet, toRowSet } from "~/domain/change-sets";
import type { CommandSource } from "~/domain/engine";
import {
  sameJson,
  tableNames,
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

function rowFilter(spec: TableSpec, workspaceId: string, query: RowQuery) {
  const conditions = [Prisma.sql`x."workspaceId" = ${workspaceId}`];
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
// column name. The household id is left out: every row has the same.
function aggregate(spec: TableSpec, from: Prisma.Sql) {
  const columns = [
    ...(spec.key === "key" ? keyColumns(spec) : []),
    ...spec.columns,
  ].map((column) => `x."${column.name}"`);
  return Prisma.sql`SELECT ${spec.table}::text AS "table", (SELECT coalesce(json_agg(r), '[]'::json) FROM (SELECT ${Prisma.raw([...columns, 'x."revision"', 'x."deleted"'].join(", "))} ${from}) r) AS "rows"`;
}

function fromStored(
  results: { table: string; rows: Record<string, unknown>[] }[],
): WireRow[] {
  return results.flatMap(({ table, rows }) => {
    const spec = tableSpec(table as TableName);
    return rows.map((stored) => fromColumns(spec, stored));
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
        Prisma.sql`FROM ${identifier(spec.model)} x WHERE ${rowFilter(spec, workspaceId, query)}`,
      ),
    ),
    " UNION ALL ",
  )}`;
  return fromStored(results);
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
  },
): Promise<{ revision: number; changeSet: ChangeSet }> {
  const { workspaceId, baseRevision, changeSet, operation } = input;
  if (changeSet.before.length !== changeSet.after.length)
    throw new Error("A change set pairs each row before with its row after");
  return inTransaction(db, async (tx) => {
    // Taking the household row first serializes writers: a concurrent one
    // waits here, then finds the revision moved.
    const bumped = await tx.workspace.updateMany({
      where: { id: workspaceId, revision: baseRevision },
      data: { revision: { increment: 1 } },
    });
    if (bumped.count !== 1) {
      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { revision: true },
      });
      throw new RevisionConflictError(workspace.revision);
    }
    const revision = baseRevision + 1;
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
