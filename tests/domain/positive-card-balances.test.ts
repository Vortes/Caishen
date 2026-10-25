import assert from "node:assert/strict";
import test from "node:test";
import {
  createBook,
  execute,
  projectBook,
  type Command,
} from "../../src/domain/engine";

const month = "2026-10";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

function fixture(openingBalance: number, cash = 100_000) {
  let book = createBook("alice", "Alice", month);
  let sequence = 0;
  const run = (command: WithoutId<Command>) => {
    book = execute(book, "alice", {
      ...command,
      id: `operation-${++sequence}`,
    });
  };
  run({
    type: "account.add",
    accountId: "cash",
    name: "Checking",
    kind: "cash",
    openingBalance: cash,
  });
  run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance,
  });
  run({ type: "category.add", categoryId: "food", name: "Food" });
  return {
    run,
    view: (selectedMonth = month) => projectBook(book, "alice", selectedMonth),
  };
}

void test("a positive card opening is assignable without creating payment reserves or income", () => {
  const f = fixture(10_000, 0);
  assert.equal(f.view().readyToAssign, 10_000);
  assert.equal(f.view().earnings, 0);
  assert.equal(f.view().accounts.find((a) => a.id === "card")!.reserve, 0);
  f.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  assert.equal(f.view().readyToAssign, 0);
  assert.equal(
    f.view().categories.find((c) => c.id === "food")!.available,
    10_000,
  );
  assert.equal(f.view("2026-11").readyToAssign, 0);
});

void test("purchases below, at, and across zero reserve only the newly borrowed portion", () => {
  for (const [amount, balance, reserve, cashActivity, ready] of [
    [6000, 4000, 0, -6000, 104_000],
    [10_000, 0, 0, -10_000, 100_000],
    [15_000, -5000, 5000, -10_000, 95_000],
  ] as const) {
    const f = fixture(10_000);
    f.run({ type: "assign", categoryId: "food", month, amount });
    f.run({
      type: "transaction.upsert",
      transactionId: "purchase",
      accountId: "card",
      date: "2026-10-10",
      amount: -amount,
      payee: "Groceries",
      categoryId: "food",
    });
    const view = f.view();
    const card = view.accounts.find((a) => a.id === "card")!;
    assert.equal(card.balance, balance);
    assert.equal(card.reserve, reserve);
    assert.equal(card.fundedSpending, reserve);
    assert.equal(
      view.categories.find((c) => c.id === "food")!.cashActivity,
      cashActivity,
    );
    assert.equal(view.readyToAssign, ready);
    assert.equal(f.view("2026-11").readyToAssign, view.readyToAssign);
  }
});

void test("statement credits reaching and crossing zero preserve the payment reserve through later spending", () => {
  for (const [credit, balance, ready] of [
    [5000, 0, 95_000],
    [8000, 3000, 98_000],
  ] as const) {
    const f = fixture(-5000);
    f.run({ type: "assign", categoryId: "card:card", month, amount: 5000 });
    f.run({
      type: "transaction.upsert",
      transactionId: "statement-credit",
      payee: "Posted statement credit",
      status: "posted",
      accountId: "card",
      date: "2026-10-05",
      amount: credit,
    });
    assert.equal(
      f.view().accounts.find((a) => a.id === "card")!.balance,
      balance,
    );
    assert.equal(f.view().accounts.find((a) => a.id === "card")!.reserve, 5000);
    assert.equal(f.view().readyToAssign, ready);
    f.run({ type: "assign", categoryId: "food", month, amount: 4000 });
    f.run({
      type: "transaction.upsert",
      transactionId: "purchase",
      accountId: "card",
      date: "2026-10-10",
      amount: -4000,
      payee: "Groceries",
      categoryId: "food",
    });
    assert.equal(
      f.view().accounts.find((a) => a.id === "card")!.reserve,
      balance ? 6000 : 9000,
    );
    assert.equal(f.view("2026-11").readyToAssign, ready - 4000);
  }
});

void test("a posted refund crossing zero restores its category and subsequent unfunded purchases split cash and credit overspending", () => {
  const f = fixture(-5000);
  f.run({ type: "assign", categoryId: "card:card", month, amount: 5000 });
  const refund = {
    type: "transaction.upsert",
    transactionId: "refund",
    accountId: "card",
    date: "2026-10-05",
    amount: 8000,
    payee: "Return",
    categoryId: "food",
  } as const;
  f.run({ ...refund, status: "pending" });
  assert.equal(f.view().readyToAssign, 95_000);
  assert.equal(f.view().categories.find((c) => c.id === "food")!.available, 0);
  f.run({ ...refund, status: "posted" });
  assert.equal(f.view().accounts.find((a) => a.id === "card")!.balance, 3000);
  assert.equal(f.view().accounts.find((a) => a.id === "card")!.reserve, 0);
  assert.equal(
    f.view().categories.find((c) => c.id === "food")!.available,
    8000,
  );
  assert.equal(f.view().readyToAssign, 95_000);
  f.run({ type: "category.add", categoryId: "fun", name: "Fun" });
  f.run({
    type: "transaction.upsert",
    transactionId: "purchase",
    accountId: "card",
    date: "2026-10-10",
    amount: -4000,
    payee: "Unfunded purchase",
    categoryId: "fun",
  });
  assert.equal(
    f.view().categories.find((c) => c.id === "fun")!.cashOverspending,
    3000,
  );
  assert.equal(f.view().accounts.find((a) => a.id === "card")!.shortfall, 1000);
  assert.equal(f.view().readyToAssign, 95_000);
  assert.equal(f.view("2026-11").readyToAssign, 92_000);
});
