import assert from "node:assert/strict";
import test from "node:test";
import {
  commandSchema,
  execute,
  executeWithChanges,
  personalLedger,
  type Book,
} from "../../src/domain/engine";
import {
  rowKey,
  rowVisibleTo,
  sameJson,
  type ChangeSet,
  type WireRow,
} from "../../src/domain/rows";
import { changeSetProblems, oracleChecks } from "../change-set-oracle";
import { buildCommandCorpus, type CorpusStep } from "./fixtures/command-corpus";

const corpus = buildCommandCorpus();
const key = (row: WireRow) => `${row.table} ${row.id}`;
const keys = (changeSet: ChangeSet) => changeSet.after.map(key);
const step = (type: string, nth = 0): CorpusStep =>
  corpus.steps.filter((item) => item.command.type === type)[nth]!;

void test("the change-set oracle checks every command any test runs", () => {
  const checked = oracleChecks();
  execute(corpus.book, "alex", {
    type: "income.expect",
    id: "oracle-installed",
    month: "2026-04",
    amount: 1,
  });
  assert.equal(
    oracleChecks(),
    checked + 1,
    "load tests/change-set-oracle.ts in every test process",
  );
});

void test("the corpus runs every command type", () => {
  const types = commandSchema.options.map((option) => option.shape.type.value);
  const run = new Set(corpus.steps.map((item) => item.command.type));
  assert.deepStrictEqual(
    types.filter((type) => !run.has(type)),
    [],
    "add every new command type to tests/domain/fixtures/command-corpus.ts",
  );
});

void test("every corpus change set equals a full comparison of the household's rows", () => {
  for (const [index, item] of corpus.steps.entries()) {
    assert.deepStrictEqual(
      changeSetProblems(item.before, item.after, item.changeSet),
      [],
      `step ${index + 1}, ${item.command.type}`,
    );
    assert.equal(item.changeSet.operationId, item.command.id);
    assert.ok(
      item.changeSet.after.length > 0,
      `${item.command.type} (${item.command.id})`,
    );
  }
});

void test("a partner's browser computes the change set the server computes for their rows", () => {
  let compared = 0;
  for (const item of corpus.steps) {
    if (Object.keys(item.before.budgets).length !== 2) continue;
    if (
      ["partner.settle", "partner.settlement.confirm"].includes(
        item.command.type,
      )
    )
      continue;
    const ledger = personalLedger(item.before, item.actorId);
    const { changeSet } = executeWithChanges(
      ledger,
      item.actorId,
      item.command,
      item.source,
    );
    const visible = (rows: WireRow[]) =>
      rows.filter((row) => rowVisibleTo(row, item.actorId));
    const server = {
      ...item.changeSet,
      after: visible(item.changeSet.after),
      before: visible(item.changeSet.before),
    };
    assert.ok(
      sameJson(changeSet, server),
      `${item.command.type} (${item.command.id})`,
    );
    compared++;
  }
  assert.ok(compared > 15);
});

void test("change sets include the rows a command changes far from itself", () => {
  // Reconciling marks every cleared transaction of the account.
  const reconcile = step("account.reconcile");
  assert.ok(
    keys(reconcile.changeSet).filter((id) => id.startsWith("transaction "))
      .length >= 5,
  );
  assert.ok(
    keys(reconcile.changeSet).includes(`account ${rowKey("alex", "checking")}`),
  );
  // Editing a loan payment from the register re-adds its payment, which
  // moves it after later payments.
  const loanEdit = corpus.steps.find(
    (item) =>
      item.command.type === "transaction.upsert" &&
      item.command.transactionId === "car-payment" &&
      item.command.revision !== undefined,
  )!;
  const paymentId = loanEdit.after.budgets.alex!.transactions.find(
    (transaction) => transaction.id === "car-payment",
  )!.linkedId!;
  const payment = loanEdit.changeSet.after.find(
    (row) => row.id === rowKey("alex", "car", paymentId),
  );
  assert.deepStrictEqual(
    [payment?.table, (payment?.data as { sort: number } | null)?.sort],
    ["loanPayment", 2],
  );
  // Moving a transfer to another account retires the old counterpart.
  const moved = corpus.steps.find(
    (item) =>
      item.command.type === "transaction.upsert" &&
      item.command.transactionId === "move" &&
      item.command.transferAccountId === "brokerage",
  )!;
  const retired = moved.changeSet.after.find(
    (row) =>
      row.id ===
      rowKey(
        "alex",
        `${corpus.steps.find((item) => item.command.type === "transaction.upsert" && item.command.transactionId === "move" && item.command.transferAccountId === "savings")!.command.id}:counterpart`,
      ),
  );
  assert.equal(
    (retired?.data as { removed?: boolean } | undefined)?.removed,
    true,
  );
  // Sharing a purchase with the partner writes the household's ledger.
  const market = corpus.steps.find(
    (item) =>
      item.command.type === "transaction.upsert" &&
      item.command.transactionId === "market",
  )!;
  assert.ok(
    keys(market.changeSet).includes(
      `partnerEntry ${rowKey("alex:market:market")}`,
    ),
  );
});

void test("a created row's before and a removed row's after are deleted", () => {
  const created = step("account.add").changeSet;
  assert.ok(created.before.every((row) => row.deleted && row.data === null));
  assert.ok(created.after.every((row) => !row.deleted));
  const removed = corpus.steps.find(
    (item) =>
      item.command.type === "target.set" && item.command.target === null,
  )!.changeSet;
  const target = removed.after.find((row) => row.table === "target");
  assert.deepStrictEqual([target?.deleted, target?.data], [true, null]);
  assert.ok(
    removed.before.some(
      (row) =>
        row.table === "target" &&
        row.id === rowKey("alex", "rent") &&
        !row.deleted,
    ),
  );
});

void test("a retried operation changes no rows", () => {
  const item = corpus.steps.at(-1)!;
  const { changeSet } = executeWithChanges(
    item.after,
    item.actorId,
    item.command,
    item.source,
  );
  assert.deepStrictEqual(changeSet, {
    operationId: item.command.id,
    revision: 0,
    after: [],
    before: [],
  });
});

void test("the oracle reports misses, extras, and wrong prior values", () => {
  const item = step("transaction.categorize");
  const { before, after, changeSet } = item;
  const without = (index: number): ChangeSet => ({
    ...changeSet,
    before: changeSet.before.filter((_, at) => at !== index),
    after: changeSet.after.filter((_, at) => at !== index),
  });
  assert.match(
    changeSetProblems(before, after, without(0)).join("\n"),
    /^missed: /m,
  );
  const unchanged = (book: Book) =>
    ({
      table: "account",
      id: rowKey("alex", "checking"),
      revision: 0,
      deleted: false,
      data: { ...book.budgets.alex!.accounts[0]!, userId: "alex", sort: 0 },
    }) as WireRow;
  assert.match(
    changeSetProblems(before, after, {
      ...changeSet,
      before: [...changeSet.before, unchanged(before)],
      after: [...changeSet.after, unchanged(after)],
    }).join("\n"),
    /^extra: account/m,
  );
  assert.match(
    changeSetProblems(before, after, {
      ...changeSet,
      before: changeSet.after,
    }).join("\n"),
    /^wrong before: /m,
  );
});
