import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { Prisma, PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";

nextEnv.loadEnvConfig(process.cwd(), true);
const host = new URL(process.env.DATABASE_URL!).hostname;
if (!host.startsWith("ep-odd-voice-b4sie2v1"))
  throw new Error(
    "Database tests only run against the isolated dev-caishen branch.",
  );
const db = new PrismaClient();
const users = [
  `test-alice-${randomUUID()}`,
  `test-bob-${randomUUID()}`,
  `test-eve-${randomUUID()}`,
];
const caller = (userId: string | null) =>
  createCaller({ db, userId, headers: new Headers() });
const [aliceId, bobId, eveId] = users as [string, string, string];
const alice = caller(aliceId),
  bob = caller(bobId),
  eve = caller(eveId);
const month = "2026-10";
const cmdId = () => randomUUID();

void test("server operations persist, enforce privacy, protect concurrent writes, and reconcile actual activity", async () => {
  try {
    await assert.rejects(() => caller(null).budget.state({ month }), {
      code: "UNAUTHORIZED",
    });
    for (const [api, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
      [eve, "Eve"],
    ] as const)
      await api.budget.onboard({
        name,
        month,
        timezone: "America/Los_Angeles",
      });
    await alice.budget.execute({
      expectedRevision: 0,
      command: {
        type: "account.add",
        id: cmdId(),
        accountId: "alice-bank",
        name: "Alice private bank",
        kind: "cash",
        openingBalance: 500000,
        date: "2026-10-01",
      },
    });
    await alice.budget.execute({
      expectedRevision: 1,
      command: {
        type: "category.add",
        id: cmdId(),
        categoryId: "alice-private",
        name: "Alice secret category",
      },
    });
    const repeated = {
      type: "assign" as const,
      id: cmdId(),
      categoryId: "alice-private",
      month,
      amount: 20000,
    };
    await alice.budget.execute({ expectedRevision: 2, command: repeated });
    assert.equal(
      (await alice.budget.execute({ expectedRevision: 2, command: repeated }))
        .revision,
      3,
    );
    await assert.rejects(
      () =>
        alice.budget.execute({
          expectedRevision: 3,
          command: { ...repeated, amount: 30000 },
        }),
      { code: "CONFLICT" },
    );
    await alice.budget.execute({
      expectedRevision: 3,
      command: {
        type: "transaction.upsert",
        id: cmdId(),
        transactionId: "secret-purchase",
        accountId: "alice-bank",
        date: "2026-10-02",
        amount: -10000,
        payee: "Private merchant",
        categoryId: "alice-private",
        reviewed: false,
      },
    });
    const own = await alice.budget.state({ month });
    assert.equal(own.view?.cash, 490000);
    assert.equal(own.view?.readyToAssign, 480000);
    assert.equal(own.view?.personalSpending, 10000);
    await assert.rejects(
      () =>
        alice.budget.execute({
          expectedRevision: own.revision,
          command: {
            type: "transaction.upsert",
            id: cmdId(),
            transactionId: "future-income",
            accountId: "alice-bank",
            date: "2100-01-01",
            amount: 100000,
            payee: "Future payroll",
          },
        }),
      { code: "BAD_REQUEST" },
    );
    await assert.rejects(
      () =>
        alice.budget.execute({
          expectedRevision: own.revision,
          command: {
            type: "account.add",
            id: cmdId(),
            accountId: "future-bank",
            name: "Future bank",
            kind: "cash",
            openingBalance: 100000,
            date: "2100-01-01",
          },
        }),
      { code: "BAD_REQUEST" },
    );
    assert.equal(
      (await bob.budget.state({ month })).view?.budget.accounts.length,
      0,
    );
    await assert.rejects(() =>
      bob.budget.execute({
        expectedRevision: 0,
        command: {
          type: "transaction.upsert",
          id: cmdId(),
          transactionId: "stolen",
          accountId: "alice-bank",
          date: "2026-10-02",
          amount: -100,
          payee: "Attack",
        },
      }),
    );
    await assert.rejects(
      () => bob.budget.suggest({ transactionIds: ["secret-purchase"] }),
      { code: "NOT_FOUND" },
    );
    const { code } = await alice.budget.invite();
    let joinTransactionAttempts = 0;
    const retryingDb = new Proxy(db, {
      get(target, property) {
        if (property === "$transaction")
          return async (...args: unknown[]) => {
            joinTransactionAttempts++;
            if (joinTransactionAttempts === 1)
              throw new Prisma.PrismaClientKnownRequestError(
                "Simulated serialization conflict",
                { code: "P2034", clientVersion: Prisma.prismaVersion.client },
              );
            const result: unknown = Reflect.apply(
              target.$transaction.bind(target),
              target,
              args,
            );
            return result;
          };
        const value: unknown = Reflect.get(target, property);
        return value;
      },
    });
    await createCaller({
      db: retryingDb,
      userId: bobId,
      headers: new Headers(),
    }).budget.join({ code });
    assert.ok(joinTransactionAttempts >= 2);
    const bobView = await bob.budget.state({ month });
    assert.equal(bobView.view?.members.length, 2);
    assert.ok(!JSON.stringify(bobView).includes("Private merchant"));
    assert.ok(!JSON.stringify(bobView).includes("Alice secret category"));
    assert.ok(!JSON.stringify(bobView).includes("Alice private bank"));
    await assert.rejects(() => eve.budget.join({ code }), {
      code: "NOT_FOUND",
    });
    const concurrentRevision = (await alice.budget.state({ month })).revision;
    const writes = await Promise.allSettled([
      alice.budget.execute({
        expectedRevision: concurrentRevision,
        command: {
          type: "category.add",
          id: cmdId(),
          categoryId: "concurrent-a",
          name: "Concurrent A",
        },
      }),
      bob.budget.execute({
        expectedRevision: concurrentRevision,
        command: {
          type: "category.add",
          id: cmdId(),
          categoryId: "concurrent-b",
          name: "Concurrent B",
        },
      }),
    ]);
    assert.equal(writes.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(writes.filter((r) => r.status === "rejected").length, 1);
    const eveView = await eve.budget.state({ month });
    assert.equal(eveView.view?.members.length, 1);
    assert.ok(!JSON.stringify(eveView).includes("Alice"));
    const matched = await alice.budget.reconcile({
      accountId: "alice-bank",
      periodStart: "2026-10-01",
      cutoff: "2026-10-31",
      openingBalanceCents: 500000,
      closingBalanceCents: 490000,
      csv: "Date,Description,Amount\n2026-10-02,Private merchant,-100.00",
      verified: true,
    });
    assert.equal(matched.status, "reconciled");
    const reconciledState = await alice.budget.state({ month });
    assert.equal(reconciledState.evidence[0]?.result.status, "reconciled");
    assert.ok(!("evidence" in reconciledState.evidence[0]));
    const changedPurchase = await alice.budget.execute({
      expectedRevision: reconciledState.revision,
      command: {
        type: "transaction.upsert",
        id: cmdId(),
        transactionId: "secret-purchase",
        accountId: "alice-bank",
        date: "2026-10-02",
        amount: -9000,
        payee: "Private merchant",
        categoryId: "alice-private",
        reviewed: false,
      },
    });
    const staleState = await alice.budget.state({ month });
    assert.equal(
      staleState.evidence[0]?.result.status,
      "insufficient_evidence",
    );
    assert.match(staleState.evidence[0].result.reasons[0]!, /ledger changed/);
    await alice.budget.execute({
      expectedRevision: changedPurchase.revision,
      command: {
        type: "transaction.upsert",
        id: cmdId(),
        transactionId: "secret-purchase",
        accountId: "alice-bank",
        date: "2026-10-02",
        amount: -10000,
        payee: "Private merchant",
        categoryId: "alice-private",
        reviewed: false,
      },
    });
    const mismatch = await alice.budget.reconcile({
      accountId: "alice-bank",
      periodStart: "2026-10-01",
      cutoff: "2026-10-31",
      openingBalanceCents: 500000,
      closingBalanceCents: 489900,
      csv: "Date,Description,Amount\n2026-10-02,Private merchant,-101.00",
      verified: true,
    });
    assert.equal(mismatch.status, "discrepancy");
    assert.equal((await alice.budget.state({ month })).view?.cash, 490000);
    await assert.rejects(
      () =>
        bob.budget.reconcile({
          accountId: "alice-bank",
          periodStart: "2026-10-01",
          cutoff: "2026-10-31",
          openingBalanceCents: 500000,
          closingBalanceCents: 490000,
          csv: "Date,Description,Amount\n2026-10-02,Private merchant,-100.00",
          verified: true,
        }),
      { code: "NOT_FOUND" },
    );
    const unverified = await alice.budget.reconcile({
      accountId: "alice-bank",
      periodStart: "2026-10-01",
      cutoff: "2026-10-31",
      openingBalanceCents: 500000,
      closingBalanceCents: 490000,
      csv: "Date,Description,Amount\n2026-10-02,Private merchant,-100.00",
      verified: false,
    });
    assert.equal(unverified.status, "insufficient_evidence");
    assert.equal((await bob.budget.state({ month })).evidence.length, 0);
    const audit = await db.budgetOperation.findMany({
      where: { actorId: aliceId },
    });
    assert.ok(audit.length >= 4);
    assert.ok(audit.every((op) => op.commandHash.length === 64));
  } finally {
    const memberships = await db.workspaceMember.findMany({
      where: { clerkUserId: { in: users } },
    });
    await db.workspace.deleteMany({
      where: {
        OR: [
          { id: { in: memberships.map((m) => m.workspaceId) } },
          {
            members: { none: {} },
            book: { path: ["budgets", bobId, "userId"], equals: bobId },
          },
        ],
      },
    });
    await db.reviewEvidence.deleteMany({
      where: { clerkUserId: { in: users } },
    });
    await db.user.deleteMany({ where: { clerkUserId: { in: users } } });
    await db.$disconnect();
  }
});
