import assert from "node:assert/strict";
import test from "node:test";
import {
  bookSchema,
  createBook,
  execute,
  projectBook,
  type Book,
  type Command,
  type CommandSource,
} from "../../src/domain/engine";
import { personalSpendingEntries } from "../../src/domain/spending";

// A transaction split into lines, each with its own category and amount.

const month = "2026-10";
const date = "2026-10-10";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

function costcoBudget() {
  let book = createBook("alan", "Alan", month);
  let sequence = 0;
  const run = (
    command: WithoutId<Command>,
    source: CommandSource = "user",
  ): Book => {
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
  run({
    type: "account.add",
    accountId: "visa",
    name: "Visa",
    kind: "credit",
    openingBalance: 0,
  });
  run({ type: "category.add", categoryId: "groceries", name: "Groceries" });
  run({ type: "category.add", categoryId: "household", name: "Household" });
  return {
    run,
    get book() {
      return book;
    },
    category: (id: string) =>
      projectBook(book, "alan", month).categories.find(
        (item) => item.id === id,
      )!,
  };
}

void test("a purchase split across two categories counts each line as that category's activity", () => {
  const budget = costcoBudget();
  budget.run({
    type: "transaction.upsert",
    transactionId: "costco",
    accountId: "checking",
    date,
    amount: -20_000,
    payee: "Costco",
    lines: [
      { lineId: "food", categoryId: "groceries", amount: -15_000 },
      { lineId: "paper", categoryId: "household", amount: -5_000 },
    ],
  });
  assert.equal(budget.category("groceries").activity, -15_000);
  assert.equal(budget.category("household").activity, -5_000);
});

void test("a split is refused unless its lines add up to the amount, each with a spending category and a nonzero amount", () => {
  const budget = costcoBudget();
  const split = (lines: { categoryId: string; amount: number }[]) => () =>
    budget.run({
      type: "transaction.upsert",
      transactionId: "costco",
      accountId: "checking",
      date,
      amount: -20_000,
      payee: "Costco",
      lines: lines.map((line, index) => ({ lineId: `line-${index}`, ...line })),
    });
  assert.throws(
    split([
      { categoryId: "groceries", amount: -15_000 },
      { categoryId: "household", amount: -4_000 },
    ]),
    /Split lines must add up to the transaction amount/,
  );
  assert.throws(
    split([
      { categoryId: "groceries", amount: -20_000 },
      { categoryId: "household", amount: 0 },
    ]),
    /Enter an amount on every split line/,
  );
  assert.throws(
    split([
      { categoryId: "groceries", amount: -15_000 },
      { categoryId: "missing", amount: -5_000 },
    ]),
    /Category/,
  );
  assert.equal(
    budget.book.budgets.alan!.transactions.some((item) => item.id === "costco"),
    false,
  );
});

void test("a split card purchase moves each line's funded money into the card payment, and a return line on the receipt refunds its category", () => {
  const budget = costcoBudget();
  budget.run({
    type: "assign",
    categoryId: "groceries",
    month,
    amount: 15_000,
  });
  budget.run({
    type: "assign",
    categoryId: "household",
    month,
    amount: 5_000,
  });
  budget.run({
    type: "transaction.upsert",
    transactionId: "costco",
    accountId: "visa",
    date,
    amount: -17_000,
    payee: "Costco",
    lines: [
      { lineId: "food", categoryId: "groceries", amount: -15_000 },
      { lineId: "paper", categoryId: "household", amount: -5_000 },
      { lineId: "return", categoryId: "household", amount: 3_000 },
    ],
  });
  const payment = projectBook(budget.book, "alan", month).categories.find(
    (item) => item.pairedAccountId === "visa",
  )!;
  assert.equal(budget.category("groceries").available, 0);
  assert.equal(budget.category("household").activity, -2_000);
  assert.equal(budget.category("household").available, 3_000);
  assert.equal(payment.available, 17_000);
});

void test("categorizing a split transaction replaces its lines with the one category", () => {
  const budget = costcoBudget();
  budget.run({
    type: "transaction.upsert",
    transactionId: "costco",
    accountId: "checking",
    date,
    amount: -20_000,
    payee: "Costco",
    lines: [
      { lineId: "food", categoryId: "groceries", amount: -15_000 },
      { lineId: "paper", categoryId: "household", amount: -5_000 },
    ],
  });
  budget.run({
    type: "transaction.categorize",
    transactionId: "costco",
    categoryId: "household",
  });
  assert.equal(budget.category("groceries").activity, 0);
  assert.equal(budget.category("household").activity, -20_000);
});

void test("when the bank changes a split transaction's amount, its lines scale in proportion and it goes back to review", () => {
  const budget = costcoBudget();
  budget.run({
    type: "transaction.upsert",
    transactionId: "costco",
    accountId: "checking",
    date,
    amount: -20_000,
    payee: "Costco",
    status: "pending",
    lines: [
      { lineId: "food", categoryId: "groceries", amount: -15_000 },
      { lineId: "paper", categoryId: "household", amount: -5_000 },
    ],
  });
  const posted = (amount: number) =>
    budget.run(
      {
        type: "transaction.upsert",
        transactionId: "costco",
        accountId: "checking",
        date,
        amount,
        payee: "Costco",
        status: "posted",
      },
      "agent",
    );
  posted(-20_000);
  assert.equal(budget.category("groceries").activity, -15_000);
  assert.equal(budget.category("household").activity, -5_000);
  posted(-22_000);
  assert.equal(budget.category("groceries").activity, -16_500);
  assert.equal(budget.category("household").activity, -5_500);
  posted(-22_001);
  assert.equal(budget.category("groceries").activity, -16_501);
  assert.equal(budget.category("household").activity, -5_500);
  const costco = budget.book.budgets.alan!.transactions.find(
    (item) => item.id === "costco",
  )!;
  assert.equal(costco.reviewed, false);
});

void test("a split counts as categorized: an imported split purchase can be approved and a split inflow is a refund", () => {
  const budget = costcoBudget();
  budget.run(
    {
      type: "transaction.upsert",
      transactionId: "costco",
      accountId: "checking",
      date,
      amount: -20_000,
      payee: "Costco",
      lines: [
        { lineId: "food", categoryId: "groceries", amount: -15_000 },
        { lineId: "paper", categoryId: "household", amount: -5_000 },
      ],
    },
    "agent",
  );
  budget.run({ type: "transaction.approve", transactionIds: ["costco"] });
  budget.run({
    type: "transaction.upsert",
    transactionId: "costco-return",
    accountId: "checking",
    date,
    amount: 4_000,
    payee: "Costco",
    lines: [
      { lineId: "food", categoryId: "groceries", amount: 3_000 },
      { lineId: "paper", categoryId: "household", amount: 1_000 },
    ],
  });
  const view = projectBook(budget.book, "alan", month);
  assert.equal(
    view.budget.transactions.find((item) => item.id === "costco-return")!.kind,
    "refund",
  );
  assert.equal(view.readyToAssign, 100_000);
  assert.equal(budget.category("groceries").activity, -12_000);
});

void test("personal spending counts each line of a split under its own category", () => {
  const budget = costcoBudget();
  budget.run({
    type: "transaction.upsert",
    transactionId: "costco",
    accountId: "visa",
    date,
    amount: -20_000,
    payee: "Costco",
    lines: [
      { lineId: "food", categoryId: "groceries", amount: -15_000 },
      { lineId: "paper", categoryId: "household", amount: -5_000 },
    ],
  });
  assert.deepStrictEqual(
    personalSpendingEntries(budget.book, "alan").map((entry) => [
      entry.transactionId,
      entry.categoryId,
      entry.amount,
    ]),
    [
      ["costco", "groceries", 15_000],
      ["costco", "household", 5_000],
    ],
  );
});

void test("a split works on a card refund, but not as a transfer or on a tracking account", () => {
  const budget = costcoBudget();
  budget.run({
    type: "account.add",
    accountId: "house",
    name: "House",
    kind: "tracking",
    openingBalance: 0,
  });
  const lines = (sign: number) => [
    { lineId: "food", categoryId: "groceries", amount: sign * 3_000 },
    { lineId: "paper", categoryId: "household", amount: sign * 1_000 },
  ];
  budget.run({
    type: "transaction.upsert",
    transactionId: "costco",
    accountId: "visa",
    date,
    amount: -20_000,
    payee: "Costco",
    categoryId: "groceries",
  });
  budget.run({
    type: "transaction.upsert",
    transactionId: "costco-return",
    accountId: "visa",
    date,
    amount: 4_000,
    payee: "Costco",
    lines: lines(1),
  });
  assert.equal(budget.category("household").activity, 1_000);
  assert.throws(
    () =>
      budget.run({
        type: "transaction.upsert",
        transactionId: "costco-to-savings",
        accountId: "checking",
        date,
        amount: -4_000,
        payee: "Transfer",
        transferAccountId: "visa",
        lines: lines(-1),
      }),
    /A transfer cannot be split/,
  );
  assert.throws(
    () =>
      budget.run({
        type: "transaction.upsert",
        transactionId: "tracked",
        accountId: "house",
        date,
        amount: -4_000,
        payee: "Costco",
        lines: lines(-1),
      }),
    /Tracking activity does not use budget categories/,
  );
});

void test("a stored split whose line names a category the budget doesn't have does not read", () => {
  const budget = costcoBudget();
  budget.run({
    type: "transaction.upsert",
    transactionId: "costco",
    accountId: "checking",
    date,
    amount: -20_000,
    payee: "Costco",
    lines: [
      { lineId: "food", categoryId: "groceries", amount: -15_000 },
      { lineId: "paper", categoryId: "household", amount: -5_000 },
    ],
  });
  const stored = structuredClone(budget.book);
  stored.budgets.alan!.transactions.find(
    ({ id }) => id === "costco",
  )!.lines![1]!.categoryId = "gone";
  assert.equal(bookSchema.safeParse(stored).success, false);
});
