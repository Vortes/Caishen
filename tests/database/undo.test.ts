import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";
import { ObservedRevision } from "../../src/server/api/trpc";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import {
  recentOperations,
  writeChangeSet,
} from "../../src/server/storage/rows";

nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
void test("undo persists, remains idempotent, and stops at partner and provider changes", async () => {
  const db = new PrismaClient();
  const aliceId = `test-undo-alice-${randomUUID()}`;
  const bobId = `test-undo-bob-${randomUUID()}`;
  const users = [aliceId, bobId];
  const caller = (userId: string) =>
    createCaller({
      revision: new ObservedRevision(),
      db,
      userId,
      headers: new Headers(),
    });
  const alice = caller(aliceId);
  const bob = caller(bobId);
  const month = "2026-10";
  try {
    const [start] = await Promise.all(
      (
        [
          [alice, "Alice"],
          [bob, "Bob"],
        ] as const
      ).map(([api, name]) =>
        api.budget.onboard({ name, month, timezone: "America/Los_Angeles" }),
      ),
    );
    let revision = start!.revision;
    ({ revision } = await alice.budget.execute({
      clientId: "test",
      baseRevision: revision,
      command: {
        type: "account.add",
        id: randomUUID(),
        accountId: "cash",
        name: "Checking",
        kind: "cash",
        openingBalance: 100_000,
        date: `${month}-01`,
      },
    }));
    ({ revision } = await alice.budget.execute({
      clientId: "test",
      baseRevision: revision,
      command: {
        type: "category.add",
        id: randomUUID(),
        categoryId: "food",
        name: "Groceries",
      },
    }));
    const beforeAssignment = revision;
    const assignment = {
      type: "assign" as const,
      id: randomUUID(),
      categoryId: "food",
      month,
      amount: 20_000,
    };
    await alice.budget.execute({
      clientId: "test",
      baseRevision: beforeAssignment,
      command: assignment,
    });
    const saved = await caller(aliceId).budget.state({ month });
    assert.equal(saved.history.undo, "Assign money");
    const undo = {
      direction: "undo" as const,
      expectedRevision: saved.revision,
      operationId: randomUUID(),
    };
    const undone = await alice.budget.changeHistory(undo);
    assert.equal(undone.revision, saved.revision + 1);
    assert.equal(
      (await alice.budget.changeHistory(undo)).revision,
      undone.revision,
      "a retried undo answers with its first result",
    );
    const beforeRedo = await alice.budget.state({ month });
    assert.equal(
      beforeRedo.view?.categories.find((c) => c.id === "food")?.assigned,
      0,
    );
    assert.equal(beforeRedo.history.redo, "Assign money");
    // Retrying the original assignment doesn't apply it again.
    await alice.budget.execute({
      clientId: "test",
      baseRevision: beforeAssignment,
      command: assignment,
    });
    assert.equal(
      (await alice.budget.state({ month })).revision,
      undone.revision,
    );
    await alice.budget.changeHistory({
      direction: "redo",
      expectedRevision: undone.revision,
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
          expectedRevision: undone.revision,
          operationId: randomUUID(),
        }),
      { code: "CONFLICT" },
    );
    const bobRevision = (await bob.budget.state({ month })).revision;
    await assert.rejects(
      () =>
        bob.budget.changeHistory({
          direction: "undo",
          expectedRevision: bobRevision,
          operationId: randomUUID(),
        }),
      { code: "BAD_REQUEST" },
    );

    const { code } = await alice.budget.invite();
    await bob.budget.join({ code });
    let state = await alice.budget.state({ month });
    assert.deepEqual(state.history, { undo: null, redo: null });
    await alice.budget.execute({
      clientId: "test",
      baseRevision: state.revision,
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
      clientId: "test",
      baseRevision: partner.revision,
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
      clientId: "test",
      baseRevision: state.revision,
      command: {
        type: "assign",
        id: randomUUID(),
        categoryId: "food",
        month,
        amount: 1000,
      },
    });
    state = await alice.budget.state({ month });
    assert.equal(state.history.undo, "Assign money");
    // A bank update for Alice: the provider's operation ends her run.
    const member = await db.workspaceMember.findUniqueOrThrow({
      where: { clerkUserId: aliceId },
    });
    await writeChangeSet(db, {
      workspaceId: member.workspaceId,
      baseRevision: state.revision,
      changeSet: {
        operationId: randomUUID(),
        revision: 0,
        before: [],
        after: [],
      },
      operation: {
        actorId: aliceId,
        source: "provider",
        type: "bank.sync",
        inputHash: "",
        command: null,
      },
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
    const reverts = (
      await recentOperations(db, member.workspaceId, 100)
    ).filter((operation) => operation.type === "revert");
    assert.equal(reverts.length, 2, "one undo and one redo");
  } finally {
    const memberships = await db.workspaceMember.findMany({
      where: { clerkUserId: { in: users } },
    });
    await db.workspace.deleteMany({
      where: {
        OR: [
          { id: { in: memberships.map((member) => member.workspaceId) } },
          { members: { none: {} }, budgetMembers: { some: { userId: bobId } } },
        ],
      },
    });
    await db.user.deleteMany({ where: { clerkUserId: { in: users } } });
    await db.$disconnect();
  }
});
