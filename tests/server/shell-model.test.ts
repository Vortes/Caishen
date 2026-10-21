import assert from "node:assert/strict";
import test from "node:test";
import { toShellData } from "../../src/components/prototype/app-shell/model";
import { viewOf } from "../../src/components/prototype/app-shell/plan-view";
import {
  createBook,
  execute,
  projectBook,
  type Command,
} from "../../src/domain/engine";

const month = "2026-10";
type Input = Command extends infer T
  ? T extends Command
    ? Omit<T, "id">
    : never
  : never;
function setup() {
  let book = createBook("owner", "Projection budget", month);
  let operation = 0;
  const run = (command: Input) => {
    book = execute(book, "owner", { ...command, id: `command-${++operation}` });
  };
  run({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
    date: "2026-10-01",
  });
  run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
    date: "2026-10-01",
  });
  for (const name of ["Gifts", "Dining", "Household", "Phone"])
    run({ type: "category.add", categoryId: name, name });
  const data = () =>
    toShellData({
      view: projectBook(book, "owner", month, month),
      revision: 0,
      history: { undo: null, redo: null },
      services: [],
      connections: [],
      evidence: [],
      imports: [],
    });
  return { run, data };
}

void test("focused views include cash and credit overspending, unfunded targets, and available money", () => {
  const { run, data } = setup();
  run({ type: "assign", categoryId: "Gifts", month, amount: 10_000 });
  run({
    type: "target.set",
    categoryId: "Phone",
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: 6_500,
      startMonth: month,
      snoozedMonths: [],
    },
  });
  for (const [categoryId, accountId] of [
    ["Dining", "checking"],
    ["Household", "card"],
  ] as const)
    run({
      type: "transaction.upsert",
      transactionId: categoryId,
      accountId,
      categoryId,
      amount: -500,
      date: "2026-10-02",
      payee: categoryId,
    });
  const matches = (id: Parameters<typeof viewOf>[0]) =>
    data()
      .categories.filter(viewOf(id).matches)
      .map(({ name }) => name);
  assert.deepEqual(matches("overspent"), ["Dining", "Household"]);
  assert.deepEqual(matches("underfunded"), ["Dining", "Household", "Phone"]);
  assert.deepEqual(matches("available"), ["Gifts"]);
  assert.deepEqual(matches("overfunded"), []);
  run({ type: "assign", categoryId: "Phone", month, amount: 7_000 });
  assert.deepEqual(matches("overfunded"), ["Phone"]);
  run({
    type: "target.snooze",
    categoryId: "Phone",
    month,
    currentMonth: month,
    snoozed: true,
  });
  assert.deepEqual(matches("snoozed"), ["Phone"]);
});

void test("the register excludes pending inflows from its uncleared balance and preserves review labels", () => {
  const { run, data } = setup();
  run({ type: "assign", categoryId: "Gifts", month, amount: 20_000 });
  for (const [transactionId, amount, status, reviewed] of [
    ["posted", -2_500, "posted", true],
    ["pending", -1_000, "pending", false],
    ["refund", 500, "pending", true],
  ] as const)
    run({
      type: "transaction.upsert",
      transactionId,
      accountId: "checking",
      categoryId: "Gifts",
      amount,
      status,
      reviewed,
      date: "2026-10-02",
      payee: transactionId,
    });
  const shell = data();
  const checking = shell.accounts.find(({ id }) => id === "checking")!;
  assert.equal(checking.balance, 96_500);
  assert.equal(checking.pending, -1_000);
  assert.deepEqual(
    Object.fromEntries(
      shell.transactions.map(({ id, needsReview }) => [id, needsReview]),
    ),
    { posted: false, pending: true, refund: false },
  );
});
