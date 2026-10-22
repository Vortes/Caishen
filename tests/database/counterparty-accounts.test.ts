import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import nextEnv from "@next/env";
import { createBook, withCounterpartyAccounts } from "../../src/domain/engine";
import { bookToRows, tombstone, type WireRow } from "../../src/domain/rows";
import { PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";
import { ObservedRevision } from "../../src/server/api/trpc";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { writeChangeSet } from "../../src/server/storage/rows";
import { createHousehold } from "./fixtures";

// Every budget holds its counterparty accounts and their paired envelopes:
// from creation, from joining a partner, and, for budgets made before they
// existed, from the first time a browser loads the budget.
nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
const run = randomUUID();
const month = "2026-10";
const build = "2:test";
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

  const { code } = await alan.api.budget.invite();
  await anna.api.budget.join({ code });

  for (const who of [alan, anna])
    assert.deepEqual(people((await pullAll(who)).rows), {
      accounts: ["partner", "reimbursements"],
      envelopes: [
        ["Partner", "counterparty:partner"],
        ["Reimbursements", "counterparty:reimbursements"],
      ],
    });
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
  } as WireRow;
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
