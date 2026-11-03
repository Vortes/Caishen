import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import nextEnv from "@next/env";
import {
  addMember,
  createBook,
  execute,
  executeWithChanges,
} from "../../src/domain/engine";
import { withPeople } from "../../src/domain/people";
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
import {
  asLegacyReimbursements,
  envelopeOf,
  personId,
  withPerson,
} from "../domain/fixtures/people";

// Every counterparty is a person with an account and paired envelope: added
// one at a time, the partner's linked person from joining, and, for budgets
// stored with a Reimbursements account, converted the first time a browser
// loads the budget.
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

// The people and paired envelopes among a member's rows.
function people(rows: WireRow[]) {
  const data = (row: WireRow) => row.data as Record<string, unknown>;
  return {
    accounts: rows
      .filter(
        (row) =>
          row.table === "account" &&
          ["person", "partner", "reimbursements"].includes(
            String(data(row).kind),
          ),
      )
      .map((row) =>
        [data(row).kind, data(row).name, data(row).linkedUserId ?? null].join(
          " ",
        ),
      )
      .sort(),
    envelopes: rows
      .filter(
        (row) => row.table === "category" && data(row).counterpartyAccountId,
      )
      .map((row) => [data(row).name, data(row).counterpartyAccountId])
      .sort(),
  };
}

// The id of the account linked to a member, among a budget's rows.
const linkedAccountId = (rows: WireRow[], userId: string) => {
  const row = rows.find(
    (row) => row.table === "account" && row.data?.linkedUserId === userId,
  );
  return row?.table === "account" ? row.data?.id : undefined;
};

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

// A legacy budget: a checking account and the empty Reimbursements account
// and envelope every budget was given before people.
function legacyBook(userId: string, name: string, startMonth = month) {
  return asLegacyReimbursements(createBook(userId, name, startMonth), userId);
}

void test("a new budget starts with nobody", async () => {
  const alan = await member("Alan");
  await onboard(alan, "Alan");

  assert.deepEqual(people((await pullAll(alan)).rows), {
    accounts: [],
    envelopes: [],
  });
});

void test("joining a partner gives each budget the person linked to the other and their envelope", async () => {
  const alan = await member("Host");
  const anna = await member("Guest");
  await onboard(alan, "Alan");
  await onboard(anna, "Anna");

  await anna.api.budget.joinInvitation({
    id: await invitationFrom(db, alan.userId),
  });

  for (const [who, other] of [
    [alan, anna.userId],
    [anna, alan.userId],
  ] as const) {
    const { rows } = await pullAll(who);
    assert.deepEqual(people(rows), {
      accounts: [`person Partner ${other}`],
      envelopes: [["Partner", linkedAccountId(rows, other)]],
    });
  }
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

void test("a budget stored with a Reimbursements account gets a person for each name once, the first time it loads", async () => {
  const sam = await member("Sam");
  let book = withPerson(
    createBook(sam.userId, "Sam", month),
    sam.userId,
    "Mom",
  );
  book = execute(book, sam.userId, {
    type: "account.add",
    id: randomUUID(),
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  book = execute(book, sam.userId, {
    type: "transaction.upsert",
    id: randomUUID(),
    transactionId: "lunch",
    accountId: "checking",
    date: "2026-10-05",
    amount: -2_000,
    payee: "Lunch",
    counterpartyShare: { accountId: personId("Mom"), amount: 2_000 },
    recordedAt: "2026-10-05T12:00:00Z",
  });
  const household = await createHousehold(
    db,
    asLegacyReimbursements(book, sam.userId),
  );
  workspaceIds.push(household);

  const first = await pullAll(sam);
  assert.equal(first.revision, 2);
  assert.deepEqual(people(first.rows), {
    accounts: ["person Mom "],
    envelopes: [["Mom", personId("Mom")]],
  });
  const state = await sam.api.budget.state({ month });
  assert.equal(
    state.view?.accounts.find((account) => account.id === personId("Mom"))
      ?.balance,
    2_000,
  );
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
  const account = bookToRows(legacyBook(kim.userId, "Kim")).find(
    (row) => row.table === "account",
  )!;
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

void test("a legacy budget's first direct command creates its people's envelopes before assigning a float and retries only once", async () => {
  const lee = await member("Lee");
  let book = withPerson(
    createBook(lee.userId, "Lee", month),
    lee.userId,
    "Mom",
  );
  book = execute(book, lee.userId, {
    type: "account.add",
    id: randomUUID(),
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  book = execute(book, lee.userId, {
    type: "transaction.upsert",
    id: randomUUID(),
    transactionId: "lunch",
    accountId: "checking",
    date: "2026-10-05",
    amount: -2_000,
    payee: "Lunch",
    counterpartyShare: { accountId: personId("Mom"), amount: 2_000 },
    recordedAt: "2026-10-05T12:00:00Z",
  });
  workspaceIds.push(
    await createHousehold(db, asLegacyReimbursements(book, lee.userId)),
  );
  const command = {
    type: "assign.set" as const,
    id: randomUUID(),
    categoryId: envelopeOf("Mom"),
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
      (category) => category.counterpartyAccountId === personId("Mom"),
    )?.available,
    18_000,
  );
});

void test("a legacy budget's first category import upgrades its accounts without invalidating the request revision", async () => {
  const robin = await member("Robin");
  workspaceIds.push(
    await createHousehold(db, legacyBook(robin.userId, "Robin")),
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
    !state.view?.accounts.some((account) => account.kind === "reimbursements"),
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
    await createHousehold(db, legacyBook(quinn.userId, "Quinn")),
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
    await createHousehold(db, legacyBook(dana.userId, "Dana", bankMonth)),
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
    !state.view?.categories.some(
      (category) =>
        category.counterpartyAccountId === "counterparty:reimbursements",
    ),
  );
});

void test("a legacy budget's first bank import keeps its original revision and records the purchase once", async () => {
  const remy = await member("Remy");
  let book = legacyBook(remy.userId, "Remy");
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
    !state.view?.accounts.some((account) => account.kind === "reimbursements"),
  );
});

// Converting a legacy budget removes its Reimbursements envelope, which
// renumbers the categories after it, so this change is one that converting
// leaves alone.
void test("a legacy budget can undo its previous user change before pulling without undoing the system accounts", async () => {
  const noa = await member("Noa");
  const book = legacyBook(noa.userId, "Noa");
  const workspaceId = await createHousehold(db, book);
  workspaceIds.push(workspaceId);
  const command = {
    type: "income.expect" as const,
    id: randomUUID(),
    month,
    amount: 50_000,
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
  assert.equal(state.view?.budget.expectedIncome[month], undefined);
  assert.ok(
    !state.view?.accounts.some((account) => account.kind === "reimbursements"),
  );
});

void test("a budget whose Reimbursements entries can't be converted shows maintenance and stays as it was stored", async () => {
  const ari = await member("Ari");
  let book = withPerson(
    createBook(ari.userId, "Ari", month),
    ari.userId,
    "Mom",
  );
  book = execute(book, ari.userId, {
    type: "account.add",
    id: randomUUID(),
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  for (const [transactionId, day] of [
    ["lunch", "05"],
    ["dinner", "06"],
  ] as const)
    book = execute(book, ari.userId, {
      type: "transaction.upsert",
      id: randomUUID(),
      transactionId,
      accountId: "checking",
      date: `2026-10-${day}`,
      amount: -2_000,
      payee: "Lunch",
      counterpartyShare: { accountId: personId("Mom"), amount: 2_000 },
      recordedAt: `2026-10-${day}T12:00:00Z`,
    });
  const legacy = asLegacyReimbursements(book, ari.userId);
  // One entry spells Mom another way, so which person it names is unclear.
  legacy.budgets[ari.userId]!.transactions.find(
    (transaction) => transaction.id === "dinner",
  )!.counterpartyShare!.counterpartyName = "mom";
  workspaceIds.push(await createHousehold(db, legacy));

  await assert.rejects(() => pullAll(ari), /maintenance/);
  const state = await ari.api.budget.state({ month });
  assert.deepEqual([state.status, state.revision], ["maintenance", 1]);
  await assert.rejects(() => pullAll(ari), /maintenance/);
});

void test("a partner budget whose linked person is linked to its own member shows maintenance instead of being relinked", async () => {
  const host = await member("SelfHost");
  const guest = await member("SelfGuest");
  const book = withPeople(
    addMember(
      createBook(host.userId, "Host", month),
      guest.userId,
      "Guest",
      month,
    ),
  );
  const budget = book.budgets[guest.userId]!;
  budget.accounts = budget.accounts.map((account) =>
    account.linkedUserId ? { ...account, linkedUserId: guest.userId } : account,
  );
  workspaceIds.push(await createHousehold(db, book));

  for (const who of [host, guest])
    await assert.rejects(() => pullAll(who), /maintenance/);
});

void test("a linked person missing their paired envelope gets it back on load, once", async () => {
  const host = await member("EnvelopeHost");
  const guest = await member("EnvelopeGuest");
  const book = withPeople(
    addMember(
      createBook(host.userId, "Host", month),
      guest.userId,
      "Guest",
      month,
    ),
  );
  const budget = book.budgets[guest.userId]!;
  budget.categories = budget.categories.filter(
    (category) => !category.counterpartyAccountId,
  );
  workspaceIds.push(await createHousehold(db, book));

  const first = await pullAll(guest);
  assert.deepEqual(people(first.rows), {
    accounts: [`person Partner ${host.userId}`],
    envelopes: [["Partner", linkedAccountId(first.rows, host.userId)]],
  });
  const again = await pullAll(guest, first.revision);
  assert.deepEqual([again.revision, again.rows], [first.revision, []]);
});

void test("undo cannot restore the legacy account format after the people upgrade", async () => {
  const sam = await member("UpgradeUndo");
  workspaceIds.push(await createHousehold(db, legacyBook(sam.userId, "Sam")));
  const first = await pullAll(sam, 1);
  assert.equal(first.confirmedOperationIds?.length, 1);

  await assert.rejects(
    () =>
      sam.api.budget.execute({
        clientId: "test",
        baseRevision: first.revision,
        command: {
          type: "revert",
          id: randomUUID(),
          targetOperationId: first.confirmedOperationIds[0]!,
        },
      }),
    /budget upgrade can't be undone/,
  );
  const again = await pullAll(sam, first.revision);
  assert.deepEqual([again.revision, again.rows], [first.revision, []]);
});

void test("joining converts a legacy host budget even before the host's next pull", async () => {
  const host = await member("LegacyHost");
  const guest = await member("LegacyGuest");
  workspaceIds.push(await createHousehold(db, legacyBook(host.userId, "Host")));
  await onboard(guest, "Guest");

  await guest.api.budget.joinInvitation({
    id: await invitationFrom(db, host.userId),
  });

  for (const [who, other] of [
    [host, guest.userId],
    [guest, host.userId],
  ] as const) {
    const loaded = await pullAll(who);
    assert.deepEqual(people(loaded.rows), {
      accounts: [`person Partner ${other}`],
      envelopes: [["Partner", linkedAccountId(loaded.rows, other)]],
    });
  }
});
