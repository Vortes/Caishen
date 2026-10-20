import assert from "node:assert/strict";
import test from "node:test";

import {
  addMember,
  createBook,
  execute,
  type Command,
} from "../../src/domain/engine";

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

function pendingPurchase(shared = false, reviewed = true) {
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
  if (shared) {
    book = addMember(book, "bob", "Bob", "2026-10");
    book = execute(book, "alice", {
      type: "shared.create",
      id: "shared",
      sharedCategoryId: "shared-dining",
      participants: ["alice", "bob"],
      categoryIds: { alice: "dining", bob: "dining-bob" },
      weights: { alice: 1, bob: 1 },
    });
  }
  return execute(
    book,
    "alice",
    {
      ...posting({
        id: "pending",
        status: "pending",
        categoryId: "dining",
        providerId: "pending-record",
      }),
      sharedCategoryId: shared ? "shared-dining" : undefined,
    },
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
  const transaction = posted.budgets.alice!.transactions[0]!;
  assert.equal(transaction.reviewed, true);
  assert.equal(transaction.status, "posted");
  assert.equal(transaction.categoryId, "dining");
  assert.equal(transaction.history.length, 2);
  assert.equal(transaction.providerId, "posted-record");
  assert.equal(pending.budgets.alice!.transactions[0]!.status, "pending");
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
      posted.budgets.alice!.transactions.at(-1)!.reviewed,
      false,
      JSON.stringify(patch),
    );
  }
  const unreviewed = execute(
    pendingPurchase(false, false),
    "alice",
    posting(),
    "agent",
  );
  assert.equal(unreviewed.budgets.alice!.transactions[0]!.reviewed, false);
});

void test("bank posting preserves shared approval only when shares and split weights stay the same", () => {
  const pending = pendingPurchase(true);
  const unchanged = execute(pending, "alice", posting(), "agent");
  assert.equal(unchanged.budgets.alice!.transactions[0]!.reviewed, true);
  for (const shares of [
    { alice: 1200, bob: 800 },
    { alice: 1000, bob: 1000 },
  ]) {
    const changed = execute(pending, "alice", posting({ shares }), "agent");
    assert.equal(changed.budgets.alice!.transactions[0]!.reviewed, false);
  }
});
