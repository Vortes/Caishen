// The change-set oracle (ADR 0006). Every test process loads this module
// before any test (see the test scripts in package.json and
// tests/components/setup.ts), so every command any test executes, through
// the engine directly or through the server, has its change set compared
// with a full comparison of the ledger's rows before and after. A miss (a
// changed row the change set leaves out or gets wrong) or an extra (a row it
// reports that did not change) fails the command and the test process.
import { inspect } from "node:util";
import {
  observeChangeSets,
  type Book,
  type ChangeSetObserver,
} from "../src/domain/engine";
import {
  bookToRows,
  diffRows,
  foldAssignments,
  personalLedgerToRows,
  rowsToBook,
  sameJson,
  type ChangeSet,
  type WireRow,
} from "../src/domain/rows";
import {
  isPersonalLedger,
  type AccountingState,
} from "../src/domain/shared-ledger";

// Rows are cached per ledger object. A test that changes a ledger in place
// could leave its cached rows stale, so a failure is confirmed with fresh
// rows before it is reported.
const cache = new WeakMap<AccountingState, WireRow[]>();
function rowsOf(state: AccountingState, fresh: boolean): WireRow[] {
  let rows = fresh ? undefined : cache.get(state);
  if (!rows) {
    rows = isPersonalLedger(state)
      ? personalLedgerToRows(state)
      : bookToRows(state);
    cache.set(state, rows);
  }
  return rows;
}

// What rows hold of a book: everything but the audit, with assignments
// folded.
export function storedBook(book: Book): Book {
  return {
    ...book,
    budgets: Object.fromEntries(
      Object.entries(book.budgets).map(([userId, budget]) => [
        userId,
        { ...budget, assignments: foldAssignments(budget.assignments) },
      ]),
    ),
    audit: [],
  };
}

const key = (row: WireRow) => `${row.table} ${row.id}`;

/** What is wrong with a change set, compared with a full row comparison. */
export function changeSetProblems(
  before: AccountingState,
  after: AccountingState,
  changeSet: ChangeSet,
  fresh = false,
): string[] {
  const problems: string[] = [];
  const afterRows = rowsOf(after, fresh);
  const expected = diffRows(rowsOf(before, fresh), afterRows);
  const wanted = new Map(
    expected.after.map((row, index) => [
      key(row),
      { before: expected.before[index]!, after: row },
    ]),
  );
  if (changeSet.before.length !== changeSet.after.length)
    problems.push("before and after differ in length");
  const reported = new Set<string>();
  changeSet.after.forEach((row, index) => {
    const prior = changeSet.before[index];
    if (!prior || key(prior) !== key(row))
      problems.push(`before and after are not the same row at ${index}`);
    if (reported.has(key(row))) problems.push(`reported twice: ${key(row)}`);
    reported.add(key(row));
    const change = wanted.get(key(row));
    if (!change) {
      problems.push(`extra: ${key(row)} did not change`);
      return;
    }
    for (const [side, actual, truth] of [
      ["before", prior, change.before],
      ["after", row, change.after],
    ] as const)
      if (
        actual?.deleted !== truth.deleted ||
        !sameJson(actual.data, truth.data)
      )
        problems.push(
          `wrong ${side}: ${key(row)}\n  reported ${inspect(actual?.data, { depth: 4 })}\n  actual   ${inspect(truth.data, { depth: 4 })}`,
        );
  });
  for (const id of wanted.keys())
    if (!reported.has(id)) problems.push(`missed: ${id}`);
  if (
    !isPersonalLedger(after) &&
    !problems.length &&
    !sameJson(rowsToBook(afterRows), storedBook(after))
  )
    problems.push("the book does not round-trip through its rows");
  return problems.length && !fresh
    ? changeSetProblems(before, after, changeSet, true)
    : problems;
}

let checked = 0;
const failures: string[] = [];

/** How many change sets the oracle has checked in this process. */
export const oracleChecks = () => checked;

/** Failures not yet reported, cleared as they are read. */
export function takeOracleFailures(): string[] {
  return failures.splice(0);
}

const observer: ChangeSetObserver = ({
  before,
  after,
  actorId,
  command,
  changeSet,
}) => {
  checked++;
  const problems = changeSetProblems(before, after, changeSet);
  if (!problems.length) return;
  const message = `Change-set oracle: ${command.type} by ${actorId} (${command.id})${isPersonalLedger(after) ? " on a personal ledger" : ""}\n${problems.join("\n")}`;
  failures.push(message);
  throw new Error(message);
};
observeChangeSets(observer);

// A failure a test caught and ignored still fails the process.
process.on("exit", () => {
  if (!failures.length) return;
  console.error(failures.join("\n\n"));
  process.exitCode = 1;
});
