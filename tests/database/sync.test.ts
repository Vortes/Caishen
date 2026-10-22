import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import nextEnv from "@next/env";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import type { LedgerCommand } from "../../src/domain/engine";
import { rowKey, rowVisibleTo, type WireRow } from "../../src/domain/rows";
import { PrismaClient } from "../../src/generated/prisma";
import { formatTRPCError } from "../../src/server/api/error-formatter";
import { createCaller } from "../../src/server/api/root";
import { ObservedRevision } from "../../src/server/api/trpc";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { executeWithChanges } from "../../src/domain/engine";
import {
  HouseholdCache,
  householdLedger,
  households,
  writeOperation,
} from "../../src/server/storage/households";
import { pull } from "../../src/server/services/pull";
import type { Database } from "../../src/server/services/household";
import {
  findOperation,
  pruneOperations,
  readHouseholdRevision,
} from "../../src/server/storage/rows";

// The sync contract (ADR 0006) as browsers use it: budget.execute and
// sync.pull, with the revision every response reports.
nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
const run = randomUUID();
const alexId = `test-sync-alex-${run}`;
const jordanId = `test-sync-jordan-${run}`;
const users = [alexId, jordanId];
const month = "2026-10";
const build = "1:test";

function caller(userId: string) {
  const revision = new ObservedRevision();
  return {
    api: createCaller({ db, userId, headers: new Headers(), revision }),
    revision,
  };
}
const alex = caller(alexId);
const jordan = caller(jordanId);

const refusalOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof TRPCError, String(error));
    const shape = formatTRPCError({
      error,
      shape: {
        message: error.message,
        code: -32600,
        data: {
          code: error.code,
          httpStatus: getHTTPStatusCodeFromError(error),
        },
      },
    });
    return (shape.data as { caishen?: { kind: string; revision?: number } })
      .caishen;
  }
  assert.fail("expected a refusal");
};

// Every page of a pull, as the browser's sync controller reads them.
async function pullAll(
  api: ReturnType<typeof caller>["api"],
  since: number | null,
) {
  const rows: WireRow[] = [];
  let first;
  let cursor: string | undefined;
  do {
    const page = await api.sync.pull({ since, cursor, clientBuild: build });
    if (first) assert.equal(page.revision, first.revision);
    first ??= page;
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  return { ...first, rows };
}

const execute = (
  who: ReturnType<typeof caller>,
  command: LedgerCommand,
  baseRevision: number,
) => who.api.budget.execute({ command, baseRevision, clientId: "test-tab" });

test.before(async () => {
  for (const [who, name] of [
    [alex, "Alex"],
    [jordan, "Jordan"],
  ] as const)
    await who.api.budget.onboard({
      name,
      month,
      timezone: "America/Los_Angeles",
    });
});

test.after(async () => {
  const memberships = await db.workspaceMember.findMany({
    where: { clerkUserId: { in: users } },
  });
  await db.workspace.deleteMany({
    where: {
      OR: [
        { id: { in: memberships.map((member) => member.workspaceId) } },
        { budgetMembers: { some: { userId: { in: users } } } },
      ],
    },
  });
  await db.user.deleteMany({ where: { clerkUserId: { in: users } } });
  await db.$disconnect();
});

void test("a browser downloads its rows once, then only what changed, deleted rows included, and the revision comes with every answer", async () => {
  const start = await pullAll(alex.api, null);
  assert.equal(start.reset, false);
  assert.deepEqual(start.confirmedOperationIds, []);
  assert.ok(start.rows.some((row) => row.table === "budgetSettings"));
  assert.ok(start.rows.every((row) => !row.deleted));
  assert.equal(alex.revision.value, start.revision);

  const added = await execute(
    alex,
    { type: "income.expect", id: randomUUID(), month, amount: 50_000 },
    start.revision,
  );
  assert.equal(added.revision, start.revision + 1);
  assert.equal(added.rebased, false);
  assert.deepEqual(
    added.changeSet?.after.map((row) => [row.table, row.revision]),
    [["expectedIncome", added.revision]],
  );
  const cleared = await execute(
    alex,
    { type: "income.expect", id: randomUUID(), month, amount: null },
    added.revision,
  );
  assert.equal(alex.revision.value, cleared.revision);

  const delta = await pullAll(alex.api, start.revision);
  assert.equal(delta.revision, cleared.revision);
  assert.deepEqual(
    delta.rows.map((row) => [row.table, row.deleted, row.revision]),
    [["expectedIncome", true, cleared.revision]],
  );
  assert.deepEqual(delta.confirmedOperationIds, [
    added.changeSet.operationId,
    cleared.changeSet!.operationId,
  ]);
  // Nothing changed since: an empty pull.
  const none = await pullAll(alex.api, cleared.revision);
  assert.deepEqual([none.rows, none.reset], [[], false]);
  // A browser too old for this server is told to reload.
  assert.equal(
    (await refusalOf(alex.api.sync.pull({ since: null, clientBuild: "0:old" })))
      ?.kind,
    "staleClient",
  );
});

void test("a retried operation answers with its first result, even after its change set is forgotten", async () => {
  const { revision } = await pullAll(alex.api, null);
  const command: LedgerCommand = {
    type: "category.add",
    id: randomUUID(),
    categoryId: "retried",
    name: "Retried",
  };
  const first = await execute(alex, command, revision);
  // The browser never heard back and sends it again, from the old revision.
  assert.deepEqual(await execute(alex, command, revision), first);
  const { workspaceId } = (await readHouseholdRevision(db, alexId))!;
  const saved = await findOperation(db, workspaceId, command.id);
  await pruneOperations(
    db,
    new Date(saved!.createdAt.getTime() + 1),
    workspaceId,
  );
  assert.deepEqual(await execute(alex, command, revision), {
    revision: first.revision,
    changeSet: null,
    rebased: false,
  });
  // The same id with other details is refused.
  assert.equal(
    (
      await refusalOf(
        execute(alex, { ...command, name: "Something else" }, revision),
      )
    )?.kind,
    "rejected",
  );
  // So is a command the engine refuses, with the household's revision.
  const rejected = await refusalOf(
    execute(
      alex,
      {
        type: "category.add",
        id: randomUUID(),
        categoryId: "retried",
        name: "Again",
      },
      first.revision,
    ),
  );
  assert.deepEqual(rejected, {
    kind: "rejected",
    revision: first.revision,
    message: "Category ID already exists",
  });
});

void test("joining resets every browser, and partners see only their own rows of a shared change", async () => {
  const before = await pullAll(jordan.api, null);
  const { code } = await alex.api.budget.invite();
  const joined = await jordan.api.budget.join({ code });
  assert.equal(joined.changeSet, null);
  // Jordan's browser holds a revision of the budget Jordan left.
  const reset = await pullAll(jordan.api, before.revision);
  assert.equal(reset.reset, true);
  assert.equal(reset.revision, joined.revision);
  assert.ok(reset.rows.every((row) => rowVisibleTo(row, jordanId)));
  assert.ok(
    reset.rows.some(
      (row) => row.table === "member" && row.id === rowKey(alexId),
    ),
  );
  // Alex's browser started over too: the household changed shape.
  assert.equal((await pullAll(alex.api, joined.revision - 1)).reset, true);

  let revision = joined.revision;
  for (const [who, userId] of [
    [alex, alexId],
    [jordan, jordanId],
  ] as const)
    ({ revision } = await execute(
      who,
      {
        type: "category.add",
        id: randomUUID(),
        categoryId: "food",
        name: `${userId} food`,
      },
      revision,
    ));
  const shared = await execute(
    alex,
    {
      type: "shared.create",
      id: randomUUID(),
      sharedCategoryId: "food",
      participants: [alexId, jordanId],
      weights: { [alexId]: 1, [jordanId]: 1 },
      categoryIds: { [alexId]: "food", [jordanId]: "food" },
    },
    revision,
  );
  // The shared category is everyone's; Jordan's category row is Jordan's.
  assert.ok(
    shared.changeSet!.after.some((row) => row.table === "sharedCategory"),
  );
  assert.ok(shared.changeSet!.after.every((row) => rowVisibleTo(row, alexId)));
  const jordanSees = await pullAll(jordan.api, revision);
  assert.ok(jordanSees.rows.some((row) => row.table === "sharedCategory"));
  assert.ok(jordanSees.rows.every((row) => rowVisibleTo(row, jordanId)));
  assert.deepEqual(jordanSees.confirmedOperationIds, []);

  // Alex's shared purchase reaches Jordan as a partner fact, never as
  // Alex's transaction.
  await execute(
    alex,
    {
      type: "account.add",
      id: randomUUID(),
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      openingBalance: 100_000,
      date: `${month}-01`,
    },
    shared.revision,
  );
  const latest = (await readHouseholdRevision(db, alexId))!.revision;
  const purchase = await execute(
    alex,
    {
      type: "transaction.upsert",
      id: randomUUID(),
      transactionId: "groceries",
      accountId: "checking",
      date: `${month}-03`,
      amount: -4_000,
      payee: "Market",
      categoryId: "food",
      sharedCategoryId: "food",
    },
    latest,
  );
  const facts = await pullAll(jordan.api, shared.revision);
  assert.ok(
    facts.rows.some(
      (row) =>
        row.table === "partnerFact" &&
        row.id === rowKey(jordanId, "purchase", alexId, "groceries"),
    ),
  );
  assert.ok(!facts.rows.some((row) => row.table === "transaction"));
  assert.ok(
    purchase.changeSet!.after.every((row) => rowVisibleTo(row, alexId)),
    "Alex's answer leaves out the fact derived for Jordan",
  );
});

void test("a command made against an older revision runs again when it changes only the actor's budget, and is a conflict otherwise", async () => {
  const base = (await readHouseholdRevision(db, alexId))!.revision;
  // Jordan changes something first.
  await execute(
    jordan,
    { type: "income.expect", id: randomUUID(), month, amount: 1_000 },
    base,
  );
  const own = await execute(
    alex,
    { type: "income.expect", id: randomUUID(), month, amount: 2_000 },
    base,
  );
  assert.equal(own.rebased, true);
  assert.equal(own.revision, base + 2);
  const conflict = await refusalOf(
    execute(
      alex,
      {
        type: "shared.rule",
        id: randomUUID(),
        sharedCategoryId: "food",
        weights: { [alexId]: 2, [jordanId]: 1 },
      },
      base,
    ),
  );
  assert.deepEqual(conflict && { ...conflict, message: undefined }, {
    kind: "conflict",
    revision: own.revision,
    message: undefined,
  });
});

void test("undo restores what an operation changed, in any order, and is refused once a partner changed it again", async () => {
  let revision = (await readHouseholdRevision(db, alexId))!.revision;
  const first = await execute(
    alex,
    { type: "income.expect", id: randomUUID(), month: "2026-11", amount: 100 },
    revision,
  );
  const second = await execute(
    alex,
    { type: "income.expect", id: randomUUID(), month: "2026-11", amount: 200 },
    first.revision,
  );
  const undo = (target: string, base: number) =>
    execute(
      alex,
      { type: "revert", id: randomUUID(), targetOperationId: target },
      base,
    );
  const undoSecond = await undo(second.changeSet!.operationId, second.revision);
  const undoFirst = await undo(
    first.changeSet!.operationId,
    undoSecond.revision,
  );
  assert.deepEqual(
    undoFirst.changeSet!.after.map((row) => [row.table, row.deleted]),
    [["expectedIncome", true]],
  );
  revision = undoFirst.revision;

  // A partner's later change to a shared row blocks undoing Alex's.
  const rule = await execute(
    alex,
    {
      type: "shared.rule",
      id: randomUUID(),
      sharedCategoryId: "food",
      weights: { [alexId]: 3, [jordanId]: 1 },
    },
    revision,
  );
  const partner = await execute(
    jordan,
    {
      type: "shared.rule",
      id: randomUUID(),
      sharedCategoryId: "food",
      weights: { [alexId]: 1, [jordanId]: 3 },
    },
    rule.revision,
  );
  assert.deepEqual(
    await refusalOf(undo(rule.changeSet!.operationId, partner.revision)),
    {
      kind: "revertRefused",
      revision: partner.revision,
      message: "This changed again since, so it can't be undone",
    },
  );
  // Only the operation's own member can undo it.
  assert.equal(
    (
      await refusalOf(
        execute(
          jordan,
          {
            type: "revert",
            id: randomUUID(),
            targetOperationId: rule.changeSet!.operationId,
          },
          partner.revision,
        ),
      )
    )?.kind,
    "revertRefused",
  );
});

void test("a server instance holding an old copy of the household answers from the latest rows and writes on them", async () => {
  // This process holds the household as of now.
  const held = (await households.load(db, alexId))!;
  // Another server instance writes for Jordan.
  const other = new HouseholdCache();
  const elsewhere = (await other.load(db, jordanId))!;
  const ledger = householdLedger(elsewhere, jordanId);
  if (ledger.status !== "ready") assert.fail("Jordan's plan reads");
  const command = {
    type: "income.expect" as const,
    id: randomUUID(),
    month: "2026-12",
    amount: 7,
  };
  const written = await writeOperation(
    db,
    elsewhere,
    {
      changeSet: executeWithChanges(ledger.state, jordanId, command).changeSet,
      operation: {
        actorId: jordanId,
        source: "user",
        type: command.type,
        inputHash: randomUUID(),
        command,
      },
    },
    other,
  );
  assert.equal(written.revision, held.revision + 1);
  // This process answers with the change, and its own write lands after it.
  assert.equal(
    (await alex.api.budget.state({ month })).revision,
    written.revision,
  );
  const mine = await execute(
    alex,
    { type: "income.expect", id: randomUUID(), month: "2026-12", amount: 9 },
    held.revision,
  );
  assert.equal(mine.revision, written.revision + 1);
  assert.equal(mine.rebased, true);
});

void test("someone without a budget is told so", async () => {
  const stranger = caller(`test-sync-stranger-${run}`);
  users.push(`test-sync-stranger-${run}`);
  assert.equal(
    (
      await refusalOf(
        stranger.api.sync.pull({ since: null, clientBuild: build }),
      )
    )?.kind,
    "noBudget",
  );
});

void test("a pull reads one revision even when a change commits while it reads", async () => {
  const before = await pullAll(alex.api, null);
  // Alex renames the budget just after the pull read the household's
  // revision, before it reads the rows.
  let renamed: Promise<unknown> | undefined;
  const racing = (client: Database): Database =>
    new Proxy(client, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (property === "workspaceMember")
          return new Proxy(value as object, {
            get(members, method, membersReceiver) {
              const original: unknown = Reflect.get(
                members,
                method,
                membersReceiver,
              );
              if (method !== "findUnique" || typeof original !== "function")
                return original;
              return async (...args: unknown[]) => {
                const found: unknown = await original.apply(members, args);
                renamed ??= execute(
                  alex,
                  {
                    type: "settings.update",
                    id: randomUUID(),
                    name: "Renamed",
                  },
                  before.revision,
                );
                await renamed;
                return found;
              };
            },
          });
        if (property === "$transaction" && typeof value === "function")
          return (callback: unknown, ...rest: unknown[]) =>
            typeof callback === "function"
              ? (value as (...a: unknown[]) => unknown).call(
                  target,
                  (tx: Database) =>
                    (callback as (tx: Database) => unknown)(racing(tx)),
                  ...rest,
                )
              : (value as (...a: unknown[]) => unknown).call(
                  target,
                  callback,
                  ...rest,
                );
        return value;
      },
    });
  const page = await pull(racing(db), alexId, {
    since: null,
    clientBuild: build,
  });
  assert.ok(renamed, "the change ran during the pull");
  assert.equal(page.revision, before.revision);
  assert.equal(page.nextCursor, undefined);
  // Every row as it stood at that revision: none changed by the rename is
  // missing, and the rename comes with the next pull.
  const keys = (rows: WireRow[]) =>
    rows.map((row) => `${row.table} ${row.id} ${row.revision}`).sort();
  assert.deepEqual(keys(page.rows), keys(before.rows));
  const after = await pullAll(alex.api, page.revision);
  assert.ok(after.rows.length > 0);
  assert.ok(after.rows.every((row) => row.revision === page.revision + 1));
});
