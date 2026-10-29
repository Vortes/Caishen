import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { PrismaClient } from "../../src/generated/prisma";
import {
  createDatabaseCaller as createCaller,
  invitationFrom,
} from "./fixtures";
import { ObservedRevision } from "../../src/server/api/trpc";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";

nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
void test("reverts persist, remain idempotent, and cannot undo another member’s change", async () => {
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
    const undo = {
      clientId: "test",
      baseRevision: saved.revision,
      command: {
        type: "revert" as const,
        id: randomUUID(),
        targetOperationId: assignment.id,
      },
    };
    const undone = await alice.budget.execute(undo);
    assert.equal(undone.revision, saved.revision + 1);
    assert.equal(
      (await caller(aliceId).budget.execute(undo)).revision,
      undone.revision,
      "a retried revert answers with its first result",
    );
    const beforeRedo = await caller(aliceId).budget.state({ month });
    assert.equal(
      beforeRedo.view?.categories.find((c) => c.id === "food")?.assigned,
      0,
    );
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
    await alice.budget.execute({
      clientId: "test",
      baseRevision: undone.revision,
      command: {
        type: "revert",
        id: randomUUID(),
        targetOperationId: undo.command.id,
      },
    });
    assert.equal(
      (await alice.budget.state({ month })).view?.categories.find(
        (c) => c.id === "food",
      )?.assigned,
      20_000,
    );

    await bob.budget.joinInvitation({
      id: await invitationFrom(db, aliceId),
    });
    const partner = await bob.budget.state({ month });
    assert.ok(!JSON.stringify(partner).includes("Groceries"));
    await assert.rejects(
      bob.budget.execute({
        clientId: "test",
        baseRevision: partner.revision,
        command: {
          type: "revert",
          id: randomUUID(),
          targetOperationId: assignment.id,
        },
      }),
      { code: "CONFLICT", message: "Undo access denied" },
    );
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
