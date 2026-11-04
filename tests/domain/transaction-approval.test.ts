import assert from "node:assert/strict";
import test from "node:test";
import {
  createBook,
  execute,
  projectBook,
  type Command,
} from "../../src/domain/engine";

function recordedPurchases() {
  let book = createBook("owner", "Review", "2026-10");
  const commands: Command[] = [
    {
      type: "account.add",
      id: "account",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      openingBalance: 100_000,
    },
    { type: "category.add", id: "category", categoryId: "food", name: "Food" },
    {
      type: "assign",
      id: "assign",
      categoryId: "food",
      month: "2026-10",
      amount: 20_000,
    },
    {
      type: "transaction.upsert",
      id: "categorized",
      transactionId: "categorized",
      accountId: "checking",
      categoryId: "food",
      amount: -1_000,
      date: "2026-10-02",
      payee: "Market",
      reviewed: false,
    },
    {
      type: "transaction.upsert",
      id: "uncategorized",
      transactionId: "uncategorized",
      accountId: "checking",
      amount: -2_000,
      date: "2026-10-02",
      payee: "Hardware",
      reviewed: false,
    },
  ];
  for (const command of commands) book = execute(book, "owner", command);
  return book;
}

void test("approval refuses the entire batch when a purchase still needs a category", () => {
  const book = recordedPurchases();
  assert.throws(
    () =>
      execute(book, "owner", {
        type: "transaction.approve",
        id: "approve",
        transactionIds: ["categorized", "uncategorized"],
      }),
    /Categorize purchases before approval/,
  );
  assert.deepEqual(
    book.budgets
      .owner!.transactions.filter(({ kind }) => kind === "purchase")
      .map(({ reviewed }) => reviewed),
    [false, false],
  );
  const approved = projectBook(
    execute(book, "owner", {
      type: "transaction.approve",
      id: "approve-one",
      transactionIds: ["categorized"],
    }),
    "owner",
    "2026-10",
  );
  assert.equal(
    approved.budget.transactions.find(({ id }) => id === "categorized")!
      .reviewed,
    true,
  );
  assert.equal(
    approved.budget.transactions.find(({ id }) => id === "uncategorized")!
      .reviewed,
    false,
  );
  assert.equal(approved.cash, 97_000);
  assert.equal(
    approved.categories.find(({ id }) => id === "food")!.available,
    19_000,
  );
});

void test("approval rejects more than 500 recorded transactions before changing review status", () => {
  const book = recordedPurchases();
  assert.throws(
    () =>
      execute(book, "owner", {
        type: "transaction.approve",
        id: "oversized",
        transactionIds: Array.from(
          { length: 501 },
          (_, index) => `transaction-${index}`,
        ),
      }),
    /500/,
  );
  assert.deepEqual(
    book.budgets
      .owner!.transactions.filter(({ kind }) => kind === "purchase")
      .map(({ reviewed }) => reviewed),
    [false, false],
  );
});

void test("categorizing posted purchases leaves approval separate, including in a batch", () => {
  const book = execute(recordedPurchases(), "owner", {
    type: "transaction.categorize.batch",
    id: "categorize-both",
    transactionIds: ["categorized", "uncategorized"],
    categoryId: "food",
  });
  const view = projectBook(book, "owner", "2026-10");
  assert.deepEqual(
    view.budget.transactions
      .filter(({ kind }) => kind === "purchase")
      .map(({ reviewed }) => reviewed),
    [false, false],
  );
  assert.equal(
    view.categories.find(({ id }) => id === "food")!.available,
    17_000,
  );
});
