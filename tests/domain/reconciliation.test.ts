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

// Checking opens with $1,000.00, then a cleared $40.00 grocery run and a
// $25.00 dinner still pending at the bank: a $960.00 cleared balance.
function checking() {
  let book = createBook("alan", "Alan", month);
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
    return book;
  };
  run({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  run({ type: "category.add", categoryId: "food", name: "Food" });
  run({
    type: "transaction.upsert",
    transactionId: "groceries",
    accountId: "checking",
    date: "2026-10-05",
    amount: -4_000,
    payee: "Grocer",
    categoryId: "food",
    status: "posted",
  });
  run({
    type: "transaction.upsert",
    transactionId: "dinner",
    accountId: "checking",
    date: "2026-10-09",
    amount: -2_500,
    payee: "Bistro",
    categoryId: "food",
    status: "pending",
  });
  return {
    run,
    view: () => projectBook(book, "alan", month),
    transaction: (id: string) =>
      projectBook(book, "alan", month).budget.transactions.find(
        (item) => item.id === id,
      )!,
    account: (id: string) =>
      projectBook(book, "alan", month).accounts.find((item) => item.id === id)!,
  };
}

void test("a matching bank balance locks cleared transactions and leaves pending ones open", () => {
  const setup = checking();
  assert.equal(setup.account("checking").cleared, 96_000);

  setup.run({
    type: "account.reconcile",
    accountId: "checking",
    date: "2026-10-10",
    balance: 96_000,
  });

  assert.equal(setup.transaction("groceries").reconciled, true);
  assert.equal(setup.transaction("dinner").reconciled, undefined);
  assert.deepEqual(setup.account("checking").reconciled, {
    date: "2026-10-10",
    balance: 96_000,
  });
});

void test("a mismatched bank balance is refused unless the user asks for an adjustment", () => {
  const setup = checking();
  assert.throws(
    () =>
      setup.run({
        type: "account.reconcile",
        accountId: "checking",
        date: "2026-10-10",
        balance: 95_000,
      }),
    /doesn't match/,
  );
  assert.equal(setup.transaction("groceries").reconciled, undefined);
  assert.equal(setup.account("checking").reconciled, undefined);
});

void test("an adjustment for the difference clears to the bank's balance and leaves Ready to Assign", () => {
  const setup = checking();
  const before = setup.view().readyToAssign;

  setup.run({
    type: "account.reconcile",
    accountId: "checking",
    date: "2026-10-10",
    balance: 95_000,
    adjustmentId: "adjustment",
  });

  const adjustment = setup.transaction("adjustment");
  assert.equal(adjustment.payee, "Reconciliation balance adjustment");
  assert.equal(adjustment.amount, -1_000);
  assert.equal(adjustment.date, "2026-10-10");
  assert.equal(adjustment.status, "posted");
  assert.equal(adjustment.kind, "adjustment");
  assert.equal(adjustment.categoryId, undefined);
  assert.equal(adjustment.reconciled, true);
  assert.equal(setup.account("checking").cleared, 95_000);
  assert.equal(setup.view().readyToAssign, before - 1_000);
});

void test("an adjustment is refused when the balances already match", () => {
  const setup = checking();
  assert.throws(
    () =>
      setup.run({
        type: "account.reconcile",
        accountId: "checking",
        date: "2026-10-10",
        balance: 96_000,
        adjustmentId: "adjustment",
      }),
    /already matches/,
  );
});

void test("a reconciled transaction keeps its amount and cleared status but can be recategorized, renamed, or deleted", () => {
  const setup = checking();
  setup.run({ type: "category.add", categoryId: "home", name: "Home" });
  setup.run({
    type: "account.reconcile",
    accountId: "checking",
    date: "2026-10-10",
    balance: 96_000,
  });
  const edit = (changes: Partial<WithoutId<Command>>) =>
    setup.run({
      type: "transaction.upsert",
      transactionId: "groceries",
      accountId: "checking",
      date: "2026-10-05",
      amount: -4_000,
      payee: "Grocer",
      categoryId: "food",
      status: "posted",
      revision: setup.transaction("groceries").revision + 1,
      ...changes,
    } as WithoutId<Command>);

  assert.throws(() => edit({ amount: -4_500 }), /reconciled/);
  assert.throws(() => edit({ status: "pending" }), /reconciled/);
  edit({ payee: "Corner Grocer", categoryId: "home" });
  assert.equal(setup.transaction("groceries").payee, "Corner Grocer");
  assert.equal(setup.transaction("groceries").reconciled, true);

  setup.run({ type: "transaction.remove", transactionId: "groceries" });
  assert.equal(setup.account("checking").cleared, 100_000);
});

void test("an adjustment can be deleted to reconcile again", () => {
  const setup = checking();
  setup.run({
    type: "account.reconcile",
    accountId: "checking",
    date: "2026-10-10",
    balance: 95_000,
    adjustmentId: "adjustment",
  });
  setup.run({ type: "transaction.remove", transactionId: "adjustment" });
  assert.equal(setup.account("checking").cleared, 96_000);
});

void test("only the user can confirm a reconciliation", () => {
  const setup = checking();
  assert.throws(
    () =>
      setup.run(
        {
          type: "account.reconcile",
          accountId: "checking",
          date: "2026-10-10",
          balance: 95_000,
          adjustmentId: "adjustment",
        },
        "agent",
      ),
    /requires a user action/,
  );
});

void test("editing a transfer keeps both sides' locks, and a reconciled side keeps its amount", () => {
  const setup = checking();
  setup.run({
    type: "account.add",
    accountId: "savings",
    name: "Savings",
    kind: "cash",
    openingBalance: 0,
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "to-savings",
    accountId: "checking",
    date: "2026-10-06",
    amount: -10_000,
    payee: "Transfer",
    status: "posted",
    transferAccountId: "savings",
  });
  const counterpartId = setup
    .view()
    .budget.transactions.find(
      (item) => item.accountId === "savings" && !item.removed,
    )!.id;
  setup.run({
    type: "account.reconcile",
    accountId: "savings",
    date: "2026-10-10",
    balance: 10_000,
  });
  const save = (changes: { date?: string; amount?: number }) =>
    setup.run({
      type: "transaction.upsert",
      transactionId: "to-savings",
      accountId: "checking",
      date: "2026-10-06",
      amount: -10_000,
      payee: "Transfer",
      status: "posted",
      transferAccountId: "savings",
      revision: setup.transaction("to-savings").revision + 1,
      ...changes,
    });

  assert.throws(() => save({ amount: -12_000 }), /reconciled/);
  save({ date: "2026-10-07" });
  assert.equal(setup.transaction(counterpartId).date, "2026-10-07");
  assert.equal(setup.transaction(counterpartId).reconciled, true);
  assert.equal(setup.transaction("to-savings").reconciled, undefined);
});
