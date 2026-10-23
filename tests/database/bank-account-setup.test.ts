import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { PrismaClient } from "../../src/generated/prisma";
import {
  createBook,
  isCounterparty,
  withCounterpartyAccounts,
} from "../../src/domain/engine";
import { createDatabaseCaller as createCaller } from "./fixtures";
import { ObservedRevision } from "../../src/server/api/trpc";
import {
  applyTransactionSync,
  normalizePlaidTransaction,
} from "../../src/server/integrations/transactions";
import {
  bankMappingsSchema,
  bankSetupDate,
} from "../../src/server/services/bank-account-setup";
import { jsonValue } from "../../src/server/services/safety";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import {
  createBankConnection,
  createHousehold,
  setConnectionImports,
} from "./fixtures";

assertDevelopmentDatabase(process.env);
async function fixture(t: TestContext) {
  const db = new PrismaClient();
  const users = [`setup-alice-${randomUUID()}`, `setup-bob-${randomUUID()}`];
  const [aliceId, bobId] = users as [string, string];
  const connectionId = `setup-connection-${randomUUID()}`;
  const api = (userId: string) =>
    createCaller({
      revision: new ObservedRevision(),
      db,
      userId,
      headers: new Headers(),
    });
  const alice = api(aliceId);
  const bob = api(bobId);
  const today = bankSetupDate("America/Los_Angeles");
  const month = today.slice(0, 7);
  const state = () => alice.budget.state({ month });
  const providerAccount = (
    accountId: string,
    type: string,
    subtype: string,
    currentBalance: number,
  ) => ({
    accountId,
    name: accountId,
    officialName: null,
    mask: "1234",
    type,
    subtype,
    currentBalance,
    availableBalance: null,
    currency: "USD",
  });
  const records = applyTransactionSync(
    [],
    {
      added: [
        normalizePlaidTransaction({
          transaction_id: "baseline",
          account_id: "checking",
          pending: false,
          amount: 20,
          iso_currency_code: "USD",
          date: today,
          name: "Already posted",
        }),
        normalizePlaidTransaction({
          transaction_id: "pending",
          account_id: "checking",
          pending: true,
          amount: 15,
          iso_currency_code: "USD",
          date: today,
          name: "Pending today",
        }),
      ],
      modified: [],
      removed: [],
    },
    connectionId,
  ).records;
  const imports = {
    records,
    resolved: {},
    errors: {},
    reviews: {},
    accounts: [
      providerAccount("checking", "depository", "checking", 1200.5),
      providerAccount("card", "credit", "credit card", 200.25),
      providerAccount("investment", "investment", "brokerage", 1000),
    ],
    transactionStatus: null as string | null,
    synchronizedAccountIds: [] as string[],
  };
  const request = {
    connectionId,
    operationId: randomUUID(),
    expectedRevision: 0,
    accounts: [
      {
        providerAccountId: "checking",
        name: "Everyday cash",
        expectedBalance: 1200.5,
      },
      {
        providerAccountId: "card",
        name: "Travel card",
        expectedBalance: 200.25,
      },
    ],
  };

  t.after(async () => {
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
  });
  await db.user.createMany({
    data: users.map((clerkUserId) => ({ clerkUserId })),
  });
  for (const userId of users)
    await createHousehold(
      db,
      withCounterpartyAccounts(createBook(userId, "Fixture", month)),
    );
  await createBankConnection(db, {
    data: {
      id: connectionId,
      clerkUserId: aliceId,
      itemId: `setup-item-${randomUUID()}`,
      encryptedToken: "fixture-no-provider-token",
      imports: jsonValue(imports),
      accountMappings: {},
      lastSyncedAt: new Date(),
    },
  });
  request.expectedRevision = (await state()).revision;
  const ready = async () => {
    imports.transactionStatus = "HISTORICAL_UPDATE_COMPLETE";
    imports.synchronizedAccountIds = ["checking", "card", "investment"];
    await setConnectionImports(db, aliceId, connectionId, imports);
  };
  return {
    db,
    aliceId,
    bob,
    alice,
    today,
    month,
    state,
    providerAccount,
    records,
    imports,
    request,
    connectionId,
    ready,
  };
}

void test("bank setup refuses another owner, incomplete or stale activity, conflicting balances and unsupported accounts without changing the budget", async (t) => {
  const { db, aliceId, bob, alice, imports, request, connectionId, state } =
    await fixture(t);
  await assert.rejects(bob.budget.setupBankAccounts(request), {
    code: "NOT_FOUND",
  });
  await assert.rejects(alice.budget.setupBankAccounts(request), {
    code: "PRECONDITION_FAILED",
  });
  imports.transactionStatus = "HISTORICAL_UPDATE_COMPLETE";
  await setConnectionImports(db, aliceId, connectionId, imports);
  await assert.rejects(alice.budget.setupBankAccounts(request), {
    code: "PRECONDITION_FAILED",
  });
  imports.synchronizedAccountIds = ["checking", "card", "investment"];
  await setConnectionImports(db, aliceId, connectionId, imports);
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await db.bankConnection.update({
    where: { id: connectionId },
    data: { lastSyncedAt: yesterday },
  });
  await assert.rejects(alice.budget.setupBankAccounts(request), {
    code: "PRECONDITION_FAILED",
  });
  await db.bankConnection.update({
    where: { id: connectionId },
    data: { lastSyncedAt: new Date() },
  });
  await assert.rejects(
    alice.budget.setupBankAccounts({
      ...request,
      expectedRevision: request.expectedRevision - 1,
    }),
    { code: "CONFLICT" },
  );
  await assert.rejects(
    alice.budget.setupBankAccounts({
      ...request,
      accounts: [
        request.accounts[0]!,
        { ...request.accounts[1]!, expectedBalance: 50 },
      ],
    }),
    { code: "CONFLICT" },
  );
  await assert.rejects(
    alice.budget.setupBankAccounts({
      ...request,
      accounts: [
        request.accounts[0]!,
        {
          providerAccountId: "investment",
          name: "Investments",
          expectedBalance: 1000,
        },
      ],
    }),
    { code: "BAD_REQUEST" },
  );
  const untouched = await state();
  assert.equal(untouched.revision, request.expectedRevision);
  assert.deepEqual(
    untouched.view!.budget.accounts.filter(
      (account) => !isCounterparty(account),
    ),
    [],
  );
  assert.deepEqual(untouched.connections[0]!.accountMappings, {});
});

void test("bank setup retries reuse the original result and reject changed details", async (t) => {
  const { alice, request, ready, state } = await fixture(t);
  await ready();
  const added = await alice.budget.setupBankAccounts(request);
  assert.equal(added.revision, request.expectedRevision + 1);
  assert.equal(added.accountIds.length, 2);
  assert.deepEqual(
    await alice.budget.setupBankAccounts({
      ...request,
      expectedRevision: 99,
    }),
    added,
  );
  await assert.rejects(
    alice.budget.setupBankAccounts({
      ...request,
      accounts: [
        { ...request.accounts[0]!, name: "Changed name" },
        request.accounts[1]!,
      ],
    }),
    { code: "BAD_REQUEST", message: /different details/ },
  );

  assert.equal(
    (await state()).view!.accounts.filter((account) => !isCounterparty(account))
      .length,
    2,
  );
});

void test("bank setup creates named accounts with opening balances and leaves pending imports for review", async (t) => {
  const { alice, bob, request, ready, state, today, month } = await fixture(t);
  await ready();
  const added = await alice.budget.setupBankAccounts(request);
  const saved = await state();
  assert.equal(saved.view!.cash, 120050);
  assert.equal(saved.view!.readyToAssign, 120050);
  assert.deepEqual(
    saved
      .view!.accounts.filter((account) => !isCounterparty(account))
      .map((account) => [account.name, account.kind, account.balance]),
    [
      ["Everyday cash", "cash", 120050],
      ["Travel card", "credit", -20025],
    ],
  );
  assert.ok(
    saved.view!.budget.categories.some(
      (category) => category.name === "Travel card payment",
    ),
  );
  const mappings = bankMappingsSchema.parse(
    saved.connections[0]!.accountMappings,
  );
  assert.equal(mappings.checking!.startDate, today);
  assert.equal(mappings.checking!.openingSnapshot!.postedImportIds.length, 1);
  assert.equal(
    saved.imports.some((record) => record.payee === "Already posted"),
    false,
  );
  assert.equal(
    saved.imports.some((record) => record.payee === "Pending today"),
    true,
  );
  assert.equal(
    (await bob.budget.state({ month })).view!.accounts.filter(
      (account) => !isCounterparty(account),
    ).length,
    0,
  );
  assert.equal(saved.revision, added.revision);
  await assert.rejects(
    alice.budget.setupBankAccounts({
      ...request,
      operationId: randomUUID(),
      expectedRevision: saved.revision,
    }),
    { code: "BAD_REQUEST" },
  );
});

void test("changes to opening history require review without counting the old purchase twice", async (t) => {
  const {
    db,
    aliceId,
    alice,
    records,
    imports,
    request,
    connectionId,
    ready,
    state,
    today,
  } = await fixture(t);
  await ready();
  await alice.budget.setupBankAccounts(request);
  const saved = await state();
  const mappings = bankMappingsSchema.parse(
    saved.connections[0]!.accountMappings,
  );
  const baseline = records.find(
    (record) => record.current.providerTransactionId === "baseline",
  )!;
  const command = {
    type: "transaction.upsert" as const,
    id: randomUUID(),
    transactionId: randomUUID(),
    accountId: mappings.checking!.accountId,
    date: today,
    amount: -2000,
    payee: "Already posted",
  };
  await assert.rejects(
    alice.budget.resolveImport({
      connectionId,
      logicalId: baseline.id,
      expectedRevision: saved.revision,
      command,
    }),
    { code: "BAD_REQUEST" },
  );
  baseline.current.amountCents = 2500;
  await setConnectionImports(db, aliceId, connectionId, imports);
  const changed = await state();
  assert.match(
    changed.imports.find((record) => record.logicalId === baseline.id)!.error!,
    /opening balance/,
  );
  await assert.rejects(
    alice.budget.resolveImport({
      connectionId,
      logicalId: baseline.id,
      expectedRevision: changed.revision,
      command: { ...command, amount: -2500 },
    }),
    { code: "BAD_REQUEST" },
  );
  assert.equal((await state()).view!.cash, 120050);
  await alice.budget.resolveImport({
    connectionId,
    logicalId: baseline.id,
    expectedRevision: changed.revision,
    ignore: true,
  });
  assert.equal(
    (await state()).imports.some((record) => record.logicalId === baseline.id),
    false,
  );
});

void test("linking an existing account preserves its name and balance and rejects incompatible links", async (t) => {
  const {
    db,
    aliceId,
    alice,
    imports,
    request,
    ready,
    state,
    today,
    providerAccount,
  } = await fixture(t);
  await ready();
  await alice.budget.setupBankAccounts(request);
  const mappings = bankMappingsSchema.parse(
    (await state()).connections[0]!.accountMappings,
  );
  await alice.budget.execute({
    clientId: "test",
    baseRevision: (await state()).revision,
    command: {
      type: "account.add",
      id: randomUUID(),
      accountId: "manual-cash",
      name: "My existing cash",
      kind: "cash",
      openingBalance: 300000,
      date: today,
    },
  });
  const secondConnectionId = `second-${randomUUID()}`;
  await createBankConnection(db, {
    data: {
      id: secondConnectionId,
      clerkUserId: aliceId,
      itemId: `second-item-${randomUUID()}`,
      encryptedToken: "fixture-no-provider-token",
      imports: jsonValue({
        ...imports,
        records: [],
        accounts: [
          providerAccount("manual-checking", "depository", "checking", 3456),
        ],
      }),
      accountMappings: {},
      lastSyncedAt: new Date(),
    },
  });
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const link = {
    connectionId: secondConnectionId,
    operationId: randomUUID(),
    expectedRevision: (await state()).revision,
    accounts: [
      {
        providerAccountId: "manual-checking",
        name: "Name must remain unchanged",
        expectedBalance: 3456,
        existingAccountId: "manual-cash",
        startDate: tomorrow.toISOString().slice(0, 10),
      },
    ],
  };
  await assert.rejects(
    alice.budget.setupBankAccounts({
      ...link,
      accounts: [
        {
          ...link.accounts[0]!,
          existingAccountId: mappings.checking!.accountId,
        },
      ],
    }),
    { code: "BAD_REQUEST" },
  );
  await assert.rejects(
    alice.budget.setupBankAccounts({
      ...link,
      accounts: [
        {
          ...link.accounts[0]!,
          existingAccountId: mappings.card!.accountId,
        },
      ],
    }),
    { code: "BAD_REQUEST" },
  );
  await assert.rejects(
    alice.budget.setupBankAccounts({
      ...link,
      accounts: [{ ...link.accounts[0]!, startDate: today }],
    }),
    { code: "BAD_REQUEST" },
  );
  await assert.rejects(
    alice.budget.mapBankAccount({
      connectionId: secondConnectionId,
      providerAccountId: "manual-checking",
      accountId: mappings.checking!.accountId,
      startDate: tomorrow.toISOString().slice(0, 10),
    }),
    { code: "BAD_REQUEST" },
  );
  await alice.budget.setupBankAccounts(link);
  const linked = await state();
  const manual = linked.view!.accounts.find(
    (account) => account.id === "manual-cash",
  )!;
  assert.equal(manual.name, "My existing cash");
  assert.equal(manual.balance, 300000);
  assert.equal(linked.view!.cash, 420050);
  assert.equal(
    linked.view!.budget.accounts.filter((account) => !isCounterparty(account))
      .length,
    3,
  );
  const linkedMapping = bankMappingsSchema.parse(
    linked.connections.find(
      (connection) => connection.id === secondConnectionId,
    )!.accountMappings,
  )["manual-checking"]!;
  assert.equal(linkedMapping.openingSnapshot, undefined);
  assert.equal(linkedMapping.startDate, tomorrow.toISOString().slice(0, 10));
});
