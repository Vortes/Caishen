import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { afterEach, mock, type TestContext } from "node:test";

import { createBook, isCounterparty } from "../../src/domain/engine";
import { PrismaClient } from "../../src/generated/prisma";
import { createDatabaseCaller as createCaller } from "./fixtures";
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

// A healthy Item, as /item/get reports it during every account update.
const itemResponse = () => ({
  item: { consent_expiration_time: null, error: null },
  status: {
    transactions: { last_successful_update: null, last_failed_update: null },
  },
});

function plaid(
  accounts: ReturnType<typeof providerAccount>[],
  sync: Record<string, unknown> = {},
) {
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    if (path === "/item/get") return Response.json(itemResponse());
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
    saved
      .view!.accounts.filter((account) => !isCounterparty(account))
      .map((a) => [a.name, a.kind, a.balance]),
    [["EveryDay", "credit", 0]],
  );
  assert.equal(saved.view!.readyToAssign, 0);
});

void test("an unchanged Business Platinum stays ready when another card advances the sync cursor", async (t) => {
  const h = await connection(t);
  const platinum = providerAccount("business-platinum");
  const gold = providerAccount("gold", "credit", "credit card", 100);
  const page: Record<string, unknown> = {
    accounts: [platinum, gold],
    next_cursor: "initial-history",
    added: [
      {
        transaction_id: "platinum-purchase",
        account_id: "business-platinum",
        pending: false,
        date: h.today,
        name: "Business purchase",
        amount: 20,
        iso_currency_code: "USD",
      },
    ],
  };
  plaid([platinum, gold], page);
  await h.caller.budget.sync();
  assert.ok(
    (await h.state()).connections[0]!.synchronizedAccountIds.includes(
      "business-platinum",
    ),
  );

  page.accounts = [gold];
  page.next_cursor = "gold-update";
  page.added = [
    {
      transaction_id: "gold-purchase",
      account_id: "gold",
      pending: false,
      date: h.today,
      name: "Gold purchase",
      amount: 12.78,
      iso_currency_code: "USD",
    },
  ];
  await h.caller.budget.sync();
  const refreshed = await h.state();
  assert.ok(
    refreshed.connections[0]!.synchronizedAccountIds.includes(
      "business-platinum",
    ),
    "An unchanged Business Platinum must remain ready after another card updates",
  );
  await h.caller.budget.setupBankAccounts({
    connectionId: h.connectionId,
    operationId: randomUUID(),
    expectedRevision: refreshed.revision,
    accounts: [
      {
        providerAccountId: "business-platinum",
        name: "Business Platinum",
        expectedBalance: 0,
      },
    ],
  });
  assert.deepEqual(
    (await h.state())
      .view!.accounts.filter((account) => !isCounterparty(account))
      .map((account) => [account.name, account.balance]),
    [["Business Platinum", 0]],
  );
});

void test("a card with stored history recovers lost readiness only from a matching full-history cursor", async (t) => {
  const h = await connection(t);
  const platinum = providerAccount("business-platinum");
  const purchase = {
    transaction_id: "platinum-purchase",
    account_id: "business-platinum",
    pending: false,
    date: h.today,
    name: "Business purchase",
    amount: 20,
    iso_currency_code: "USD",
  };
  let reconnecting = false;
  let historyCursor = "initial-history";
  let incrementalCursor = "initial-history";
  mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(input instanceof Request ? input.url : input)
        .pathname;
      if (path === "/item/get") return Response.json(itemResponse());
      if (path === "/accounts/get")
        return Response.json({
          accounts: [platinum],
          item: {
            institution_id: "amex",
            institution_name: "American Express",
          },
        });
      if (path !== "/transactions/sync")
        throw new Error(`Unexpected provider request: ${path}`);
      const body = init?.body;
      assert.ok(typeof body === "string");
      const request = JSON.parse(body) as { cursor?: string };
      const fullHistory = !request.cursor;
      return Response.json({
        accounts: !reconnecting || fullHistory ? [platinum] : [],
        added: !reconnecting || fullHistory ? [purchase] : [],
        modified: [],
        removed: [],
        next_cursor: fullHistory ? historyCursor : incrementalCursor,
        has_more: false,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      });
    },
  );
  await h.caller.budget.sync();
  await h.caller.budget.plaidReconnect({ connectionId: h.connectionId });
  reconnecting = true;

  historyCursor = "history-before-new-update";
  incrementalCursor = "history-after-new-update";
  await h.caller.budget.sync();
  assert.deepEqual(
    (await h.state()).connections[0]!.synchronizedAccountIds,
    [],
    "Balances from a different history cursor cannot restore readiness",
  );

  historyCursor = incrementalCursor;
  await h.caller.budget.sync();
  const recovered = await h.state();
  assert.deepEqual(
    recovered.connections[0]!.synchronizedAccountIds,
    ["business-platinum"],
    "A complete matching history snapshot must recover the already-stuck card",
  );
  await h.caller.budget.setupBankAccounts({
    connectionId: h.connectionId,
    operationId: randomUUID(),
    expectedRevision: recovered.revision,
    accounts: [
      {
        providerAccountId: "business-platinum",
        name: "Business Platinum",
        expectedBalance: 0,
      },
    ],
  });
  const saved = await h.state();
  assert.deepEqual(
    saved
      .view!.accounts.filter((account) => !isCounterparty(account))
      .map((account) => [account.name, account.balance]),
    [["Business Platinum", 0]],
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
  assert.equal(
    saved.view!.accounts.filter((account) => !isCounterparty(account)).length,
    0,
  );
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
  assert.equal(
    saved.view!.accounts.filter((account) => !isCounterparty(account)).length,
    0,
  );
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
  assert.equal(activity.eligibility, "loan_activity");
  assert.equal(saved.view!.loans[0]!.balance, 500_000);
  assert.equal(
    saved.view!.accounts.filter((account) => !isCounterparty(account)).length,
    0,
  );
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
