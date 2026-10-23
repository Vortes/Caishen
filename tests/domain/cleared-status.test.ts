import assert from "node:assert/strict";
import test from "node:test";
import {
  createBook,
  execute,
  projectBook,
  type Command,
} from "../../src/domain/engine";

function checkingWithGroceries() {
  let book = createBook("owner", "Cleared status", "2026-10");
  const setup: Command[] = [
    {
      type: "account.add",
      id: "account",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      openingBalance: 100_000,
    },
    {
      type: "category.add",
      id: "groceries",
      categoryId: "groceries",
      name: "Groceries",
    },
  ];
  for (const command of setup) book = execute(book, "owner", command);
  return book;
}

const grocer = {
  type: "transaction.upsert",
  id: "grocer",
  transactionId: "grocer",
  accountId: "checking",
  date: "2026-10-04",
  payee: "Corner Grocer",
  amount: -4_210,
  categoryId: "groceries",
} as const;

const checking = (book: ReturnType<typeof createBook>) =>
  projectBook(book, "owner", "2026-10").accounts.find(
    ({ id }) => id === "checking",
  )!;

void test("a posted transaction left uncleared stays out of the cleared balance until it's cleared", () => {
  const entered = execute(checkingWithGroceries(), "owner", {
    ...grocer,
    status: "posted",
    cleared: false,
  });
  assert.equal(checking(entered).balance, 95_790);
  assert.equal(checking(entered).cleared, 100_000);

  const cleared = execute(entered, "owner", {
    ...grocer,
    id: "clear-grocer",
    status: "posted",
    cleared: true,
  });
  assert.equal(checking(cleared).balance, 95_790);
  assert.equal(checking(cleared).cleared, 95_790);
});

void test("the bank posting a pending transaction clears it", () => {
  const pending = execute(
    checkingWithGroceries(),
    "owner",
    { ...grocer, status: "pending", providerId: "bank-grocer" },
    "provider",
  );
  assert.equal(checking(pending).cleared, 100_000);

  const posted = execute(
    pending,
    "owner",
    {
      ...grocer,
      id: "grocer-posted",
      status: "posted",
      providerId: "bank-grocer",
    },
    "provider",
  );
  assert.equal(checking(posted).cleared, 95_790);
});
