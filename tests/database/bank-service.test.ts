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
import { onboard } from "../../src/server/services/household-operations";
import { households } from "../../src/server/storage/households";
import {
  loadRows,
  readHouseholdRevision,
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

void test("bank update Link tokens and completion enforce connection ownership before accessing Plaid", async () => {
  const h = await harness();
  const before = await h.details();
  const fetcher = mock.method(globalThis, "fetch", async () => {
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
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
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

void test("update mode reuses the private Item token and refreshes metadata without exchanging a public token", async () => {
  const h = await harness();
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
  mock.method(globalThis, "fetch", async () =>
    Response.json({
      access_token: "new-private-token",
      item_id: h.connection.itemId,
    }),
  );
  await assert.rejects(exchangeBankToken(h.db, bob, "public-token"), {
    code: "CONFLICT",
  });
  assert.equal((await h.saved()).encryptedToken, before);
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
  mock.method(globalThis, "fetch", async () =>
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
  const result = await exchangeBankToken(h.db, alice, "public-token");
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
  await syncBanks(h.db, alice);
  const details = await h.details();
  assert.equal(details.accounts[0]!.currentBalance, 100);
  assert.deepEqual(details.synchronizedAccountIds, ["provider-checking"]);
});

void test("a prior sync balance is retained only when its cursor and account activity are unchanged", async () => {
  const h = await harness();
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
  mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, init?: RequestInit) => {
      if (requestUrl(url).pathname !== "/transactions/sync")
        return Response.json(accountsResponse());
      requests.push(
        JSON.parse(init!.body as string) as Record<string, unknown>,
      );
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
    },
  );
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
