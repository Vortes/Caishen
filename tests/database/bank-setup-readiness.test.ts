import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { afterEach, mock, type TestContext } from "node:test";

import { createBook } from "../../src/domain/engine";
import { PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";
import { ObservedRevision } from "../../src/server/api/trpc";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { bankSetupDate } from "../../src/server/services/bank-account-setup";
import { encryptBankToken } from "../../src/server/token-crypto";
import { createBankConnection, createHousehold } from "./fixtures";

assertDevelopmentDatabase(process.env);

const originalEnvironment = { ...process.env };
afterEach(() => {
  mock.restoreAll();
  for (const key of [
    "PLAID_CLIENT_ID",
    "PLAID_SECRET",
    "PLAID_ENV",
    "PLAID_REDIRECT_URI",
    "BANK_TOKEN_ENCRYPTION_KEY",
  ]) {
    if (originalEnvironment[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnvironment[key];
  }
});

function providerAccount(
  accountId = "empty-card",
  type = "credit",
  subtype = "credit card",
  current: number | null = 0,
) {
  return {
    account_id: accountId,
    name: accountId === "empty-card" ? "Amex EveryDay" : "Discover loan",
    official_name: null,
    mask: "1004",
    type,
    subtype,
    balances: {
      current,
      available: null,
      iso_currency_code: "USD",
      unofficial_currency_code: null,
    },
  };
}

async function connection(t: TestContext) {
  const db = new PrismaClient();
  const userId = `bank-readiness-${randomUUID()}`;
  const connectionId = randomUUID();
  const today = bankSetupDate("America/Los_Angeles");
  process.env.PLAID_CLIENT_ID = "fixture-client";
  process.env.PLAID_SECRET = "fixture-secret";
  process.env.PLAID_ENV = "production";
  process.env.PLAID_REDIRECT_URI = "https://caishen.example/banks/oauth";
  process.env.BANK_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  await db.user.create({ data: { clerkUserId: userId } });
  const workspaceId = await createHousehold(
    db,
    createBook(userId, "Bank setup", today.slice(0, 7)),
  );
  t.after(async () => {
    await db.bankConnection.deleteMany({ where: { clerkUserId: userId } });
    await db.workspace.delete({ where: { id: workspaceId } });
    await db.user.delete({ where: { clerkUserId: userId } });
    await db.$disconnect();
  });
  await createBankConnection(db, {
    data: {
      id: connectionId,
      clerkUserId: userId,
      itemId: `item-${connectionId}`,
      encryptedToken: encryptBankToken("fixture-access-token", userId),
      imports: {},
      accountMappings: {},
    },
  });
  const caller = createCaller({
    db,
    userId,
    revision: new ObservedRevision(),
    headers: new Headers(),
  });
  return {
    caller,
    connectionId,
    today,
    state: () => caller.budget.state({ month: today.slice(0, 7) }),
  };
}

function plaid(
  accounts: ReturnType<typeof providerAccount>[],
  sync: Record<string, unknown> = {},
) {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    if (path === "/accounts/get")
      return Response.json({
        accounts,
        item: { institution_id: "fixture-bank", institution_name: "Bank" },
      });
    if (path === "/transactions/sync")
      return Response.json({
        accounts: [],
        added: [],
        modified: [],
        removed: [],
        next_cursor: "completed-history",
        has_more: false,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        ...sync,
      });
    throw new Error(`Unexpected provider request: ${path}`);
  });
}

void test("a completed empty Amex history can be added with its current balance", async (t) => {
  const h = await connection(t);
  plaid([providerAccount()]);
  await h.caller.budget.sync();
  const synced = await h.state();
  assert.deepEqual(synced.connections[0]!.synchronizedAccountIds, [
    "empty-card",
  ]);
  await h.caller.budget.setupBankAccounts({
    connectionId: h.connectionId,
    operationId: randomUUID(),
    expectedRevision: synced.revision,
    accounts: [
      { providerAccountId: "empty-card", name: "EveryDay", expectedBalance: 0 },
    ],
  });
  const saved = await h.state();
  assert.deepEqual(
    saved.view!.accounts.map((a) => [a.name, a.kind, a.balance]),
    [["EveryDay", "credit", 0]],
  );
  assert.equal(saved.view!.readyToAssign, 0);
});

void test("unreadable activity cannot make an account look like a completed empty history", async (t) => {
  const h = await connection(t);
  plaid([providerAccount()], {
    added: [
      {
        transaction_id: "unreadable",
        account_id: "empty-card",
        pending: false,
      },
    ],
  });
  await h.caller.budget.sync();
  const synced = await h.state();
  assert.deepEqual(synced.connections[0]!.synchronizedAccountIds, []);
  await assert.rejects(
    h.caller.budget.setupBankAccounts({
      connectionId: h.connectionId,
      operationId: randomUUID(),
      expectedRevision: synced.revision,
      accounts: [
        {
          providerAccountId: "empty-card",
          name: "EveryDay",
          expectedBalance: 0,
        },
      ],
    }),
    { code: "PRECONDITION_FAILED" },
  );
});

void test("a connected loan without a Plaid balance can be added using confirmed lender terms", async (t) => {
  const h = await connection(t);
  plaid([providerAccount("loan", "loan", "consumer", null)]);
  await h.caller.budget.sync();
  const synced = await h.state();
  await h.caller.budget.setupBankAccounts({
    connectionId: h.connectionId,
    operationId: randomUUID(),
    expectedRevision: synced.revision,
    accounts: [
      {
        providerAccountId: "loan",
        name: "Discover personal loan",
        expectedBalance: null,
        loan: {
          principal: 820_113,
          annualRateBps: 1_099,
          minimumPayment: 49_848,
          variable: false,
        },
      },
    ],
  });
  const saved = await h.state();
  assert.deepEqual(
    saved.view!.loans.map((loan) => [
      loan.name,
      loan.balance,
      loan.minimumPayment,
    ]),
    [["Discover personal loan", 820_113, 49_848]],
  );
  assert.equal(saved.view!.accounts.length, 0);
  assert.equal(saved.view!.readyToAssign, 0);
  assert.ok(
    saved.view!.budget.categories.some(
      (category) => category.pairedLoanId === saved.view!.loans[0]!.id,
    ),
  );
  assert.deepEqual(saved.connections[0]!.accountMappings, {
    loan: {
      accountId: saved.view!.loans[0]!.id,
      startDate: h.today,
      openingSnapshot: {
        postedImportIds: [],
        fingerprints: {},
        financialFingerprints: {},
        reviewImportIds: [],
      },
    },
  });
});

void test("a connected loan can link to an existing loan without replacing its balance or duplicating a retried save", async (t) => {
  const h = await connection(t);
  plaid([providerAccount("loan", "loan", "consumer", null)]);
  await h.caller.budget.sync();
  await h.caller.budget.execute({
    clientId: "bank-setup-test",
    baseRevision: (await h.state()).revision,
    command: {
      type: "loan.add",
      id: randomUUID(),
      loanId: "existing-loan",
      categoryId: "loan-payment",
      name: "My loan",
      principal: 500_000,
      annualRateBps: 800,
      minimumPayment: 15_000,
      variable: false,
      effectiveDate: "2026-01-01",
    },
  });
  const request = {
    connectionId: h.connectionId,
    operationId: randomUUID(),
    expectedRevision: (await h.state()).revision,
    accounts: [
      {
        providerAccountId: "loan",
        name: "Keep my name",
        expectedBalance: null,
        existingAccountId: "existing-loan",
        startDate: h.today,
      },
    ],
  };
  await h.caller.budget.setupBankAccounts(request);
  await h.caller.budget.setupBankAccounts(request);
  const saved = await h.state();
  assert.deepEqual(
    saved.view!.loans.map((loan) => [loan.id, loan.name, loan.balance]),
    [["existing-loan", "My loan", 500_000]],
  );
  assert.equal(saved.view!.accounts.length, 0);
  assert.equal(saved.view!.readyToAssign, 0);
  await assert.rejects(
    h.caller.budget.setupBankAccounts({
      ...request,
      operationId: randomUUID(),
      expectedRevision: saved.revision,
    }),
    { code: "BAD_REQUEST" },
  );
});

void test("new loan activity asks for confirmed principal and interest without becoming cash activity", async (t) => {
  const h = await connection(t);
  const page: Record<string, unknown> = {};
  plaid([providerAccount("loan", "loan", "consumer", null)], page);
  await h.caller.budget.sync();
  await h.caller.budget.setupBankAccounts({
    connectionId: h.connectionId,
    operationId: randomUUID(),
    expectedRevision: (await h.state()).revision,
    accounts: [
      {
        providerAccountId: "loan",
        name: "Discover loan",
        expectedBalance: null,
        loan: {
          principal: 500_000,
          annualRateBps: 800,
          minimumPayment: 15_000,
          variable: false,
        },
      },
    ],
  });
  page.next_cursor = "new-loan-activity";
  page.added = [
    {
      transaction_id: "loan-payment",
      account_id: "loan",
      pending: false,
      date: h.today,
      name: "Loan payment",
      amount: -150,
      iso_currency_code: "USD",
    },
  ];
  await h.caller.budget.sync();
  const saved = await h.state();
  const activity = saved.imports.find(
    (item) => item.providerAccountId === "loan",
  )!;
  assert.equal(activity.accountId, null);
  assert.match(activity.error!, /principal and interest/);
  assert.equal(saved.view!.loans[0]!.balance, 500_000);
  assert.equal(saved.view!.accounts.length, 0);
  assert.equal(saved.view!.budget.transactions.length, 0);
  await assert.rejects(
    h.caller.budget.resolveImport({
      connectionId: h.connectionId,
      logicalId: activity.logicalId,
      expectedRevision: saved.revision,
      command: {
        type: "transaction.upsert",
        id: randomUUID(),
        transactionId: randomUUID(),
        accountId: saved.view!.loans[0]!.id,
        date: h.today,
        amount: 15_000,
        payee: "Loan payment",
      },
    }),
    /principal and interest/,
  );
  await h.caller.budget.resolveImport({
    connectionId: h.connectionId,
    logicalId: activity.logicalId,
    expectedRevision: saved.revision,
    ignore: true,
  });
  assert.equal((await h.state()).imports.length, 0);
});
