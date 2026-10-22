import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../../src/generated/prisma";
import { createBook } from "../../src/domain/engine";
import { createCaller } from "../../src/server/api/root";
import { ObservedRevision } from "../../src/server/api/trpc";
import {
  assertDevelopmentSeedEnvironment,
  developmentSeedArchiveId,
  developmentSeedIdentity,
  restoreDevelopmentWorkspace,
  seedDevelopmentDatabase,
} from "../../src/server/dev/seed-database";
import { developmentToday } from "../../src/server/dev/seed-scenarios";
import { loadRows, recentOperations } from "../../src/server/storage/rows";
import { createHousehold } from "./fixtures";

assertDevelopmentSeedEnvironment(process.env);

void test("development seed persists through the API, repeats safely, resets only its workspace, and restores the original", async () => {
  const db = new PrismaClient();
  const userId = `dev-seed-test-${randomUUID()}`;
  const identity = developmentSeedIdentity(userId);
  const userIds = [userId, identity.partnerId];
  const month = developmentToday().slice(0, 7);
  const originalBook = createBook(userId, "Original budget", month);
  const originalId = `test-original-${randomUUID()}`;
  const originalBankId = `test-original-bank-${randomUUID()}`;
  const originalEvidenceId = `test-original-evidence-${randomUUID()}`;
  const api = createCaller({
    revision: new ObservedRevision(),
    db,
    userId,
    headers: new Headers(),
  });
  try {
    await db.user.create({ data: { clerkUserId: userId } });
    await createHousehold(db, originalBook, originalId);
    const originalRows = await loadRows(db, originalId);
    await db.bankConnection.create({
      data: {
        id: originalBankId,
        clerkUserId: userId,
        itemId: originalBankId,
        encryptedToken: "original-credential-preserved",
        imports: { records: [], resolved: {}, reviews: {}, errors: {} },
        accountMappings: {},
      },
    });
    await db.reviewEvidence.create({
      data: {
        id: originalEvidenceId,
        clerkUserId: userId,
        accountId: "original-account",
        kind: "statement",
        cutoff: developmentToday(),
        evidence: { fixture: "original" },
        result: {},
      },
    });
    await assert.rejects(seedDevelopmentDatabase(db, { userId }), /--activate/);
    assert.equal(
      await db.workspace.count({ where: { id: identity.workspaceId } }),
      0,
    );
    const first = await seedDevelopmentDatabase(db, { userId, activate: true });
    assert.equal(first.skipped, false);
    const archivedBank = await db.bankConnection.findUniqueOrThrow({
      where: { id: originalBankId },
    });
    assert.equal(archivedBank.clerkUserId, developmentSeedArchiveId(userId));
    assert.equal(archivedBank.encryptedToken, "original-credential-preserved");
    assert.equal(
      (
        await db.user.findUniqueOrThrow({
          where: { clerkUserId: archivedBank.clerkUserId },
        })
      ).active,
      false,
    );
    assert.equal(
      (
        await db.reviewEvidence.findUniqueOrThrow({
          where: { id: originalEvidenceId },
        })
      ).clerkUserId,
      developmentSeedArchiveId(userId),
    );
    assert.deepEqual(first.previousWorkspaces, [
      { userId, workspaceId: originalId },
    ]);
    assert.deepEqual(await loadRows(db, originalId), originalRows);
    const state = await api.budget.state({ month });
    assert.equal(state.view!.budget.name, "Demo · Alex’s budget");
    assert.equal(state.imports.length, 0);
    assert.equal(state.evidence.length, 0);
    assert.equal(
      state.view!.budget.transactions.filter(
        (transaction) => !transaction.removed && !transaction.reviewed,
      ).length,
      0,
    );
    await api.budget.execute({
      clientId: "test",
      baseRevision: state.revision,
      command: {
        id: randomUUID(),
        type: "transaction.upsert",
        transactionId: "user-added-after-seed",
        accountId: "checking",
        date: developmentToday(),
        amount: -1250,
        payee: "Philz Coffee",
        categoryId: "dining",
      },
    });
    const edited = await api.budget.state({ month });
    const hasEdit = (view: typeof edited.view) =>
      view!.budget.transactions.some(
        (transaction) => transaction.id === "user-added-after-seed",
      );
    assert.ok(hasEdit(edited.view));
    const repeated = await seedDevelopmentDatabase(db, { userId });
    assert.equal(repeated.skipped, true);
    assert.equal(repeated.revision, edited.revision);
    assert.ok(hasEdit((await api.budget.state({ month })).view));
    const reset = await seedDevelopmentDatabase(db, { userId, reset: true });
    assert.equal(reset.revision, edited.revision + 1);
    assert.equal(hasEdit((await api.budget.state({ month })).view), false);
    assert.equal(
      (await recentOperations(db, identity.workspaceId, 10_000)).length,
      reset.seed.operations.length,
    );
    assert.equal(
      await db.bankConnection.count({
        where: { clerkUserId: { in: userIds } },
      }),
      0,
    );
    assert.equal(
      await db.reviewEvidence.count({
        where: { clerkUserId: { in: userIds } },
      }),
      0,
    );
    await restoreDevelopmentWorkspace(db, userId, originalId);
    assert.deepEqual(await loadRows(db, originalId), originalRows);
    assert.equal(
      (await api.budget.state({ month })).view!.budget.name,
      "Original budget",
    );
    assert.equal(
      await db.bankConnection.count({ where: { clerkUserId: userId } }),
      1,
    );
    assert.equal(
      (
        await db.bankConnection.findUniqueOrThrow({
          where: { id: originalBankId },
        })
      ).clerkUserId,
      userId,
    );
    assert.equal(
      await db.reviewEvidence.count({ where: { clerkUserId: userId } }),
      1,
    );
    assert.deepEqual(
      (
        await db.reviewEvidence.findUniqueOrThrow({
          where: { id: originalEvidenceId },
        })
      ).evidence,
      { fixture: "original" },
    );
  } finally {
    await db.bankConnection.deleteMany({
      where: { OR: [{ clerkUserId: { in: userIds } }, { id: originalBankId }] },
    });
    await db.reviewEvidence.deleteMany({
      where: {
        OR: [{ clerkUserId: { in: userIds } }, { id: originalEvidenceId }],
      },
    });
    await db.workspace.deleteMany({
      where: { id: { in: [originalId, identity.workspaceId] } },
    });
    await db.user.deleteMany({
      where: {
        clerkUserId: { in: [...userIds, developmentSeedArchiveId(userId)] },
      },
    });
    await db.$disconnect();
  }
});
