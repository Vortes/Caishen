import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountingError,
  ledgerCommandSchema,
  type Book,
} from "../../src/domain/engine";
import {
  applyChangeSet,
  changeSetVisibleTo,
  executeRevert,
  getRow,
  revert,
  rowsIn,
  stampChangeSet,
  toRowSet,
} from "../../src/domain/change-sets";
import {
  bookToRows,
  orphanRows,
  rowKey,
  rowsToBook,
  rowsToPersonalLedger,
  rowVisibleTo,
  sameJson,
  type ChangeSet,
  type RowSet,
} from "../../src/domain/rows";
import { storedBook } from "../change-set-oracle";
import { buildCommandCorpus, type CorpusStep } from "./fixtures/command-corpus";

const corpus = buildCommandCorpus();
// The corpus written step by step as the server would: each change set
// stamped with the next revision and applied to the stored rows.
type Written = CorpusStep & {
  stamped: ChangeSet;
  rowsBefore: RowSet;
  rowsAfter: RowSet;
};
const written: Written[] = [];
let stored = toRowSet(bookToRows(corpus.steps[0]!.before));
for (const [index, step] of corpus.steps.entries()) {
  const stamped = stampChangeSet(step.changeSet, index + 1, stored);
  const rowsAfter = applyChangeSet(stored, stamped);
  written.push({ ...step, stamped, rowsBefore: stored, rowsAfter });
  stored = rowsAfter;
}
const final = stored;
const find = (type: string, nth = 0) =>
  written.filter((step) => step.command.type === type)[nth]!;
const revertOf = (step: CorpusStep, id = `undo-${step.command.id}`) => ({
  type: "revert" as const,
  id,
  targetOperationId: step.command.id,
});
const sameBook = (actual: unknown, expected: Book) =>
  sameJson(actual, storedBook(expected));
const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof AccountingError, String(error));
    return error.message;
  }
  return "allowed";
};

void test("applying each stamped change set to stored rows rebuilds every book", () => {
  for (const step of written)
    assert.ok(
      sameBook(rowsToBook(rowsIn(step.rowsAfter)), step.after),
      `${step.command.type} (${step.command.id})`,
    );
  const removedShared = getRow(final, "sharedCategory", rowKey("trips"))!;
  assert.deepStrictEqual(
    [removedShared.deleted, removedShared.data],
    [true, null],
    "removed rows stay as deleted rows",
  );
  // A stamped row carries the revision of the operation that last changed it.
  const shared = find("shared.rule");
  const row = getRow(final, "sharedCategory", rowKey("groceries"))!;
  assert.equal(row.revision, shared.stamped.revision);
  assert.equal(
    shared.stamped.before.find((item) => item.id === row.id)!.revision,
    find("shared.create").stamped.revision,
  );
  assert.ok(
    find("account.add").stamped.before.every((item) => item.revision === 0),
  );
});

void test("every command can be undone right away and redone", () => {
  for (const step of written) {
    const undone = executeRevert(step.rowsAfter, revertOf(step), step.stamped);
    assert.ok(
      sameBook(undone.book, step.before),
      `undo ${step.command.type} (${step.command.id})`,
    );
    // The server stamps the undo and writes it before anything can redo it.
    const undo = stampChangeSet(
      undone.changeSet,
      step.stamped.revision + 1,
      step.rowsAfter,
    );
    const redone = executeRevert(
      applyChangeSet(step.rowsAfter, undo),
      {
        type: "revert",
        id: `redo-${step.command.id}`,
        targetOperationId: undo.operationId,
      },
      undo,
    );
    assert.ok(
      sameBook(redone.book, step.after),
      `redo ${step.command.type} (${step.command.id})`,
    );
  }
});

void test("an undo is refused when a row it restores changed since, including by the partner", () => {
  // Jordan changed the split Alex's shared category was created with.
  const shared = find("shared.create");
  assert.match(
    refusal(() => executeRevert(final, revertOf(shared), shared.stamped)),
    /changed again since/,
  );
  // Moving the transfer again changed the rows the first save wrote.
  const firstSave = find("transaction.save");
  assert.match(
    refusal(() => executeRevert(final, revertOf(firstSave), firstSave.stamped)),
    /changed again since/,
  );
  // Nothing has touched the expected income since it was set.
  const income = find("income.expect");
  const undone = executeRevert(final, revertOf(income), income.stamped);
  assert.equal(
    (undone.book as Book).budgets.alex!.expectedIncome["2026-02"],
    undefined,
  );
});

void test("an undo is refused when later changes depend on what it removes", () => {
  // Rent has assignments made after it was added.
  const rent = written.find(
    (step) =>
      step.command.type === "category.add" &&
      step.command.categoryId === "rent",
  )!;
  assert.match(
    refusal(() => executeRevert(final, revertOf(rent), rent.stamped)),
    /later changes depend on it/,
  );
  // The loan has payments recorded after it was added, which would be left
  // without their loan.
  const loan = find("loan.add");
  assert.deepStrictEqual(
    [
      ...new Set(
        orphanRows(rowsIn(revert(final, loan.stamped, "undo").rows)).map(
          (row) => row.table,
        ),
      ),
    ],
    ["loanRate", "loanPayment"],
  );
  assert.match(
    refusal(() => executeRevert(final, revertOf(loan), loan.stamped)),
    /later changes depend on it/,
  );
  // An undo runs only against the operation it names.
  assert.match(
    refusal(() =>
      executeRevert(final, revertOf(find("rule.set")), loan.stamped),
    ),
    /Undo access denied/,
  );
});

void test("a partner's browser undoes on its own rows like the server", () => {
  let compared = 0;
  for (const step of written) {
    if (Object.keys(step.before.budgets).length !== 2) continue;
    const viewer = step.actorId;
    const visible = (set: RowSet) =>
      toRowSet(rowsIn(set).filter((row) => rowVisibleTo(row, viewer)));
    const server = executeRevert(step.rowsAfter, revertOf(step), step.stamped);
    const browser = executeRevert(
      visible(step.rowsAfter),
      revertOf(step),
      step.stamped,
      viewer,
    );
    assert.ok(
      sameJson(browser.book, rowsToPersonalLedger(rowsIn(server.rows), viewer)),
      `${step.command.type} (${step.command.id})`,
    );
    compared++;
  }
  assert.ok(compared > 15);
});

void test("a browser receives only its own rows of a change set", () => {
  const shared = find("shared.create").stamped;
  const ids = (changeSet: ChangeSet) => changeSet.after.map((row) => row.id);
  assert.ok(ids(shared).includes(rowKey("jordan", "groceries")));
  const alex = changeSetVisibleTo(shared, "alex");
  assert.ok(!ids(alex).includes(rowKey("jordan", "groceries")));
  assert.deepStrictEqual(
    alex.before.map((row) => row.id),
    ids(alex),
  );
  assert.ok(
    ids(changeSetVisibleTo(shared, "jordan")).includes(
      rowKey("jordan", "groceries"),
    ),
  );
});

void test("the server executes revert alongside the engine's commands", () => {
  assert.deepStrictEqual(
    ledgerCommandSchema.parse({
      type: "revert",
      id: "undo-1",
      targetOperationId: "corpus-1",
    }),
    { type: "revert", id: "undo-1", targetOperationId: "corpus-1" },
  );
  assert.equal(
    ledgerCommandSchema.parse(corpus.steps[0]!.command).type,
    "account.add",
  );
  assert.throws(() =>
    ledgerCommandSchema.parse({ type: "revert", id: "undo-1" }),
  );
});
