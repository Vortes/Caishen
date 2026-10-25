import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { afterEach, mock } from "node:test";
import nextEnv from "@next/env";

import { createDatabaseCaller as createCaller } from "./fixtures";
import { ObservedRevision } from "../../src/server/api/trpc";
import { toShellData } from "../../src/components/app-shell/model";
import { PrismaClient } from "../../src/generated/prisma";
import {
  execute,
  isCounterparty,
  withCounterpartyAccounts,
  type Book,
} from "../../src/domain/engine";
import { bookToRows, diffRows, rowsToBook } from "../../src/domain/rows";
import {
  applyTransactionSync,
  normalizePlaidTransaction,
} from "../../src/server/integrations/transactions";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import {
  bankImportFingerprint,
  bankSetupDate,
  openingSnapshot,
} from "../../src/server/services/bank-account-setup";
import { importStateChange } from "../../src/server/services/bank-import-rows";
import {
  bankAccountDetails,
  bankInbox,
  exchangeBankToken,
  linkBankToken,
  reconnectBank,
  resolveImport,
  syncBanks,
} from "../../src/server/services/banks";
import { recordBankWebhookReceipt } from "../../src/server/services/bank-provider-events";
import { onboard } from "../../src/server/services/household-operations";
import * as banks from "../../src/server/services/banks";
import { households } from "../../src/server/storage/households";
import {
  findOperation,
  loadRows,
  readHouseholdRevision,
  recentOperations,
  writeChangeSet,
} from "../../src/server/storage/rows";
import {
  decryptBankToken,
  encryptBankToken,
} from "../../src/server/token-crypto";

// The bank service against a real household (ADR 0006): its import state
// and budget live in rows, with Plaid answered by fetch mocks.
nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
const run = randomUUID();
const alice = `test-bank-service-alice-${run}`;
const bob = `test-bank-service-bob-${run}`;

const environmentKeys = [
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "PLAID_REDIRECT_URI",
  "BANK_TOKEN_ENCRYPTION_KEY",
  "APP_BASE_URL",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentKeys.map((key) => [key, process.env[key]]),
);
afterEach(() => {
  mock.restoreAll();
  for (const key of environmentKeys) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const accountsResponse = () => ({
  accounts: [
    {
      account_id: "provider-checking",
      name: "Chase checking",
      official_name: null,
      mask: "1234",
      type: "depository",
      subtype: "checking",
      balances: {
        current: 123.45,
        available: 100,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      },
    },
  ],
  item: { institution_id: "ins-chase", institution_name: "Chase" },
});

const linkMetadata = (response = accountsResponse()) => ({
  institution: { institution_id: response.item.institution_id },
  accounts: response.accounts.map(({ account_id, name, mask }) => ({
    id: account_id,
    name,
    mask,
  })),
});

const requestUrl = (input: string | URL | Request) =>
  new URL(input instanceof Request ? input.url : input);

// A healthy Item, as /item/get reports it during every account update.
const itemResponse = () => ({
  item: { consent_expiration_time: null, error: null },
  status: {
    transactions: { last_successful_update: null, last_failed_update: null },
  },
});

/** Plaid answered by `answer`, with the Item's health read every update. */
function mockPlaid(
  answer: (
    url: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  return mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) =>
      requestUrl(url).pathname === "/item/get"
        ? Response.json(itemResponse())
        : answer(url, init),
  );
}

test.before(async () => {
  await db.user.createMany({
    data: [{ clerkUserId: alice }, { clerkUserId: bob }],
  });
});

// Each test starts Alice over with a new budget and bank connection.
async function startOver() {
  const memberships = await db.workspaceMember.findMany({
    where: { clerkUserId: { in: [alice, bob] } },
  });
  await db.workspace.deleteMany({
    where: { id: { in: memberships.map((member) => member.workspaceId) } },
  });
  await db.bankConnection.deleteMany({
    where: { clerkUserId: { in: [alice, bob] } },
  });
  await db.bankProviderEvent.deleteMany({
    where: { clerkUserId: { in: [alice, bob] } },
  });
}
afterEach(startOver);

test.after(async () => {
  await db.user.deleteMany({ where: { clerkUserId: { in: [alice, bob] } } });
  await db.$disconnect();
});

async function harness() {
  process.env.PLAID_CLIENT_ID = "fixture-client";
  process.env.PLAID_SECRET = "fixture-secret";
  process.env.PLAID_ENV = "production";
  process.env.PLAID_REDIRECT_URI = "https://caishen.example/plaid/oauth";
  process.env.BANK_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  await startOver();
  await onboard(db, alice, {
    name: "Alice",
    month: "2026-10",
    timezone: "America/Los_Angeles",
  });
  const connection = await db.bankConnection.create({
    data: {
      id: `connection-${randomUUID()}`,
      clerkUserId: alice,
      itemId: `item-${randomUUID()}`,
      encryptedToken: encryptBankToken("private-access-token", alice),
      imports: {},
      accountMappings: {},
      error: "Reconnect your bank",
    },
  });
  const workspaceId = (await readHouseholdRevision(db, alice))!.workspaceId;
  // Writes rows as they now are to these, as one operation.
  const write = async (
    change: Pick<ReturnType<typeof diffRows>, "before" | "after">,
    operationId = randomUUID(),
  ) => {
    if (!change.after.length) return;
    await writeChangeSet(db, {
      workspaceId,
      baseRevision: (await readHouseholdRevision(db, alice))!.revision,
      changeSet: { ...change, operationId, revision: 0 },
      operation: {
        actorId: alice,
        source: "user",
        type: "test.setup",
        inputHash: operationId,
        command: null,
      },
    });
  };
  const household = async () => (await households.load(db, alice))!;
  const api = createCaller({
    db,
    userId: alice,
    headers: new Headers(),
    revision: new ObservedRevision(),
  });
  const state = () => api.budget.state({ month: "2026-10" });
  return {
    db,
    api,
    connection,
    state,
    details: async () =>
      (await state()).connections.find((item) => item.id === connection.id)!,
    book: async () => rowsToBook(await loadRows(db, workspaceId)),
    setBook: async (book: Book) =>
      write(
        diffRows(
          (await loadRows(db, workspaceId)).filter(
            (row) => row.table !== "bankImport",
          ),
          bookToRows(book),
        ),
      ),
    /** Sets the connection's import state and, if given, its details. */
    setImports: async (state: Record<string, unknown>) => {
      const { records, resolved, errors, reviews, ...details } = state;
      await write(
        importStateChange((await household()).rows, alice, connection.id, {
          records: (records ?? []) as never,
          resolved: (resolved ?? {}) as never,
          errors: (errors ?? {}) as never,
          reviews: (reviews ?? {}) as never,
        }),
      );
      await db.bankConnection.update({
        where: { id: connection.id },
        data: { imports: details as never },
      });
    },
    setMappings: async (mappings: Record<string, unknown>) => {
      await db.bankConnection.update({
        where: { id: connection.id },
        data: { accountMappings: mappings as never },
      });
    },
    saved: () =>
      db.bankConnection.findUniqueOrThrow({ where: { id: connection.id } }),
    revision: async () => (await state()).revision,
  };
}

void test("stored disconnected connections remain readable without contacting the bank", async () => {
  const h = await linkedHarness();
  const disconnectedAt = "2026-10-24T12:00:00.000Z";
  await h.setImports({ disconnectedAt, accounts: [] });
  await db.bankConnection.update({
    where: { id: h.connection.id },
    data: { encryptedToken: "", error: null },
  });
  const fetcher = mockPlaid(async () => {
    throw new Error("Disconnected banks must not be contacted");
  });
  const before = await h.state();
  assert.equal(before.connections[0]!.disconnectedAt, disconnectedAt);
  assert.deepEqual(await syncBanks(db, alice), { imported: 0, updated: 0 });
  await assert.rejects(
    linkBankToken(db, alice, h.connection.id),
    /link again/i,
  );
  await assert.rejects(
    reconnectBank(db, alice, h.connection.id),
    /link again/i,
  );
  assert.deepEqual((await h.state()).view, before.view);
  assert.equal((await h.details()).error, null);
  assert.equal(fetcher.mock.callCount(), 0);
});

void test("bank update Link tokens and completion enforce connection ownership before accessing Plaid", async () => {
  const h = await harness();
  const before = await h.details();
  const fetcher = mockPlaid(async () => {
    throw new Error("Provider must not be called");
  });
  await assert.rejects(linkBankToken(h.db, bob, h.connection.id), {
    code: "NOT_FOUND",
  });
  await assert.rejects(reconnectBank(h.db, bob, h.connection.id), {
    code: "NOT_FOUND",
  });
  assert.equal(fetcher.mock.callCount(), 0);
  assert.deepEqual(await h.details(), before);
});

const importFact = (id: string, pending = false) =>
  normalizePlaidTransaction({
    transaction_id: id,
    account_id: "provider-checking",
    pending,
    amount: 20,
    iso_currency_code: "USD",
    date: "2026-10-20",
    name: "Coffee shop",
  });

async function linkedHarness() {
  const h = await harness();
  let book = execute(await h.book(), alice, {
    type: "account.add",
    id: "cash",
    accountId: "cash",
    name: "Checking",
    kind: "cash",
    openingBalance: 10000,
    date: "2026-10-01",
  });
  book = execute(book, alice, {
    type: "category.add",
    id: "category",
    categoryId: "dining",
    name: "Dining",
  });
  await h.setBook(book);
  await h.setMappings({
    "provider-checking": { accountId: "cash", startDate: "2026-10-01" },
  });
  return h;
}

void test("disconnecting a bank preserves the account, reviewed history, and outstanding imports", async () => {
  const h = await linkedHarness();
  const record = applyTransactionSync(
    [],
    { added: [importFact("outstanding")], modified: [], removed: [] },
    h.connection.id,
  ).records[0]!;
  await h.setImports({
    records: [record],
    institutionId: "ins-chase",
    institutionName: "Chase",
    accounts: [],
  });
  await h.setBook(
    execute(await h.book(), alice, {
      type: "transaction.upsert",
      id: randomUUID(),
      transactionId: "history",
      accountId: "cash",
      date: "2026-10-10",
      amount: -500,
      payee: "Recorded purchase",
      categoryId: "dining",
      status: "posted",
    }),
  );
  const before = await h.state();
  const beforeInbox = await bankInbox(db, alice);
  const paths: string[] = [];
  mockPlaid(async (url: string | URL | Request) => {
    paths.push(requestUrl(url).pathname);
    return Response.json({ removed: true });
  });
  const input = {
    connectionId: h.connection.id,
    operationId: randomUUID(),
    expectedRevision: before.revision,
  };
  await h.api.budget.disconnectBank(input);
  await h.api.budget.disconnectBank(input);
  const after = await h.state();
  assert.deepEqual(after.view!.budget.accounts, before.view!.budget.accounts);
  assert.deepEqual(
    after.view!.budget.transactions,
    before.view!.budget.transactions,
  );
  assert.deepEqual(await bankInbox(db, alice), beforeInbox);
  assert.ok(after.connections[0]!.disconnectedAt);
  assert.equal(after.connections[0]!.status, "disconnected");
  assert.deepEqual(paths, ["/item/remove"]);
  await h.api.budget.sync();
  assert.deepEqual(paths, ["/item/remove"]);
});

for (const mode of [
  "disconnected",
  "unavailable",
  "renamed",
  "revoked",
] as const)
  void test(`relinking a ${mode} account preserves its reconciled history and excludes the replacement's historical imports`, async () => {
    const h = await linkedHarness();
    const today = bankSetupDate("America/Los_Angeles");
    let replacement = false;
    let later = false;
    const response = () => ({
      ...accountsResponse(),
      accounts: [
        {
          ...accountsResponse().accounts[0]!,
          name:
            replacement && mode === "renamed"
              ? "Chase checking renamed"
              : "Chase checking",
          account_id: replacement
            ? "replacement-checking"
            : "provider-checking",
          balances: {
            ...accountsResponse().accounts[0]!.balances,
            current: later ? 93 : 95,
          },
        },
      ],
    });
    mockPlaid(async (url: string | URL | Request) => {
      switch (requestUrl(url).pathname) {
        case "/item/remove":
          return Response.json({ removed: true });
        case "/item/public_token/exchange":
          return Response.json({
            access_token: "replacement-token",
            item_id: `replacement-${run}`,
          });
        case "/accounts/get":
          return Response.json(response());
        case "/transactions/sync":
          return Response.json({
            added: [
              {
                transaction_id: later ? "new-purchase" : "replacement-history",
                account_id: "replacement-checking",
                pending: false,
                amount: later ? 2 : 5,
                iso_currency_code: "USD",
                date: later ? today : "2026-10-10",
                name: later ? "New purchase" : "Recorded purchase",
              },
            ],
            modified: [],
            removed: [],
            accounts: response().accounts,
            has_more: false,
            next_cursor: later ? "later" : "replacement",
            transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
          });
        default:
          throw new Error("Unexpected provider request");
      }
    });
    await reconnectBank(db, alice, h.connection.id);
    await h.setBook(
      execute(await h.book(), alice, {
        type: "transaction.upsert",
        id: randomUUID(),
        transactionId: "history",
        accountId: "cash",
        date: "2026-10-10",
        amount: -500,
        payee: "Recorded purchase",
        categoryId: "dining",
        status: "posted",
      }),
    );
    await h.setBook(
      execute(await h.book(), alice, {
        type: "account.reconcile",
        id: randomUUID(),
        accountId: "cash",
        date: today,
        balance: 9500,
      }),
    );
    const before = (await h.state()).view!.budget;
    if (mode === "disconnected")
      await h.api.budget.disconnectBank({
        connectionId: h.connection.id,
        operationId: randomUUID(),
        expectedRevision: await h.revision(),
      });
    if (mode === "revoked")
      await db.bankConnection.update({
        where: { id: h.connection.id },
        data: { status: "revoked" },
      });
    replacement = true;
    const linked =
      mode === "disconnected" || mode === "revoked"
        ? await h.api.budget.plaidExchange({
            publicToken: "replacement-public",
            metadata: linkMetadata(response()),
          })
        : await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
    await h.api.budget.sync();
    const selected = {
      providerAccountId: "replacement-checking",
      name: "Checking",
      expectedBalance: 95,
    };
    await assert.rejects(
      h.api.budget.setupBankAccounts({
        connectionId: linked.id,
        operationId: randomUUID(),
        expectedRevision: await h.revision(),
        accounts: [selected],
      }),
      /existing.*account|already added/i,
    );
    const input = {
      connectionId: linked.id,
      operationId: randomUUID(),
      expectedRevision: await h.revision(),
      accounts: [{ ...selected, existingAccountId: "cash" }],
    };
    await h.api.budget.setupBankAccounts(input);
    await h.api.budget.setupBankAccounts(input);
    const after = (await h.state()).view!.budget;
    assert.deepEqual(after.accounts, before.accounts);
    assert.deepEqual(after.transactions, before.transactions);
    assert.deepEqual(await bankInbox(db, alice), []);
    if (mode !== "disconnected" && mode !== "revoked")
      assert.deepEqual(
        (await h.details()).accounts.map((account) => account.accountId),
        ["replacement-checking"],
        "retired provider identity must not be offered as another account",
      );
    later = true;
    await h.api.budget.sync();
    const inbox = await bankInbox(db, alice);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]!.accountId, "cash");
    assert.equal(inbox[0]!.amount, -200);
  });

void test("recovery with missing bank identifiers requires an explicit existing account and reconciliation", async () => {
  const h = await linkedHarness();
  await h.setImports({
    disconnectedAt: new Date().toISOString(),
    institutionId: "ins-chase",
    institutionName: "Chase",
    accounts: [
      {
        accountId: "provider-checking",
        name: "Chase checking",
        officialName: null,
        mask: null,
        type: "depository",
        subtype: "checking",
        currentBalance: 100,
        availableBalance: null,
        currency: "USD",
      },
    ],
  });
  const response = {
    ...accountsResponse(),
    accounts: [
      {
        ...accountsResponse().accounts[0]!,
        account_id: "unknown-checking",
        mask: null,
        balances: { ...accountsResponse().accounts[0]!.balances, current: 100 },
      },
    ],
  };
  mockPlaid(async (url: string | URL | Request) => {
    switch (requestUrl(url).pathname) {
      case "/item/public_token/exchange":
        return Response.json({
          access_token: "new-token",
          item_id: `unknown-${run}`,
        });
      case "/accounts/get":
        return Response.json(response);
      case "/transactions/sync":
        return Response.json({
          added: [],
          modified: [],
          removed: [],
          accounts: response.accounts,
          next_cursor: "unknown",
          has_more: false,
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        });
      default:
        throw new Error("Unexpected provider request");
    }
  });
  const linked = await h.api.budget.plaidExchange({
    publicToken: "public-unknown",
    metadata: {
      institution: { institution_id: "ins-chase" },
      accounts: [
        { id: "unknown-checking", name: "Chase checking", mask: null },
      ],
    },
  });
  await h.api.budget.sync();
  const selected = {
    providerAccountId: "unknown-checking",
    name: "Checking",
    expectedBalance: 100,
  };
  const revision = await h.revision();
  const attempt = (existingAccountId?: string) =>
    h.api.budget.setupBankAccounts({
      connectionId: linked.id,
      operationId: randomUUID(),
      expectedRevision: revision,
      accounts: [{ ...selected, existingAccountId }],
    });
  await assert.rejects(attempt(), /existing.*account/i);
  await assert.rejects(attempt("cash"), /reconcile/i);
  assert.equal(
    (await h.state()).view!.budget.accounts.filter(
      (account) => account.kind === "cash",
    ).length,
    1,
  );
});

void test("a disconnected bank requires fresh Link rather than update mode", async () => {
  const h = await linkedHarness();
  const fetcher = mockPlaid(async () => Response.json({ removed: true }));
  await h.api.budget.disconnectBank({
    connectionId: h.connection.id,
    operationId: randomUUID(),
    expectedRevision: await h.revision(),
  });
  await assert.rejects(
    h.api.budget.plaidLinkToken({ connectionId: h.connection.id }),
    /link again/i,
  );
  await assert.rejects(
    h.api.budget.plaidReconnect({ connectionId: h.connection.id }),
    /link again/i,
  );
  assert.equal(fetcher.mock.callCount(), 1);
});

async function duplicatedCards() {
  const h = await linkedHarness();
  let book = await h.book();
  for (const [accountId, name, openingBalance] of [
    ["original-gold", "Gold", -43508],
    ["duplicate-gold", "Gold", -43508],
    ["personal-platinum", "Platinum", -23721],
  ] as const)
    book = execute(book, alice, {
      type: "account.add",
      id: randomUUID(),
      accountId,
      name,
      openingBalance,
      kind: "credit",
      date: "2026-10-01",
    });
  await h.setBook(book);
  const card = (
    accountId: string,
    name: string,
    mask: string,
    currentBalance: number,
  ) => ({
    accountId,
    name,
    mask,
    type: "credit",
    subtype: "credit card",
    currency: "USD",
    currentBalance,
    availableBalance: null,
    officialName: null,
  });
  const old = card("old-gold", "Gold", "1001", 435.08);
  const gold = card("new-gold", "Gold", "1001", 435.08);
  const platinum = card("new-platinum", "Platinum", "1007", 237.21);
  await h.setImports({
    institutionId: "ins-amex",
    institutionName: "Amex",
    accounts: [old],
    transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
    synchronizedAccountIds: [old.accountId],
  });
  await h.setMappings({
    "old-gold": { accountId: "original-gold", startDate: "2026-10-01" },
  });
  const replacement = await db.bankConnection.create({
    data: {
      clerkUserId: alice,
      itemId: `replacement-${randomUUID()}`,
      encryptedToken: encryptBankToken("replacement-access", alice),
      lastSyncedAt: new Date(),
      imports: {
        institutionId: "ins-amex",
        institutionName: "Amex",
        accounts: [gold, platinum],
        transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
        synchronizedAccountIds: [gold.accountId, platinum.accountId],
      },
      accountMappings: {
        "new-gold": { accountId: "duplicate-gold", startDate: "2026-10-01" },
        "new-platinum": {
          accountId: "personal-platinum",
          startDate: "2026-10-01",
        },
      },
    },
  });
  return {
    ...h,
    replacement,
    selection: {
      retiredConnectionId: h.connection.id,
      replacementConnectionId: replacement.id,
    },
  };
}

void test("repairing untouched duplicate cards keeps the original accounts and the newly discovered Platinum", async () => {
  const h = await duplicatedCards();
  const before = (await h.state()).view!.budget;
  const paths: string[] = [];
  mockPlaid(async (url: string | URL | Request) => {
    paths.push(requestUrl(url).pathname);
    if (requestUrl(url).pathname === "/accounts/get")
      return Response.json({
        item: { institution_id: "ins-amex", institution_name: "Amex" },
        accounts: bankAccountDetails(h.replacement.imports).accounts.map(
          (account) => ({
            account_id: account.accountId,
            official_name: account.officialName,
            name: account.name,
            mask: account.mask,
            type: account.type,
            subtype: account.subtype,
            balances: {
              current: account.currentBalance,
              available: account.availableBalance,
              iso_currency_code: account.currency,
              unofficial_currency_code: null,
            },
          }),
        ),
      });
    return Response.json({ removed: true });
  });
  const plan = await banks.previewDuplicateBankRepair(db, alice, h.selection);
  assert.equal(plan.accounts.length, 1);
  assert.equal(plan.accounts[0]!.keepAccountId, "original-gold");
  assert.equal(plan.accounts[0]!.removeAccountId, "duplicate-gold");
  assert.deepEqual(paths, []);
  const input = {
    ...h.selection,
    operationId: randomUUID(),
    expectedPlanHash: plan.hash,
  };
  await banks.repairDuplicateBankAccounts(db, alice, input);
  await banks.repairDuplicateBankAccounts(db, alice, input);
  const after = await h.state();
  assert.deepEqual(
    after.view!.budget.accounts,
    before.accounts.filter((account) => account.id !== "duplicate-gold"),
  );
  assert.deepEqual(after.view!.budget.transactions, before.transactions);
  assert.equal(
    after.view!.budget.categories.some(
      (category) => category.pairedAccountId === "duplicate-gold",
    ),
    false,
  );
  assert.equal(after.connections.length, 1);
  assert.equal(after.connections[0]!.id, h.replacement.id);
  assert.deepEqual(after.connections[0]!.accountMappings, {
    "new-gold": { accountId: "original-gold", startDate: "2026-10-01" },
    "new-platinum": { accountId: "personal-platinum", startDate: "2026-10-01" },
  });
  assert.deepEqual(paths, ["/accounts/get", "/item/remove"]);
});

void test("duplicate repair refuses a replacement without a matching balance and history snapshot", async () => {
  const h = await duplicatedCards();
  await db.bankConnection.update({
    where: { id: h.replacement.id },
    data: {
      imports: {
        ...bankAccountDetails(h.replacement.imports),
        synchronizedAccountIds: [],
      },
    },
  });
  const before = await h.state();
  const fetcher = mockPlaid(async () => {
    throw new Error("Must not revoke an unsafe replacement");
  });
  await assert.rejects(
    banks.previewDuplicateBankRepair(db, alice, h.selection),
    /matching balance.*history/i,
  );
  assert.equal(fetcher.mock.callCount(), 0);
  assert.deepEqual(await h.state(), before);
});

void test("duplicate repair keeps the old connection when the replacement cannot be reached", async () => {
  const h = await duplicatedCards();
  const before = await h.state();
  const paths: string[] = [];
  mockPlaid(async (url: string | URL | Request) => {
    const path = requestUrl(url).pathname;
    paths.push(path);
    return path === "/accounts/get"
      ? Response.json({ error_code: "INSTITUTION_DOWN" }, { status: 503 })
      : Response.json({ removed: true });
  });
  const plan = await banks.previewDuplicateBankRepair(db, alice, h.selection);
  await assert.rejects(
    banks.repairDuplicateBankAccounts(db, alice, {
      ...h.selection,
      operationId: randomUUID(),
      expectedPlanHash: plan.hash,
    }),
  );
  assert.deepEqual(paths, ["/accounts/get"]);
  assert.deepEqual(await h.state(), before);
});

async function pendingImport() {
  const h = await linkedHarness();
  const records = applyTransactionSync(
    [],
    { added: [importFact("pending-edit", true)], modified: [], removed: [] },
    h.connection.id,
  ).records;
  const record = records[0]!;
  await h.setImports({ records, resolved: {}, errors: {}, reviews: {} });
  const input = {
    connectionId: h.connection.id,
    logicalId: record.id,
    expectedFingerprint: bankImportFingerprint(record),
    expectedRevision: await h.revision(),
    ignore: false,
    command: {
      type: "transaction.upsert" as const,
      id: "edit-pending",
      transactionId: "purchase",
      accountId: "cash",
      date: "2026-10-19",
      amount: -2375,
      payee: "Neighborhood cafe",
      categoryId: "dining",
      status: "pending" as const,
    },
  };
  return { ...h, input, record };
}

void test("reviewing imported activity replaces its balance contribution without a reconciliation adjustment or a second charge", async () => {
  const h = await linkedHarness();
  const [record] = applyTransactionSync(
    [],
    { added: [importFact("unreviewed-purchase")], modified: [], removed: [] },
    h.connection.id,
  ).records;
  await h.setImports({
    records: [record!],
    resolved: {},
    errors: {},
    reviews: {},
  });
  const before = await h.state();
  assert.equal(
    toShellData({ ...before, view: before.view! }).accounts.find(
      ({ id }) => id === "cash",
    )!.balance,
    8_000,
  );
  assert.equal(before.imports.length, 1);
  await assert.rejects(
    h.api.budget.execute({
      command: {
        type: "account.reconcile",
        id: randomUUID(),
        accountId: "cash",
        date: "2026-10-23",
        balance: 8_000,
        adjustmentId: randomUUID(),
      },
      baseRevision: before.revision,
      clientId: "balance-test",
    }),
    /Review imported bank activity before reconciling/,
  );
  await h.api.budget.resolveImport({
    connectionId: h.connection.id,
    logicalId: record!.id,
    expectedFingerprint: bankImportFingerprint(record!),
    expectedRevision: before.revision,
    command: {
      type: "transaction.upsert",
      id: randomUUID(),
      transactionId: "reviewed-purchase",
      accountId: "cash",
      date: "2026-10-20",
      amount: -2_000,
      payee: "Coffee shop",
      categoryId: "dining",
      status: "posted",
    },
  });
  const after = await h.state();
  assert.equal(after.imports.length, 0);
  assert.equal(after.view!.budget.transactions.length, 1);
  assert.equal(
    toShellData({ ...after, view: after.view! }).accounts.find(
      ({ id }) => id === "cash",
    )!.balance,
    8_000,
  );
  assert.equal(
    toShellData({
      ...after,
      view: after.view!,
      imports: before.imports,
    }).accounts.find(({ id }) => id === "cash")!.balance,
    8_000,
  );
});

void test("the register can edit pending bank activity without clearing it or changing the bank fact", async () => {
  const h = await pendingImport();
  await resolveImport(h.db, alice, h.input);
  const transactions = (await h.state()).view!.budget.transactions;
  assert.equal(transactions.length, 1);
  const saved = transactions[0]!;
  assert.equal(saved.payee, "Neighborhood cafe");
  assert.equal(saved.amount, -2375);
  assert.equal(saved.date, "2026-10-19");
  assert.equal(saved.categoryId, "dining");
  assert.equal(saved.status, "pending");
  assert.equal(saved.providerId, "pending-edit");
  assert.equal(h.record.current.amountCents, 2000);
  assert.equal(h.record.current.name, "Coffee shop");
  assert.deepEqual(await bankInbox(h.db, alice), []);
});

void test("retrying a pending import save does not record it twice", async () => {
  const h = await pendingImport();
  const start = await h.revision();
  await resolveImport(h.db, alice, h.input);
  await resolveImport(h.db, alice, h.input);
  assert.equal((await h.state()).view!.budget.transactions.length, 1);
  assert.equal(await h.revision(), start + 1);
  await assert.rejects(
    resolveImport(h.db, alice, {
      ...h.input,
      command: { ...h.input.command, payee: "Different edit" },
    }),
    /different details/,
  );
});

void test("entering a pending import counts it once, removes its review dot, and matches its posted version", async () => {
  const h = await pendingImport();
  const before = await h.state();
  const beforeShell = toShellData({ ...before, view: before.view! });
  assert.equal(
    beforeShell.accounts.find(({ id }) => id === "cash")!.balance,
    10_000,
  );
  await h.api.budget.resolveImport({
    ...h.input,
    command: {
      ...h.input.command,
      date: "2026-10-20",
      amount: -2_000,
      payee: "Coffee shop",
    },
  });
  const entered = await h.state();
  const enteredShell = toShellData({ ...entered, view: entered.view! });
  assert.equal(
    enteredShell.accounts.find(({ id }) => id === "cash")!.balance,
    8_000,
  );
  assert.equal(
    enteredShell.accounts.find(({ id }) => id === "cash")!.toReview,
    false,
  );
  assert.equal(entered.imports.length, 0);
  syncPages([
    {
      added: [
        plaidTransaction({
          transaction_id: "posted-edit",
          pending_transaction_id: "pending-edit",
          name: "Coffee shop",
          date: "2026-10-20",
          amount: 20,
        }),
      ],
      removed: [
        { transaction_id: "pending-edit", account_id: "provider-checking" },
      ],
      next_cursor: "posted",
    },
  ]);
  await syncBanks(h.db, alice);
  const posted = await h.state();
  const postedShell = toShellData({ ...posted, view: posted.view! });
  assert.equal(
    postedShell.accounts.find(({ id }) => id === "cash")!.balance,
    8_000,
  );
  assert.equal(
    postedShell.accounts.find(({ id }) => id === "cash")!.toReview,
    false,
  );
  assert.equal(posted.view!.budget.transactions.length, 1);
  assert.equal(posted.view!.budget.transactions[0]!.status, "posted");
});

void test("an edited pending import posts to the same transaction and keeps the user's payee and category", async () => {
  const h = await pendingImport();
  await resolveImport(h.db, alice, h.input);
  mockPlaid(async (url: string | URL | Request) => {
    if (requestUrl(url).pathname === "/transactions/sync")
      return Response.json({
        added: [
          {
            transaction_id: "posted-edit",
            account_id: "provider-checking",
            pending_transaction_id: "pending-edit",
            pending: false,
            amount: 24,
            iso_currency_code: "USD",
            date: "2026-10-20",
            name: "Coffee shop final",
          },
        ],
        modified: [],
        removed: [
          { transaction_id: "pending-edit", account_id: "provider-checking" },
        ],
        accounts: accountsResponse().accounts,
        next_cursor: "posted",
        has_more: false,
      });
    return Response.json(accountsResponse());
  });
  await syncBanks(h.db, alice);
  const transactions = (await h.state()).view!.budget.transactions;
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0]!.id, "purchase");
  assert.equal(transactions[0]!.status, "posted");
  assert.equal(transactions[0]!.amount, -2400);
  assert.equal(transactions[0]!.payee, "Neighborhood cafe");
  assert.equal(transactions[0]!.categoryId, "dining");
  assert.deepEqual(await bankInbox(h.db, alice), []);
});

void test("entering a pending bank transfer approves both sides without marking them posted", async () => {
  const h = await pendingImport();
  await h.setBook(
    execute(await h.book(), alice, {
      type: "account.add",
      id: "savings",
      accountId: "savings",
      name: "Savings",
      kind: "cash",
      openingBalance: 0,
    }),
  );
  await resolveImport(h.db, alice, {
    ...h.input,
    expectedRevision: await h.revision(),
    command: {
      ...h.input.command,
      type: "transaction.upsert",
      transferAccountId: "savings",
      categoryId: undefined,
    },
  });
  const pair = (await h.state()).view!.budget.transactions;
  assert.equal(pair.length, 2);
  assert.equal(pair[0]!.amount + pair[1]!.amount, 0);
  assert.equal(
    pair.every((item) => item.status === "pending" && item.reviewed),
    true,
  );
});

void test("a pending import edit refuses stale bank facts, stale budgets, and other users", async () => {
  const h = await pendingImport();
  const start = await h.revision();
  await assert.rejects(
    resolveImport(h.db, alice, {
      ...h.input,
      expectedFingerprint: "a".repeat(64),
    }),
    /bank updated/,
  );
  await assert.rejects(
    resolveImport(h.db, alice, {
      ...h.input,
      expectedRevision: 99,
    }),
    /budget changed/,
  );
  await assert.rejects(resolveImport(h.db, bob, h.input), {
    code: "NOT_FOUND",
  });
  assert.deepEqual((await h.state()).view!.budget.transactions, []);
  assert.equal(await h.revision(), start);
});

void test("pending edits retain bank status and reject account changes or duplicate ledger records", async () => {
  const h = await pendingImport();
  await assert.rejects(
    resolveImport(h.db, alice, {
      ...h.input,
      command: { ...h.input.command, accountId: "another-account" },
    }),
    /must match the bank fact/,
  );
  await h.setBook(
    execute(await h.book(), alice, {
      ...h.input.command,
      id: "existing",
      transactionId: "existing",
      amount: -2000,
      date: "2026-10-20",
      payee: "Coffee shop",
    }),
  );
  await assert.rejects(
    resolveImport(h.db, alice, {
      ...h.input,
      expectedRevision: await h.revision(),
    }),
    /matching ledger record/,
  );
  assert.deepEqual(
    (await h.state()).view!.budget.transactions.map((item) => item.id),
    ["existing"],
  );
  const fresh = await pendingImport();
  await resolveImport(fresh.db, alice, {
    ...fresh.input,
    command: { ...fresh.input.command, status: "posted" },
  });
  assert.equal(
    (await fresh.state()).view!.budget.transactions[0]!.status,
    "pending",
  );
});

void test("first-connect inbox excludes unrecorded tombstones while preserving opening-balance discrepancies", async () => {
  const h = await harness();
  const initial = applyTransactionSync(
    [],
    {
      added: [
        { ...importFact("already-removed"), name: "Old bookstore record" },
        { ...importFact("opening-posted"), name: "Opening coffee purchase" },
        { ...importFact("dropped-pending", true), name: "Pending bus fare" },
      ],
      modified: [],
      removed: [
        {
          providerTransactionId: "already-removed",
          providerAccountId: "provider-checking",
        },
      ],
    },
    h.connection.id,
  ).records;
  await h.setMappings({
    "provider-checking": {
      accountId: "cash",
      startDate: "2026-10-20",
      openingSnapshot: openingSnapshot(initial, "provider-checking"),
    },
  });
  const updated = applyTransactionSync(
    initial,
    {
      added: [],
      modified: [],
      removed: ["opening-posted", "dropped-pending"].map(
        (providerTransactionId) => ({
          providerTransactionId,
          providerAccountId: "provider-checking",
        }),
      ),
    },
    h.connection.id,
  );
  await h.setImports({
    records: updated.records,
    resolved: {},
    errors: {},
    reviews: {},
  });
  const inbox = await bankInbox(h.db, alice);
  assert.equal(inbox.length, 1);
  assert.equal(
    inbox[0]!.logicalId,
    initial.find(
      (record) => record.current.providerTransactionId === "opening-posted",
    )!.id,
  );
  assert.equal(inbox[0]!.eligibility, "opening_snapshot_changed");
  assert.equal(
    updated.records.length,
    3,
    "technical history remains inspectable",
  );
});

void test("first-connect opening history ignores payee-only changes for saved legacy snapshots", async () => {
  const h = await harness();
  const initial = applyTransactionSync(
    [],
    { added: [importFact("opening")], modified: [], removed: [] },
    h.connection.id,
  ).records;
  const snapshot = openingSnapshot(initial, "provider-checking");
  const legacySnapshot = {
    postedImportIds: snapshot.postedImportIds,
    fingerprints: snapshot.fingerprints,
  };
  await h.setMappings({
    "provider-checking": {
      accountId: "cash",
      startDate: "2026-10-20",
      openingSnapshot: legacySnapshot,
    },
  });
  const updated = applyTransactionSync(
    initial,
    {
      added: [],
      modified: [
        {
          ...initial[0]!.current,
          name: "COFFEE SHOP #123",
          merchantName: "Coffee shop",
        },
      ],
      removed: [],
    },
    h.connection.id,
  ).records;
  await h.setImports({
    records: updated,
    resolved: {},
    errors: {},
    reviews: {},
  });
  assert.deepEqual(await bankInbox(h.db, alice), []);
  updated[0]!.current.amountCents += 100;
  await h.setImports({
    records: updated,
    resolved: {},
    errors: {},
    reviews: {},
  });
  assert.equal(
    (await bankInbox(h.db, alice))[0]!.eligibility,
    "opening_snapshot_changed",
  );
});

void test("inbox categories come from the linked ledger category, and normal posting has no discrepancy", async () => {
  const h = await harness();
  let book = execute(await h.book(), alice, {
    type: "account.add",
    id: "cash",
    accountId: "cash",
    name: "Cash",
    kind: "cash",
    openingBalance: 10000,
    date: "2026-10-19",
  });
  book = execute(book, alice, {
    type: "category.add",
    id: "category",
    categoryId: "dining",
    name: "Dining out",
  });
  book = execute(book, alice, {
    type: "transaction.upsert",
    id: "purchase",
    transactionId: "purchase",
    accountId: "cash",
    date: "2026-10-20",
    amount: -2000,
    payee: "Coffee shop",
    status: "pending",
    categoryId: "dining",
  });
  await h.setBook(book);
  const initial = applyTransactionSync(
    [],
    { added: [importFact("pending", true)], modified: [], removed: [] },
    h.connection.id,
  ).records;
  const posted = applyTransactionSync(
    initial,
    {
      added: [{ ...importFact("posted"), pendingTransactionId: "pending" }],
      modified: [],
      removed: [
        {
          providerTransactionId: "pending",
          providerAccountId: "provider-checking",
        },
      ],
    },
    h.connection.id,
  ).records;
  posted[0]!.categoryId = "outdated-import-category";
  await h.setMappings({
    "provider-checking": { accountId: "cash", startDate: "2026-10-20" },
  });
  await h.setImports({
    records: posted,
    resolved: {
      [posted[0]!.id]: {
        fingerprint: "b".repeat(64),
        transactionId: "purchase",
      },
    },
    errors: {},
    reviews: {},
  });
  const inbox = await bankInbox(h.db, alice);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0]!.removed, false);
  assert.equal(inbox[0]!.needsMatchReview, false);
  assert.equal(inbox[0]!.error, null);
  assert.equal(inbox[0]!.categoryName, "Dining out");
  await assert.rejects(
    resolveImport(h.db, alice, {
      connectionId: h.connection.id,
      logicalId: posted[0]!.id,
      expectedRevision: await h.revision(),
      ignore: false,
      command: {
        type: "transaction.upsert",
        id: "duplicate",
        transactionId: "duplicate",
        accountId: "cash",
        date: "2026-10-20",
        amount: -2000,
        payee: "Coffee shop",
      },
    }),
    /already linked to a budget transaction/,
  );
});

for (const delivery of [
  "same sync",
  "separate syncs",
  "user deletion",
] as const)
  void test(`explicit pending posting (${delivery}) preserves one categorized purchase and respects user deletion`, async () => {
    const h = await harness();
    let book = execute(await h.book(), alice, {
      type: "account.add",
      id: "cash",
      accountId: "cash",
      name: "Cash",
      kind: "cash",
      openingBalance: 10000,
      date: "2026-10-19",
    });
    book = execute(book, alice, {
      type: "category.add",
      id: "category",
      categoryId: "dining",
      name: "Dining out",
    });
    book = execute(book, alice, {
      type: "transaction.upsert",
      id: "purchase",
      transactionId: "purchase",
      accountId: "cash",
      date: "2026-10-20",
      amount: -2000,
      payee: "Coffee shop",
      status: "pending",
      categoryId: "dining",
    });
    await h.setBook(book);
    if (delivery === "user deletion")
      await h.setBook(
        execute(await h.book(), alice, {
          type: "transaction.remove",
          id: "user-delete-purchase",
          transactionId: "purchase",
        }),
      );
    const initial = applyTransactionSync(
      [],
      { added: [importFact("pending", true)], modified: [], removed: [] },
      h.connection.id,
    ).records;
    await h.setMappings({
      "provider-checking": { accountId: "cash", startDate: "2026-10-20" },
    });
    await h.setImports({
      records: initial,
      resolved: {
        [initial[0]!.id]: {
          fingerprint: "b".repeat(64),
          transactionId: "purchase",
        },
      },
      errors: {},
      reviews: {},
    });
    let syncCount = 0;
    mockPlaid(async (url: string | URL | Request) => {
      if (requestUrl(url).pathname === "/transactions/sync") {
        syncCount++;
        const removalOnly = delivery !== "same sync" && syncCount === 1;
        return Response.json({
          added: removalOnly
            ? []
            : [
                {
                  transaction_id: "posted",
                  account_id: "provider-checking",
                  pending_transaction_id: "pending",
                  pending: false,
                  amount: 20,
                  iso_currency_code: "USD",
                  date: "2026-10-20",
                  name: "Coffee shop",
                },
              ],
          modified: [],
          removed: [
            { transaction_id: "pending", account_id: "provider-checking" },
          ],
          accounts: accountsResponse().accounts,
          next_cursor: removalOnly ? "pending-removed" : "posted",
          has_more: false,
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        });
      }
      return Response.json(accountsResponse());
    });
    if (delivery !== "same sync") {
      assert.deepEqual(await syncBanks(h.db, alice), {
        imported: 0,
        updated: delivery === "user deletion" ? 0 : 1,
      });
      assert.equal(
        (await h.state()).view!.budget.transactions[0]!.removed,
        true,
      );
      if (delivery !== "user deletion")
        assert.deepEqual(await bankInbox(h.db, alice), []);
    }
    assert.deepEqual(await syncBanks(h.db, alice), {
      imported: 0,
      updated: delivery === "user deletion" ? 0 : 1,
    });
    assert.equal((await h.state()).view!.budget.transactions.length, 1);
    const purchase = (await h.state()).view!.budget.transactions[0]!;
    assert.equal(
      purchase.status,
      delivery === "user deletion" ? "pending" : "posted",
    );
    assert.equal(purchase.amount, -2000);
    assert.equal(purchase.categoryId, "dining");
    assert.equal(purchase.reviewed, true);
    assert.equal(Boolean(purchase.removed), delivery === "user deletion");
    if (delivery !== "user deletion")
      assert.deepEqual(await bankInbox(h.db, alice), []);
    assert.deepEqual(await syncBanks(h.db, alice), {
      imported: 0,
      updated: 0,
    });
  });

void test("an older reconnect response cannot overwrite a newer bank refresh", async () => {
  const h = await linkedHarness();
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const firstRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  mockPlaid(async (url: string | URL | Request) => {
    assert.equal(requestUrl(url).pathname, "/accounts/get");
    const first = ++calls === 1;
    if (first) {
      started();
      await firstRelease;
    }
    const response = accountsResponse();
    response.accounts[0]!.balances.current = first ? 100 : 200;
    return Response.json(response);
  });
  const earlier = Promise.allSettled([
    reconnectBank(db, alice, h.connection.id),
  ]);
  await firstStarted;
  try {
    await reconnectBank(db, alice, h.connection.id);
  } finally {
    release();
  }
  await earlier;
  assert.equal((await h.details()).accounts[0]!.currentBalance, 200);
});

void test("an older transaction sync cannot overwrite a completed reconnect", async () => {
  const h = await linkedHarness();
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const firstRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  mockPlaid(async (url: string | URL | Request) => {
    if (requestUrl(url).pathname === "/transactions/sync")
      return Response.json({
        added: [],
        modified: [],
        removed: [],
        accounts: accountsResponse().accounts,
        next_cursor: "next",
        has_more: false,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      });
    assert.equal(requestUrl(url).pathname, "/accounts/get");
    const first = ++calls === 1;
    if (first) {
      started();
      await firstRelease;
    }
    const response = accountsResponse();
    response.accounts[0]!.balances.current = first ? 100 : 200;
    return Response.json(response);
  });
  const earlier = Promise.allSettled([syncBanks(db, alice)]);
  await firstStarted;
  let current;
  try {
    await reconnectBank(db, alice, h.connection.id);
    current = await h.details();
  } finally {
    release();
  }
  await earlier;
  assert.deepEqual(await h.details(), current);
});

void test("concurrent initial Link completions cannot exchange the same bank twice", async () => {
  const h = await harness();
  let started!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let release!: () => void;
  const firstRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  let exchanges = 0;
  mockPlaid(async (url: string | URL | Request) => {
    if (requestUrl(url).pathname === "/item/public_token/exchange") {
      const number = ++exchanges;
      if (number === 1) {
        started();
        await firstRelease;
      }
      return Response.json({
        access_token: `concurrent-token-${number}`,
        item_id: `concurrent-${run}-${number}`,
      });
    }
    assert.equal(requestUrl(url).pathname, "/accounts/get");
    return Response.json(accountsResponse());
  });
  const earlier = Promise.allSettled([
    exchangeBankToken(db, alice, "first-public", linkMetadata()),
  ]);
  await firstStarted;
  let later;
  try {
    later = await Promise.allSettled([
      exchangeBankToken(db, alice, "second-public", linkMetadata()),
    ]);
  } finally {
    release();
  }
  const results = [...(await earlier), ...later];
  assert.equal(
    (await h.state()).connections.filter((c) => c.institutionId === "ins-chase")
      .length,
    1,
  );
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(exchanges, 1);
});

void test("missing identity for a cash account does not block adding a new credit card", async () => {
  const h = await linkedHarness();
  await h.setImports({
    institutionId: "ins-chase",
    institutionName: "Chase",
    accounts: [],
  });
  mockPlaid(async (url: string | URL | Request) => {
    const response = accountsResponse();
    Object.assign(response.accounts[0]!, {
      account_id: "new-credit",
      name: "New credit card",
      type: "credit",
      subtype: "credit card",
    });
    if (requestUrl(url).pathname === "/transactions/sync")
      return Response.json({
        added: [],
        modified: [],
        removed: [],
        accounts: response.accounts,
        next_cursor: "credit",
        has_more: false,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      });
    return Response.json(response);
  });
  await syncBanks(db, alice);
  const before = (await h.state()).view!.budget.accounts.find(
    (account) => account.id === "cash",
  );
  await h.api.budget.setupBankAccounts({
    connectionId: h.connection.id,
    operationId: randomUUID(),
    expectedRevision: await h.revision(),
    accounts: [
      {
        providerAccountId: "new-credit",
        name: "New credit card",
        expectedBalance: 123.45,
      },
    ],
  });
  const after = (await h.state()).view!.budget.accounts;
  assert.deepEqual(
    after.find((account) => account.id === "cash"),
    before,
  );
  assert.equal(after.filter((account) => account.kind === "credit").length, 1);
});

void test("Add accounts cannot duplicate a mapped card whose Plaid ID changed after its cached identity was lost", async () => {
  const h = await linkedHarness();
  await h.setImports({
    institutionId: "ins-chase",
    institutionName: "Chase",
    accounts: [],
  });
  mockPlaid(async (url: string | URL | Request) => {
    const response = accountsResponse();
    response.accounts[0]!.account_id = "provider-checking-reauthorized";
    if (requestUrl(url).pathname === "/transactions/sync")
      return Response.json({
        added: [],
        modified: [],
        removed: [],
        accounts: response.accounts,
        next_cursor: "reauthorized",
        has_more: false,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      });
    assert.equal(requestUrl(url).pathname, "/accounts/get");
    return Response.json(response);
  });
  await reconnectBank(db, alice, h.connection.id);
  await syncBanks(db, alice);
  const before = await h.state();
  const [attempt] = await Promise.allSettled([
    h.api.budget.setupBankAccounts({
      connectionId: h.connection.id,
      operationId: randomUUID(),
      expectedRevision: before.revision,
      accounts: [
        {
          providerAccountId: "provider-checking-reauthorized",
          name: "Checking",
          expectedBalance: 123.45,
        },
      ],
    }),
  ]);
  const after = await h.state();
  assert.equal(
    after.view!.budget.accounts.filter((a) => a.kind === "cash").length,
    1,
    "the returned card must not create a second budget account",
  );
  assert.equal(
    attempt.status,
    "rejected",
    "missing identity must require review, not guess a new account",
  );
  assert.deepEqual(after.view, before.view);
  assert.deepEqual(
    after.connections[0]!.accountMappings,
    before.connections[0]!.accountMappings,
  );
});

void test("a mapped account with missing cached identity routes a fresh Link back to the existing bank", async () => {
  const h = await linkedHarness();
  await h.setImports({
    institutionId: "ins-chase",
    institutionName: "Chase",
    accounts: [],
  });
  const before = await h.state();
  const fetcher = mockPlaid(async () => {
    throw new Error("A potential duplicate must not be exchanged");
  });
  await assert.rejects(
    exchangeBankToken(db, alice, "public-duplicate", linkMetadata()),
    /Choose shared accounts/,
  );
  assert.equal(fetcher.mock.callCount(), 0);
  assert.deepEqual(await h.state(), before);
});

void test("a partial reconnect merges fresh details without forgetting other mapped accounts", async () => {
  const h = await linkedHarness();
  await h.setBook(
    execute(await h.book(), alice, {
      type: "account.add",
      id: "savings",
      accountId: "savings",
      name: "Savings",
      kind: "cash",
      openingBalance: 50000,
      date: "2026-10-01",
    }),
  );
  const mappings = {
    "provider-checking": { accountId: "cash", startDate: "2026-10-01" },
    "provider-savings": { accountId: "savings", startDate: "2026-10-01" },
  };
  await h.setMappings(mappings);
  const checking = {
    accountId: "provider-checking",
    name: "Chase checking",
    officialName: null,
    mask: "1234",
    type: "depository",
    subtype: "checking",
    currentBalance: 100,
    availableBalance: 100,
    currency: "USD",
  };
  const savings = {
    ...checking,
    accountId: "provider-savings",
    name: "Chase savings",
    mask: "5678",
    subtype: "savings",
    currentBalance: 500,
    availableBalance: 500,
  };
  await h.setImports({
    accounts: [checking, savings],
    institutionId: "ins-chase",
    institutionName: "Chase",
    synchronizedAccountIds: [checking.accountId, savings.accountId],
  });
  const before = await h.state();
  let shareSavings = false;
  mockPlaid(async (url: string | URL | Request) => {
    const response = accountsResponse();
    if (shareSavings)
      response.accounts.push({
        ...response.accounts[0]!,
        account_id: "provider-savings",
        name: "Chase savings",
        mask: "5678",
        subtype: "savings",
        balances: {
          ...response.accounts[0]!.balances,
          current: 510,
          available: 510,
        },
      });
    if (requestUrl(url).pathname === "/transactions/sync")
      return Response.json({
        added: [],
        modified: [],
        removed: [],
        accounts: response.accounts,
        next_cursor: "same",
        has_more: false,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      });
    assert.equal(requestUrl(url).pathname, "/accounts/get");
    return Response.json(response);
  });
  await reconnectBank(db, alice, h.connection.id);
  let details = await h.details();
  assert.deepEqual(
    details.accounts.map((a) => [a.accountId, a.currentBalance]),
    [
      ["provider-checking", 123.45],
      ["provider-savings", 500],
    ],
  );
  assert.deepEqual(details.accountMappings, mappings);
  assert.deepEqual(details.unavailableAccountIds, ["provider-savings"]);
  await syncBanks(db, alice);
  details = await h.details();
  assert.deepEqual(
    details.accounts.find((a) => a.accountId === "provider-savings"),
    savings,
  );
  assert.deepEqual(details.synchronizedAccountIds, ["provider-checking"]);
  assert.deepEqual(details.unavailableAccountIds, ["provider-savings"]);
  assert.deepEqual((await h.state()).view, before.view);
  shareSavings = true;
  await reconnectBank(db, alice, h.connection.id);
  details = await h.details();
  assert.deepEqual(details.unavailableAccountIds ?? [], []);
  assert.equal(
    details.accounts.find((a) => a.accountId === "provider-savings")!
      .currentBalance,
    510,
  );
  assert.deepEqual(details.accountMappings, mappings);
  assert.deepEqual((await h.state()).view, before.view);
});

// A connection whose one mapped checking account Plaid reports with the
// persistent id its institution assigns, and recorded history on it.
async function persistentHarness(persistentAccountId?: string) {
  const h = await linkedHarness();
  await h.setBook(
    execute(await h.book(), alice, {
      type: "transaction.upsert",
      id: randomUUID(),
      transactionId: "history",
      accountId: "cash",
      date: "2026-10-10",
      amount: -500,
      payee: "Recorded purchase",
      categoryId: "dining",
      status: "posted",
    }),
  );
  await h.setImports({
    accounts: [
      {
        accountId: "provider-checking",
        ...(persistentAccountId ? { persistentAccountId } : {}),
        name: "Chase checking",
        officialName: null,
        mask: "1234",
        type: "depository",
        subtype: "checking",
        currentBalance: 95,
        availableBalance: 95,
        currency: "USD",
      },
    ],
    institutionId: "ins-chase",
    institutionName: "Chase",
    transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
    synchronizedAccountIds: ["provider-checking"],
  });
  const today = bankSetupDate("America/Los_Angeles");
  let later = false;
  const response = () => ({
    ...accountsResponse(),
    accounts: [
      {
        ...accountsResponse().accounts[0]!,
        account_id: "provider-checking-reissued",
        ...(persistentAccountId
          ? { persistent_account_id: persistentAccountId }
          : {}),
        balances: {
          ...accountsResponse().accounts[0]!.balances,
          current: later ? 91 : 93,
          available: later ? 91 : 93,
        },
      },
    ],
  });
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    switch (requestUrl(url).pathname) {
      case "/item/get":
        return Response.json({ item: { error: null } });
      case "/accounts/get":
        return Response.json(response());
      case "/transactions/sync":
        return Response.json({
          added: later
            ? [
                {
                  transaction_id: "new-purchase",
                  account_id: "provider-checking-reissued",
                  pending: false,
                  amount: 2,
                  iso_currency_code: "USD",
                  date: today,
                  name: "New purchase",
                },
              ]
            : [],
          modified: [],
          removed: [],
          accounts: response().accounts,
          has_more: false,
          next_cursor: later ? "later" : "reissued",
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        });
      default:
        throw new Error("Unexpected provider request");
    }
  });
  const state = await h.state();
  return {
    ...h,
    before: { ...state.view!.budget, revision: state.revision },
    newActivity: () => {
      later = true;
    },
  };
}

// The identity decisions recorded on Alice's operations of one type.
async function recordedDecisions(type: string) {
  const workspaceId = (await readHouseholdRevision(db, alice))!.workspaceId;
  const operations = (await recentOperations(db, workspaceId, 100)).filter(
    (operation) => operation.type === type,
  );
  return Promise.all(
    operations.map(
      async ({ operationId }) =>
        (await findOperation(db, workspaceId, operationId))!.command,
    ),
  );
}

void test("reconnect records rung 1 when the same provider account retains its live link", async () => {
  const h = await linkedHarness();
  mock.method(globalThis, "fetch", async () =>
    Response.json(accountsResponse()),
  );
  await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
  const before = (await h.state()).view!.budget;
  await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
  assert.deepEqual(await recordedDecisions("bank.accounts.identify"), [
    {
      connectionId: h.connection.id,
      decisions: [
        {
          rung: 1,
          from: "provider-checking",
          to: "provider-checking",
          accountId: "cash",
        },
      ],
    },
  ]);
  assert.deepEqual((await h.state()).view!.budget, before);
});

void test("a re-shared account with a new Plaid id and the same persistent id keeps its budget account without a question", async () => {
  const h = await persistentHarness("persistent-checking");
  const followed = {
    "provider-checking-reissued": {
      accountId: "cash",
      startDate: "2026-10-01",
    },
  };
  await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
  let details = await h.details();
  assert.deepEqual(details.accountMappings, followed);
  assert.deepEqual(
    details.accounts.map((a) => [a.accountId, a.currentBalance]),
    [["provider-checking-reissued", 93]],
    "the retired id leaves the catalog and the account shows a fresh balance",
  );
  assert.deepEqual(details.unavailableAccountIds ?? [], []);
  await h.api.budget.sync();
  details = await h.details();
  assert.deepEqual(details.accountMappings, followed);
  assert.deepEqual(
    details.accounts.map((a) => [a.accountId, a.currentBalance]),
    [["provider-checking-reissued", 93]],
  );
  const after = (await h.state()).view!.budget;
  assert.deepEqual(after.accounts, h.before.accounts);
  assert.deepEqual(after.transactions, h.before.transactions);
  assert.deepEqual(await bankInbox(db, alice), []);
  await assert.rejects(
    h.api.budget.setupBankAccounts({
      connectionId: h.connection.id,
      operationId: randomUUID(),
      expectedRevision: await h.revision(),
      accounts: [
        {
          providerAccountId: "provider-checking-reissued",
          name: "Checking",
          expectedBalance: 93,
        },
      ],
    }),
    /already added/i,
    "the re-shared account is not addable as a second budget account",
  );
  assert.deepEqual(
    await recordedDecisions("bank.accounts.supersede"),
    [
      {
        connectionId: h.connection.id,
        decisions: [
          {
            rung: 2,
            from: "provider-checking",
            to: "provider-checking-reissued",
            accountId: "cash",
          },
        ],
      },
    ],
    "the automatic decision is recorded with the rung that fired",
  );
  h.newActivity();
  await h.api.budget.sync();
  const inbox = await bankInbox(db, alice);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0]!.accountId, "cash");
  assert.equal(inbox[0]!.amount, -200);
});

void test("a new Plaid id without a persistent id still needs the user to confirm recovery", async () => {
  const h = await persistentHarness();
  await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
  await h.api.budget.sync();
  const details = await h.details();
  assert.deepEqual(details.accountMappings, {
    "provider-checking": { accountId: "cash", startDate: "2026-10-01" },
  });
  assert.deepEqual(details.unavailableAccountIds, ["provider-checking"]);
  assert.deepEqual(details.accounts.map((a) => a.accountId).sort(), [
    "provider-checking",
    "provider-checking-reissued",
  ]);
  const selected = {
    providerAccountId: "provider-checking-reissued",
    name: "Checking",
    expectedBalance: 93,
  };
  const attempt = (existingAccountId?: string) =>
    h.api.budget.setupBankAccounts({
      connectionId: h.connection.id,
      operationId: randomUUID(),
      expectedRevision: h.before.revision,
      accounts: [{ ...selected, existingAccountId }],
    });
  await assert.rejects(attempt(), /existing.*account/i);
  await assert.rejects(attempt("cash"), /reconcile/i);
  const after = (await h.state()).view!.budget;
  assert.deepEqual(after.accounts, h.before.accounts);
  assert.deepEqual(after.transactions, h.before.transactions);
  assert.deepEqual(
    await recordedDecisions("bank.accounts.supersede"),
    [],
    "no automatic identity decision is made without a persistent id",
  );
});

void test("update mode reuses the private Item token, registers the webhook, and a completed reconnect returns the connection to connected", async () => {
  const h = await harness();
  process.env.APP_BASE_URL = "https://caishen.example";
  await h.db.bankConnection.update({
    where: { id: h.connection.id },
    data: { status: "login_required", newAccountsAvailable: true },
  });
  await h.setMappings({
    "provider-checking": { accountId: "cash", startDate: "2026-10-01" },
  });
  const records = applyTransactionSync(
    [],
    { added: [importFact("earlier")], modified: [], removed: [] },
    h.connection.id,
  ).records;
  const earlier = records[0]!.id;
  const savedHistory = {
    records,
    resolved: {},
    errors: { [earlier]: "Review an earlier import" },
    reviews: { [earlier]: [{ message: "Original review evidence" }] },
    synchronizedAccountIds: ["provider-checking"],
    transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
  };
  await h.setImports(savedHistory);
  const priorInbox = await bankInbox(h.db, alice);
  assert.equal(priorInbox.length, 1);
  assert.equal(priorInbox[0]!.error, "Review an earlier import");
  const paths: string[] = [];
  mockPlaid(async (url: string | URL | Request, init?: RequestInit) => {
    const path = requestUrl(url).pathname;
    paths.push(path);
    const request = JSON.parse(init?.body as string) as Record<string, unknown>;
    assert.equal(request.access_token, "private-access-token");
    if (path === "/link/token/create") {
      assert.equal(request.products, undefined);
      assert.deepEqual(request.update, { account_selection_enabled: true });
      assert.equal(request.redirect_uri, process.env.PLAID_REDIRECT_URI);
      assert.equal(
        request.webhook,
        "https://caishen.example/api/webhooks/plaid",
      );
      return Response.json({
        link_token: "link-update",
        expiration: "2026-10-20T12:00:00Z",
      });
    }
    assert.equal(path, "/accounts/get");
    return Response.json(accountsResponse());
  });
  const link = await linkBankToken(h.db, alice, h.connection.id);
  assert.deepEqual(link, {
    linkToken: "link-update",
    expiration: "2026-10-20T12:00:00Z",
    redirectUri: "https://caishen.example/plaid/oauth",
  });
  const result = await reconnectBank(h.db, alice, h.connection.id);
  assert.deepEqual(result, { id: h.connection.id });
  assert.deepEqual(paths, ["/link/token/create", "/accounts/get"]);
  assert.equal((await h.details()).error, null);
  assert.equal((await h.details()).status, "connected");
  assert.equal((await h.details()).newAccountsAvailable, false);
  assert.deepEqual(await bankInbox(h.db, alice), priorInbox);
  assert.deepEqual(
    (await h.details()).accounts.map((a) => [a.name, a.currentBalance]),
    [["Chase checking", 123.45]],
  );
  assert.deepEqual(
    (await h.state()).view!.budget.accounts.filter(
      (account) => !isCounterparty(account),
    ),
    [],
  );
  assert.deepEqual((await h.details()).synchronizedAccountIds, []);
  assert.equal((await h.details()).transactionStatus, null);
  assert.ok(!JSON.stringify({ link, result }).includes("private-access-token"));
});

void test("exchange refuses an Item already owned by another user without replacing its credential", async () => {
  const h = await harness();
  await onboard(db, bob, {
    name: "Bob",
    month: "2026-10",
    timezone: "America/Los_Angeles",
  });
  const before = (await h.saved()).encryptedToken;
  mockPlaid(async () =>
    Response.json({
      access_token: "new-private-token",
      item_id: h.connection.itemId,
    }),
  );
  await assert.rejects(
    exchangeBankToken(h.db, bob, "public-token", linkMetadata()),
    {
      code: "CONFLICT",
    },
  );
  assert.equal((await h.saved()).encryptedToken, before);
});

void test("Link metadata rejects duplicate cards before exchanging a public token", async () => {
  const h = await harness();
  await h.setImports({
    institutionId: "ins-amex",
    institutionName: "American Express",
    accounts: [
      {
        accountId: "old-gold",
        name: "American Express Gold Card",
        officialName: null,
        mask: "1234",
        type: "credit",
        subtype: "credit card",
        currentBalance: 435.08,
        availableBalance: null,
        currency: "USD",
      },
    ],
  });
  const requests: string[] = [];
  mockPlaid(async (url: string | URL | Request) => {
    const path = requestUrl(url).pathname;
    requests.push(path);
    if (path === "/item/public_token/exchange")
      return Response.json({
        access_token: "duplicate-token",
        item_id: `duplicate-${run}`,
      });
    return Response.json({
      item: {
        institution_id: "ins-amex",
        institution_name: "American Express",
      },
      accounts: [
        {
          ...accountsResponse().accounts[0]!,
          account_id: "separate-gold",
          name: "American Express Gold Card",
          mask: "9876",
          type: "credit",
          subtype: "credit card",
        },
      ],
    });
  });
  await assert.rejects(
    h.api.budget.plaidExchange({
      publicToken: "duplicate-public-token",
      metadata: {
        institution: { institution_id: "ins-amex" },
        accounts: [
          { id: "new-gold", name: "American Express Gold Card", mask: "1234" },
          { id: "new-platinum", name: "Platinum Card", mask: "5678" },
        ],
      },
    }),
    /already connected.*Choose shared accounts/i,
  );
  assert.deepEqual(requests, []);
  assert.equal((await h.state()).connections.length, 1);
  await assert.rejects(
    h.api.budget.plaidExchange({
      publicToken: "missing-mask-public-token",
      metadata: {
        institution: { institution_id: "ins-amex" },
        accounts: [
          {
            id: "unknown-gold",
            name: "American Express Gold Card",
            mask: null,
          },
        ],
      },
    }),
    /already connected.*Choose shared accounts/i,
  );
  assert.deepEqual(requests, []);
  await h.api.budget.plaidExchange({
    publicToken: "separate-bank-login",
    metadata: {
      institution: { institution_id: "ins-amex" },
      accounts: [
        {
          id: "separate-gold",
          name: "American Express Gold Card",
          mask: "9876",
        },
      ],
    },
  });
  assert.deepEqual(requests, ["/item/public_token/exchange", "/accounts/get"]);
  assert.equal((await h.state()).connections.length, 2);
});

void test("Link completion treats a same-named card with a different account type as a different account", async () => {
  const h = await harness();
  await h.setImports({
    institutionId: "ins-amex",
    institutionName: "American Express",
    accounts: [
      {
        accountId: "old-gold",
        name: "American Express Gold Card",
        officialName: null,
        mask: "1234",
        type: "credit",
        subtype: "credit card",
        currentBalance: 435.08,
        availableBalance: null,
        currency: "USD",
      },
    ],
  });
  const requests: string[] = [];
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const path = requestUrl(url).pathname;
    requests.push(path);
    if (path === "/item/public_token/exchange")
      return Response.json({
        access_token: "savings-token",
        item_id: `savings-${run}`,
      });
    return Response.json({
      item: {
        institution_id: "ins-amex",
        institution_name: "American Express",
      },
      accounts: [
        {
          ...accountsResponse().accounts[0]!,
          account_id: "gold-savings",
          name: "American Express Gold Card",
          mask: "1234",
          type: "depository",
          subtype: "savings",
        },
      ],
    });
  });
  const metadata = (type: string, subtype: string) => ({
    institution: { institution_id: "ins-amex" },
    accounts: [
      {
        id: "gold-again",
        name: "American Express Gold Card",
        mask: "1234",
        type,
        subtype,
      },
    ],
  });
  await assert.rejects(
    h.api.budget.plaidExchange({
      publicToken: "same-card",
      metadata: metadata("credit", "credit card"),
    }),
    /already connected.*Choose shared accounts/i,
    "the same name, mask, type, and subtype is the connected card",
  );
  assert.deepEqual(requests, [], "a duplicate is refused before the exchange");
  await h.api.budget.plaidExchange({
    publicToken: "savings-account",
    metadata: metadata("depository", "savings"),
  });
  assert.deepEqual(requests, ["/item/public_token/exchange", "/accounts/get"]);
  assert.equal((await h.state()).connections.length, 2);
});

void test("a second Plaid connection cannot add the same Amex card to the budget again", async () => {
  const h = await harness();
  let secondLink = false;
  const card = (newConnection: boolean) => ({
    ...accountsResponse().accounts[0]!,
    account_id: newConnection ? "amex-gold-new" : "amex-gold-old",
    name: "American Express Gold Card",
    type: "credit",
    subtype: "credit card",
    balances: {
      ...accountsResponse().accounts[0]!.balances,
      current: 435.08,
    },
  });
  const accounts = (newConnection: boolean) => [
    card(newConnection),
    ...(newConnection
      ? [
          {
            ...card(true),
            account_id: "amex-platinum",
            name: "Platinum Card",
            balances: { ...card(true).balances, current: 237.21 },
          },
        ]
      : []),
  ];
  mockPlaid(async (url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(init?.body as string) as {
      access_token?: string;
    };
    const newConnection = request.access_token === "fixture-amex-new";
    switch (requestUrl(url).pathname) {
      case "/item/public_token/exchange":
        return Response.json({
          access_token: secondLink ? "fixture-amex-new" : "fixture-amex-old",
          item_id: secondLink ? `amex-new-${run}` : h.connection.itemId,
        });
      case "/accounts/get":
        return Response.json({
          accounts: accounts(newConnection),
          item: { institution_id: "ins-amex", institution_name: "Amex" },
        });
      case "/transactions/sync":
        return Response.json({
          added: [],
          modified: [],
          removed: [],
          accounts: accounts(newConnection),
          next_cursor: "amex-cursor",
          has_more: false,
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        });
      default:
        throw new Error("Unexpected provider request");
    }
  });
  const first = await h.api.budget.plaidExchange({
    publicToken: "first",
    metadata: {
      institution: { institution_id: "ins-amex" },
      accounts: [
        {
          id: "amex-gold-old",
          name: "American Express Gold Card",
          mask: "1234",
        },
      ],
    },
  });
  await h.api.budget.sync();
  const setup = async (
    connectionId: string,
    accounts: {
      providerAccountId: string;
      name: string;
      expectedBalance: number;
    }[],
  ) =>
    h.api.budget.setupBankAccounts({
      connectionId,
      operationId: randomUUID(),
      expectedRevision: await h.revision(),
      accounts,
    });
  await setup(first.id, [
    {
      providerAccountId: "amex-gold-old",
      name: "My Gold Card",
      expectedBalance: 435.08,
    },
  ]);
  secondLink = true;
  // A duplicate connection saved before the Link guard was introduced.
  const second = await db.bankConnection.create({
    data: {
      clerkUserId: alice,
      itemId: `legacy-amex-${run}`,
      encryptedToken: encryptBankToken("fixture-amex-new", alice),
      imports: {},
      accountMappings: {},
    },
  });
  await h.api.budget.plaidReconnect({ connectionId: second.id });
  await h.api.budget.sync();
  const platinum = {
    providerAccountId: "amex-platinum",
    name: "My Platinum Card",
    expectedBalance: 237.21,
  };
  await assert.rejects(
    setup(second.id, [
      platinum,
      {
        providerAccountId: "amex-gold-new",
        name: "My Gold Card",
        expectedBalance: 435.08,
      },
    ]),
    /already.*linked|already.*added/i,
  );
  const saved = await h.api.budget.state({
    month: bankSetupDate("America/Los_Angeles").slice(0, 7),
  });
  assert.deepEqual(
    saved
      .view!.accounts.filter((account) => !isCounterparty(account))
      .map(({ name, balance }) => ({ name, balance })),
    [{ name: "My Gold Card", balance: -43508 }],
  );
  await setup(second.id, [platinum]);
  const withPlatinum = await h.api.budget.state({
    month: bankSetupDate("America/Los_Angeles").slice(0, 7),
  });
  assert.deepEqual(
    withPlatinum
      .view!.accounts.filter((account) => !isCounterparty(account))
      .map(({ name, balance }) => ({ name, balance })),
    [
      { name: "My Gold Card", balance: -43508 },
      { name: "My Platinum Card", balance: -23721 },
    ],
  );
});

void test("account details are backward compatible and never return import history", () => {
  assert.deepEqual(
    bankAccountDetails({
      records: [],
      resolved: {},
      errors: { private: "sensitive import" },
    }),
    {
      accounts: [],
      institutionId: null,
      institutionName: null,
      transactionStatus: null,
      synchronizedAccountIds: [],
    },
  );
});

void test("sandbox Link response omits redirectUri when no redirect is configured", async () => {
  const h = await harness();
  process.env.PLAID_ENV = "sandbox";
  delete process.env.PLAID_REDIRECT_URI;
  mockPlaid(async () =>
    Response.json({
      link_token: "link-sandbox",
      expiration: "2026-10-20T12:00:00Z",
    }),
  );
  assert.deepEqual(await linkBankToken(h.db, alice), {
    linkToken: "link-sandbox",
    expiration: "2026-10-20T12:00:00Z",
  });
});

void test("successful public token exchange remains saved if account metadata is temporarily unavailable", async () => {
  const h = await harness();
  mockPlaid(async (url: string | URL | Request) => {
    if (requestUrl(url).pathname === "/item/public_token/exchange")
      return Response.json({
        access_token: "new-private-token",
        item_id: h.connection.itemId,
      });
    return Response.json(
      {
        error_code: "INSTITUTION_NOT_RESPONDING",
        error_message: "private provider details",
      },
      { status: 400 },
    );
  });
  const result = await exchangeBankToken(
    h.db,
    alice,
    "public-token",
    linkMetadata(),
  );
  assert.equal(result.id, h.connection.id);
  assert.match(result.warning!, /bank is connected/);
  assert.equal(
    decryptBankToken((await h.saved()).encryptedToken, alice),
    "new-private-token",
  );
  assert.ok(!JSON.stringify(result).includes("private provider details"));
  assert.deepEqual((await h.details()).accounts, []);
});

void test("bank sync updates cached account details without creating ledger accounts or balances", async () => {
  const h = await harness();
  mockPlaid(async (url: string | URL | Request) => {
    if (requestUrl(url).pathname === "/transactions/sync")
      return Response.json({
        added: [],
        modified: [],
        removed: [],
        next_cursor: "next",
        has_more: false,
        accounts: accountsResponse().accounts,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      });
    assert.equal(requestUrl(url).pathname, "/accounts/get");
    return Response.json(accountsResponse());
  });
  assert.deepEqual(await syncBanks(h.db, alice), { imported: 0, updated: 0 });
  assert.equal((await h.details()).error, null);
  assert.equal((await h.details()).accounts[0]!.availableBalance, 100);
  assert.deepEqual(
    (await h.state()).view!.budget.accounts.filter(
      (account) => !isCounterparty(account),
    ),
    [],
  );
  assert.deepEqual((await h.details()).synchronizedAccountIds, [
    "provider-checking",
  ]);
});

void test("opening metadata uses the balance paired with sync activity rather than a newer accounts/get balance", async () => {
  const h = await harness();
  mockPlaid(async (url: string | URL | Request) => {
    const result = accountsResponse();
    result.accounts[0]!.balances.current =
      requestUrl(url).pathname === "/transactions/sync" ? 100 : 80;
    if (requestUrl(url).pathname === "/transactions/sync")
      return Response.json({
        added: [],
        modified: [],
        removed: [],
        accounts: result.accounts,
        next_cursor: "same",
        has_more: false,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      });
    return Response.json(result);
  });
  await syncBanks(h.db, alice);
  const details = await h.details();
  assert.equal(details.accounts[0]!.currentBalance, 100);
  assert.deepEqual(details.synchronizedAccountIds, ["provider-checking"]);
});

void test("a prior sync balance is retained only when its cursor and account activity are unchanged", async () => {
  const h = await harness();
  let updates = 0;
  mockPlaid(async (url: string | URL | Request) => {
    if (requestUrl(url).pathname === "/transactions/sync") {
      updates++;
      return Response.json({
        added: [],
        modified: [],
        removed: [],
        accounts: updates === 1 ? accountsResponse().accounts : [],
        next_cursor: updates < 3 ? "same" : "new",
        has_more: false,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      });
    }
    const result = accountsResponse();
    result.accounts[0]!.balances.current = 80;
    return Response.json(result);
  });
  await syncBanks(h.db, alice);
  await syncBanks(h.db, alice);
  assert.equal((await h.details()).accounts[0]!.currentBalance, 123.45);
  assert.deepEqual((await h.details()).synchronizedAccountIds, [
    "provider-checking",
  ]);
  await syncBanks(h.db, alice);
  assert.equal((await h.details()).accounts[0]!.currentBalance, 80);
  assert.deepEqual((await h.details()).synchronizedAccountIds, []);
});

void test("an account delta without its matching sync balance invalidates the prior balance source", async () => {
  const h = await harness();
  let updates = 0;
  mockPlaid(async (url: string | URL | Request) => {
    if (requestUrl(url).pathname === "/transactions/sync") {
      updates++;
      return Response.json({
        added: [],
        modified: [],
        removed:
          updates === 1
            ? []
            : [{ transaction_id: "unknown", account_id: "provider-checking" }],
        accounts: updates === 1 ? accountsResponse().accounts : [],
        next_cursor: "same",
        has_more: false,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      });
    }
    return Response.json(accountsResponse());
  });
  await syncBanks(h.db, alice);
  assert.deepEqual((await h.details()).synchronizedAccountIds, [
    "provider-checking",
  ]);
  await syncBanks(h.db, alice);
  assert.deepEqual((await h.details()).synchronizedAccountIds, []);
});

const plaidTransaction = (overrides: Record<string, unknown> = {}) => ({
  transaction_id: "usd-coffee",
  account_id: "provider-checking",
  pending_transaction_id: null,
  pending: false,
  amount: 4.5,
  iso_currency_code: "USD",
  unofficial_currency_code: null,
  date: "2026-10-20",
  name: "Coffee shop",
  ...overrides,
});

function syncPages(pages: Record<string, unknown>[]) {
  let call = 0;
  const requests: Record<string, unknown>[] = [];
  mockPlaid(async (url: string | URL | Request, init?: RequestInit) => {
    if (requestUrl(url).pathname !== "/transactions/sync")
      return Response.json(accountsResponse());
    requests.push(JSON.parse(init!.body as string) as Record<string, unknown>);
    const page = pages[Math.min(call++, pages.length - 1)]!;
    return Response.json({
      added: [],
      modified: [],
      removed: [],
      accounts: accountsResponse().accounts,
      has_more: false,
      transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      ...page,
    });
  });
  return requests;
}

void test("a non-USD transaction is quarantined for review while the rest of the sync applies", async () => {
  const h = await harness();
  await h.setMappings({
    "provider-checking": { accountId: "cash", startDate: "2026-10-01" },
  });
  const warn = mock.method(console, "warn", () => undefined);
  const requests = syncPages([
    {
      added: [
        plaidTransaction(),
        plaidTransaction({
          transaction_id: "eur-dinner",
          amount: 42.1,
          iso_currency_code: "EUR",
          name: "Bistro Paris",
        }),
      ],
      next_cursor: "after-eur",
    },
    { next_cursor: "after-eur" },
  ]);
  assert.deepEqual(await syncBanks(h.db, alice), {
    imported: 1,
    updated: 0,
  });
  assert.equal((await h.details()).error, null);
  const inbox = await bankInbox(h.db, alice);
  assert.deepEqual(
    inbox.map((item) => [item.payee, item.quarantined]),
    [
      ["Coffee shop", false],
      ["Bistro Paris", true],
    ],
  );
  const quarantined = inbox[1]!;
  assert.equal(quarantined.amount, 0);
  assert.equal(quarantined.date, "2026-10-20");
  assert.match(quarantined.error ?? "", /EUR 42\.10.*US dollars/);
  assert.ok(
    warn.mock.calls.some((call) =>
      JSON.stringify(call.arguments).includes("eur-dinner"),
    ),
  );
  assert.ok(
    !warn.mock.calls.some((call) =>
      JSON.stringify(call.arguments).includes("Bistro Paris"),
    ),
    "logs leave out merchant details",
  );
  assert.deepEqual(await syncBanks(h.db, alice), { imported: 0, updated: 0 });
  assert.equal(requests.at(-1)!.cursor, "after-eur");
});

void test("malformed sync records are quarantined or skipped without blocking the cursor", async () => {
  const h = await harness();
  await h.setMappings({
    "provider-checking": { accountId: "cash", startDate: "2026-10-01" },
  });
  mock.method(console, "warn", () => undefined);
  const requests = syncPages([
    {
      added: [
        plaidTransaction(),
        plaidTransaction({
          transaction_id: "crypto",
          iso_currency_code: null,
          unofficial_currency_code: "BTC",
        }),
        plaidTransaction({ transaction_id: "fraction", amount: 1.234 }),
        plaidTransaction({ transaction_id: "bad-date", date: "2026-02-30" }),
        { account_id: "provider-checking", amount: 3 },
      ],
      modified: [plaidTransaction({ transaction_id: "nameless", name: "" })],
      removed: [{ account_id: "provider-checking" }],
      next_cursor: "after-malformed",
    },
    { next_cursor: "after-malformed" },
  ]);
  assert.deepEqual(await syncBanks(h.db, alice), {
    imported: 1,
    updated: 0,
  });
  const quarantined = (await bankInbox(h.db, alice)).filter(
    (item) => item.quarantined,
  );
  assert.deepEqual(quarantined.map((item) => item.payee).sort(), [
    "Coffee shop",
    "Coffee shop",
    "Coffee shop",
    "Unreadable bank transaction",
  ]);
  assert.match(
    quarantined.find((item) => item.logicalId.includes("crypto"))!.error ?? "",
    /BTC/,
  );
  assert.equal(
    quarantined.find((item) => item.logicalId.includes("bad-date"))!.date,
    new Date().toISOString().slice(0, 10),
  );
  assert.deepEqual(await syncBanks(h.db, alice), { imported: 0, updated: 0 });
  assert.equal(requests.at(-1)!.cursor, "after-malformed");
});

void test("a quarantined transaction leaves review once the bank fixes, removes, or the user dismisses it", async () => {
  const h = await harness();
  await h.setMappings({
    "provider-checking": { accountId: "cash", startDate: "2026-10-01" },
  });
  mock.method(console, "warn", () => undefined);
  const eur = (id: string) =>
    plaidTransaction({ transaction_id: id, iso_currency_code: "EUR" });
  syncPages([
    {
      added: [eur("fixed"), eur("removed"), eur("dismissed")],
      next_cursor: "1",
    },
    {
      modified: [plaidTransaction({ transaction_id: "fixed" })],
      removed: [{ transaction_id: "removed", account_id: "provider-checking" }],
      next_cursor: "2",
    },
    { modified: [eur("dismissed")], next_cursor: "3" },
    {
      modified: [
        plaidTransaction({
          transaction_id: "dismissed",
          amount: 9,
          iso_currency_code: "GBP",
        }),
      ],
      next_cursor: "4",
    },
  ]);
  await syncBanks(h.db, alice);
  const quarantinedIds = async () =>
    (await bankInbox(h.db, alice))
      .filter((item) => item.quarantined)
      .map((item) => item.logicalId);
  assert.equal((await quarantinedIds()).length, 3);
  await syncBanks(h.db, alice);
  assert.equal((await quarantinedIds()).length, 1);
  assert.ok(
    (await bankInbox(h.db, alice)).some(
      (item) => !item.quarantined && item.logicalId.includes("fixed"),
    ),
  );
  const [dismissed] = await quarantinedIds();
  await resolveImport(h.db, alice, {
    connectionId: h.connection.id,
    logicalId: dismissed!,
    expectedRevision: await h.revision(),
    ignore: true,
  });
  assert.deepEqual(await quarantinedIds(), []);
  await syncBanks(h.db, alice);
  assert.deepEqual(await quarantinedIds(), [], "the same fact stays dismissed");
  await syncBanks(h.db, alice);
  assert.deepEqual(
    await quarantinedIds(),
    [dismissed],
    "a changed fact needs review again",
  );
});

// Saves a bank import from the inbox as the register's editor does, with
// the category the user chose.
async function saveImport(
  h: Awaited<ReturnType<typeof harness>>,
  logicalId: string,
  // Absent for Ready to Assign.
  categoryId?: string,
) {
  const item = (await bankInbox(h.db, alice)).find(
    (entry) => entry.logicalId === logicalId,
  )!;
  await resolveImport(h.db, alice, {
    connectionId: item.connectionId,
    logicalId: item.logicalId,
    expectedFingerprint: item.fingerprint,
    expectedRevision: await h.revision(),
    ignore: false,
    command: {
      type: "transaction.upsert",
      id: randomUUID(),
      transactionId: randomUUID(),
      accountId: item.accountId!,
      date: item.date,
      amount: item.amount,
      payee: item.payee,
      categoryId,
      status: item.pending ? "pending" : "posted",
    },
  });
}

const groceryRun = (id: string, date: string, overrides = {}) =>
  plaidTransaction({
    transaction_id: id,
    date,
    amount: 42.1,
    name: "TRADER JOE'S #552 SAN FRANCISCO CA",
    merchant_name: "Trader Joe's",
    ...overrides,
  });

void test("a saved full reimbursement is remembered on the next bank import without a category", async () => {
  const h = await linkedHarness();
  await h.setBook(
    execute(withCounterpartyAccounts(await h.book()), alice, {
      type: "transaction.upsert",
      id: "remember-mom",
      transactionId: "first",
      accountId: "cash",
      date: "2026-10-02",
      amount: -1_154,
      payee: "Trader Joe's",
      recordedAt: "2026-10-02T12:00:00Z",
      counterpartyShare: {
        accountId: "counterparty:reimbursements",
        counterpartyName: "Mom",
        amount: 1_154,
      },
    }),
  );
  syncPages([
    { added: [groceryRun("for-mom", "2026-10-19")], next_cursor: "1" },
  ]);
  await syncBanks(h.db, alice);
  const transaction = (await h.state()).view!.budget.transactions.find(
    (item) => item.providerId === "for-mom",
  );
  assert.ok(
    transaction,
    "the imported purchase retains its remembered full share",
  );
  assert.equal(transaction.categoryId, undefined);
  assert.equal(transaction.counterpartyShare?.counterpartyName, "Mom");
  assert.equal(transaction.counterpartyShare?.amount, 4_210);
  assert.equal(transaction.reviewed, false);
});

void test("an import from a payee the user categorized arrives categorized and counted, still to review", async () => {
  const h = await linkedHarness();
  syncPages([
    { added: [groceryRun("first-run", "2026-10-12")], next_cursor: "1" },
    {
      added: [
        groceryRun("second-run", "2026-10-19"),
        plaidTransaction({ transaction_id: "deli", name: "Corner Deli" }),
      ],
      next_cursor: "2",
    },
  ]);
  await syncBanks(h.db, alice);
  const [first] = await bankInbox(h.db, alice);
  assert.equal(first?.payee, "Trader Joe's");
  await saveImport(h, first.logicalId, "dining");

  await syncBanks(h.db, alice);
  const second = (await h.state()).view!.budget.transactions.find(
    (transaction) => transaction.providerId === "second-run",
  );
  assert.ok(second, "the remembered payee's import became a transaction");
  assert.equal(second.categoryId, "dining");
  assert.equal(second.amount, -4210);
  assert.equal(second.payee, "Trader Joe's");
  assert.equal(second.status, "posted");
  assert.equal(second.reviewed, false);
  // A payee with no memory waits in the inbox as before.
  assert.deepEqual(
    (await bankInbox(h.db, alice)).map((item) => item.payee),
    ["Corner Deli"],
  );
});

void test("a remembered payee's import waits in the inbox when a hand-entered transaction may be the same purchase", async () => {
  const h = await linkedHarness();
  syncPages([
    { added: [groceryRun("first-run", "2026-10-02")], next_cursor: "1" },
    { added: [groceryRun("second-run", "2026-10-19")], next_cursor: "2" },
  ]);
  await syncBanks(h.db, alice);
  await saveImport(h, (await bankInbox(h.db, alice))[0]!.logicalId, "dining");
  // Entered by hand at the checkout, three days before the bank posts it.
  await h.setBook(
    execute(await h.book(), alice, {
      type: "transaction.upsert",
      id: "by-hand",
      transactionId: "by-hand",
      accountId: "cash",
      date: "2026-10-16",
      amount: -4210,
      payee: "Trader Joe's",
      status: "posted",
      categoryId: "dining",
    }),
  );
  await syncBanks(h.db, alice);
  assert.equal(
    (await h.state()).view!.budget.transactions.filter(
      (transaction) => !transaction.removed,
    ).length,
    2,
  );
  assert.deepEqual(
    (await bankInbox(h.db, alice)).map((item) => [item.payee, item.date]),
    [["Trader Joe's", "2026-10-19"]],
  );
});

void test("a remembered pending import waits outside the register until posting, then counts once and still needs review", async () => {
  const h = await linkedHarness();
  syncPages([
    { added: [groceryRun("first-run", "2026-10-02")], next_cursor: "1" },
    {
      added: [groceryRun("pending-run", "2026-10-18", { pending: true })],
      next_cursor: "2",
    },
    {
      added: [
        groceryRun("posted-run", "2026-10-19", {
          pending_transaction_id: "pending-run",
        }),
      ],
      removed: [
        { transaction_id: "pending-run", account_id: "provider-checking" },
      ],
      next_cursor: "3",
    },
    {
      removed: [
        { transaction_id: "posted-run", account_id: "provider-checking" },
      ],
      next_cursor: "4",
    },
  ]);
  await syncBanks(h.db, alice);
  await saveImport(h, (await bankInbox(h.db, alice))[0]!.logicalId, "dining");
  const runs = async () =>
    (await h.state()).view!.budget.transactions.filter(
      (transaction) =>
        !transaction.removed && transaction.payee === "Trader Joe's",
    );
  await syncBanks(h.db, alice);
  assert.deepEqual(
    (await runs()).map((item) => [item.status, item.categoryId, item.reviewed]),
    [["posted", "dining", false]],
  );
  const pending = (await bankInbox(h.db, alice))[0]!;
  assert.equal(pending.pending, true);
  const state = await h.state();
  const staged = toShellData({ ...state, view: state.view! });
  assert.equal(staged.accounts.find(({ id }) => id === "cash")!.balance, 5_790);
  assert.equal(
    staged.transactions.find(({ source }) => source === "bank")!.needsReview,
    false,
  );
  await syncBanks(h.db, alice);
  assert.deepEqual(
    (await runs()).map((item) => [item.status, item.date, item.categoryId]),
    [
      ["posted", "2026-10-02", "dining"],
      ["posted", "2026-10-19", "dining"],
    ],
  );
  assert.deepEqual(await bankInbox(h.db, alice), []);
  await syncBanks(h.db, alice);
  assert.equal((await runs()).length, 1);
  assert.deepEqual(await bankInbox(h.db, alice), []);
});

void test("pay remembered as Ready to Assign arrives there, and money going out to the same payee waits for a category", async () => {
  const h = await linkedHarness();
  const payroll = (id: string, date: string, amount: number) =>
    plaidTransaction({
      transaction_id: id,
      date,
      amount,
      name: "ACME CORP PAYROLL",
      merchant_name: "Acme Payroll",
    });
  syncPages([
    { added: [payroll("october-1", "2026-10-01", -3000)], next_cursor: "1" },
    {
      added: [
        payroll("october-15", "2026-10-15", -3000),
        payroll("clawback", "2026-10-16", 40),
      ],
      next_cursor: "2",
    },
  ]);
  await syncBanks(h.db, alice);
  await saveImport(h, (await bankInbox(h.db, alice))[0]!.logicalId);
  await syncBanks(h.db, alice);
  const pay = (await h.state()).view!.budget.transactions.find(
    (transaction) => transaction.providerId === "october-15",
  );
  assert.equal(pay?.kind, "income");
  assert.equal(pay.categoryId, undefined);
  assert.equal(pay.reviewed, false);
  assert.deepEqual(
    (await bankInbox(h.db, alice)).map((item) => [item.payee, item.amount]),
    [["Acme Payroll", -4000]],
  );
});

void test("ambiguous Link identities ask for review instead of proposing either stored account", async () => {
  const h = await harness();
  const stored = {
    name: "Gold Card",
    officialName: null,
    mask: "1234",
    type: "credit",
    subtype: "credit card",
    currentBalance: 50,
    availableBalance: null,
    currency: "USD",
  };
  await h.setImports({
    institutionId: "ins-amex",
    institutionName: "American Express",
    accounts: [
      { ...stored, accountId: "old-one" },
      { ...stored, accountId: "old-two" },
    ],
  });
  const fetcher = mock.method(globalThis, "fetch", async () => {
    throw new Error("No exchange before review");
  });
  await assert.rejects(
    h.api.budget.plaidExchange({
      publicToken: "public-token",
      metadata: {
        institution: { institution_id: "ins-amex" },
        accounts: [
          {
            id: "new-id",
            name: "Gold Card",
            mask: "1234",
            type: "credit",
            subtype: "credit card",
          },
        ],
      },
    }),
    /couldn’t tell.*already connected/i,
  );
  assert.equal(fetcher.mock.callCount(), 0);
  assert.equal((await h.state()).connections.length, 1);
});

void test("missing Link masks report an unknown comparison before token exchange", async () => {
  const h = await linkedHarness();
  mock.method(globalThis, "fetch", async () =>
    Response.json(accountsResponse()),
  );
  await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
  mock.restoreAll();
  const fetcher = mock.method(globalThis, "fetch", async () => {
    throw new Error("No exchange before review");
  });
  await assert.rejects(
    h.api.budget.plaidExchange({
      publicToken: "public-token",
      metadata: {
        institution: { institution_id: "ins-chase" },
        accounts: [
          {
            id: "new-id",
            name: "Chase checking",
            mask: null,
            type: "depository",
            subtype: "checking",
          },
        ],
      },
    }),
    /couldn’t tell.*details.*incomplete/i,
  );
  assert.equal(fetcher.mock.callCount(), 0);
});

// The provider event audit trail (spec #139): what an operator can query
// about one connection's exchanges with Plaid.
const providerEvents = async (connectionId: string) =>
  (await db.bankProviderEvent.findMany({ where: { connectionId } })).sort(
    (left, right) => left.method.localeCompare(right.method),
  );

void test("one account update records a provider event for each Plaid request with its request id", async () => {
  const h = await harness();
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (requestUrl(url).pathname === "/item/get")
      return Response.json({ item: { error: null }, request_id: "req-item-1" });
    if (requestUrl(url).pathname === "/transactions/sync")
      return Response.json({
        added: [],
        modified: [],
        removed: [],
        next_cursor: "next",
        has_more: false,
        accounts: accountsResponse().accounts,
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        request_id: "req-sync-1",
      });
    return Response.json({
      ...accountsResponse(),
      request_id: "req-accounts-1",
    });
  });
  await syncBanks(h.db, alice);
  const events = await providerEvents(h.connection.id);
  assert.deepEqual(
    events.map(({ kind, method, requestId, errorCode, clerkUserId }) => ({
      kind,
      method,
      requestId,
      errorCode,
      clerkUserId,
    })),
    [
      {
        kind: "request",
        method: "/accounts/get",
        requestId: "req-accounts-1",
        errorCode: null,
        clerkUserId: alice,
      },
      {
        kind: "request",
        method: "/item/get",
        requestId: "req-item-1",
        errorCode: null,
        clerkUserId: alice,
      },
      {
        kind: "request",
        method: "/transactions/sync",
        requestId: "req-sync-1",
        errorCode: null,
        clerkUserId: alice,
      },
    ],
  );
  assert.ok(
    events.every((event) => event.durationMs !== null && event.durationMs >= 0),
  );
});

void test("a failed account update stores an error naming the Plaid request id and records the failure", async () => {
  const h = await harness();
  mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        error_code: "INSTITUTION_DOWN",
        error_message: "private provider details",
        request_id: "req-down-7",
      },
      { status: 503 },
    ),
  );
  await assert.rejects(syncBanks(h.db, alice));
  const details = await h.details();
  assert.match(details.error!, /Plaid request id: req-down-7/);
  assert.ok(!details.error!.includes("private provider details"));
  assert.deepEqual(
    (await providerEvents(h.connection.id)).map(
      ({ method, requestId, errorCode }) => ({ method, requestId, errorCode }),
    ),
    [
      {
        method: "/item/get",
        requestId: "req-down-7",
        errorCode: "INSTITUTION_DOWN",
      },
    ],
  );
});

void test("completing Link records a success event with the institution and account count", async () => {
  const h = await harness();
  mock.method(globalThis, "fetch", async (url: string | URL | Request) =>
    requestUrl(url).pathname === "/item/public_token/exchange"
      ? Response.json({
          access_token: "new-private-token",
          item_id: h.connection.itemId,
          request_id: "req-exchange-1",
        })
      : Response.json({ ...accountsResponse(), request_id: "req-accounts-2" }),
  );
  await exchangeBankToken(h.db, alice, "public-token", linkMetadata());
  const links = await db.bankProviderEvent.findMany({
    where: { clerkUserId: alice, kind: "link" },
  });
  assert.deepEqual(
    links.map(({ method, connectionId, errorCode, detail }) => ({
      method,
      connectionId,
      errorCode,
      detail,
    })),
    [
      {
        method: "success",
        connectionId: h.connection.id,
        errorCode: null,
        detail: { institutionId: "ins-chase", accountCount: 1 },
      },
    ],
  );
});

void test("leaving Link early records an exit event with Plaid's error code and request id", async () => {
  const h = await harness();
  await h.api.budget.plaidLinkExit({
    connectionId: h.connection.id,
    institutionId: "ins-chase",
    errorCode: "INVALID_CREDENTIALS",
    requestId: "req-link-exit-1",
  });
  const links = await db.bankProviderEvent.findMany({
    where: { clerkUserId: alice, kind: "link" },
  });
  assert.deepEqual(
    links.map(({ method, connectionId, errorCode, requestId, detail }) => ({
      method,
      connectionId,
      errorCode,
      requestId,
      detail,
    })),
    [
      {
        method: "exit",
        connectionId: h.connection.id,
        errorCode: "INVALID_CREDENTIALS",
        requestId: "req-link-exit-1",
        detail: { institutionId: "ins-chase", accountCount: null },
      },
    ],
  );
});

void test("completing an update-mode Link records a success event against the reconnected bank", async () => {
  const h = await harness();
  mock.method(globalThis, "fetch", async () =>
    Response.json({ ...accountsResponse(), request_id: "req-accounts-3" }),
  );
  await reconnectBank(h.db, alice, h.connection.id, linkMetadata());
  const links = await db.bankProviderEvent.findMany({
    where: { clerkUserId: alice, kind: "link" },
  });
  assert.deepEqual(
    links.map(({ method, connectionId, detail }) => ({
      method,
      connectionId,
      detail,
    })),
    [
      {
        method: "success",
        connectionId: h.connection.id,
        detail: { institutionId: "ins-chase", accountCount: 1 },
      },
    ],
  );
});

void test("a received webhook is recorded with its type, code, and verification result", async (t) => {
  const h = await harness();
  const verification = `invalid_signature:${randomUUID()}`;
  const anonymousReceipt = {
    detail: { path: ["verification"], equals: verification },
  };
  t.after(() => db.bankProviderEvent.deleteMany({ where: anonymousReceipt }));
  await recordBankWebhookReceipt(db, {
    connectionId: h.connection.id,
    userId: alice,
    webhookType: "ITEM",
    webhookCode: "ERROR",
    verification: "verified",
    errorCode: "ITEM_LOGIN_REQUIRED",
  });
  await recordBankWebhookReceipt(db, {
    webhookType: null,
    webhookCode: null,
    verification,
  });
  const receipts = (
    await db.bankProviderEvent.findMany({
      where: {
        kind: "webhook",
        OR: [{ connectionId: h.connection.id }, anonymousReceipt],
      },
    })
  )
    .filter(
      (event) =>
        event.connectionId === h.connection.id || event.connectionId === null,
    )
    .map(({ method, connectionId, clerkUserId, errorCode, detail }) => ({
      method,
      connectionId,
      clerkUserId,
      errorCode,
      detail,
    }))
    .sort((left, right) => left.method.localeCompare(right.method));
  assert.deepEqual(receipts, [
    {
      method: "ITEM/ERROR",
      connectionId: h.connection.id,
      clerkUserId: alice,
      errorCode: "ITEM_LOGIN_REQUIRED",
      detail: {
        webhookType: "ITEM",
        webhookCode: "ERROR",
        verification: "verified",
      },
    },
    {
      method: "unverified",
      connectionId: null,
      clerkUserId: null,
      errorCode: null,
      detail: {
        webhookType: null,
        webhookCode: null,
        verification,
      },
    },
  ]);
});

void test("Link review reports all connected accounts with masks without receiving or exchanging a token", async () => {
  const h = await linkedHarness();
  await h.setImports({
    institutionId: "ins-chase",
    institutionName: "Chase",
    accounts: [
      {
        accountId: "provider-checking",
        name: "Chase checking",
        officialName: null,
        mask: "1234",
        type: "depository",
        subtype: "checking",
        currentBalance: 100,
        availableBalance: 100,
        currency: "USD",
      },
    ],
  });
  const fetcher = mock.method(globalThis, "fetch", async () => {
    throw new Error("Review must not call Plaid");
  });
  const metadata = {
    institution: { institution_id: "ins-chase" },
    accounts: [
      {
        id: "new-checking",
        name: "Chase checking",
        mask: "1234",
        type: "depository",
        subtype: "checking",
      },
    ],
  };
  const review = await h.api.budget.plaidLinkReview({ metadata });
  assert.equal(review.verdict, "all");
  assert.equal(review.mayDisconnectExisting, true);
  assert.deepEqual(review.connections, [
    {
      id: h.connection.id,
      institutionName: "Chase",
      accounts: [
        {
          accountId: "provider-checking",
          name: "Chase checking",
          mask: "1234",
        },
      ],
    },
  ]);
  assert.match(review.reviewId, /^[a-f0-9]{64}$/);
  assert.equal(fetcher.mock.callCount(), 0);
});

void test("a reviewed partial duplicate exchanges only after Connect anyway", async () => {
  const h = await linkedHarness();
  await h.setImports({
    institutionId: "ins-chase",
    institutionName: "Chase",
    accounts: [
      {
        accountId: "provider-checking",
        name: "Chase checking",
        officialName: null,
        mask: "1234",
        type: "depository",
        subtype: "checking",
        currentBalance: 100,
        availableBalance: 100,
        currency: "USD",
      },
    ],
  });
  const metadata = {
    institution: { institution_id: "ins-chase" },
    accounts: [
      {
        id: "new-checking",
        name: "Chase checking",
        mask: "1234",
        type: "depository",
        subtype: "checking",
      },
      {
        id: "new-savings",
        name: "Chase savings",
        mask: "9876",
        type: "depository",
        subtype: "savings",
      },
    ],
  };
  const requests: string[] = [];
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    const path = requestUrl(url).pathname;
    requests.push(path);
    return path === "/item/public_token/exchange"
      ? Response.json({
          access_token: "second-access-token",
          item_id: `second-login-${run}`,
        })
      : Response.json(accountsResponse());
  });
  const review = await h.api.budget.plaidLinkReview({ metadata });
  assert.equal(review.verdict, "some");
  assert.deepEqual(requests, []);
  const result = await h.api.budget.plaidExchange({
    publicToken: "held-public-token",
    metadata,
    reviewId: review.reviewId,
  });
  assert.ok(result.id);
  assert.equal((await h.state()).connections.length, 2);
  assert.equal(
    requests.filter((path) => path === "/item/public_token/exchange").length,
    1,
  );
});

void test("Link reviews preserve unknown and no-match outcomes and audit a completion even when no token is exchanged", async () => {
  const h = await linkedHarness();
  const account = {
    accountId: "provider-checking",
    name: "Checking",
    officialName: null,
    mask: "1234",
    type: "depository",
    subtype: "checking",
    currentBalance: 100,
    availableBalance: 100,
    currency: "USD",
  };
  await h.setImports({
    institutionId: "ins-chase",
    institutionName: "Chase",
    accounts: [account],
  });
  const metadata = {
    institution: { institution_id: "ins-chase" },
    accounts: [
      {
        id: "new-checking",
        name: "Checking",
        mask: null as string | null,
        type: "depository",
        subtype: "checking",
      },
    ],
  };
  const fetcher = mock.method(globalThis, "fetch", async () => {
    throw new Error("Review does not exchange tokens");
  });
  assert.equal(
    (await h.api.budget.plaidLinkReview({ metadata })).verdict,
    "unknown",
  );
  await db.bankConnection.create({
    data: {
      clerkUserId: alice,
      itemId: `ambiguous-${run}`,
      encryptedToken: encryptBankToken("other-token", alice),
      accountMappings: {},
      imports: {
        institutionId: "ins-chase",
        institutionName: "Chase",
        accounts: [{ ...account, accountId: "other-checking" }],
      },
    },
  });
  metadata.accounts[0]!.mask = "1234";
  const ambiguous = await h.api.budget.plaidLinkReview({ metadata });
  assert.equal(ambiguous.verdict, "unknown");
  assert.equal(ambiguous.connections.length, 2);
  const fresh = await h.api.budget.plaidLinkReview({
    metadata: { ...metadata, institution: { institution_id: "ins-new-bank" } },
  });
  assert.equal(fresh.verdict, "none");
  assert.deepEqual(fresh.connections, []);
  assert.equal(fetcher.mock.callCount(), 0);
  const events = await db.bankProviderEvent.findMany({
    where: { clerkUserId: alice, kind: "link", method: "success" },
  });
  assert.equal(events.length, 3);
  assert.ok(
    events.every((event) => !JSON.stringify(event).includes("other-token")),
  );
});

void test("a revoked Item does not block Link again as an all-connected duplicate", async () => {
  const h = await linkedHarness();
  await h.setImports({
    institutionId: "ins-chase",
    institutionName: "Chase",
    accounts: [
      {
        accountId: "provider-checking",
        name: "Checking",
        officialName: null,
        mask: "1234",
        type: "depository",
        subtype: "checking",
        currentBalance: 100,
        availableBalance: 100,
        currency: "USD",
      },
    ],
  });
  await db.bankConnection.update({
    where: { id: h.connection.id },
    data: { status: "revoked" },
  });
  const fetcher = mock.method(globalThis, "fetch", async () => {
    throw new Error("Review must not call Plaid");
  });
  const result = await h.api.budget.plaidLinkReview({
    metadata: {
      institution: { institution_id: "ins-chase" },
      accounts: [
        {
          id: "replacement-checking",
          name: "Checking",
          mask: "1234",
          type: "depository",
          subtype: "checking",
        },
      ],
    },
  });
  assert.equal(result.verdict, "none");
  assert.deepEqual(result.connections, []);
  assert.equal(fetcher.mock.callCount(), 0);
});

void test("row-backed provider accounts show the same linked accounts and inbox as legacy JSON", async () => {
  const h = await linkedHarness();
  const record = applyTransactionSync(
    [],
    { added: [importFact("row-reader-purchase")], modified: [], removed: [] },
    h.connection.id,
  ).records[0]!;
  const account = {
    accountId: "provider-checking",
    persistentAccountId: "persistent-checking",
    name: "Checking",
    officialName: "Everyday Checking",
    mask: "1234",
    type: "depository",
    subtype: "checking",
    currentBalance: 100,
    availableBalance: 95,
    currency: "USD",
  };
  const details = {
    institutionId: "ins-chase",
    institutionName: "Chase",
    transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
    accounts: [account],
    synchronizedAccountIds: [account.accountId],
  };
  await h.setImports({ ...details, records: [record] });
  const legacy = await h.state();
  assert.equal(legacy.imports.length, 1);
  await db.bankAccount.create({
    data: {
      connectionId: h.connection.id,
      providerAccountId: account.accountId,
      persistentAccountId: account.persistentAccountId,
      name: account.name,
      officialName: account.officialName,
      mask: account.mask,
      type: account.type,
      subtype: account.subtype,
      currentBalance: account.currentBalance,
      availableBalance: account.availableBalance,
      currency: account.currency,
      historyComplete: true,
      balancesAsOf: new Date("2026-10-25T12:00:00Z"),
      link: {
        create: {
          workspaceId: (await readHouseholdRevision(db, alice))!.workspaceId,
          userId: alice,
          accountId: "cash",
          startDate: "2026-10-01",
        },
      },
    },
  });
  await db.bankConnection.update({
    where: { id: h.connection.id },
    data: {
      imports: { ...details, accounts: [], synchronizedAccountIds: [] },
      accountMappings: {},
    },
  });
  const rows = await h.state();
  assert.deepEqual(rows.connections, legacy.connections);
  assert.deepEqual(rows.imports, legacy.imports);
  assert.deepEqual(rows.view, legacy.view);
});

void test("an unreadable provider account puts only its connection under maintenance", async () => {
  const h = await linkedHarness();
  await db.bankAccount.create({
    data: {
      connectionId: h.connection.id,
      providerAccountId: "provider-checking",
      name: "Checking",
      type: "depository",
      status: "not-a-readable-state",
    },
  });
  const result = await h.state();
  assert.equal(result.status, "ready");
  assert.match(result.connections[0]!.error!, /under maintenance/);
  assert.deepEqual(result.connections[0]!.accounts, []);
  assert.equal(
    result.view.budget.accounts.some((account) => account.id === "cash"),
    true,
  );
  await db.bankAccount.updateMany({
    where: { connectionId: h.connection.id },
    data: { status: "shared", name: "x".repeat(1025) },
  });
  assert.match((await h.state()).connections[0]!.error!, /under maintenance/);
});

void test("imports naming a retired provider id still reach its live linked account", async () => {
  const h = await linkedHarness();
  const record = applyTransactionSync(
    [],
    { added: [importFact("retired-id-purchase")], modified: [], removed: [] },
    h.connection.id,
  ).records[0]!;
  await h.setImports({ records: [record] });
  await h.setMappings({});
  const replacement = await db.bankAccount.create({
    data: {
      connectionId: h.connection.id,
      providerAccountId: "provider-replacement",
      name: "Checking",
      type: "depository",
      subtype: "checking",
      mask: "1234",
      currency: "USD",
      currentBalance: 100,
      historyComplete: true,
      link: {
        create: {
          workspaceId: (await readHouseholdRevision(db, alice))!.workspaceId,
          userId: alice,
          accountId: "cash",
          startDate: "2026-10-01",
        },
      },
    },
  });
  await db.bankAccount.create({
    data: {
      connectionId: h.connection.id,
      providerAccountId: "provider-checking",
      name: "Checking",
      type: "depository",
      status: "retired",
      supersededById: replacement.id,
    },
  });
  const result = await h.state();
  assert.equal(result.imports[0]?.accountId, "cash");
  assert.equal(result.imports[0]?.providerAccountId, "provider-checking");
  assert.deepEqual(Object.keys(result.connections[0]!.accountMappings), [
    "provider-replacement",
  ]);
  await assert.rejects(
    h.api.budget.execute({
      baseRevision: result.revision,
      clientId: "reader-test",
      command: {
        type: "account.reconcile",
        id: randomUUID(),
        accountId: "cash",
        date: "2026-10-25",
        balance: 10000,
      },
    }),
    /review/i,
  );
  const item = result.imports[0];
  await h.api.budget.resolveImport({
    connectionId: item.connectionId,
    logicalId: item.logicalId,
    expectedFingerprint: item.fingerprint,
    expectedRevision: result.revision,
    ignore: false,
    command: {
      type: "transaction.upsert",
      id: randomUUID(),
      transactionId: "retired-id-recorded",
      accountId: "cash",
      date: item.date,
      amount: item.amount,
      payee: item.payee,
      categoryId: "dining",
      status: "posted",
    },
  });
  const confirmed = await h.state();
  assert.equal(confirmed.status, "ready");
  assert.equal(
    confirmed.view.budget.transactions.find(
      (item) => item.id === "retired-id-recorded",
    )?.accountId,
    "cash",
  );
});

void test("a provider link owned by another budget is refused by the connection reader", async () => {
  const h = await linkedHarness();
  await db.bankAccount.create({
    data: {
      connectionId: h.connection.id,
      providerAccountId: "provider-checking",
      name: "Checking",
      type: "depository",
      link: {
        create: {
          workspaceId: (await readHouseholdRevision(db, alice))!.workspaceId,
          userId: bob,
          accountId: "cash",
          startDate: "2026-10-01",
        },
      },
    },
  });
  const result = await h.state();
  assert.equal(result.status, "ready");
  assert.match(result.connections[0]!.error!, /under maintenance/);
  assert.deepEqual(result.connections[0]!.accountMappings, {});
});

void test("broken provider supersession raises an alert and isolates the connection", async () => {
  const h = await linkedHarness();
  const row = await db.bankAccount.create({
    data: {
      connectionId: h.connection.id,
      providerAccountId: "provider-checking",
      name: "Checking",
      type: "depository",
      status: "retired",
    },
  });
  await db.bankAccount.update({
    where: { id: row.id },
    data: { supersededById: row.id },
  });
  const alerts: string[] = [];
  mock.method(console, "error", (message: string) => {
    alerts.push(message);
  });
  const cyclic = await h.state();
  assert.equal(cyclic.status, "ready");
  assert.match(cyclic.connections[0]!.error!, /under maintenance/);
  assert.ok(
    alerts.some(
      (message) =>
        message.includes("stored-data-unreadable") &&
        message.includes(h.connection.id),
    ),
  );

  const other = await db.bankConnection.create({
    data: {
      clerkUserId: bob,
      itemId: `other-${randomUUID()}`,
      encryptedToken: "",
      imports: {},
      accountMappings: {},
    },
  });
  const outside = await db.bankAccount.create({
    data: {
      connectionId: other.id,
      providerAccountId: "provider-other",
      name: "Other",
      type: "depository",
    },
  });
  await db.bankAccount.update({
    where: { id: row.id },
    data: { supersededById: outside.id },
  });
  alerts.length = 0;
  const missing = await h.state();
  assert.equal(missing.status, "ready");
  assert.match(missing.connections[0]!.error!, /under maintenance/);
  assert.ok(
    alerts.some(
      (message) =>
        message.includes("stored-data-unreadable") &&
        message.includes(h.connection.id),
    ),
  );
});

void test("first bank read copies legacy links once even when their cached identity is missing", async () => {
  const h = await linkedHarness();
  const snapshot = { postedImportIds: ["old-import"], fingerprints: {} };
  await h.setMappings({
    "provider-checking": {
      accountId: "cash",
      startDate: "2026-09-18",
      openingSnapshot: snapshot,
    },
  });
  const before = await h.book();
  await h.state();
  const rows = await db.bankAccount.findMany({
    where: { connectionId: h.connection.id },
    include: { link: true },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.providerAccountId, "provider-checking");
  assert.equal(rows[0]!.status, "unavailable");
  assert.equal(rows[0]!.persistentAccountId, null);
  assert.equal(rows[0]!.mask, null);
  assert.equal(rows[0]!.link!.accountId, "cash");
  assert.equal(rows[0]!.link!.startDate, "2026-09-18");
  assert.deepEqual(rows[0]!.link!.openingSnapshot, snapshot);
  await h.state();
  assert.deepEqual(
    await db.bankAccount.findMany({
      where: { connectionId: h.connection.id },
      include: { link: true },
    }),
    rows,
  );
  assert.deepEqual(await h.book(), before);
});

void test("reconnect writes provider rows and preserves a revoked account omitted by Plaid", async () => {
  const h = await linkedHarness();
  await h.state();
  await db.bankAccount.updateMany({
    where: { connectionId: h.connection.id },
    data: { status: "revoked" },
  });
  const legacy = await h.saved();
  mockPlaid(async () =>
    Response.json({
      ...accountsResponse(),
      accounts: [
        { ...accountsResponse().accounts[0]!, account_id: "second-account" },
      ],
    }),
  );
  await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
  const rows = await db.bankAccount.findMany({
    where: { connectionId: h.connection.id },
    orderBy: { providerAccountId: "asc" },
  });
  assert.deepEqual(
    rows.map((row) => [row.providerAccountId, row.status]),
    [
      ["provider-checking", "revoked"],
      ["second-account", "shared"],
    ],
  );
  assert.deepEqual((await h.saved()).accountMappings, legacy.accountMappings);
  assert.deepEqual(bankAccountDetails((await h.saved()).imports).accounts, []);
  mock.restoreAll();
  mockPlaid(async () => Response.json(accountsResponse()));
  await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
  assert.equal(
    (
      await db.bankAccount.findUniqueOrThrow({
        where: {
          connectionId_providerAccountId: {
            connectionId: h.connection.id,
            providerAccountId: "provider-checking",
          },
        },
      })
    ).status,
    "shared",
  );
});

void test("five Amex cards survive subset consent and explicit recovery of four changed ids", async () => {
  const h = await harness();
  await db.bankConnection.delete({ where: { id: h.connection.id } });
  let phase: "all" | "subset" | "reshared" = "all";
  const response = () => ({
    item: { institution_id: "ins-amex", institution_name: "Amex" },
    accounts: Array.from(
      { length: phase === "subset" ? 1 : 5 },
      (_, index) => ({
        account_id:
          phase === "reshared" && index ? `new-${index}` : `card-${index}`,
        name: `Amex card ${index}`,
        official_name: null,
        mask: `100${index}`,
        type: "credit",
        subtype: "credit card",
        balances: {
          current: 10,
          available: null,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
      }),
    ),
  });
  mockPlaid(async (url) => {
    switch (requestUrl(url).pathname) {
      case "/item/public_token/exchange":
        return Response.json({
          access_token: "amex-access",
          item_id: `amex-${run}`,
        });
      case "/transactions/sync":
        return Response.json({
          ...response(),
          added: [],
          modified: [],
          removed: [],
          next_cursor: phase,
          has_more: false,
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        });
      case "/accounts/get":
        return Response.json(response());
      default:
        throw new Error("Unexpected Plaid request");
    }
  });
  const linked = await h.api.budget.plaidExchange({
    publicToken: "public-amex",
    metadata: {
      institution: { institution_id: "ins-amex" },
      accounts: response().accounts.map((account) => ({
        id: account.account_id,
        name: account.name,
        mask: account.mask,
      })),
    },
  });
  assert.equal(
    await db.bankAccount.count({ where: { connectionId: linked.id } }),
    5,
  );
  await h.api.budget.sync();
  await h.api.budget.setupBankAccounts({
    connectionId: linked.id,
    operationId: randomUUID(),
    expectedRevision: await h.revision(),
    accounts: response().accounts.map((account) => ({
      providerAccountId: account.account_id,
      name: account.name,
      expectedBalance: 10,
    })),
  });
  const original = (await h.state()).view!.budget.accounts.filter(
    (account) => account.kind === "credit",
  );
  assert.equal(original.length, 5);
  const originalLinks = await db.bankAccountLink.findMany({
    where: { userId: alice },
    include: { bankAccount: true },
  });
  let book = await h.book();
  for (const account of original)
    book = execute(book, alice, {
      type: "account.reconcile",
      id: randomUUID(),
      accountId: account.id,
      date: bankSetupDate(book.budgets[alice]!.settings.timezone),
      balance: -1000,
    });
  await h.setBook(book);
  const before = (await h.state()).view!.budget;
  phase = "subset";
  await h.api.budget.plaidReconnect({ connectionId: linked.id });
  assert.equal((await h.state()).connections[0]!.accounts.length, 5);
  assert.equal(
    await db.bankAccount.count({
      where: { connectionId: linked.id, status: "unavailable" },
    }),
    4,
  );
  phase = "reshared";
  await h.api.budget.plaidReconnect({ connectionId: linked.id });
  await h.api.budget.sync();
  const accounts = response()
    .accounts.slice(1)
    .map((account, index) => ({
      providerAccountId: account.account_id,
      name: account.name,
      expectedBalance: 10,
      existingAccountId: originalLinks.find(
        (link) => link.bankAccount.providerAccountId === `card-${index + 1}`,
      )!.accountId,
    }));
  await h.api.budget.setupBankAccounts({
    connectionId: linked.id,
    operationId: randomUUID(),
    expectedRevision: await h.revision(),
    accounts,
  });
  const after = (await h.state()).view!.budget;
  assert.deepEqual(after.accounts, before.accounts);
  assert.deepEqual(after.transactions, before.transactions);
  assert.equal(
    await db.bankAccountLink.count({
      where: { userId: alice, unlinkedAt: null },
    }),
    5,
  );
  const retired = await db.bankAccount.findMany({
    where: { connectionId: linked.id, status: "retired" },
  });
  assert.equal(retired.length, 4);
  assert.ok(retired.every((account) => account.supersededById));
  assert.deepEqual(
    bankAccountDetails(
      (await db.bankConnection.findUniqueOrThrow({ where: { id: linked.id } }))
        .imports,
    ).accounts,
    [],
  );
});

void test("superseded ids keep their old inbox through a chain and cannot become live again", async () => {
  const h = await linkedHarness();
  const record = applyTransactionSync(
    [],
    { added: [importFact("old-id-purchase")], modified: [], removed: [] },
    h.connection.id,
  ).records[0]!;
  await h.setImports({
    institutionId: "ins-chase",
    institutionName: "Chase",
    records: [record],
    accounts: [
      {
        accountId: "provider-checking",
        persistentAccountId: "stable-checking",
        name: "Chase checking",
        officialName: null,
        mask: "1234",
        type: "depository",
        subtype: "checking",
        currentBalance: 100,
        availableBalance: null,
        currency: "USD",
      },
    ],
  });
  await h.state();
  const before = await bankInbox(db, alice);
  assert.equal(before.length, 1);
  const importRows = (
    await loadRows(db, (await readHouseholdRevision(db, alice))!.workspaceId)
  ).filter((row) => row.table === "bankImport");
  let providerId = "replacement-one";
  mockPlaid(async () =>
    Response.json({
      ...accountsResponse(),
      accounts: [
        {
          ...accountsResponse().accounts[0]!,
          account_id: providerId,
          persistent_account_id: "stable-checking",
        },
      ],
    }),
  );
  await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
  providerId = "replacement-two";
  await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
  providerId = "provider-checking";
  await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
  assert.deepEqual(await bankInbox(db, alice), before);
  assert.deepEqual(
    (
      await loadRows(db, (await readHouseholdRevision(db, alice))!.workspaceId)
    ).filter((row) => row.table === "bankImport"),
    importRows,
  );
  const links = await db.bankAccountLink.findMany({
    where: { userId: alice, unlinkedAt: null },
    include: { bankAccount: true },
  });
  assert.equal(links.length, 1);
  assert.equal(links[0]!.bankAccount.providerAccountId, "replacement-two");
  assert.equal(
    await db.bankAccount.count({
      where: { connectionId: h.connection.id, status: "retired" },
    }),
    2,
  );
});

void test("table-backed update Link and disconnect keep feeds and history while stopping balances", async () => {
  const h = await linkedHarness();
  await h.setImports({
    accounts: [
      {
        accountId: "provider-checking",
        name: "Checking",
        officialName: null,
        mask: "1234",
        type: "depository",
        subtype: "checking",
        currency: "USD",
        currentBalance: 100,
        availableBalance: 100,
      },
    ],
    synchronizedAccountIds: ["provider-checking"],
  });
  await h.state();
  const before = await h.book();
  const legacy = await h.saved();
  mockPlaid(async (url) =>
    requestUrl(url).pathname === "/link/token/create"
      ? Response.json({
          link_token: "update-token",
          expiration: "2026-10-26T00:00:00Z",
        })
      : Response.json({ removed: true }),
  );
  const token = await linkBankToken(db, alice, h.connection.id);
  assert.equal(token.linkToken, "update-token");
  await h.api.budget.disconnectBank({
    connectionId: h.connection.id,
    operationId: randomUUID(),
    expectedRevision: await h.revision(),
  });
  assert.equal(
    (
      await db.bankAccount.findFirstOrThrow({
        where: { connectionId: h.connection.id },
      })
    ).status,
    "unavailable",
  );
  assert.equal(
    await db.bankAccountLink.count({
      where: { userId: alice, unlinkedAt: null },
    }),
    1,
  );
  assert.deepEqual(
    bankAccountDetails((await h.saved()).imports).accounts,
    bankAccountDetails(legacy.imports).accounts,
  );
  assert.deepEqual((await h.saved()).accountMappings, legacy.accountMappings);
  assert.deepEqual(await h.book(), before);
});

void test("a persistent identity is superseded before the user adds any budget account", async () => {
  const h = await harness();
  const before = (await h.state()).view!.budget;
  let providerId = "first-provider";
  mockPlaid(async () =>
    Response.json({
      ...accountsResponse(),
      accounts: [
        {
          ...accountsResponse().accounts[0]!,
          account_id: providerId,
          persistent_account_id: "stable-unlinked",
        },
      ],
    }),
  );
  await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
  providerId = "next-provider";
  await h.api.budget.plaidReconnect({ connectionId: h.connection.id });
  const rows = await db.bankAccount.findMany({
    where: { connectionId: h.connection.id },
    orderBy: { providerAccountId: "asc" },
  });
  assert.deepEqual(
    rows.map((row) => [row.providerAccountId, row.status]),
    [
      ["first-provider", "retired"],
      ["next-provider", "shared"],
    ],
  );
  assert.equal(rows[0]!.supersededById, rows[1]!.id);
  assert.equal(await db.bankAccountLink.count({ where: { userId: alice } }), 0);
  assert.deepEqual((await h.state()).view!.budget.accounts, before.accounts);
  const decisions = await recordedDecisions("bank.accounts.supersede");
  assert.deepEqual(decisions, [
    {
      connectionId: h.connection.id,
      decisions: [{ rung: 2, from: "first-provider", to: "next-provider" }],
    },
  ]);
});
