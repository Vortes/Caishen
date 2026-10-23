import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { PrismaClient } from "../../src/generated/prisma";
import {
  createBook,
  execute,
  withCounterpartyAccounts,
  type Book,
  type Command,
} from "../../src/domain/engine";
import { createDatabaseCaller as createCaller } from "./fixtures";
import { ObservedRevision } from "../../src/server/api/trpc";
import {
  applyTransactionSync,
  normalizePlaidTransaction,
  type StoredImport,
} from "../../src/server/integrations/transactions";
import { commandHash, jsonValue } from "../../src/server/services/safety";
import { bankMappingsSchema } from "../../src/server/services/bank-account-setup";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { createBankConnection, createHousehold } from "./fixtures";

assertDevelopmentDatabase(process.env);

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
      createCaller({
        revision: new ObservedRevision(),
        db,
        userId,
        headers: new Headers(),
      });
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
        await createHousehold(
          db,
          withCounterpartyAccounts(fixtureBook(userId, prefix)),
        );
      }
      await createBankConnection(db, {
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
      await createBankConnection(db, {
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
          accountMappings: {
            "fixture-provider-checking": {
              accountId: "bob-checking",
              startDate: "2026-10-01",
            },
          },
        },
      });

      const ownInbox = await state();
      const otherInbox = await bob.budget.state({ month: "2026-10" });
      // Alice's bank account isn't in her budget yet, so none of its
      // activity is up for review.
      assert.equal(ownInbox.imports.length, 0);
      assert.equal(otherInbox.imports.length, 1);
      // The app shell reads the same connections and inbox beside its rows.
      for (const [caller, inbox] of [
        [alice, ownInbox],
        [bob, otherInbox],
      ] as const) {
        const overview = await caller.budget.overview();
        assert.equal(overview.status, "ready");
        assert.deepEqual(overview.imports, inbox.imports);
        assert.deepEqual(overview.connections, inbox.connections);
        assert.deepEqual(overview.services, inbox.services);
      }
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
      const mapped = await alice.budget.mapBankAccount({
        connectionId: aliceConnectionId,
        providerAccountId: "fixture-provider-checking",
        accountId: "alice-checking",
        startDate: "2026-10-02",
      });
      // The inbox changes, so browsers learn of a new revision.
      assert.equal(mapped.mapped, true);
      assert.deepEqual(mapped.changeSet?.after, []);
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
      assert.equal(mappedState.revision, ownInbox.revision + 1);
      assert.deepEqual(mappedState.history, { undo: null, redo: null });
      assert.ok(
        !mappedState.imports.some((item) => item.logicalId === preopening.id),
      );
      const matchConflict = mappedState.imports.find(
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
      assert.equal(linkedState.revision, mappedState.revision + 1);
      assert.deepEqual(linkedState.history, { undo: null, redo: null });
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

void test(
  "bank mappings and existing-transaction links prevent undo from deleting referenced ledger records",
  { timeout: 90_000 },
  async () => {
    const db = new PrismaClient();
    const userId = `test-bank-history-${randomUUID()}`;
    const connectionId = `fixture-bank-history-${randomUUID()}`;
    const api = createCaller({
      revision: new ObservedRevision(),
      db,
      userId,
      headers: new Headers(),
    });
    const record = fixtureRecord(connectionId, "history-purchase");
    try {
      await db.user.create({ data: { clerkUserId: userId } });
      await createHousehold(
        db,
        withCounterpartyAccounts(fixtureBook(userId, "history")),
      );
      await createBankConnection(db, {
        data: {
          id: connectionId,
          clerkUserId: userId,
          itemId: `fixture-item-${randomUUID()}`,
          encryptedToken: "fixture-no-provider-token",
          imports: jsonValue({ records: [record], resolved: {}, errors: {} }),
          accountMappings: {},
        },
      });
      const start = (await api.budget.state({ month: "2026-10" })).revision;
      const addAccount = randomUUID();
      await api.budget.execute({
        clientId: "test",
        baseRevision: start,
        command: {
          type: "account.add",
          id: addAccount,
          accountId: "mapped-account",
          name: "Mapped checking",
          kind: "cash",
          openingBalance: 10000,
          date: "2026-10-01",
        },
      });
      assert.equal(
        (await api.budget.state({ month: "2026-10" })).history.undo,
        "Add account",
      );
      await api.budget.mapBankAccount({
        connectionId,
        providerAccountId: "fixture-provider-checking",
        accountId: "mapped-account",
        startDate: "2026-10-02",
      });
      let state = await api.budget.state({ month: "2026-10" });
      assert.equal(state.revision, start + 2);
      assert.deepEqual(state.history, { undo: null, redo: null });
      await assert.rejects(
        api.budget.changeHistory({
          direction: "undo",
          operationId: randomUUID(),
          expectedRevision: start + 1,
        }),
        { code: "CONFLICT" },
      );
      await assert.rejects(
        api.budget.changeHistory({
          direction: "undo",
          operationId: randomUUID(),
          expectedRevision: start + 2,
        }),
        { code: "BAD_REQUEST" },
      );
      // Undo from the browser's own history is refused too.
      await assert.rejects(
        api.budget.execute({
          clientId: "test",
          baseRevision: state.revision,
          command: {
            type: "revert",
            id: randomUUID(),
            targetOperationId: addAccount,
          },
        }),
        { code: "CONFLICT", message: /bank connection uses it/ },
      );
      assert.ok(
        state.view!.budget.accounts.some(
          (account) => account.id === "mapped-account",
        ),
      );

      await api.budget.execute({
        clientId: "test",
        baseRevision: state.revision,
        command: {
          type: "transaction.upsert",
          id: randomUUID(),
          transactionId: "linked-transaction",
          accountId: "mapped-account",
          date: record.current.date,
          amount: -record.current.amountCents,
          payee: "Fixture coffee",
          categoryId: "food",
        },
      });
      state = await api.budget.state({ month: "2026-10" });
      assert.equal(state.history.undo, "Save transaction");
      await api.budget.resolveImport({
        connectionId,
        logicalId: record.id,
        existingTransactionId: "linked-transaction",
        expectedRevision: state.revision,
      });
      const linked = await api.budget.state({ month: "2026-10" });
      assert.equal(linked.revision, state.revision + 1);
      assert.deepEqual(linked.history, { undo: null, redo: null });
      await assert.rejects(
        api.budget.changeHistory({
          direction: "undo",
          operationId: randomUUID(),
          expectedRevision: linked.revision,
        }),
        { code: "BAD_REQUEST" },
      );
      assert.ok(
        linked.view!.budget.transactions.some(
          (transaction) =>
            transaction.id === "linked-transaction" && !transaction.removed,
        ),
      );
      assert.ok(!linked.imports.some((item) => item.logicalId === record.id));
    } finally {
      await db.bankConnection.deleteMany({ where: { clerkUserId: userId } });
      await db.workspace.deleteMany({
        where: { members: { some: { clerkUserId: userId } } },
      });
      await db.user.deleteMany({ where: { clerkUserId: userId } });
      await db.$disconnect();
    }
  },
);

for (const boundary of ["mapping", "existing transaction link"] as const)
  void test(
    `concurrent ${boundary} and undo cannot commit a dangling bank reference`,
    { timeout: 90_000 },
    async () => {
      const db = new PrismaClient();
      const userId = `test-bank-race-${randomUUID()}`;
      const connectionId = `fixture-bank-race-${randomUUID()}`;
      const record = fixtureRecord(connectionId, "race-purchase");
      const api = createCaller({
        revision: new ObservedRevision(),
        db,
        userId,
        headers: new Headers(),
      });
      const accountId =
        boundary === "mapping" ? "race-account" : "race-checking";
      try {
        await db.user.create({ data: { clerkUserId: userId } });
        await createHousehold(db, fixtureBook(userId, "race"));
        await createBankConnection(db, {
          data: {
            id: connectionId,
            clerkUserId: userId,
            itemId: `fixture-item-${randomUUID()}`,
            encryptedToken: "fixture-no-provider-token",
            imports: jsonValue({ records: [record], resolved: {}, errors: {} }),
            accountMappings:
              boundary === "mapping"
                ? {}
                : {
                    "fixture-provider-checking": {
                      accountId,
                      startDate: "2026-10-02",
                    },
                  },
          },
        });
        const { revision: expected } = await api.budget.execute({
          clientId: "test",
          baseRevision: (await api.budget.state({ month: "2026-10" })).revision,
          command:
            boundary === "mapping"
              ? {
                  type: "account.add",
                  id: randomUUID(),
                  accountId,
                  name: "Race checking",
                  kind: "cash",
                  openingBalance: 10000,
                  date: "2026-10-01",
                }
              : {
                  type: "transaction.upsert",
                  id: randomUUID(),
                  transactionId: "race-transaction",
                  accountId,
                  amount: -record.current.amountCents,
                  date: record.current.date,
                  payee: "Fixture coffee",
                  categoryId: "food",
                },
        });
        let reads = 0;
        let release!: () => void;
        const bothRead = new Promise<void>((resolve) => {
          release = resolve;
        });
        // Both requests read the household before either writes.
        const concurrentDb = db.$extends({
          query: {
            async $allOperations({ operation, args, query }) {
              const household =
                operation === "$queryRaw" &&
                JSON.stringify(args).includes("WorkspaceMember");
              const result: unknown = await query(args);
              if (household && reads < 2) {
                reads++;
                if (reads === 2) release();
                await bothRead;
              }
              return result;
            },
          },
        }) as unknown as PrismaClient;
        const racer = createCaller({
          revision: new ObservedRevision(),
          db: concurrentDb,
          userId,
          headers: new Headers(),
        });
        const results = await Promise.allSettled([
          boundary === "mapping"
            ? racer.budget.mapBankAccount({
                connectionId,
                providerAccountId: "fixture-provider-checking",
                accountId,
                startDate: "2026-10-02",
              })
            : racer.budget.resolveImport({
                connectionId,
                logicalId: record.id,
                existingTransactionId: "race-transaction",
                expectedRevision: expected,
              }),
          racer.budget.changeHistory({
            direction: "undo",
            expectedRevision: expected,
            operationId: randomUUID(),
          }),
        ]);
        assert.equal(reads, 2);
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        const saved = await api.budget.state({ month: "2026-10" });
        const budget = saved.view!.budget;
        const connection = saved.connections.find(
          (item) => item.id === connectionId,
        )!;
        const externalCommitted = results[0].status === "fulfilled";
        if (boundary === "mapping") {
          const mapping = bankMappingsSchema.parse(connection.accountMappings)[
            "fixture-provider-checking"
          ];
          assert.equal(Boolean(mapping), externalCommitted);
          assert.equal(
            budget.accounts.some((account) => account.id === accountId),
            externalCommitted,
          );
        } else {
          assert.equal(
            saved.imports.some((item) => item.logicalId === record.id),
            !externalCommitted,
          );
          assert.equal(
            budget.transactions.some(
              (transaction) =>
                transaction.id === "race-transaction" && !transaction.removed,
            ),
            externalCommitted,
          );
        }
      } finally {
        await db.bankConnection.deleteMany({ where: { clerkUserId: userId } });
        await db.workspace.deleteMany({
          where: { members: { some: { clerkUserId: userId } } },
        });
        await db.user.deleteMany({ where: { clerkUserId: userId } });
        await db.$disconnect();
      }
    },
  );
