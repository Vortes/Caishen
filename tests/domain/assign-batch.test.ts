import assert from "node:assert/strict";
import test from "node:test";
import {
  createBook,
  execute,
  projectBook,
  type Book,
  type Command,
} from "../../src/domain/engine";

type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

function fixture(cash: number, start = "2026-10") {
  let book: Book = createBook("alan", "Alan", start);
  let sequence = 0;
  const run = (
    command: WithoutId<Command>,
    source: "user" | "agent" = "user",
  ) => {
    book = execute(
      book,
      "alan",
      { ...command, id: `operation-${++sequence}` },
      source,
    );
  };
  run({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: cash,
    date: `${start}-01`,
  });
  for (const categoryId of ["rent", "food", "gifts"])
    run({ type: "category.add", categoryId, name: categoryId });
  return {
    run,
    book: () => book,
    view: (month = start) => projectBook(book, "alan", month),
  };
}

void test("a batch applies every change at once, funding increases with released money", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "assign",
    categoryId: "gifts",
    month: "2026-10",
    amount: 100_000,
  });
  setup.run({
    type: "assign.batch",
    month: "2026-10",
    changes: [
      { categoryId: "gifts", amount: -60_000 },
      { categoryId: "rent", amount: 50_000 },
      { categoryId: "food", amount: 10_000 },
    ],
  });
  const view = setup.view();
  const assigned = (id: string) =>
    view.categories.find((category) => category.id === id)!.assigned;
  assert.deepEqual(
    [assigned("gifts"), assigned("rent"), assigned("food")],
    [40_000, 50_000, 10_000],
  );
  assert.equal(view.readyToAssign, 0);
});

void test("a batch that overspends Ready to Assign or a category changes nothing", () => {
  const setup = fixture(50_000);
  const before = setup.view();
  assert.throws(
    () =>
      setup.run({
        type: "assign.batch",
        month: "2026-10",
        changes: [
          { categoryId: "rent", amount: 40_000 },
          { categoryId: "food", amount: 20_000 },
        ],
      }),
    /Ready to Assign/,
  );
  assert.throws(
    () =>
      setup.run({
        type: "assign.batch",
        month: "2026-10",
        changes: [{ categoryId: "gifts", amount: -1 }],
      }),
    /does not hold/,
  );
  assert.throws(
    () =>
      setup.run({
        type: "assign.batch",
        month: "2026-10",
        changes: [
          { categoryId: "rent", amount: 1 },
          { categoryId: "rent", amount: 1 },
        ],
      }),
    /only once/,
  );
  assert.deepEqual(setup.view().categories, before.categories);
});

void test("only the user can run a batch", () => {
  const setup = fixture(50_000);
  assert.throws(
    () =>
      setup.run(
        {
          type: "assign.batch",
          month: "2026-10",
          changes: [{ categoryId: "rent", amount: 1_000 }],
        },
        "agent",
      ),
    /requires a user action/,
  );
});

void test("categories carry earlier months' assigned and spent amounts", () => {
  const setup = fixture(300_000, "2026-08");
  setup.run({
    type: "assign",
    categoryId: "food",
    month: "2026-09",
    amount: 40_000,
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "groceries",
    accountId: "checking",
    date: "2026-09-12",
    payee: "Market",
    amount: -25_000,
    categoryId: "food",
  });
  const food = setup
    .view("2026-10")
    .categories.find((category) => category.id === "food")!;
  assert.deepEqual(food.history, {
    assigned: [0, 40_000],
    spent: [0, 25_000],
  });
});

void test("setting a month's total assigns the difference and keeps one assignment per category and month", () => {
  const setup = fixture(100_000);
  const assigned = (id: string) =>
    setup.view().categories.find((category) => category.id === id)!.assigned;
  setup.run({
    type: "assign",
    categoryId: "rent",
    month: "2026-10",
    amount: 30_000,
  });
  setup.run({
    type: "assign.set",
    categoryId: "rent",
    month: "2026-10",
    amount: 70_000,
  });
  assert.equal(assigned("rent"), 70_000);
  assert.equal(setup.view().readyToAssign, 30_000);
  // Setting the same total again, as a retried or rebased edit would, changes nothing.
  setup.run({
    type: "assign.set",
    categoryId: "rent",
    month: "2026-10",
    amount: 70_000,
  });
  setup.run({
    type: "assign.set",
    categoryId: "rent",
    month: "2026-10",
    amount: 20_000,
  });
  setup.run({
    type: "cover",
    fromCategoryId: "rent",
    toCategoryId: "food",
    month: "2026-10",
    amount: 5_000,
  });
  setup.run({
    type: "assign.set",
    categoryId: "gifts",
    month: "2026-10",
    amount: 0,
  });
  assert.deepEqual(
    [assigned("rent"), assigned("food"), assigned("gifts")],
    [15_000, 5_000, 0],
  );
  assert.deepEqual(setup.book().budgets.alan!.assignments, [
    { id: "operation-5", categoryId: "rent", month: "2026-10", amount: 15_000 },
    {
      id: "operation-9:to",
      categoryId: "food",
      month: "2026-10",
      amount: 5_000,
    },
  ]);
});

void test("setting a total checks the difference like any assignment", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "assign",
    categoryId: "rent",
    month: "2026-10",
    amount: 40_000,
  });
  assert.throws(
    () =>
      setup.run({
        type: "assign.set",
        categoryId: "food",
        month: "2026-10",
        amount: 60_001,
      }),
    /Assignments require existing Ready to Assign cash/,
  );
  setup.run({
    type: "transaction.upsert",
    transactionId: "rent-paid",
    accountId: "checking",
    date: "2026-10-02",
    amount: -30_000,
    payee: "Landlord",
    categoryId: "rent",
  });
  assert.throws(
    () =>
      setup.run({
        type: "assign.set",
        categoryId: "rent",
        month: "2026-10",
        amount: 29_999,
      }),
    /Cannot unassign cash the category does not hold/,
  );
  assert.throws(
    () =>
      setup.run(
        { type: "assign.set", categoryId: "food", month: "2026-10", amount: 1 },
        "agent",
      ),
    /This decision requires a user action/,
  );
  setup.run({
    type: "assign.set",
    categoryId: "rent",
    month: "2026-10",
    amount: 30_000,
  });
  assert.equal(setup.view().readyToAssign, 70_000);
});
