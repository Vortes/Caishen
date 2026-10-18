import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";
import { type Command } from "../../src/domain/engine";

if (
  !new URL(process.env.DATABASE_URL!).hostname.startsWith(
    "ep-odd-voice-b4sie2v1",
  )
)
  throw new Error("Use the isolated dev-caishen database only.");
void test("two private server budgets record the exact rent/utilities settlement without fictional cash", async () => {
  const db = new PrismaClient();
  const a = `test-shared-a-${randomUUID()}`,
    b = `test-shared-b-${randomUUID()}`;
  const api = (userId: string) =>
    createCaller({ db, userId, headers: new Headers() });
  const alice = api(a),
    bob = api(b);
  const state = (userId: string) =>
    api(userId).budget.state({ month: "2026-10" });
  const run = async (userId: string, command: Command) =>
    api(userId).budget.execute({
      command,
      expectedRevision: (await state(userId)).revision,
    });
  try {
    await alice.budget.onboard({
      name: "Shared test A",
      month: "2026-10",
      timezone: "America/Los_Angeles",
    });
    await bob.budget.onboard({
      name: "Shared test B",
      month: "2026-10",
      timezone: "America/Los_Angeles",
    });
    const invite = await alice.budget.invite();
    await bob.budget.join({ code: invite.code });
    for (const [who, acct] of [
      [a, "a-bank"],
      [b, "b-bank"],
    ])
      await run(who!, {
        type: "account.add",
        id: randomUUID(),
        accountId: acct!,
        name: "Checking",
        kind: "cash",
        openingBalance: 500000,
        date: "2026-10-01",
      });
    for (const [id, name] of [
      ["rent-a", "Rent"],
      ["utility-a", "Utilities"],
    ])
      await run(a, {
        type: "category.add",
        id: randomUUID(),
        categoryId: id!,
        name: name!,
      });
    for (const [sharedId, name, own, other] of [
      ["rent", "Rent", "rent-a", "rent-b"],
      ["utilities", "Utilities", "utility-a", "utility-b"],
    ])
      await run(a, {
        type: "shared.create",
        id: randomUUID(),
        sharedCategoryId: sharedId!,
        name: name!,
        participants: [a, b],
        weights: { [a]: 1, [b]: 1 },
        categoryIds: { [a]: own!, [b]: other! },
      });
    for (const [who, categoryId, amount] of [
      [a, "rent-a", 100000],
      [a, "utility-a", 20000],
      [b, "rent-b", 200000],
      [b, "utility-b", 10000],
    ] as const)
      await run(who, {
        type: "assign",
        id: randomUUID(),
        categoryId,
        month: "2026-10",
        amount,
      });
    await run(b, {
      type: "transaction.upsert",
      id: randomUUID(),
      transactionId: "rent-paid",
      accountId: "b-bank",
      date: "2026-10-01",
      amount: -200000,
      payee: "Rent due October",
      categoryId: "rent-b",
      sharedCategoryId: "rent",
      expenseMonth: "2026-10",
    });
    await run(a, {
      type: "transaction.upsert",
      id: randomUUID(),
      transactionId: "utility-paid",
      accountId: "a-bank",
      date: "2026-10-02",
      amount: -20000,
      payee: "Utilities",
      categoryId: "utility-a",
      sharedCategoryId: "utilities",
    });
    const before = await state(a);
    assert.equal(before.view!.settlement.net, 90000);
    assert.equal(before.view!.personalSpending, 110000);
    assert.equal(before.view!.amountPaid, 20000);
    assert.equal((await state(b)).view!.personalSpending, 110000);
    const repeated = await state(a);
    assert.equal(repeated.revision, before.revision);
    assert.equal(repeated.view!.settlement.net, 90000);
    await run(a, {
      type: "settlement.record",
      id: randomUUID(),
      settlementId: "net-rent",
      otherUserId: b,
      date: "2026-10-03",
      accountId: "a-bank",
      amount: 90000,
    });
    const after = await state(a);
    assert.equal(after.view!.cash, 390000);
    assert.equal(after.view!.readyToAssign - before.view!.readyToAssign, 10000);
    assert.equal(after.view!.settlement.net, 0);
    assert.equal(after.view!.personalSpending, 110000);
    assert.equal(
      after.view!.budget.transactions.filter((t) => t.amount > 0).length,
      0,
    );
    assert.equal(
      (await state(b)).view!.cash,
      300000,
      "report/payment record does not invent recipient bank cash",
    );
    await assert.rejects(() =>
      run(a, {
        type: "settlement.receive",
        id: randomUUID(),
        settlementId: "net-rent",
        accountId: "a-bank",
        date: "2026-10-03",
      }),
    );
    await run(b, {
      type: "settlement.receive",
      id: randomUUID(),
      settlementId: "net-rent",
      accountId: "b-bank",
      date: "2026-10-03",
    });
    assert.equal((await state(b)).view!.cash, 390000);
    assert.equal((await state(b)).view!.earnings, 0);
    assert.equal(
      (await state(a)).view!.cash + (await state(b)).view!.cash,
      780000,
      "both cash ledgers conserve actual combined liquid cash",
    );
    await assert.rejects(() =>
      run(b, {
        type: "transaction.remove",
        id: randomUUID(),
        transactionId: "rent-paid",
      }),
    );
  } finally {
    const memberships = await db.workspaceMember.findMany({
      where: { clerkUserId: { in: [a, b] } },
    });
    await db.workspace.deleteMany({
      where: {
        OR: [
          { id: { in: memberships.map((m) => m.workspaceId) } },
          {
            members: { none: {} },
            book: { path: ["budgets", b, "userId"], equals: b },
          },
        ],
      },
    });
    await db.user.deleteMany({ where: { clerkUserId: { in: [a, b] } } });
    await db.$disconnect();
  }
});
