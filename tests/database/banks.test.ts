import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { PrismaClient } from "../../src/generated/prisma";
import {
  createBook,
  execute,
  type Book,
  type Command,
} from "../../src/domain/engine";
import { createCaller } from "../../src/server/api/root";
import {
  applyTransactionSync,
  normalizePlaidTransaction,
  type StoredImport,
} from "../../src/server/integrations/transactions";
import { commandHash, jsonValue } from "../../src/server/services/safety";

const connectionUrl = process.env.DATABASE_URL;
if (
  !connectionUrl ||
  !new URL(connectionUrl).hostname.startsWith("ep-odd-voice-b4sie2v1")
) {
  throw new Error(
    "Bank service database tests require the isolated dev-caishen branch.",
  );
}

const fixtureFingerprint = (record: StoredImport) =>
  commandHash({
    current: record.current,
    removed: record.removed,
    matchStatus: record.matchStatus,
  });

function fixtureBook(userId: string, accountPrefix: string): Book {
  let book = createBook(userId, `Fixture ${accountPrefix}`, "2026-10");
  const commands: Command[] = [
    {
      type: "account.add",
      id: randomUUID(),
      accountId: `${accountPrefix}-checking`,
      name: "Fixture checking",
      kind: "cash",
      openingBalance: 100_000,
      date: "2026-10-01",
    },
    {
      type: "account.add",
      id: randomUUID(),
      accountId: `${accountPrefix}-savings`,
      name: "Fixture savings",
      kind: "cash",
      openingBalance: 10_000,
      date: "2026-10-01",
    },
    {
      type: "category.add",
      id: randomUUID(),
      categoryId: "food",
      name: "Fixture food",
    },
  ];
  if (accountPrefix === "alice") {
    for (const [transactionId, accountId, date, amount] of [
      ["existing-exact", "alice-checking", "2026-10-05", -2500],
      ["existing-other-account", "alice-savings", "2026-10-05", -2500],
      ["existing-other-date", "alice-checking", "2026-10-06", -2500],
      ["existing-other-amount", "alice-checking", "2026-10-05", -2501],
      ["existing-conflict", "alice-checking", "2026-10-07", -3000],
    ] as const) {
      commands.push({
        type: "transaction.upsert",
        id: randomUUID(),
        transactionId,
        accountId,
        date,
        amount,
        payee:
          transactionId === "existing-conflict"
            ? "Fixture conflict merchant"
            : "Fixture coffee",
        categoryId: "food",
        status: transactionId === "existing-conflict" ? "pending" : "posted",
      });
    }
  }
  for (const command of commands) book = execute(book, userId, command);
  return book;
}

function fixtureRecord(
  namespace: string,
  providerId: string,
  overrides: Record<string, unknown> = {},
): StoredImport {
  const fact = normalizePlaidTransaction({
    transaction_id: providerId,
    account_id: "fixture-provider-checking",
    pending_transaction_id: null,
    pending: false,
    amount: 25,
    iso_currency_code: "USD",
    date: "2026-10-05",
    authorized_date: "2026-10-05",
    name: "Fixture coffee",
    merchant_name: "Fixture coffee",
    ...overrides,
  });
  return applyTransactionSync(
    [],
    { added: [fact], modified: [], removed: [] },
    namespace,
  ).records[0]!;
}

void test(
  "persisted fixture bank imports enforce private ownership, cutoff rules, and reviewed identities without provider calls",
  { timeout: 90_000 },
  async () => {
    const db = new PrismaClient();
    const aliceId = `test-bank-alice-${randomUUID()}`;
    const bobId = `test-bank-bob-${randomUUID()}`;
    const users = [aliceId, bobId];
    const aliceConnectionId = `fixture-bank-${randomUUID()}`;
    const bobConnectionId = `fixture-bank-${randomUUID()}`;
    const api = (userId: string) =>
      createCaller({ db, userId, headers: new Headers() });
    const alice = api(aliceId);
    const bob = api(bobId);
    const state = () => alice.budget.state({ month: "2026-10" });
    const preopening = fixtureRecord(aliceConnectionId, "fixture-preopening", {
      date: "2026-10-01",
      authorized_date: "2026-10-01",
      name: "Fixture opening history",
      merchant_name: "Fixture opening history",
    });
    const exact = fixtureRecord(aliceConnectionId, "fixture-exact");
    const pendingIncome = fixtureRecord(
      aliceConnectionId,
      "fixture-pending-income",
      {
        date: "2026-10-10",
        authorized_date: "2026-10-10",
        amount: -100,
        pending: true,
        name: "Fixture pending payroll",
        merchant_name: "Fixture pending payroll",
      },
    );
    const conflict = fixtureRecord(aliceConnectionId, "fixture-conflict", {
      date: "2026-10-07",
      authorized_date: "2026-10-07",
      amount: 30,
      pending: true,
      name: "Fixture conflict merchant",
      merchant_name: "Fixture conflict merchant",
    });
    const confirmedConflictFingerprint = fixtureFingerprint(conflict);
    conflict.matchStatus = "needs_review";
    const bobPrivate = fixtureRecord(bobConnectionId, "fixture-bob-private", {
      name: "Bob private fixture merchant",
      merchant_name: "Bob private fixture merchant",
    });
    try {
      await db.user.createMany({
        data: users.map((clerkUserId) => ({ clerkUserId })),
      });
      for (const [userId, prefix] of [
        [aliceId, "alice"],
        [bobId, "bob"],
      ] as const) {
        await db.workspace.create({
          data: {
            book: jsonValue(fixtureBook(userId, prefix)),
            members: { create: { clerkUserId: userId } },
          },
        });
      }
      await db.bankConnection.create({
        data: {
          id: aliceConnectionId,
          clerkUserId: aliceId,
          itemId: `fixture-item-${randomUUID()}`,
          encryptedToken: "fixture-only-no-provider-token",
          imports: jsonValue({
            records: [preopening, exact, pendingIncome, conflict],
            resolved: {
              [conflict.id]: {
                fingerprint: confirmedConflictFingerprint,
                transactionId: "existing-conflict",
              },
            },
            errors: {
              [conflict.id]:
                "Fixture conflicting provider identity requires review.",
            },
            reviews: {
              [conflict.id]: [
                {
                  kind: "conflicting_identity",
                  message: "Fixture evidence requires explicit review.",
                },
              ],
            },
          }),
          accountMappings: {},
        },
      });
      await db.bankConnection.create({
        data: {
          id: bobConnectionId,
          clerkUserId: bobId,
          itemId: `fixture-item-${randomUUID()}`,
          encryptedToken: "fixture-bob-token-never-return",
          imports: jsonValue({
            records: [bobPrivate],
            resolved: {},
            errors: {},
            reviews: {},
          }),
          accountMappings: {},
        },
      });

      const ownInbox = await state();
      const otherInbox = await bob.budget.state({ month: "2026-10" });
      assert.equal(ownInbox.imports.length, 4);
      assert.equal(otherInbox.imports.length, 1);
      assert.ok(
        !JSON.stringify(ownInbox).includes("Bob private fixture merchant"),
      );
      assert.ok(
        !JSON.stringify(otherInbox).includes("Fixture pending payroll"),
      );
      assert.ok(
        !JSON.stringify(ownInbox).includes("fixture-only-no-provider-token"),
      );
      assert.ok(
        !JSON.stringify(otherInbox).includes("fixture-bob-token-never-return"),
      );

      const matchConflict = ownInbox.imports.find(
        (item) => item.logicalId === conflict.id,
      );
      assert.ok(matchConflict);
      assert.equal(
        matchConflict.needsMatchReview,
        true,
        "a status-only identity conflict must reopen a previously resolved import",
      );
      assert.match(matchConflict.error!, /conflicting provider identity/);
      assert.equal(matchConflict.reviewEvidence.length, 1);

      await assert.rejects(
        () =>
          bob.budget.mapBankAccount({
            connectionId: aliceConnectionId,
            providerAccountId: "fixture-provider-checking",
            accountId: "bob-checking",
            startDate: "2026-10-02",
          }),
        { code: "NOT_FOUND" },
      );
      await assert.rejects(
        () =>
          bob.budget.resolveImport({
            connectionId: aliceConnectionId,
            logicalId: exact.id,
            expectedRevision: 0,
            ignore: true,
          }),
        { code: "NOT_FOUND" },
      );
      await assert.rejects(
        () =>
          alice.budget.mapBankAccount({
            connectionId: aliceConnectionId,
            providerAccountId: "fixture-provider-checking",
            accountId: "bob-checking",
            startDate: "2026-10-02",
          }),
        { code: "NOT_FOUND" },
      );
      for (const startDate of ["2026-09-30", "2026-10-01"]) {
        await assert.rejects(
          () =>
            alice.budget.mapBankAccount({
              connectionId: aliceConnectionId,
              providerAccountId: "fixture-provider-checking",
              accountId: "alice-checking",
              startDate,
            }),
          { code: "BAD_REQUEST" },
        );
      }
      assert.deepEqual(
        await alice.budget.mapBankAccount({
          connectionId: aliceConnectionId,
          providerAccountId: "fixture-provider-checking",
          accountId: "alice-checking",
          startDate: "2026-10-02",
        }),
        { mapped: true },
      );
      await assert.rejects(
        () =>
          alice.budget.mapBankAccount({
            connectionId: aliceConnectionId,
            providerAccountId: "second-provider-account",
            accountId: "alice-checking",
            startDate: "2026-10-02",
          }),
        { code: "BAD_REQUEST" },
      );
      const mappedState = await state();
      assert.ok(
        !mappedState.imports.some((item) => item.logicalId === preopening.id),
      );
      await assert.rejects(
        () =>
          alice.budget.resolveImport({
            connectionId: aliceConnectionId,
            logicalId: preopening.id,
            expectedRevision: mappedState.revision,
            existingTransactionId: "existing-exact",
          }),
        { code: "BAD_REQUEST" },
      );

      for (const transactionId of [
        "existing-other-account",
        "existing-other-date",
        "existing-other-amount",
      ]) {
        await assert.rejects(
          () =>
            alice.budget.resolveImport({
              connectionId: aliceConnectionId,
              logicalId: exact.id,
              expectedRevision: mappedState.revision,
              existingTransactionId: transactionId,
            }),
          { code: "BAD_REQUEST" },
        );
      }
      const transactionCount = mappedState.view!.budget.transactions.length;
      await alice.budget.resolveImport({
        connectionId: aliceConnectionId,
        logicalId: exact.id,
        expectedRevision: mappedState.revision,
        existingTransactionId: "existing-exact",
      });
      const linkedState = await state();
      assert.equal(
        linkedState.view!.budget.transactions.length,
        transactionCount,
        "linking a confirmed existing record must not duplicate its accounting effects",
      );
      assert.equal(linkedState.view!.cash, mappedState.view!.cash);
      assert.ok(
        !linkedState.imports.some((item) => item.logicalId === exact.id),
      );

      await alice.budget.resolveImport({
        connectionId: aliceConnectionId,
        logicalId: pendingIncome.id,
        expectedRevision: linkedState.revision,
        command: {
          type: "transaction.upsert",
          id: randomUUID(),
          transactionId: "imported-pending-income",
          accountId: "alice-checking",
          date: "2026-10-10",
          amount: 10_000,
          payee: "User attempted to rename confirmed payroll",
          status: "posted",
        },
      });
      const resolvedState = await state();
      const imported = resolvedState.view!.budget.transactions.find(
        (transaction) => transaction.id === "imported-pending-income",
      );
      assert.ok(imported);
      assert.equal(
        imported.status,
        "pending",
        "the provider's pending status must override a client declaring the deposit posted",
      );
      assert.equal(imported.payee, "Fixture pending payroll");
      assert.equal(imported.providerId, "fixture-pending-income");
      assert.equal(
        resolvedState.view!.cash,
        linkedState.view!.cash,
        "pending inflow cannot create liquid cash",
      );
      assert.equal(
        resolvedState.view!.readyToAssign,
        linkedState.view!.readyToAssign,
        "pending inflow cannot be allocated",
      );
      assert.ok(
        !resolvedState.imports.some(
          (item) => item.logicalId === pendingIncome.id,
        ),
      );
      assert.equal(
        (await bob.budget.state({ month: "2026-10" })).imports.length,
        1,
      );
    } finally {
      await db.bankConnection.deleteMany({
        where: { clerkUserId: { in: users } },
      });
      const memberships = await db.workspaceMember.findMany({
        where: { clerkUserId: { in: users } },
      });
      await db.workspace.deleteMany({
        where: { id: { in: memberships.map((member) => member.workspaceId) } },
      });
      await db.user.deleteMany({ where: { clerkUserId: { in: users } } });
      await db.$disconnect();
    }
  },
);
