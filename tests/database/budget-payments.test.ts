import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { apiFixture } from "./fixtures";

assertDevelopmentDatabase(process.env);
const month = "2026-10";
const date = "2026-10-02";
async function fixture(t: TestContext) {
  const { people } = await apiFixture(t);
  const person = people[0]!;
  await person.run({
    type: "account.add",
    id: randomUUID(),
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
    date: "2026-10-01",
  });
  await person.run({
    type: "category.add",
    id: randomUUID(),
    categoryId: "groceries",
    name: "Groceries",
  });
  return person;
}
async function cardPurchase(t: TestContext) {
  const person = await fixture(t);
  await person.run({
    type: "account.add",
    id: randomUUID(),
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: -20_000,
    date: "2026-10-01",
  });
  for (const [categoryId, amount] of [
    ["groceries", 30_000],
    ["card:card", 20_000],
  ] as const)
    await person.run({
      type: "assign",
      id: randomUUID(),
      categoryId,
      month,
      amount,
    });
  await person.run({
    type: "transaction.upsert",
    id: randomUUID(),
    transactionId: "purchase",
    accountId: "card",
    categoryId: "groceries",
    payee: "Card purchase",
    date,
    amount: -5_000,
    status: "posted",
    reviewed: false,
  });
  return person;
}
void test("expected income persists without creating cash or Ready to Assign", async (t) => {
  const { run, state } = await fixture(t);
  await run({
    type: "target.set",
    id: randomUUID(),
    categoryId: "groceries",
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: 40_000,
      startMonth: month,
    },
  });
  for (const [amount, gap] of [
    [35_000, -5_000],
    [100_000, 60_000],
  ] as const) {
    await run({ type: "income.expect", id: randomUUID(), month, amount });
    const view = (await state()).view!;
    assert.equal(view.expectedIncome, amount);
    assert.equal(view.costToBeMe, 40_000);
    assert.equal(view.expectedIncome - view.costToBeMe, gap);
    assert.equal(view.cash, 100_000);
    assert.equal(view.readyToAssign, 100_000);
  }
});
void test("approving a transaction persists without creating another purchase", async (t) => {
  const { run, state } = await cardPurchase(t);
  assert.equal(
    (await state()).view!.budget.transactions.find(
      (item) => item.id === "purchase",
    )!.reviewed,
    false,
  );
  await run({
    type: "transaction.approve",
    id: randomUUID(),
    transactionIds: ["purchase"],
  });
  const purchases = (await state()).view!.budget.transactions.filter(
    (item) => item.id === "purchase" && !item.removed,
  );
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0]!.reviewed, true);
});
void test("a card payment persists and consumes its reserve without new spending", async (t) => {
  const { run, state } = await cardPurchase(t);
  await run({
    type: "card.payment",
    id: randomUUID(),
    cashAccountId: "checking",
    cardAccountId: "card",
    date,
    amount: 25_000,
  });
  const view = (await state()).view!;
  const card = view.accounts.find((account) => account.id === "card")!;
  assert.equal(card.balance, 0);
  assert.equal(card.reserve, 0);
  assert.equal(view.cash, 75_000);
  assert.equal(view.personalSpending, 5_000);
});
void test("a loan payment persists its principal and interest separately", async (t) => {
  const { run, state } = await fixture(t);
  await run({
    type: "loan.add",
    id: randomUUID(),
    loanId: "loan",
    categoryId: "loan-payment",
    name: "Student loan",
    principal: 500_000,
    annualRateBps: 500,
    minimumPayment: 10_000,
    variable: false,
    effectiveDate: "2026-10-01",
  });
  await run({
    type: "assign",
    id: randomUUID(),
    categoryId: "loan-payment",
    month,
    amount: 15_000,
  });
  await run({
    type: "loan.payment",
    id: randomUUID(),
    loanId: "loan",
    accountId: "checking",
    date,
    principal: 12_000,
    interest: 3_000,
  });
  const view = (await state()).view!;
  assert.equal(view.loans.find((loan) => loan.id === "loan")?.balance, 488_000);
  assert.equal(view.cash, 85_000);
  const payments = view.budget.loans.find(
    (loan) => loan.id === "loan",
  )!.payments;
  assert.equal(payments.length, 1);
  assert.equal(payments[0]!.principal, 12_000);
  assert.equal(payments[0]!.interest, 3_000);
});
