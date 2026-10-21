import {
  AccountingError,
  checkRestoredLedger,
  revertCommandSchema,
  type Book,
  type RevertCommand,
} from "./engine";
import {
  orphanRows,
  rowsToBook,
  rowsToPersonalLedger,
  rowVisibleTo,
  sameJson,
  tombstone,
  type ChangeSet,
  type RowSet,
  type TableName,
  type WireRow,
} from "./rows";
import type { PersonalLedger } from "./shared-ledger";

// Change sets applied to rows, the same way on the server and in the
// browser (ADR 0006): applying a confirmed change set, stamping one with the
// revision it was written at, and reverting one.

export function toRowSet(rows: Iterable<WireRow>): RowSet {
  const set = new Map<TableName, Map<string, WireRow>>();
  for (const row of rows) {
    let table = set.get(row.table);
    if (!table) set.set(row.table, (table = new Map<string, WireRow>()));
    table.set(row.id, row);
  }
  return set;
}

/** Every row in the set, deleted rows included. */
export function rowsIn(set: RowSet): WireRow[] {
  return [...set.values()].flatMap((table) => [...table.values()]);
}

export function getRow(
  set: RowSet,
  table: TableName,
  id: string,
): WireRow | undefined {
  return set.get(table)?.get(id);
}

/**
 * The rows after a change set: each of its rows replaces the row with the
 * same table and id, and removed rows stay as deleted rows. Only the tables
 * it changes are copied; the given set is unchanged.
 */
export function applyChangeSet(set: RowSet, changeSet: ChangeSet): RowSet {
  const next = new Map(set);
  const copied = new Set<TableName>();
  for (const row of changeSet.after) {
    if (!copied.has(row.table)) {
      next.set(row.table, new Map(set.get(row.table)));
      copied.add(row.table);
    }
    (next.get(row.table) as Map<string, WireRow>).set(row.id, row);
  }
  return next;
}

/**
 * A change set as written at a revision: its rows after carry the revision,
 * and its rows before carry the revision they had, read from the rows it
 * was applied to (0 for rows it created).
 */
export function stampChangeSet(
  changeSet: ChangeSet,
  revision: number,
  current: RowSet,
): ChangeSet {
  return {
    operationId: changeSet.operationId,
    revision,
    after: changeSet.after.map((row) => ({ ...row, revision })),
    before: changeSet.before.map((row) => ({
      ...row,
      revision: getRow(current, row.table, row.id)?.revision ?? 0,
    })),
  };
}

/** The part of a change set one partner's browser holds. */
export function changeSetVisibleTo(
  changeSet: ChangeSet,
  viewerId: string,
): ChangeSet {
  const visible = changeSet.after.map((row) => rowVisibleTo(row, viewerId));
  return {
    ...changeSet,
    after: changeSet.after.filter((_, index) => visible[index]),
    before: changeSet.before.filter((_, index) => visible[index]),
  };
}

/**
 * The rows a change set changed that have changed again since. A stamped
 * change set compares revisions, as the server does; one not yet stamped
 * (a browser's local preview) compares content.
 */
export function revertConflicts(set: RowSet, target: ChangeSet): WireRow[] {
  return target.after.filter((row) => {
    const current = getRow(set, row.table, row.id);
    if (!current) return !row.deleted;
    return target.revision
      ? current.revision !== target.revision
      : current.deleted !== row.deleted || !sameJson(current.data, row.data);
  });
}

/**
 * Restores the rows a change set changed to what they were before it. It is
 * refused when any of them changed since, so a revert never overwrites a
 * later edit, including a partner's. The result's change set is the revert's
 * own, so reverting it again redoes the original.
 */
export function revert(
  set: RowSet,
  target: ChangeSet,
  operationId: string,
): { rows: RowSet; changeSet: ChangeSet } {
  if (revertConflicts(set, target).length)
    throw new AccountingError(
      "This changed again since, so it can't be undone",
    );
  const changeSet: ChangeSet = {
    operationId,
    revision: 0,
    after: target.before.map((row) => ({ ...row, revision: 0 })),
    before: target.after.map(
      (row) => getRow(set, row.table, row.id) ?? tombstone(row),
    ),
  };
  return { rows: applyChangeSet(set, changeSet), changeSet };
}

/**
 * Runs a revert command against the stored change set of its target
 * operation, which the server loads (never one a browser sent). With a
 * viewer, the rows are that partner's browser rows and the result is their
 * personal ledger; otherwise the household's. The restored ledger passes the
 * engine's checks, since later changes may rely on what it restores.
 */
export function executeRevert(
  set: RowSet,
  input: RevertCommand,
  target: ChangeSet,
  viewerId?: string,
): { rows: RowSet; changeSet: ChangeSet; book: Book | PersonalLedger } {
  const command = revertCommandSchema.parse(input);
  if (command.targetOperationId !== target.operationId)
    throw new AccountingError("Undo access denied");
  const reverted = revert(
    set,
    viewerId ? changeSetVisibleTo(target, viewerId) : target,
    command.id,
  );
  const rows = rowsIn(reverted.rows);
  if (orphanRows(rows).length)
    throw new AccountingError(
      "This can't be undone because later changes depend on it",
    );
  const book = viewerId
    ? rowsToPersonalLedger(rows, viewerId)
    : rowsToBook(rows);
  checkRestoredLedger(book);
  return { ...reverted, book };
}
