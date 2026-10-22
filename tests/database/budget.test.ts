import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { Prisma, PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";
import { ObservedRevision } from "../../src/server/api/trpc";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { operationHash } from "../../src/server/services/safety";
import { findOperation, recentOperations } from "../../src/server/storage/rows";

nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
const users = [
  `test-alice-${randomUUID()}`,
  `test-bob-${randomUUID()}`,
  `test-eve-${randomUUID()}`,
];
const caller = (userId: string | null) =>
  createCaller({
    revision: new ObservedRevision(),
    db,
    userId,
    headers: new Headers(),
  });
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
    assert.equal((await alice.budget.overview()).status, "new");
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
      clientId: "test",
      baseRevision: 1,
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
    // Validation adds the category's default group; the operation is still
    // identified by what was submitted, so a release that changes that
    // default cannot turn a retry into a conflict.
    const submittedCategory = {
      type: "category.add" as const,
      id: cmdId(),
      categoryId: "alice-private",
      name: "Alice secret category",
    };
    await alice.budget.execute({
      clientId: "test",
      baseRevision: 2,
      command: submittedCategory,
    });
    const aliceWorkspace = (
      await db.workspaceMember.findUniqueOrThrow({
        where: { clerkUserId: aliceId },
      })
    ).workspaceId;
    const savedCategory = await findOperation(
      db,
      aliceWorkspace,
      submittedCategory.id,
    );
    assert.equal(savedCategory?.inputHash, operationHash(submittedCategory));
    assert.equal(savedCategory.actorId, aliceId);
    assert.deepEqual(savedCategory.command, submittedCategory);
    const repeated = {
      type: "assign" as const,
      id: cmdId(),
      categoryId: "alice-private",
      month,
      amount: 20000,
    };
    const first = await alice.budget.execute({
      clientId: "test",
      baseRevision: 3,
      command: repeated,
    });
    assert.deepEqual(
      await alice.budget.execute({
        clientId: "test",
        baseRevision: 3,
        command: repeated,
      }),
      { ...first, rebased: false },
      "a retry answers with the original result and applies nothing",
    );
    await assert.rejects(
      () =>
        alice.budget.execute({
          clientId: "test",
          baseRevision: 4,
          command: { ...repeated, amount: 30000 },
        }),
      { code: "BAD_REQUEST", message: /different details/ },
    );
    await alice.budget.execute({
      clientId: "test",
      baseRevision: 4,
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
          clientId: "test",
          baseRevision: own.revision,
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
          clientId: "test",
          baseRevision: own.revision,
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
        clientId: "test",
        baseRevision: 1,
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
      revision: new ObservedRevision(),
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
        clientId: "test",
        baseRevision: concurrentRevision,
        command: {
          type: "category.add",
          id: cmdId(),
          categoryId: "concurrent-a",
          name: "Concurrent A",
        },
      }),
      bob.budget.execute({
        clientId: "test",
        baseRevision: concurrentRevision,
        command: {
          type: "category.add",
          id: cmdId(),
          categoryId: "concurrent-b",
          name: "Concurrent B",
        },
      }),
    ]);
    // Both change only their own budget, so the second runs again on the
    // household the first wrote.
    const results = writes.map((write) => {
      assert.equal(write.status, "fulfilled");
      return write.value;
    });
    assert.deepEqual(results.map((result) => result.rebased).sort(), [
      false,
      true,
    ]);
    assert.deepEqual(results.map((result) => result.revision).sort(), [
      concurrentRevision + 1,
      concurrentRevision + 2,
    ]);
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
      clientId: "test",
      baseRevision: reconciledState.revision,
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
      clientId: "test",
      baseRevision: changedPurchase.revision,
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
    const audit = (await recentOperations(db, aliceWorkspace, 100)).filter(
      (operation) => operation.actorId === aliceId,
    );
    assert.ok(audit.length >= 4);
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
            budgetMembers: { some: { userId: bobId } },
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
