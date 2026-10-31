import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import nextEnv from "@next/env";
import {
  createBook,
  execute,
  executeWithChanges,
  withCounterpartyAccounts,
} from "../../src/domain/engine";
import { bookToRows, tombstone, type WireRow } from "../../src/domain/rows";
import { PrismaClient } from "../../src/generated/prisma";
import {
  createDatabaseCaller as createCaller,
  databaseClientBuild as build,
} from "./fixtures";
import { ObservedRevision } from "../../src/server/api/trpc";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { writeChangeSet } from "../../src/server/storage/rows";
import { jsonValue } from "../../src/server/services/safety";
import {
  createBankConnection,
  createHousehold,
  invitationFrom,
} from "./fixtures";
import {
  applyTransactionSync,
  normalizePlaidTransaction,
} from "../../src/server/integrations/transactions";
import { bankSetupDate } from "../../src/server/services/bank-account-setup";

// Every budget holds its counterparty accounts and their paired envelopes:
// from creation, from joining a partner, and, for budgets made before they
// existed, from the first time a browser loads the budget.
nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
const run = randomUUID();
const month = "2026-10";
const users: string[] = [];
const workspaceIds: string[] = [];

async function member(name: string) {
  const userId = `test-counterparty-${name.toLowerCase()}-${run}`;
  users.push(userId);
  await db.user.create({ data: { clerkUserId: userId } });
  const api = createCaller({
    db,
    userId,
    headers: new Headers(),
    revision: new ObservedRevision(),
  });
  return { userId, api };
}
type Member = Awaited<ReturnType<typeof member>>;

async function pullAll(who: Member, since: number | null = null) {
  const rows: WireRow[] = [];
  let first;
  let cursor: string | undefined;
  do {
    const page = await who.api.sync.pull({ since, cursor, clientBuild: build });
    first ??= page;
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  return { ...first, rows };
}

// The counterparty accounts and paired envelopes among a member's rows.
function people(rows: WireRow[]) {
  const data = (row: WireRow) => row.data as Record<string, unknown>;
  return {
    accounts: rows
      .filter(
        (row) =>
          row.table === "account" &&
          ["partner", "reimbursements"].includes(String(data(row).kind)),
      )
      .map((row) => data(row).kind)
      .sort(),
    envelopes: rows
      .filter(
        (row) => row.table === "category" && data(row).counterpartyAccountId,
      )
      .map((row) => [data(row).name, data(row).counterpartyAccountId])
      .sort(),
  };
}

const onboard = (who: Member, name: string) =>
  who.api.budget.onboard({ name, month, timezone: "America/Los_Angeles" });

test.after(async () => {
  await db.bankConnection.deleteMany({ where: { clerkUserId: { in: users } } });
  const memberships = await db.workspaceMember.findMany({
    where: { clerkUserId: { in: users } },
  });
  await db.workspace.deleteMany({
    where: {
      OR: [
        {
          id: {
            in: [...workspaceIds, ...memberships.map((m) => m.workspaceId)],
          },
        },
        { budgetMembers: { some: { userId: { in: users } } } },
      ],
    },
  });
  await db.user.deleteMany({ where: { clerkUserId: { in: users } } });
  await db.$disconnect();
});

void test("a new budget starts with the reimbursements account and its envelope", async () => {
  const alan = await member("Alan");
  await onboard(alan, "Alan");

  assert.deepEqual(people((await pullAll(alan)).rows), {
    accounts: ["reimbursements"],
    envelopes: [["Reimbursements", "counterparty:reimbursements"]],
  });
});

void test("joining a partner gives each budget a partner account and its envelope", async () => {
  const alan = await member("Host");
  const anna = await member("Guest");
  await onboard(alan, "Alan");
  await onboard(anna, "Anna");

  await anna.api.budget.joinInvitation({
    id: await invitationFrom(db, alan.userId),
  });

  for (const who of [alan, anna])
    assert.deepEqual(people((await pullAll(who)).rows), {
      accounts: ["partner", "reimbursements"],
      envelopes: [
        ["Partner", "counterparty:partner"],
        ["Reimbursements", "counterparty:reimbursements"],
      ],
    });
  // The partner account goes by the partner's first name.
  await db.user.update({
    where: { clerkUserId: anna.userId },
    data: { firstName: "Anna" },
  });
  const overview = await alan.api.budget.overview();
  assert.equal(
    overview.status === "ready" && overview.partnerFirstName,
    "Anna",
  );
  // Onboarding reads the budget's state, and names the partner the same way.
  const state = await alan.api.budget.state({ month });
  assert.equal(state.status === "ready" && state.partnerFirstName, "Anna");
});

void test("a budget made before counterparty accounts gets them once, the first time it loads", async () => {
  const sam = await member("Sam");
  const household = await createHousehold(
    db,
    createBook(sam.userId, "Sam", month),
  );
  workspaceIds.push(household);

  const first = await pullAll(sam);
  assert.equal(first.revision, 2);
  assert.deepEqual(people(first.rows), {
    accounts: ["reimbursements"],
    envelopes: [["Reimbursements", "counterparty:reimbursements"]],
  });
  // Later loads find them there and write nothing.
  const again = await pullAll(sam, first.revision);
  assert.deepEqual([again.revision, again.rows], [first.revision, []]);
});

void test("a budget under maintenance shows maintenance instead of being upgraded", async () => {
  const kim = await member("Kim");
  const book = createBook(kim.userId, "Kim", month);
  const household = await createHousehold(db, book);
  workspaceIds.push(household);
  // A newer release saved an account kind this code doesn't know.
  const account = bookToRows(
    withCounterpartyAccounts(createBook(kim.userId, "Kim", month)),
  ).find((row) => row.table === "account")!;
  const unknown = {
    ...account,
    data: { ...account.data!, kind: "crypto" },
  } as unknown as WireRow;
  await writeChangeSet(db, {
    workspaceId: household,
    baseRevision: 1,
    changeSet: {
      operationId: randomUUID(),
      revision: 0,
      before: [tombstone(unknown)],
      after: [unknown],
    },
    operation: {
      actorId: kim.userId,
      source: "user",
      type: "account.add",
      inputHash: "",
      command: {},
    },
  });

  // The upgrade waits; the budget shows its maintenance message.
  await assert.rejects(() => pullAll(kim), /maintenance/);
});

void test("a legacy budget's first direct command creates its paired envelopes before assigning a float and retries only once", async () => {
  const lee = await member("Lee");
  let book = createBook(lee.userId, "Lee", month);
  book = execute(book, lee.userId, {
    type: "account.add",
    id: randomUUID(),
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  workspaceIds.push(await createHousehold(db, book));
  const command = {
    type: "assign.set" as const,
    id: randomUUID(),
    categoryId: "envelope:reimbursements",
    month,
    amount: 20_000,
  };
  const input = { command, baseRevision: 1, clientId: "direct-client" };

  const first = await lee.api.budget.execute(input);
  assert.equal(first.revision, 3);
  assert.deepEqual(await lee.api.budget.execute(input), {
    ...first,
    rebased: false,
  });
  const state = await lee.api.budget.state({ month });
  assert.equal(state.revision, 3);
  assert.equal(state.view?.readyToAssign, 80_000);
  assert.equal(
    state.view?.categories.find(
      (category) =>
        category.counterpartyAccountId === "counterparty:reimbursements",
    )?.available,
    20_000,
  );
});

void test("a legacy budget's first category import upgrades its accounts without invalidating the request revision", async () => {
  const robin = await member("Robin");
  workspaceIds.push(
    await createHousehold(db, createBook(robin.userId, "Robin", month)),
  );

  const saved = await robin.api.budget.execute({
    clientId: "test",
    baseRevision: 1,
    command: {
      type: "category.import",
      id: randomUUID(),
      categories: [
        { categoryId: "groceries", name: "Groceries", group: "Everyday" },
      ],
    },
  });
  const state = await robin.api.budget.state({ month });
  assert.ok(
    state.view?.accounts.some((account) => account.kind === "reimbursements"),
  );
  assert.ok(
    state.view?.categories.some((category) => category.id === "groceries"),
  );
  assert.equal(saved.revision, 3);
  assert.equal(state.revision, 3);
});

void test("a future command revision is still refused when it happens to equal the upgrade's revision", async () => {
  const quinn = await member("Quinn");
  workspaceIds.push(
    await createHousehold(db, createBook(quinn.userId, "Quinn", month)),
  );

  await assert.rejects(
    quinn.api.budget.execute({
      clientId: "future-client",
      baseRevision: 2,
      command: {
        type: "income.expect",
        id: randomUUID(),
        month,
        amount: 50_000,
      },
    }),
    { code: "CONFLICT" },
  );
  assert.equal((await quinn.api.budget.state({ month })).revision, 2);
});

void test("a legacy budget can add its first bank account before pulling and retry setup after the system upgrade", async () => {
  const dana = await member("Dana");
  const today = bankSetupDate("America/Los_Angeles");
  const bankMonth = today.slice(0, 7);
  workspaceIds.push(
    await createHousehold(db, createBook(dana.userId, "Dana", bankMonth)),
  );
  const connectionId = randomUUID();
  await createBankConnection(db, {
    data: {
      id: connectionId,
      clerkUserId: dana.userId,
      itemId: `counterparty-bank-${connectionId}`,
      encryptedToken: "fixture-no-provider-token",
      accountMappings: {},
      lastSyncedAt: new Date(),
      imports: {
        accounts: [
          {
            accountId: "cash",
            name: "Cash",
            officialName: null,
            mask: "1234",
            type: "depository",
            subtype: "checking",
            currentBalance: 1000,
            availableBalance: 1000,
            currency: "USD",
          },
        ],
        transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
        synchronizedAccountIds: ["cash"],
      },
    },
  });
  const input = {
    connectionId,
    operationId: randomUUID(),
    expectedRevision: 1,
    accounts: [
      { providerAccountId: "cash", name: "Checking", expectedBalance: 1000 },
    ],
  };

  const saved = await dana.api.budget.setupBankAccounts(input);
  assert.equal(saved.revision, 3);
  assert.deepEqual(await dana.api.budget.setupBankAccounts(input), saved);
  const state = await dana.api.budget.state({ month: bankMonth });
  assert.equal(state.revision, 3);
  assert.equal(state.view?.readyToAssign, 100_000);
  assert.ok(
    state.view?.categories.some(
      (category) =>
        category.counterpartyAccountId === "counterparty:reimbursements",
    ),
  );
});

void test("a legacy budget's first bank import keeps its original revision and records the purchase once", async () => {
  const remy = await member("Remy");
  let book = createBook(remy.userId, "Remy", month);
  book = execute(book, remy.userId, {
    type: "account.add",
    id: randomUUID(),
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
    date: "2026-10-01",
  });
  book = execute(book, remy.userId, {
    type: "category.add",
    id: randomUUID(),
    categoryId: "food",
    name: "Food",
  });
  workspaceIds.push(await createHousehold(db, book));
  const connectionId = randomUUID();
  const records = applyTransactionSync(
    [],
    {
      added: [
        normalizePlaidTransaction({
          transaction_id: "market",
          account_id: "cash",
          pending: false,
          amount: 15,
          iso_currency_code: "USD",
          date: "2026-10-10",
          name: "Market",
        }),
      ],
      modified: [],
      removed: [],
    },
    connectionId,
  ).records;
  await createBankConnection(db, {
    data: {
      id: connectionId,
      clerkUserId: remy.userId,
      itemId: `counterparty-import-${connectionId}`,
      encryptedToken: "fixture-no-provider-token",
      accountMappings: {
        cash: { accountId: "checking", startDate: "2026-10-02" },
      },
      imports: jsonValue({ records }),
    },
  });
  const input = {
    connectionId,
    logicalId: records[0]!.id,
    expectedRevision: 2,
    ignore: false,
    command: {
      type: "transaction.upsert" as const,
      id: randomUUID(),
      transactionId: "market",
      accountId: "checking",
      categoryId: "food",
      date: "2026-10-10",
      amount: -1500,
      payee: "Market",
    },
  };

  const saved = await remy.api.budget.resolveImport(input);
  assert.equal(saved.revision, 4);
  assert.deepEqual(await remy.api.budget.resolveImport(input), saved);
  const state = await remy.api.budget.state({ month });
  assert.equal(state.revision, 4);
  assert.equal(state.view?.budget.transactions.length, 1);
  assert.equal(state.view?.personalSpending, 1500);
  assert.ok(
    state.view?.accounts.some((account) => account.kind === "reimbursements"),
  );
});

void test("a legacy budget can undo its previous user change before pulling without undoing the system accounts", async () => {
  const noa = await member("Noa");
  const book = createBook(noa.userId, "Noa", month);
  const workspaceId = await createHousehold(db, book);
  workspaceIds.push(workspaceId);
  const command = {
    type: "category.add" as const,
    id: randomUUID(),
    categoryId: "old-category",
    name: "Old category",
  };
  const legacy = executeWithChanges(book, noa.userId, command);
  await writeChangeSet(db, {
    workspaceId,
    baseRevision: 1,
    changeSet: legacy.changeSet,
    operation: {
      actorId: noa.userId,
      source: "user",
      type: command.type,
      inputHash: "legacy-fixture",
      command,
    },
  });
  const input = {
    clientId: "test",
    baseRevision: 2,
    command: {
      type: "revert" as const,
      id: randomUUID(),
      targetOperationId: command.id,
    },
  };

  const saved = await noa.api.budget.execute(input);
  assert.equal(saved.revision, 4);
  assert.deepEqual(await noa.api.budget.execute(input), {
    ...saved,
    rebased: false,
  });
  const state = await noa.api.budget.state({ month });
  assert.equal(
    state.view?.categories.some((category) => category.id === "old-category"),
    false,
  );
  assert.ok(
    state.view?.accounts.some((account) => account.kind === "reimbursements"),
  );
});
