import assert from "node:assert/strict";
import test from "node:test";
import {
  applyChangeSet,
  executeRevert,
  stampChangeSet,
  toRowSet,
} from "../../src/domain/change-sets";
import {
  createBook,
  execute,
  executeWithChanges,
  type Book,
  type Command,
  type CommandSource,
} from "../../src/domain/engine";
import { rememberedCategory } from "../../src/domain/payee-memory";
import { bookToRows } from "../../src/domain/rows";
import { READY_TO_ASSIGN } from "../../src/domain/transfers";

type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

// Alan's budget: Checking, a Visa card, a tracking account, and two
// spending categories.
function budget() {
  let book: Book = createBook("alan", "Alan", "2026-10");
  let sequence = 0;
  const run = (command: WithoutId<Command>, source: CommandSource = "user") => {
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
    openingBalance: 500_000,
    date: "2026-10-01",
  });
  run({ type: "category.add", categoryId: "groceries", name: "Groceries" });
  run({ type: "category.add", categoryId: "household", name: "Household" });
  return {
    run,
    get book() {
      return book;
    },
    purchase: (
      transactionId: string,
      payee: string,
      categoryId: string | undefined,
      date = "2026-10-10",
      source: CommandSource = "user",
    ) =>
      run(
        {
          type: "transaction.upsert",
          transactionId,
          accountId: "checking",
          date,
          amount: -4_210,
          payee,
          status: "posted",
          categoryId,
        },
        source,
      ),
    remembered: (payee: string, accountId = "checking", amount?: number) =>
      rememberedCategory(book.budgets.alan!, { payee, accountId, amount }),
  };
}

void test("categorizing a payee once remembers it for the same payee however it is written", () => {
  const alan = budget();
  alan.purchase("first", "Trader Joe’s", "groceries");
  for (const payee of [
    "Trader Joe’s",
    "Trader Joe's",
    "TRADER JOES",
    "trader-joes",
  ])
    assert.equal(
      alan.remembered(payee, "checking", -1_000),
      "groceries",
      payee,
    );
  assert.equal(alan.remembered("Whole Foods Market"), undefined);
});

void test("the most recent categorization wins, whatever the transactions' dates", () => {
  const alan = budget();
  alan.purchase("newer", "Trader Joe's", "groceries", "2026-10-20");
  alan.purchase("older", "Trader Joe's", undefined, "2026-10-02");
  assert.equal(alan.remembered("Trader Joe's"), "groceries");
  alan.run({
    type: "transaction.categorize",
    transactionId: "older",
    categoryId: "household",
  });
  assert.equal(alan.remembered("Trader Joe's"), "household");
  // Changing only the amount of the newer one isn't a categorization.
  alan.run({
    type: "transaction.upsert",
    transactionId: "newer",
    accountId: "checking",
    date: "2026-10-20",
    amount: -5_000,
    payee: "Trader Joe's",
    status: "posted",
    categoryId: "groceries",
  });
  assert.equal(alan.remembered("Trader Joe's"), "household");
});

void test("only the user's own categorizations are remembered", () => {
  const alan = budget();
  alan.purchase("bank", "Trader Joe's", "groceries", "2026-10-10", "provider");
  alan.purchase("agent", "Trader Joe's", "groceries", "2026-10-11", "agent");
  assert.equal(alan.remembered("Trader Joe's"), undefined);
});

void test("explicitly choosing a transaction's current category refreshes its payee's memory", () => {
  const alan = budget();
  alan.purchase("groceries-run", "Trader Joe's", "groceries");
  alan.purchase("household-run", "Trader Joe's", "household");
  alan.run({
    type: "transaction.categorize",
    transactionId: "groceries-run",
    categoryId: "groceries",
  });
  assert.equal(alan.remembered("Trader Joe's"), "groceries");
});

void test("removing or rejecting a transaction keeps its payee's memory", () => {
  const alan = budget();
  alan.purchase("kept", "Trader Joe's", "groceries");
  alan.run({ type: "transaction.remove", transactionId: "kept" });
  assert.equal(alan.remembered("Trader Joe's"), "groceries");
  // Saved from a bank import, so it still waits for review.
  alan.run({
    type: "transaction.upsert",
    transactionId: "imported",
    accountId: "checking",
    date: "2026-10-10",
    amount: -8_000,
    payee: "Costco",
    status: "posted",
    categoryId: "household",
    reviewed: false,
  });
  alan.run({ type: "transaction.reject", transactionIds: ["imported"] });
  assert.equal(alan.remembered("Costco"), "household");
});

void test("undoing a categorization brings back what the payee's memory was", () => {
  const alan = budget();
  alan.purchase("first", "Trader Joe's", "groceries");
  const stored = toRowSet(bookToRows(alan.book));
  const recategorized = executeWithChanges(alan.book, "alan", {
    type: "transaction.categorize",
    id: "recategorize",
    transactionId: "first",
    categoryId: "household",
  });
  const remembered = (book: Book) =>
    rememberedCategory(book.budgets.alan!, {
      payee: "Trader Joe's",
      accountId: "checking",
    });
  assert.equal(remembered(recategorized.book), "household");
  const stamped = stampChangeSet(recategorized.changeSet, 1, stored);
  const undone = executeRevert(
    applyChangeSet(stored, stamped),
    { type: "revert", id: "undo", targetOperationId: "recategorize" },
    stamped,
  );
  assert.equal(remembered(undone.book as Book), "groceries");
});

void test("a payee's memory prefills only where it fits the account and direction", () => {
  const alan = budget();
  alan.run({
    type: "account.add",
    accountId: "visa",
    name: "Visa",
    kind: "credit",
    openingBalance: 0,
    date: "2026-10-01",
  });
  alan.run({
    type: "account.add",
    accountId: "brokerage",
    name: "Brokerage",
    kind: "tracking",
    openingBalance: 0,
    date: "2026-10-01",
  });
  // Payroll goes to Ready to Assign, which takes only money coming into
  // a cash account.
  alan.run({
    type: "transaction.upsert",
    transactionId: "salary",
    accountId: "checking",
    date: "2026-10-01",
    amount: 300_000,
    payee: "Acme Payroll",
    status: "posted",
  });
  assert.equal(
    alan.remembered("Acme Payroll", "checking", 300_000),
    READY_TO_ASSIGN,
  );
  assert.equal(alan.remembered("Acme Payroll", "checking"), READY_TO_ASSIGN);
  assert.equal(alan.remembered("Acme Payroll", "checking", -2_000), undefined);
  assert.equal(alan.remembered("Acme Payroll", "visa", 300_000), undefined);
  // A category fits money in either direction, on cash or card.
  alan.purchase("market", "Trader Joe's", "groceries");
  assert.equal(alan.remembered("Trader Joe's", "visa", -1_000), "groceries");
  assert.equal(alan.remembered("Trader Joe's", "checking", 1_000), "groceries");
  assert.equal(alan.remembered("Trader Joe's", "brokerage", -1_000), undefined);
});
