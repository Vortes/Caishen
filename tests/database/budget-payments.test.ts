import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { bookSchema, type Command } from "../../src/domain/engine";
import { PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";

const connectionUrl = process.env.DATABASE_URL;
if (
  !connectionUrl ||
  !new URL(connectionUrl).hostname.startsWith("ep-odd-voice-b4sie2v1")
)
  throw new Error("Use the isolated dev-caishen database only.");

void test("expected income, transaction approval, card payments, and loan payments persist through the budget API", async () => {
  const db = new PrismaClient();
  const userId = `test-payments-${randomUUID()}`;
  const api = createCaller({ db, userId, headers: new Headers() });
  const month = "2026-10";
  const date = "2026-10-02";
  const state = () => api.budget.state({ month });
  const run = async (command: Command) =>
    api.budget.execute({
      command,
      expectedRevision: (await state()).revision,
    });
  try {
    await api.budget.onboard({
      name: "Payment fixtures",
      month,
      timezone: "America/Los_Angeles",
    });
    await run({
      type: "account.add",
      id: randomUUID(),
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      openingBalance: 100_000,
      date: "2026-10-01",
    });
    await run({
      type: "category.add",
      id: randomUUID(),
      categoryId: "groceries",
      name: "Groceries",
    });
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

    await run({
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
      await run({
        type: "assign",
        id: randomUUID(),
        categoryId,
        month,
        amount,
      });
    await run({
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
    assert.equal(
      (await state()).view!.budget.transactions.find(
        (transaction) => transaction.id === "purchase",
      )?.reviewed,
      false,
    );
    await run({
      type: "transaction.approve",
      id: randomUUID(),
      transactionIds: ["purchase"],
    });
    await run({
      type: "card.payment",
      id: randomUUID(),
      cashAccountId: "checking",
      cardAccountId: "card",
      date,
      amount: 25_000,
    });
    const paidCard = (await state()).view!.accounts.find(
      (account) => account.id === "card",
    )!;
    assert.equal(paidCard.balance, 0);
    assert.equal(paidCard.reserve, 0);

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
    assert.equal(
      view.loans.find((loan) => loan.id === "loan")?.balance,
      488_000,
    );
    assert.equal(view.cash, 60_000);
    const member = await db.workspaceMember.findUniqueOrThrow({
      where: { clerkUserId: userId },
      include: { workspace: true },
    });
    const saved = bookSchema.parse(member.workspace.book).budgets[userId]!;
    assert.equal(saved.expectedIncome[month], 100_000);
    const purchases = saved.transactions.filter(
      (transaction) => transaction.id === "purchase" && !transaction.removed,
    );
    assert.equal(purchases.length, 1);
    assert.equal(purchases[0]!.reviewed, true);
    const payments = saved.loans.find((loan) => loan.id === "loan")!.payments;
    assert.equal(payments.length, 1);
    assert.equal(payments[0]!.principal, 12_000);
    assert.equal(payments[0]!.interest, 3_000);
  } finally {
    await db.workspace.deleteMany({
      where: { members: { some: { clerkUserId: userId } } },
    });
    await db.user.deleteMany({ where: { clerkUserId: userId } });
    await db.$disconnect();
  }
});
