import assert from "node:assert/strict";
import test from "node:test";
import { toShellData } from "../../src/components/app-shell/model";
import { viewOf } from "../../src/components/app-shell/plan-view";
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
function setup(cardBalance = 0) {
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
    openingBalance: cardBalance,
    date: "2026-10-01",
  });
  for (const name of ["Gifts", "Dining", "Household", "Phone"])
    run({ type: "category.add", categoryId: name, name });
  const data = (viewMonth = month, activeMonth = month) =>
    toShellData(
      {
        view: projectBook(book, "owner", viewMonth, month),
        connections: [],
        imports: [],
      },
      activeMonth,
    );
  return { run, data };
}

void test("a positive payment reserve below the working balance is underfunded", () => {
  const { run, data } = setup(-552_290);
  run({ type: "assign", categoryId: "card:card", month, amount: 11_042 });
  const payment = data().categories.find(
    (category) => category.id === "card:card",
  )!;
  assert.equal(payment.funding, "underfunded");
});

void test("a zero payment reserve is underfunded while the card has debt", () => {
  const { data } = setup(-1_385);
  const payment = data().categories.find(
    (category) => category.id === "card:card",
  )!;
  assert.equal(payment.funding, "underfunded");
});

void test("the payment shortfall explains how much cash is needed to pay in full", () => {
  const { run, data } = setup(-552_290);
  run({ type: "assign", categoryId: "card:card", month, amount: 11_042 });
  const payment = data().categories.find(
    (category) => category.id === "card:card",
  )!;
  assert.equal(payment.status, "$5,412.48 more needed to pay in full");
});

for (const [period, viewMonth, activeMonth] of [
  ["past", "2026-10", "2026-11"],
  ["future", "2026-11", "2026-10"],
] as const) {
  void test(`the implicit full-balance warning does not apply to a ${period} month`, () => {
    const { run, data } = setup(-552_290);
    run({ type: "assign", categoryId: "card:card", month, amount: 11_042 });
    const payment = data(viewMonth, activeMonth).categories.find(
      (category) => category.id === "card:card",
    )!;
    assert.equal(payment.funding, "funded");
  });
}

void test("a funded monthly payment target replaces the full-balance funding requirement", () => {
  const { run, data } = setup(-30_000);
  run({
    type: "target.set",
    categoryId: "card:card",
    target: {
      cadence: "card-monthly",
      behavior: "contribution",
      amount: 5_000,
      startMonth: month,
      snoozedMonths: [],
    },
  });
  run({ type: "assign", categoryId: "card:card", month, amount: 5_000 });
  const payment = data().categories.find(
    (category) => category.id === "card:card",
  )!;
  assert.equal(payment.funding, "funded");
});

for (const [description, balance, reserve, expectedFunding] of [
  ["a debt-free card", 0, 0, "empty"],
  ["a fully reserved card", -30_000, 30_000, "funded"],
] as const) {
  void test(`${description} has no payment funding warning`, () => {
    const { run, data } = setup(balance);
    if (reserve > 0)
      run({ type: "assign", categoryId: "card:card", month, amount: reserve });
    const payment = data().categories.find(
      (category) => category.id === "card:card",
    )!;
    assert.equal(payment.funding, expectedFunding);
  });
}

void test("funded card purchases move cash into the payment reserve", () => {
  const { run, data } = setup();
  run({ type: "assign", categoryId: "Gifts", month, amount: 5_000 });
  run({
    type: "transaction.upsert",
    transactionId: "purchase",
    accountId: "card",
    categoryId: "Gifts",
    amount: -5_000,
    date: "2026-10-02",
    payee: "Store",
  });
  const payment = data().categories.find(
    (category) => category.id === "card:card",
  )!;
  assert.equal(payment.available, 5_000);
});

void test("a card payment consumes cash from the payment reserve", () => {
  const { run, data } = setup(-5_000);
  run({ type: "assign", categoryId: "card:card", month, amount: 5_000 });
  run({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "card",
    date: "2026-10-03",
    amount: 2_000,
  });
  const payment = data().categories.find(
    (category) => category.id === "card:card",
  )!;
  assert.equal(payment.available, 3_000);
});

void test("paying the card does not count the purchase as a second expense", () => {
  const { run, data } = setup();
  run({ type: "assign", categoryId: "Gifts", month, amount: 5_000 });
  run({
    type: "transaction.upsert",
    transactionId: "purchase",
    accountId: "card",
    categoryId: "Gifts",
    amount: -5_000,
    date: "2026-10-02",
    payee: "Store",
  });
  run({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "card",
    date: "2026-10-03",
    amount: 2_000,
  });
  const spendingActivity = data()
    .categories.filter((category) => !category.pays)
    .reduce((total, category) => total + category.activity, 0);
  assert.equal(spendingActivity, -5_000);
});

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
  assert.deepEqual(matches("underfunded"), [
    "Card payment",
    "Dining",
    "Household",
    "Phone",
  ]);
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
