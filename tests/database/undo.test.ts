import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";

nextEnv.loadEnvConfig(process.cwd(), true);
if (
  !new URL(process.env.DATABASE_URL!).hostname.startsWith(
    "ep-odd-voice-b4sie2v1",
  )
)
  throw new Error(
    "Database tests only run against the isolated dev-caishen branch.",
  );

void test("undo persists, remains idempotent, and stops at partner and provider changes", async () => {
  const db = new PrismaClient();
  const aliceId = `test-undo-alice-${randomUUID()}`;
  const bobId = `test-undo-bob-${randomUUID()}`;
  const users = [aliceId, bobId];
  const caller = (userId: string) =>
    createCaller({ db, userId, headers: new Headers() });
  const alice = caller(aliceId);
  const bob = caller(bobId);
  const month = "2026-10";
  try {
    for (const [api, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
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
        id: randomUUID(),
        accountId: "cash",
        name: "Checking",
        kind: "cash",
        openingBalance: 100_000,
        date: `${month}-01`,
      },
    });
    await alice.budget.execute({
      expectedRevision: 1,
      command: {
        type: "category.add",
        id: randomUUID(),
        categoryId: "food",
        name: "Groceries",
      },
    });
    const assignment = {
      type: "assign" as const,
      id: randomUUID(),
      categoryId: "food",
      month,
      amount: 20_000,
    };
    await alice.budget.execute({ expectedRevision: 2, command: assignment });
    const saved = await caller(aliceId).budget.state({ month });
    assert.equal(saved.history.undo, "Assign money");
    const undo = {
      direction: "undo" as const,
      expectedRevision: saved.revision,
      operationId: randomUUID(),
    };
    const undone = await alice.budget.changeHistory(undo);
    assert.equal(undone.revision, 4);
    assert.equal((await alice.budget.changeHistory(undo)).revision, 4);
    const beforeRedo = await alice.budget.state({ month });
    assert.equal(
      beforeRedo.view?.categories.find((c) => c.id === "food")?.assigned,
      0,
    );
    assert.equal(beforeRedo.history.redo, "Assign money");
    await alice.budget.execute({ expectedRevision: 2, command: assignment });
    assert.equal((await alice.budget.state({ month })).revision, 4);
    await alice.budget.changeHistory({
      direction: "redo",
      expectedRevision: 4,
      operationId: randomUUID(),
    });
    assert.equal(
      (await alice.budget.state({ month })).view?.categories.find(
        (c) => c.id === "food",
      )?.assigned,
      20_000,
    );
    await assert.rejects(
      () =>
        alice.budget.changeHistory({
          direction: "undo",
          expectedRevision: 4,
          operationId: randomUUID(),
        }),
      { code: "CONFLICT" },
    );
    await assert.rejects(
      () =>
        bob.budget.changeHistory({
          direction: "undo",
          expectedRevision: 0,
          operationId: randomUUID(),
        }),
      { code: "BAD_REQUEST" },
    );

    const { code } = await alice.budget.invite();
    await bob.budget.join({ code });
    let state = await alice.budget.state({ month });
    assert.deepEqual(state.history, { undo: null, redo: null });
    await alice.budget.execute({
      expectedRevision: state.revision,
      command: {
        type: "assign",
        id: randomUUID(),
        categoryId: "food",
        month,
        amount: 1000,
      },
    });
    const partner = await bob.budget.state({ month });
    assert.deepEqual(partner.history, { undo: null, redo: null });
    assert.ok(!JSON.stringify(partner).includes("Groceries"));
    await assert.rejects(
      () =>
        bob.budget.changeHistory({
          direction: "undo",
          expectedRevision: partner.revision,
          operationId: randomUUID(),
        }),
      { code: "BAD_REQUEST" },
    );
    await bob.budget.execute({
      expectedRevision: partner.revision,
      command: {
        type: "category.add",
        id: randomUUID(),
        categoryId: "bob-food",
        name: "Bob groceries",
      },
    });
    state = await alice.budget.state({ month });
    assert.deepEqual(state.history, { undo: null, redo: null });
    await alice.budget.execute({
      expectedRevision: state.revision,
      command: {
        type: "assign",
        id: randomUUID(),
        categoryId: "food",
        month,
        amount: 1000,
      },
    });
    state = await alice.budget.state({ month });
    const member = await db.workspaceMember.findUniqueOrThrow({
      where: { clerkUserId: aliceId },
    });
    await db.workspace.update({
      where: { id: member.workspaceId },
      data: { revision: { increment: 1 } },
    });
    await assert.rejects(
      () =>
        alice.budget.changeHistory({
          direction: "undo",
          expectedRevision: state.revision,
          operationId: randomUUID(),
        }),
      { code: "CONFLICT" },
    );
    const afterProvider = await alice.budget.state({ month });
    assert.deepEqual(afterProvider.history, { undo: null, redo: null });
    await assert.rejects(
      () =>
        alice.budget.changeHistory({
          direction: "undo",
          expectedRevision: afterProvider.revision,
          operationId: randomUUID(),
        }),
      { code: "BAD_REQUEST" },
    );
    const audit = await db.budgetOperation.findMany({
      where: { actorId: aliceId },
    });
    assert.equal(
      audit.filter((entry) => entry.type === "history.undo").length,
      1,
    );
    assert.equal(
      audit.filter((entry) => entry.type === "history.redo").length,
      1,
    );
  } finally {
    const memberships = await db.workspaceMember.findMany({
      where: { clerkUserId: { in: users } },
    });
    await db.workspace.deleteMany({
      where: {
        OR: [
          { id: { in: memberships.map((member) => member.workspaceId) } },
          {
            members: { none: {} },
            book: { path: ["budgets", bobId, "userId"], equals: bobId },
          },
        ],
      },
    });
    await db.user.deleteMany({ where: { clerkUserId: { in: users } } });
    await db.$disconnect();
  }
});
