import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import nextEnv from "@next/env";
import type { Command } from "../../src/domain/engine";
import type { WireRow } from "../../src/domain/rows";
import { PrismaClient } from "../../src/generated/prisma";
import {
  createDatabaseCaller as createCaller,
  databaseClientBuild,
} from "./fixtures";
import { ObservedRevision } from "../../src/server/api/trpc";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";

// Split transactions saved through budget.execute and read back the way a
// browser reads them, through sync.pull.
nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
const userId = `test-split-${randomUUID()}`;
const month = "2026-10";
const api = createCaller({
  db,
  userId,
  headers: new Headers(),
  revision: new ObservedRevision(),
});

test.after(async () => {
  const memberships = await db.workspaceMember.findMany({
    where: { clerkUserId: userId },
  });
  await db.workspace.deleteMany({
    where: { id: { in: memberships.map((member) => member.workspaceId) } },
  });
  await db.user.deleteMany({ where: { clerkUserId: userId } });
  await db.$disconnect();
});

async function linesFrom(since: number | null) {
  const rows: WireRow[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.sync.pull({
      since,
      cursor,
      clientBuild: databaseClientBuild,
    });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  return rows
    .filter((row) => row.table === "transactionLine")
    .map((row) => [row.id, row.deleted, row.data]);
}

void test("a split saved through budget.execute pulls back line by line, and undoing its removal restores the lines", async () => {
  let { revision } = await api.budget.onboard({
    name: "Alan",
    month,
    timezone: "America/Los_Angeles",
  });
  const execute = async (command: Command) =>
    ({ revision } = await api.budget.execute({
      clientId: "test",
      baseRevision: revision,
      command,
    }));
  await execute({
    type: "account.add",
    id: randomUUID(),
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
    date: `${month}-01`,
  });
  for (const [categoryId, name] of [
    ["groceries", "Groceries"],
    ["household", "Household"],
  ] as const)
    await execute({ type: "category.add", id: randomUUID(), categoryId, name });
  await execute({
    type: "transaction.upsert",
    id: randomUUID(),
    transactionId: "costco",
    accountId: "checking",
    date: `${month}-10`,
    amount: -20_000,
    payee: "Costco",
    lines: [
      { lineId: "food", categoryId: "groceries", amount: -15_000 },
      { lineId: "paper", categoryId: "household", amount: -5_000 },
    ],
  });
  const line = (
    id: string,
    categoryId: string,
    amount: number,
    sort: number,
  ) => ({ userId, transactionId: "costco", id, categoryId, amount, sort });
  assert.deepStrictEqual(await linesFrom(null), [
    [`${userId}/costco/food`, false, line("food", "groceries", -15_000, 0)],
    [`${userId}/costco/paper`, false, line("paper", "household", -5_000, 1)],
  ]);

  const split = revision;
  await execute({
    type: "transaction.categorize",
    id: randomUUID(),
    transactionId: "costco",
    categoryId: "groceries",
  });
  assert.deepStrictEqual(await linesFrom(split), [
    [`${userId}/costco/food`, true, null],
    [`${userId}/costco/paper`, true, null],
  ]);

  const { revision: undone } = await api.budget.changeHistory({
    direction: "undo",
    expectedRevision: revision,
    operationId: randomUUID(),
  });
  assert.deepStrictEqual(await linesFrom(revision), [
    [`${userId}/costco/food`, false, line("food", "groceries", -15_000, 0)],
    [`${userId}/costco/paper`, false, line("paper", "household", -5_000, 1)],
  ]);
  const view = (await api.budget.state({ month })).view!;
  assert.equal(undone, revision + 1);
  assert.equal(
    view.categories.find((item) => item.id === "household")!.activity,
    -5_000,
  );
});
