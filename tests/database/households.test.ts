import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import nextEnv from "@next/env";
import { rowsIn } from "../../src/domain/change-sets";
import {
  addMember,
  createBook,
  execute,
  executeWithChanges,
  type Book,
  type Command,
} from "../../src/domain/engine";
import {
  bookToRows,
  rowKey,
  rowsToBook,
  rowVisibleTo,
  type ChangeSet,
  type WireRow,
} from "../../src/domain/rows";
import { PrismaClient } from "../../src/generated/prisma";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { operationHash } from "../../src/server/services/safety";
import {
  HouseholdCache,
  householdLedger,
  writeOperation,
  type Household,
} from "../../src/server/storage/households";
import {
  loadHouseholdRows,
  loadRows,
  pullRows,
  replaceRows,
  resetHouseholdRows,
  RevisionConflictError,
  writeChangeSet,
  type PullPosition,
} from "../../src/server/storage/rows";

nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
const run = randomUUID();
const alex = `test-households-alex-${run}`;
const jordan = `test-households-jordan-${run}`;
const workspaceIds: string[] = [];

const key = (row: Pick<WireRow, "table" | "id">) => `${row.table} ${row.id}`;
const sorted = (rows: WireRow[]) =>
  [...rows].sort((a, b) => key(a).localeCompare(key(b)));
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

// Alex and Jordan's household: accounts, categories, a shared category,
// and some spending on it.
function startingBook(): Book {
  let book = addMember(
    createBook(alex, "Alex", "2026-09"),
    jordan,
    "Jordan",
    "2026-09",
  );
  let sequence = 0;
  const run = (actorId: string, command: WithoutId<Command>) => {
    book = execute(book, actorId, { ...command, id: `setup-${++sequence}` });
  };
  for (const actorId of [alex, jordan]) {
    run(actorId, {
      type: "account.add",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      openingBalance: 500_000,
    });
    for (const name of ["Rent", "Food"])
      run(actorId, {
        type: "category.add",
        categoryId: name.toLowerCase(),
        name,
      });
  }
  for (const [index, amount] of [-2_500, -4_000, -1_250].entries())
    run(alex, {
      type: "transaction.upsert",
      transactionId: `market-${index}`,
      accountId: "checking",
      date: `2026-10-0${index + 1}`,
      amount,
      payee: "Market",
      categoryId: "food",
    });
  return book;
}

// A household of Alex and Jordan holding the starting book's rows.
async function household(revision = 3) {
  const id = `test-households-${randomUUID()}`;
  workspaceIds.push(id);
  await db.workspace.create({ data: { id, revision } });
  await replaceRows(db, id, bookToRows(startingBook()), revision);
  await db.workspaceMember.createMany({
    data: [
      { clerkUserId: alex, workspaceId: id },
      { clerkUserId: jordan, workspaceId: id },
    ],
  });
  return id;
}

const operation = (actorId: string, command: Command) => ({
  actorId,
  source: "user" as const,
  type: command.type,
  inputHash: operationHash(command),
  command,
});

const change = (rows: Iterable<WireRow>, actorId: string, command: Command) =>
  executeWithChanges(rowsToBook(rows), actorId, command).changeSet;

const income = (id: string, amount: number | null): Command => ({
  type: "income.expect",
  id,
  month: "2026-10",
  amount,
});

const bookOf = (household: Household) =>
  json(rowsToBook(rowsIn(household.rows)));

test.before(async () => {
  await db.user.createMany({
    data: [{ clerkUserId: alex }, { clerkUserId: jordan }],
  });
});

test.afterEach(async () => {
  await db.workspaceMember.deleteMany({
    where: { clerkUserId: { in: [alex, jordan] } },
  });
});

test.after(async () => {
  await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await db.user.deleteMany({ where: { clerkUserId: { in: [alex, jordan] } } });
  await db.$disconnect();
});

void test("a household is read whole once, then only the rows changed since, deleted rows included", async () => {
  const workspaceId = await household();
  const cache = new HouseholdCache();
  const first = (await cache.load(db, alex))!;
  assert.equal(first.revision, 3);
  assert.deepStrictEqual(
    sorted(rowsIn(first.rows)),
    sorted(await loadRows(db, workspaceId)),
  );
  assert.equal(await cache.load(db, alex), first, "nothing changed");

  // Another server instance writes, then removes, Alex's expected income.
  let rows = await loadRows(db, workspaceId);
  for (const [revision, command] of [
    [3, income("expect", 100_000)],
    [4, income("clear", null)],
  ] as const) {
    await writeChangeSet(db, {
      workspaceId,
      baseRevision: revision,
      changeSet: change(rows, alex, command),
      operation: operation(alex, command),
    });
    rows = await loadRows(db, workspaceId);
  }
  const delta = await loadHouseholdRows(db, alex, {
    workspaceId,
    since: 3,
  });
  assert.equal(delta?.since, 3);
  assert.deepStrictEqual(
    delta?.rows.map((row) => [row.table, row.revision, row.deleted]),
    [["expectedIncome", 5, true]],
    "only the changed row, as a deleted row",
  );

  const next = (await cache.load(db, alex))!;
  assert.equal(next.revision, 5);
  assert.deepStrictEqual(bookOf(next), json(rowsToBook(rows)));
  // A new server process reading everything sees the same household.
  const fresh = (await new HouseholdCache().load(db, alex))!;
  assert.deepStrictEqual(bookOf(fresh), bookOf(next));
});

void test("two server instances write the same household: the one holding an old copy reloads and neither change is lost", async () => {
  const workspaceId = await household();
  const one = new HouseholdCache();
  const other = new HouseholdCache();
  const [atOne, atOther] = await Promise.all([
    one.load(db, alex),
    other.load(db, jordan),
  ]);
  const rent = (id: string, actorId: string, amount: number): Command => ({
    type: "assign",
    id,
    categoryId: "rent",
    month: "2026-10",
    amount,
  });
  const write = (
    cache: HouseholdCache,
    household: Household,
    actorId: string,
    command: Command,
  ) =>
    writeOperation(
      db,
      household,
      {
        changeSet: change(rowsIn(household.rows), actorId, command),
        operation: operation(actorId, command),
      },
      cache,
    );

  const written = await write(one, atOne!, alex, rent("one", alex, 100));
  assert.equal(written.revision, 4);
  await assert.rejects(
    write(other, atOther!, jordan, rent("other", jordan, 200)),
    (error) => error instanceof RevisionConflictError && error.revision === 4,
  );
  const reloaded = (await other.load(db, jordan))!;
  assert.equal(reloaded.revision, 4);
  await write(other, reloaded, jordan, rent("other", jordan, 200));

  const stored = json(rowsToBook(await loadRows(db, workspaceId)));
  const [alexView, jordanView] = [
    (await one.load(db, alex))!,
    (await other.load(db, jordan))!,
  ];
  for (const view of [alexView, jordanView]) {
    assert.equal(view.revision, 5);
    assert.deepStrictEqual(bookOf(view), stored);
  }
  const assigned = (book: Book, userId: string) =>
    book.budgets[userId]!.assignments.find(
      (assignment) => assignment.categoryId === "rent",
    )?.amount;
  assert.equal(assigned(stored, alex), 100);
  assert.equal(assigned(stored, jordan), 200);
});

void test("rows removed outright make every copy start over", async () => {
  const workspaceId = await household();
  const cache = new HouseholdCache();
  const held = (await cache.load(db, alex))!;
  const kept = rowsIn(held.rows).filter(
    (row) => !(row.table === "category" && row.id === rowKey(alex, "rent")),
  );
  const revision = await resetHouseholdRows(db, workspaceId, kept);
  assert.equal(revision, 4);
  const reloaded = (await cache.load(db, alex))!;
  assert.equal(reloaded.resetRevision, 4);
  assert.deepStrictEqual(
    sorted(rowsIn(reloaded.rows)),
    sorted(kept.map((row) => ({ ...row, revision: 4 }))),
  );
});

void test("a budget that doesn't read puts only its owner's plan under maintenance", async () => {
  const workspaceId = await household();
  const cache = new HouseholdCache();
  const ready = (await cache.load(db, alex))!;
  for (const viewer of [alex, jordan]) {
    const ledger = householdLedger(ready, viewer);
    assert.equal(ledger.status, "ready");
    assert.equal(ledger.status === "ready" && ledger.personal, false);
  }

  // A newer release saved a transaction kind this code doesn't know.
  const purchase = ready.rows
    .get("transaction")!
    .get(rowKey(alex, "market-0"))!;
  const unknown: ChangeSet = {
    operationId: "newer-release",
    revision: 0,
    before: [purchase],
    after: [
      {
        ...purchase,
        data: { ...purchase.data!, kind: "rebate" },
      } as unknown as WireRow,
    ],
  };
  await writeChangeSet(db, {
    workspaceId,
    baseRevision: 3,
    changeSet: unknown,
    operation: {
      actorId: alex,
      source: "user",
      type: "transaction.upsert",
      inputHash: "",
      command: {},
    },
  });
  const after = (await cache.load(db, alex))!;
  const owner = householdLedger(after, alex);
  assert.equal(owner.status, "maintenance");
  assert.deepStrictEqual(
    owner.failures.map((failure) => ({
      part: failure.part,
      owner: "ownerId" in failure ? failure.ownerId : undefined,
      path: failure.issues[0]!.path,
    })),
    [
      {
        part: "budget",
        owner: alex,
        path: ["transaction", rowKey(alex, "market-0"), "kind"],
      },
    ],
  );
  // Jordan's plan works from the rows Jordan's browser holds.
  const partner = householdLedger(after, jordan);
  assert.equal(partner.status, "ready");
  assert.ok(partner.status === "ready" && partner.personal);
  assert.equal(partner.status === "ready" && partner.budget.userId, jordan);
});

void test("a pull pages through one revision in table and key order, and rows changed later come with the next pull", async () => {
  const workspaceId = await household();
  const page = async (
    viewerId: string,
    since: number | null,
    revision: number,
    limit: number,
    from?: PullPosition,
  ) => {
    const rows: WireRow[] = [];
    let after = from;
    let pages = 0;
    do {
      const result = await pullRows(db, {
        workspaceId,
        viewerId,
        since,
        revision,
        after,
        limit,
      });
      assert.ok(result.rows.length <= limit);
      for (const row of result.rows) {
        assert.ok(!("issues" in row));
        rows.push(row);
      }
      after = result.next;
      pages++;
    } while (after);
    return { rows, pages };
  };
  for (const viewer of [alex, jordan]) {
    const { rows, pages } = await page(viewer, null, 3, 7);
    const visible = await loadRows(db, workspaceId, { viewerId: viewer });
    assert.equal(pages, Math.ceil(visible.length / 7));
    assert.deepStrictEqual(sorted(rows), sorted(visible));
    assert.ok(rows.every((row) => rowVisibleTo(row, viewer)));
  }

  // Alex changes something while Jordan's browser is between pages: pages
  // at revision 3 leave the changed row out; the pull from 3 brings it.
  const first = await pullRows(db, {
    workspaceId,
    viewerId: alex,
    since: null,
    revision: 3,
    limit: 5,
  });
  const command = income("between-pages", 50_000);
  await writeChangeSet(db, {
    workspaceId,
    baseRevision: 3,
    changeSet: change(await loadRows(db, workspaceId), alex, command),
    operation: operation(alex, command),
  });
  const rest = await page(alex, null, 3, 1000, first.next);
  assert.ok(first.next);
  assert.ok(
    ![...first.rows, ...rest.rows].some(
      (row) => row.table === "expectedIncome",
    ),
  );
  const later = await page(alex, 3, 4, 1000);
  assert.deepStrictEqual(
    later.rows.map((row) => [row.table, row.revision]),
    [["expectedIncome", 4]],
  );
  assert.deepStrictEqual((await page(jordan, 3, 4, 1000)).rows, []);
});
