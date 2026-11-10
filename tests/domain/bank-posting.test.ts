import assert from "node:assert/strict";
import test from "node:test";

import { createBook, execute, type Command } from "../../src/domain/engine";

const posting = (
  patch: Partial<Extract<Command, { type: "transaction.upsert" }>> = {},
) => ({
  type: "transaction.upsert" as const,
  id: "bank-posted",
  transactionId: "purchase",
  accountId: "cash",
  date: "2026-10-20",
  amount: -2000,
  payee: "Coffee shop",
  status: "posted" as const,
  providerId: "posted-record",
  ...patch,
});

function pendingPurchase(reviewed = true) {
  let book = createBook("alice", "Alice", "2026-10");
  book = execute(book, "alice", {
    type: "account.add",
    id: "cash",
    accountId: "cash",
    name: "Cash",
    kind: "cash",
    openingBalance: 10000,
  });
  book = execute(book, "alice", {
    type: "category.add",
    id: "dining",
    categoryId: "dining",
    name: "Dining out",
  });
  book = execute(book, "alice", {
    type: "category.add",
    id: "travel",
    categoryId: "travel",
    name: "Travel",
  });
  return execute(
    book,
    "alice",
    posting({
      id: "pending",
      status: "pending",
      categoryId: "dining",
      providerId: "pending-record",
    }),
    reviewed ? "user" : "agent",
  );
}

void test("a bank posting preserves approval only for unchanged reviewed financial activity", () => {
  const pending = pendingPurchase();
  const posted = execute(
    pending,
    "alice",
    posting({ payee: "COFFEE SHOP #123" }),
    "agent",
  );
  const transaction = posted.budgets.alice!.transactions.find(
    ({ id }) => id === "purchase",
  )!;
  assert.equal(transaction.reviewed, true);
  assert.equal(transaction.status, "posted");
  assert.equal(transaction.categoryId, "dining");
  assert.equal(transaction.history.length, 2);
  assert.equal(transaction.providerId, "posted-record");
  assert.equal(
    pending.budgets.alice!.transactions.find(({ id }) => id === "purchase")!
      .status,
    "pending",
  );
});

void test("new, unreviewed, or financially changed bank activity still requires approval", () => {
  for (const patch of [
    { amount: -2200 },
    { date: "2026-10-21" },
    { categoryId: "travel" },
    { expenseMonth: "2026-11" },
    { transactionId: "new-purchase" },
  ]) {
    const posted = execute(
      pendingPurchase(),
      "alice",
      posting({ ...patch, reviewed: true }),
      "agent",
    );
    assert.equal(
      posted.budgets.alice!.transactions.find(
        ({ id }) => id === (patch.transactionId ?? "purchase"),
      )!.reviewed,
      false,
      JSON.stringify(patch),
    );
  }
  const unreviewed = execute(
    pendingPurchase(false),
    "alice",
    posting(),
    "agent",
  );
  assert.equal(
    unreviewed.budgets.alice!.transactions.find(({ id }) => id === "purchase")!
      .reviewed,
    false,
  );
});

void test("a bank update that changes nothing approved keeps a purchase approved", () => {
  const posted = execute(pendingPurchase(), "alice", posting(), "agent");
  const resent = execute(
    posted,
    "alice",
    posting({ id: "bank-resent", payee: "COFFEE SHOP #123" }),
    "agent",
  );
  assert.equal(
    resent.budgets.alice!.transactions.find(({ id }) => id === "purchase")!
      .reviewed,
    true,
  );
});

function pendingTransfer() {
  let book = pendingPurchase();
  book = execute(book, "alice", {
    type: "account.add",
    id: "savings",
    accountId: "savings",
    name: "Savings",
    kind: "cash",
    openingBalance: 0,
  });
  return execute(book, "alice", {
    type: "transaction.upsert",
    id: "pending-transfer",
    transactionId: "move",
    accountId: "cash",
    transferAccountId: "savings",
    date: "2026-10-20",
    amount: -5000,
    payee: "Savings",
    status: "pending",
  });
}

const transferPosting = (
  patch: Partial<Extract<Command, { type: "transaction.upsert" }>> = {},
) => ({
  type: "transaction.upsert" as const,
  id: "transfer-posted",
  transactionId: "move",
  accountId: "cash",
  transferAccountId: "savings",
  date: "2026-10-20",
  amount: -5000,
  payee: "Savings",
  status: "posted" as const,
  revision: 2,
  ...patch,
});

const transferSides = (book: ReturnType<typeof pendingTransfer>) =>
  book.budgets.alice!.transactions.filter(
    ({ kind, removed }) => kind === "transfer" && !removed,
  );

void test("a bank posting keeps an approved transfer approved on both sides", () => {
  const posted = execute(
    pendingTransfer(),
    "alice",
    transferPosting(),
    "agent",
  );
  const sides = transferSides(posted);
  assert.equal(sides.length, 2);
  assert.deepEqual(
    sides.map(({ status, reviewed }) => ({ status, reviewed })),
    [
      { status: "posted", reviewed: true },
      { status: "posted", reviewed: true },
    ],
  );
});

void test("a bank update that changes a transfer's amount still requires approval", () => {
  const posted = execute(
    pendingTransfer(),
    "alice",
    transferPosting({ amount: -5500 }),
    "agent",
  );
  assert.deepEqual(
    transferSides(posted).map(({ reviewed }) => reviewed),
    [false, false],
  );
});
