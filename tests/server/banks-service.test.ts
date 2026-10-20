import assert from "node:assert/strict";
import test, { afterEach, mock } from "node:test";

import { type Prisma } from "../../src/generated/prisma";
import { createBook, execute } from "../../src/domain/engine";
import {
  applyTransactionSync,
  normalizePlaidTransaction,
} from "../../src/server/integrations/transactions";
import { openingSnapshot } from "../../src/server/services/bank-account-setup";
import {
  bankAccountDetails,
  bankInbox,
  exchangeBankToken,
  linkBankToken,
  reconnectBank,
  resolveImport,
  syncBanks,
} from "../../src/server/services/banks";
import { type Database } from "../../src/server/services/workspace";
import {
  decryptBankToken,
  encryptBankToken,
} from "../../src/server/token-crypto";

const environmentKeys = [
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "PLAID_REDIRECT_URI",
  "BANK_TOKEN_ENCRYPTION_KEY",
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

const requestUrl = (input: string | URL | Request) =>
  new URL(input instanceof Request ? input.url : input);

function harness() {
  process.env.PLAID_CLIENT_ID = "fixture-client";
  process.env.PLAID_SECRET = "fixture-secret";
  process.env.PLAID_ENV = "production";
  process.env.PLAID_REDIRECT_URI = "https://caishen.example/plaid/oauth";
  process.env.BANK_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  const book = createBook("alice", "Alice", "2026-10");
  const workspace = { id: "workspace", book, revision: 0 };
  const connection = {
    id: "connection-alice",
    clerkUserId: "alice",
    itemId: "item-alice",
    cursor: null as string | null,
    encryptedToken: encryptBankToken("private-access-token", "alice"),
    imports: {
      records: [],
      resolved: {},
      errors: {},
      reviews: {},
    } as unknown,
    accountMappings: {} as Prisma.JsonValue,
    error: "Reconnect your bank" as string | null,
    lastSyncedAt: null as Date | null,
  };
  const raw = {
    bankConnection: {
      findFirst: mock.fn(
        async ({ where }: { where: { id: string; clerkUserId: string } }) =>
          where.id === connection.id &&
          where.clerkUserId === connection.clerkUserId
            ? { ...connection }
            : null,
      ),
      findFirstOrThrow: async () => ({ ...connection }),
      findUnique: async () => ({ ...connection }),
      findMany: async () => [{ ...connection }],
      upsert: mock.fn(
        async ({ update }: { update: Partial<typeof connection> }) => {
          Object.assign(connection, update);
          return { ...connection };
        },
      ),
      update: mock.fn(
        async ({ data }: { data: Partial<typeof connection> }) => {
          Object.assign(connection, data);
          return { ...connection };
        },
      ),
    },
    workspaceMember: {
      findUnique: async () => ({ workspaceId: workspace.id, workspace }),
      findUniqueOrThrow: async () => ({ workspaceId: workspace.id, workspace }),
    },
    workspace: {
      updateMany: mock.fn(async ({ data }: { data: { book: typeof book } }) => {
        Object.assign(book, data.book);
        workspace.revision++;
        return { count: 1 };
      }),
    },
    budgetOperation: {
      createMany: mock.fn(async ({ data }: { data: unknown[] }) => ({
        count: data.length,
      })),
    },
    $transaction: async (operation: (db: Database) => Promise<unknown>) =>
      operation(raw as unknown as Database),
  };
  return { db: raw as unknown as Database, raw, connection, book };
}

void test("bank update Link tokens and completion enforce connection ownership before accessing Plaid", async () => {
  const h = harness();
  const fetcher = mock.method(globalThis, "fetch", async () => {
    throw new Error("Provider must not be called");
  });
  await assert.rejects(linkBankToken(h.db, "bob", h.connection.id), {
    code: "NOT_FOUND",
  });
  await assert.rejects(reconnectBank(h.db, "bob", h.connection.id), {
    code: "NOT_FOUND",
  });
  assert.equal(fetcher.mock.callCount(), 0);
  assert.equal(h.raw.bankConnection.update.mock.callCount(), 0);
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

void test("first-connect inbox excludes unrecorded tombstones while preserving opening-balance discrepancies", async () => {
  const h = harness();
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
  h.connection.accountMappings = {
    "provider-checking": {
      accountId: "cash",
      startDate: "2026-10-20",
      openingSnapshot: openingSnapshot(initial, "provider-checking"),
    },
  };
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
  h.connection.imports = {
    records: updated.records,
    resolved: {},
    errors: {},
    reviews: {},
  };
  const inbox = await bankInbox(h.db, "alice");
  assert.equal(inbox.length, 1);
  assert.equal(
    inbox[0]!.logicalId,
    initial.find(
      (record) => record.current.providerTransactionId === "opening-posted",
    )!.id,
  );
  assert.match(inbox[0]!.error!, /opening balance/);
  assert.equal(
    updated.records.length,
    3,
    "technical history remains inspectable",
  );
});

void test("first-connect opening history ignores payee-only changes for saved legacy snapshots", async () => {
  const h = harness();
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
  h.connection.accountMappings = {
    "provider-checking": {
      accountId: "cash",
      startDate: "2026-10-20",
      openingSnapshot: legacySnapshot,
    },
  };
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
  h.connection.imports = {
    records: updated,
    resolved: {},
    errors: {},
    reviews: {},
  };
  assert.deepEqual(await bankInbox(h.db, "alice"), []);
  updated[0]!.current.amountCents += 100;
  h.connection.imports = {
    records: updated,
    resolved: {},
    errors: {},
    reviews: {},
  };
  assert.match((await bankInbox(h.db, "alice"))[0]!.error!, /opening balance/);
});

void test("inbox categories come from the linked ledger category, and normal posting has no discrepancy", async () => {
  const h = harness();
  let book = execute(h.book, "alice", {
    type: "account.add",
    id: "cash",
    accountId: "cash",
    name: "Cash",
    kind: "cash",
    openingBalance: 10000,
    date: "2026-10-19",
  });
  book = execute(book, "alice", {
    type: "category.add",
    id: "category",
    categoryId: "dining",
    name: "Dining out",
  });
  book = execute(book, "alice", {
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
  Object.assign(h.book, book);
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
  h.connection.accountMappings = {
    "provider-checking": { accountId: "cash", startDate: "2026-10-20" },
  };
  h.connection.imports = {
    records: posted,
    resolved: {
      [posted[0]!.id]: {
        fingerprint: "b".repeat(64),
        transactionId: "purchase",
      },
    },
    errors: {},
    reviews: {},
  };
  const inbox = await bankInbox(h.db, "alice");
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0]!.removed, false);
  assert.equal(inbox[0]!.needsMatchReview, false);
  assert.equal(inbox[0]!.error, null);
  assert.equal(inbox[0]!.categoryName, "Dining out");
  await assert.rejects(
    resolveImport(h.db, "alice", {
      connectionId: h.connection.id,
      logicalId: posted[0]!.id,
      expectedRevision: 0,
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
    const h = harness();
    let book = execute(h.book, "alice", {
      type: "account.add",
      id: "cash",
      accountId: "cash",
      name: "Cash",
      kind: "cash",
      openingBalance: 10000,
      date: "2026-10-19",
    });
    book = execute(book, "alice", {
      type: "category.add",
      id: "category",
      categoryId: "dining",
      name: "Dining out",
    });
    book = execute(book, "alice", {
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
    Object.assign(h.book, book);
    if (delivery === "user deletion")
      Object.assign(
        h.book,
        execute(h.book, "alice", {
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
    h.connection.accountMappings = {
      "provider-checking": { accountId: "cash", startDate: "2026-10-20" },
    };
    h.connection.imports = {
      records: initial,
      resolved: {
        [initial[0]!.id]: {
          fingerprint: "b".repeat(64),
          transactionId: "purchase",
        },
      },
      errors: {},
      reviews: {},
    };
    let syncCount = 0;
    mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
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
      assert.deepEqual(await syncBanks(h.db, "alice"), {
        imported: 0,
        updated: delivery === "user deletion" ? 0 : 1,
      });
      assert.equal(h.book.budgets.alice!.transactions[0]!.removed, true);
      if (delivery !== "user deletion")
        assert.deepEqual(await bankInbox(h.db, "alice"), []);
    }
    assert.deepEqual(await syncBanks(h.db, "alice"), {
      imported: 0,
      updated: delivery === "user deletion" ? 0 : 1,
    });
    assert.equal(h.book.budgets.alice!.transactions.length, 1);
    const purchase = h.book.budgets.alice!.transactions[0]!;
    assert.equal(
      purchase.status,
      delivery === "user deletion" ? "pending" : "posted",
    );
    assert.equal(purchase.amount, -2000);
    assert.equal(purchase.categoryId, "dining");
    assert.equal(purchase.reviewed, true);
    assert.equal(Boolean(purchase.removed), delivery === "user deletion");
    if (delivery !== "user deletion")
      assert.deepEqual(await bankInbox(h.db, "alice"), []);
    assert.deepEqual(await syncBanks(h.db, "alice"), {
      imported: 0,
      updated: 0,
    });
    const operations =
      delivery === "user deletion" ? 0 : delivery === "same sync" ? 1 : 2;
    assert.equal(h.raw.budgetOperation.createMany.mock.callCount(), operations);
    assert.equal(h.raw.workspace.updateMany.mock.callCount(), operations);
  });

void test("update mode reuses the private Item token and refreshes metadata without exchanging a public token", async () => {
  const h = harness();
  const savedHistory = {
    records: [],
    resolved: { previous: { fingerprint: "b".repeat(64), ignored: true } },
    errors: { previous: "Review an earlier import" },
    reviews: { previous: [{ message: "Original review evidence" }] },
    synchronizedAccountIds: ["provider-checking"],
    transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
  };
  h.connection.imports = savedHistory;
  const paths: string[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      const path = requestUrl(url).pathname;
      paths.push(path);
      const request = JSON.parse(init?.body as string) as Record<
        string,
        unknown
      >;
      assert.equal(request.access_token, "private-access-token");
      if (path === "/link/token/create") {
        assert.equal(request.products, undefined);
        assert.equal(request.redirect_uri, process.env.PLAID_REDIRECT_URI);
        return Response.json({
          link_token: "link-update",
          expiration: "2026-10-20T12:00:00Z",
        });
      }
      assert.equal(path, "/accounts/get");
      return Response.json(accountsResponse());
    },
  );
  const link = await linkBankToken(h.db, "alice", h.connection.id);
  assert.deepEqual(link, {
    linkToken: "link-update",
    expiration: "2026-10-20T12:00:00Z",
    redirectUri: "https://caishen.example/plaid/oauth",
  });
  const result = await reconnectBank(h.db, "alice", h.connection.id);
  assert.deepEqual(result, { id: h.connection.id });
  assert.deepEqual(paths, ["/link/token/create", "/accounts/get"]);
  assert.equal(h.connection.error, null);
  assert.deepEqual(h.connection.imports, {
    ...savedHistory,
    ...bankAccountDetails(h.connection.imports),
  });
  assert.deepEqual(
    bankAccountDetails(h.connection.imports).accounts.map((a) => [
      a.name,
      a.currentBalance,
    ]),
    [["Chase checking", 123.45]],
  );
  assert.deepEqual(h.book.budgets.alice!.accounts, []);
  assert.deepEqual(
    bankAccountDetails(h.connection.imports).synchronizedAccountIds,
    [],
  );
  assert.equal(
    bankAccountDetails(h.connection.imports).transactionStatus,
    null,
  );
  assert.ok(!JSON.stringify({ link, result }).includes("private-access-token"));
});

void test("exchange refuses an Item already owned by another user without replacing its credential", async () => {
  const h = harness();
  const before = h.connection.encryptedToken;
  mock.method(globalThis, "fetch", async () =>
    Response.json({
      access_token: "new-private-token",
      item_id: h.connection.itemId,
    }),
  );
  await assert.rejects(exchangeBankToken(h.db, "bob", "public-token"), {
    code: "CONFLICT",
  });
  assert.equal(h.raw.bankConnection.upsert.mock.callCount(), 0);
  assert.equal(h.connection.encryptedToken, before);
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
  const h = harness();
  process.env.PLAID_ENV = "sandbox";
  delete process.env.PLAID_REDIRECT_URI;
  mock.method(globalThis, "fetch", async () =>
    Response.json({
      link_token: "link-sandbox",
      expiration: "2026-10-20T12:00:00Z",
    }),
  );
  assert.deepEqual(await linkBankToken(h.db, "alice"), {
    linkToken: "link-sandbox",
    expiration: "2026-10-20T12:00:00Z",
  });
});

void test("successful public token exchange remains saved if account metadata is temporarily unavailable", async () => {
  const h = harness();
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
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
  const result = await exchangeBankToken(h.db, "alice", "public-token");
  assert.equal(result.id, h.connection.id);
  assert.match(result.warning!, /bank is connected/);
  assert.equal(
    decryptBankToken(h.connection.encryptedToken, "alice"),
    "new-private-token",
  );
  assert.ok(!JSON.stringify(result).includes("private provider details"));
  assert.deepEqual(bankAccountDetails(h.connection.imports).accounts, []);
});

void test("bank sync updates cached account details without creating ledger accounts or balances", async () => {
  const h = harness();
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
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
  assert.deepEqual(await syncBanks(h.db, "alice"), { imported: 0, updated: 0 });
  assert.equal(h.connection.cursor, "next");
  assert.equal(h.connection.error, null);
  assert.equal(
    bankAccountDetails(h.connection.imports).accounts[0]!.availableBalance,
    100,
  );
  assert.deepEqual(h.book.budgets.alice!.accounts, []);
  assert.deepEqual(
    bankAccountDetails(h.connection.imports).synchronizedAccountIds,
    ["provider-checking"],
  );
});

void test("opening metadata uses the balance paired with sync activity rather than a newer accounts/get balance", async () => {
  const h = harness();
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
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
  await syncBanks(h.db, "alice");
  const details = bankAccountDetails(h.connection.imports);
  assert.equal(details.accounts[0]!.currentBalance, 100);
  assert.deepEqual(details.synchronizedAccountIds, ["provider-checking"]);
});

void test("a prior sync balance is retained only when its cursor and account activity are unchanged", async () => {
  const h = harness();
  let updates = 0;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
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
  await syncBanks(h.db, "alice");
  await syncBanks(h.db, "alice");
  assert.equal(
    bankAccountDetails(h.connection.imports).accounts[0]!.currentBalance,
    123.45,
  );
  assert.deepEqual(
    bankAccountDetails(h.connection.imports).synchronizedAccountIds,
    ["provider-checking"],
  );
  await syncBanks(h.db, "alice");
  assert.equal(
    bankAccountDetails(h.connection.imports).accounts[0]!.currentBalance,
    80,
  );
  assert.deepEqual(
    bankAccountDetails(h.connection.imports).synchronizedAccountIds,
    [],
  );
});

void test("an account delta without its matching sync balance invalidates the prior balance source", async () => {
  const h = harness();
  let updates = 0;
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
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
  await syncBanks(h.db, "alice");
  assert.deepEqual(
    bankAccountDetails(h.connection.imports).synchronizedAccountIds,
    ["provider-checking"],
  );
  await syncBanks(h.db, "alice");
  assert.deepEqual(
    bankAccountDetails(h.connection.imports).synchronizedAccountIds,
    [],
  );
});
