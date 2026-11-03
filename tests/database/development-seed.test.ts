import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../../src/generated/prisma";
import { createBook } from "../../src/domain/engine";
import { createDatabaseCaller as createCaller } from "./fixtures";
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

function seedFixture(t: TestContext, partnerId?: string) {
  const db = new PrismaClient();
  const userId = `dev-seed-test-${randomUUID()}`;
  const identity = developmentSeedIdentity(userId, partnerId);
  const userIds = [userId, identity.partnerId];
  const workspaces = new Set([identity.workspaceId]);
  t.after(async () => {
    await db.bankConnection.deleteMany({
      where: { clerkUserId: { in: userIds } },
    });
    await db.workspace.deleteMany({ where: { id: { in: [...workspaces] } } });
    await db.user.deleteMany({
      where: { clerkUserId: { in: userIds } },
    });
    await db.$disconnect();
  });
  const api = createCaller({
    db,
    userId,
    headers: new Headers(),
    revision: new ObservedRevision(),
  });
  return { db, userId, api, workspaces, month: developmentToday().slice(0, 7) };
}

void test("solo presets refuse a second login without changing either budget", async (t) => {
  const partnerId = `dev-seed-test-${randomUUID()}`;
  const { db, userId, month } = seedFixture(t, partnerId);
  await db.user.createMany({
    data: [{ clerkUserId: userId }, { clerkUserId: partnerId }],
  });
  await assert.rejects(
    seedDevelopmentDatabase(db, {
      userId,
      partnerId,
      scenario: "former-partner",
    }),
    /--partner/,
  );
  for (const login of [userId, partnerId]) {
    const api = createCaller({
      db,
      userId: login,
      headers: new Headers(),
      revision: new ObservedRevision(),
    });
    assert.equal((await api.budget.state({ month })).status, "new");
  }
});

void test("the development banks expose linked accounts, attention states and an unresolved match", async (t) => {
  const { db, userId, api, month } = seedFixture(t);
  await seedDevelopmentDatabase(db, { userId });
  const state = await api.budget.state({ month });
  assert.equal(state.connections.length, 3);
  assert.deepEqual(
    state.connections.map((connection) => connection.status).sort(),
    ["connected", "connected", "login_required"],
  );
  assert.deepEqual(
    state.connections
      .flatMap((connection) =>
        Object.values(connection.accountMappings).map(
          (mapping) => mapping.accountId,
        ),
      )
      .sort(),
    ["amex", "checking", "discover", "savings"],
  );
  assert.ok(
    state.connections.some((connection) => connection.newAccountsAvailable),
  );
  assert.ok(
    state.connections.some(
      (connection) => connection.unavailableAccountIds?.length,
    ),
  );
  assert.equal(state.imports.length, 1);
  assert.equal(state.imports[0]!.needsMatchReview, true);
  assert.equal(state.imports[0]!.eligibility, "eligible");
  assert.match(state.imports[0]!.error!, /match/i);
  assert.equal(
    state.view!.budget.transactions.some(
      (transaction) =>
        transaction.payee === "Demo · possible duplicate payment",
    ),
    false,
  );
  assert.equal((await seedDevelopmentDatabase(db, { userId })).skipped, true);
  assert.deepEqual((await api.budget.state({ month })).imports, state.imports);
});

void test("demo banks stay offline during updates and can disconnect without Plaid", async (t) => {
  const { db, userId, api, month } = seedFixture(t);
  t.mock.method(globalThis, "fetch", () =>
    assert.fail("demo banks must not contact external services"),
  );
  await seedDevelopmentDatabase(db, { userId });
  const before = await api.budget.state({ month });
  const updated = await api.budget.sync();
  assert.equal(updated.imported, 0);
  assert.equal(updated.updated, 0);
  const state = await api.budget.state({ month });
  assert.deepEqual(state.connections, before.connections);
  assert.deepEqual(state.imports, before.imports);
  await api.budget.disconnectBank({
    connectionId: state.connections[0]!.id,
    operationId: randomUUID(),
    expectedRevision: state.revision,
  });
  const disconnected = await api.budget.state({ month });
  assert.equal(
    disconnected.connections.find(
      (connection) => connection.id === state.connections[0]!.id,
    )!.status,
    "disconnected",
  );
  assert.equal(disconnected.view!.cash, state.view!.cash);
});

void test("the invitation preset exposes a live signed card and clears it when reset", async (t) => {
  const originalKey = process.env.CLERK_SECRET_KEY;
  process.env.CLERK_SECRET_KEY = "sk_test_development_seed_fixture";
  const { db, userId, api, month, workspaces } = seedFixture(t);
  const originalId = `test-original-invitation-${randomUUID()}`;
  workspaces.add(originalId);
  t.after(() => {
    if (originalKey === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = originalKey;
  });
  await db.user.create({ data: { clerkUserId: userId } });
  await createHousehold(
    db,
    createBook(userId, "Original budget", month),
    originalId,
  );
  const seeded = await seedDevelopmentDatabase(db, {
    userId,
    scenario: "invitation",
    activate: true,
  });
  const state = await api.budget.state({ month });
  assert.equal(state.view!.members.length, 1);
  assert.equal(state.partnerFirstName, null);
  const invitation = await api.budget.invitation();
  assert.equal(invitation?.email, "partner@example.test");
  assert.equal(invitation?.expired, false);
  const token = seeded.invitationPath!.split("/").at(-1)!;
  const card = await api.budget.openInvitation({ token });
  assert.equal(card.status, "live");
  if (card.status !== "live") assert.fail("the seed invitation must open");
  assert.equal(card.from, "Alex");
  assert.ok(card.signature.length > 0);
  assert.equal((await seedDevelopmentDatabase(db, { userId })).skipped, true);
  assert.deepEqual(await api.budget.invitation(), invitation);
  await restoreDevelopmentWorkspace(db, userId, originalId);
  assert.equal(await api.budget.invitation(), null);
  await seedDevelopmentDatabase(db, {
    userId,
    scenario: "invitation",
    activate: true,
    reset: true,
  });
  await seedDevelopmentDatabase(db, {
    userId,
    scenario: "former-partner",
    reset: true,
  });
  assert.equal(await api.budget.invitation(), null);
  assert.equal((await api.budget.openInvitation({ token })).status, "invalid");
});

void test("the former-partner preset persists a solo budget and can reset to a household", async (t) => {
  const { db, userId, api, month } = seedFixture(t);
  await seedDevelopmentDatabase(db, { userId, scenario: "former-partner" });
  const state = await api.budget.state({ month });
  assert.equal(state.view!.members.length, 1);
  assert.equal(state.partnerFirstName, null);
  const former = state.view.accounts.find(
    (account) => account.kind === "former-partner",
  )!;
  assert.equal(former.name, "Jordan");
  assert.ok(state.view.formerPartnerLedgers[former.id]!.length > 0);
  const repeated = await seedDevelopmentDatabase(db, { userId });
  assert.equal(repeated.skipped, true);
  assert.equal((await api.budget.state({ month })).view!.members.length, 1);
  await assert.rejects(
    seedDevelopmentDatabase(db, { userId, scenario: "household" }),
    /--reset/,
  );
  await seedDevelopmentDatabase(db, {
    userId,
    scenario: "household",
    reset: true,
  });
  const household = await api.budget.state({ month });
  assert.equal(household.view!.members.length, 2);
  assert.equal(household.partnerFirstName, "Jordan (demo)");
  assert.equal(
    household.view.accounts.some(
      (account) => account.kind === "former-partner",
    ),
    false,
  );
});

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
    assert.equal(state.imports.length, 1);
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
      6,
    );
    assert.equal(
      await db.reviewEvidence.count({
        where: { clerkUserId: { in: userIds } },
      }),
      0,
    );
    const partnerApi = createCaller({
      db,
      userId: identity.partnerId,
      headers: new Headers(),
      revision: new ObservedRevision(),
    });
    const partnerBeforeRestore = await partnerApi.budget.state({ month });
    await restoreDevelopmentWorkspace(db, userId, originalId);
    const partnerAfterRestore = await partnerApi.budget.state({ month });
    assert.deepEqual(
      partnerAfterRestore.connections,
      partnerBeforeRestore.connections,
    );
    assert.deepEqual(partnerAfterRestore.imports, partnerBeforeRestore.imports);
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
