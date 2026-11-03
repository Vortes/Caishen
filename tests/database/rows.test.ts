import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import nextEnv from "@next/env";
import {
  createBook,
  executeWithChanges,
  projectBook,
  type Book,
  type Command,
} from "../../src/domain/engine";
import {
  bookToRows,
  foldAssignments,
  rowsToBook,
  rowVisibleTo,
  type ChangeSet,
  type WireRow,
} from "../../src/domain/rows";
import { PrismaClient } from "../../src/generated/prisma";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { buildDevelopmentSeed } from "../../src/server/dev/seed-scenarios";
import { operationHash } from "../../src/server/services/safety";
import {
  importStateRows,
  importStatesFromRows,
} from "../../src/server/services/bank-import-rows";
import { importStateSchema } from "../../src/server/services/banks";
import {
  findOperation,
  loadRows,
  pruneOperations,
  replaceRows,
  RevisionConflictError,
  writeChangeSet,
} from "../../src/server/storage/rows";
import { buildCommandCorpus } from "../domain/fixtures/command-corpus";
import { withPeople } from "../../src/domain/people";
import { personId, withPerson } from "../domain/fixtures/people";

nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
const run = randomUUID();
const alexId = `test-rows-alex-${run}`;
const jordanId = `test-rows-jordan-${run}`;
const connectionId = `test-rows-bank-${run}`;
const workspaceIds: string[] = [];

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const key = (row: Pick<WireRow, "table" | "id">) => `${row.table} ${row.id}`;
const sorted = (rows: WireRow[]) =>
  [...rows].sort((a, b) => key(a).localeCompare(key(b)));

// What rows hold of a book: everything but the audit, with assignments
// folded.
function stored(book: Book): Book {
  const copy = json(book);
  for (const budget of Object.values(copy.budgets))
    budget.assignments = foldAssignments(budget.assignments);
  copy.audit = [];
  return json(copy);
}

// A household holding a book's rows (and any others) at a revision.
async function household(book: Book, revision: number, more: WireRow[] = []) {
  const id = `test-rows-${randomUUID()}`;
  workspaceIds.push(id);
  await db.workspace.create({ data: { id, revision } });
  await replaceRows(db, id, [...bookToRows(book), ...more], revision);
  return id;
}

const revisionOf = async (id: string) =>
  (await db.workspace.findUniqueOrThrow({ where: { id } })).revision;

const operation = (actorId: string, command: Command) => ({
  actorId,
  source: "user" as const,
  type: command.type,
  inputHash: operationHash(command),
  command,
});

test.before(async () => {
  await db.user.createMany({
    data: [{ clerkUserId: alexId }, { clerkUserId: jordanId }],
  });
});

test.after(async () => {
  await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await db.bankConnection.deleteMany({ where: { id: connectionId } });
  await db.user.deleteMany({
    where: { clerkUserId: { in: [alexId, jordanId] } },
  });
  await db.$disconnect();
});

void test("a category-free reimbursement split survives database storage", async () => {
  let book = withPerson(
    withPeople(createBook(alexId, "Alex", "2026-10")),
    alexId,
    "Mom",
  );
  const commands: Command[] = [
    {
      type: "account.add",
      id: "cash",
      accountId: "cash",
      name: "Checking",
      kind: "cash",
      openingBalance: 100_000,
    },
    {
      type: "category.add",
      id: "category",
      categoryId: "dining",
      name: "Dining",
    },
    {
      type: "transaction.upsert",
      id: "purchase",
      transactionId: "dinner",
      accountId: "cash",
      date: "2026-10-05",
      amount: -2_000,
      payee: "Noodles Plus",
      recordedAt: "2026-10-05T12:00:00Z",
      lines: [
        { lineId: "mine", categoryId: "dining", amount: -846 },
        {
          lineId: "mom",
          amount: -1_154,
          counterpartyShare: {
            accountId: personId("Mom"),
            amount: 1_154,
          },
        },
      ],
    },
  ];
  for (const command of commands)
    book = executeWithChanges(book, alexId, command).book;
  const workspaceId = await household(book, 1);
  const loaded = rowsToBook(await loadRows(db, workspaceId));
  const view = projectBook(loaded, alexId, "2026-10");
  assert.equal(
    view.budget.transactions.find(({ id }) => id === "dinner")!.lines![1]!
      .categoryId,
    undefined,
  );
  assert.equal(view.personalSpending, 846);
  assert.equal(
    view.accounts.find((item) => item.id === personId("Mom"))!.balance,
    1_154,
  );
});

void test("the development seed and bank imports are stored whole, and each partner reads the rows they hold", async () => {
  const seed = buildDevelopmentSeed({
    userId: "alex",
    partnerId: "jordan",
    asOf: "2026-10-21",
  });
  const imports = importStateSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../stored-data/samples/BankConnection.imports/synced-with-reviews.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  await db.bankConnection.create({
    data: {
      id: connectionId,
      clerkUserId: alexId,
      itemId: connectionId,
      encryptedToken: "unused",
      imports: {},
      accountMappings: {},
    },
  });
  const workspaceId = await household(seed.book, 5, [
    ...importStateRows("alex", connectionId, imports),
  ]);

  const rows = await loadRows(db, workspaceId);
  assert.ok(rows.every((row) => row.revision === 5 && !row.deleted));
  assert.deepStrictEqual(json(rowsToBook(rows)), stored(seed.book));
  const { records, resolved, errors, reviews } = imports;
  assert.deepStrictEqual(importStatesFromRows(rows).get(connectionId), {
    records,
    resolved,
    errors,
    reviews,
  });

  // A partner's browser holds their own budget's rows and the shared rows.
  for (const viewerId of ["alex", "jordan"]) {
    const visible = await loadRows(db, workspaceId, { viewerId });
    assert.deepStrictEqual(
      sorted(visible),
      sorted(rows.filter((row) => rowVisibleTo(row, viewerId))),
    );
  }
});

void test("every command's change set writes through the database with stamped revisions", async () => {
  const corpus = buildCommandCorpus();
  const actors: Record<string, string> = { alex: alexId, jordan: jordanId };
  const workspaceId = await household(corpus.steps[0]!.before, 0);

  // Each row's revision and whether it is deleted, as the database should
  // hold them.
  const expected = new Map(
    bookToRows(corpus.steps[0]!.before).map((row) => [
      key(row),
      { revision: 0, deleted: false },
    ]),
  );
  for (const [index, step] of corpus.steps.entries()) {
    const written = await writeChangeSet(db, {
      workspaceId,
      baseRevision: index,
      changeSet: step.changeSet,
      operation: operation(actors[step.actorId]!, step.command),
    });
    const revision = index + 1;
    assert.equal(written.revision, revision);
    assert.ok(
      written.changeSet.after.every((row) => row.revision === revision),
    );
    written.changeSet.before.forEach((row, at) => {
      assert.equal(
        row.revision,
        expected.get(key(row))?.revision ?? 0,
        step.command.type,
      );
      expected.set(key(row), {
        revision,
        deleted: written.changeSet.after[at]!.deleted,
      });
    });
    const saved = await findOperation(
      db,
      workspaceId,
      step.changeSet.operationId,
    );
    assert.equal(saved?.revision, revision);
    assert.deepStrictEqual(saved.changeSet, written.changeSet);
  }
  assert.equal(await revisionOf(workspaceId), corpus.steps.length);

  const live = await loadRows(db, workspaceId);
  assert.deepStrictEqual(
    json(rowsToBook(live)),
    stored(corpus.steps.at(-1)!.after),
  );
  const all = await loadRows(db, workspaceId, { includeDeleted: true });
  assert.deepEqual(
    Object.fromEntries(
      all.map((row) => [
        key(row),
        { revision: row.revision, deleted: row.deleted },
      ]),
    ),
    Object.fromEntries(expected),
  );

  // Deleted rows are left out unless asked for, and come back with no data.
  const deleted = all.filter((row) => row.deleted);
  assert.ok(deleted.length > 0);
  assert.ok(deleted.every((row) => row.data === null));
  assert.equal(live.length, all.length - deleted.length);
  assert.ok(live.every((row) => !row.deleted));

  // The rows changed since a revision, deleted ones included.
  const since = 40;
  assert.deepStrictEqual(
    sorted(await loadRows(db, workspaceId, { since, includeDeleted: true })),
    sorted(all.filter((row) => row.revision > since)),
  );
});

void test("a change set is written whole or not at all, and only at the revision it was made for", async () => {
  const corpus = buildCommandCorpus();
  const book = corpus.steps.at(-1)!.after;
  const workspaceId = await household(book, 3);
  const rows = await loadRows(db, workspaceId);
  const change = (command: Command, actorId = "alex") =>
    executeWithChanges(rowsToBook(rows), actorId, command).changeSet;
  const assign = (id: string, amount: number): Command => ({
    type: "assign",
    id,
    categoryId: "rent",
    month: "2026-01",
    amount,
  });
  const unchanged = async () => {
    assert.equal(await revisionOf(workspaceId), 3);
    assert.deepStrictEqual(
      sorted(await loadRows(db, workspaceId)),
      sorted(rows),
    );
  };

  // Based on a revision the household has moved past.
  await assert.rejects(
    writeChangeSet(db, {
      workspaceId,
      baseRevision: 2,
      changeSet: change(assign("stale-base", 100)),
      operation: operation(alexId, assign("stale-base", 100)),
    }),
    (error) => error instanceof RevisionConflictError && error.revision === 3,
  );
  // Rows before that aren't the stored rows.
  const first = change(assign("stale-rows", 100));
  const stale: ChangeSet = {
    ...first,
    before: first.before.map((row) =>
      row.deleted
        ? row
        : ({ ...row, data: { ...row.data!, amount: 1 } } as WireRow),
    ),
  };
  assert.ok(stale.before.some((row) => !row.deleted));
  await assert.rejects(
    writeChangeSet(db, {
      workspaceId,
      baseRevision: 3,
      changeSet: stale,
      operation: operation(alexId, assign("stale-rows", 100)),
    }),
    /doesn't match the stored row/,
  );
  await unchanged();
  assert.equal(await findOperation(db, workspaceId, "stale-rows"), null);

  // An operation id already recorded rolls the rows and revision back too.
  const once = change(assign("once", 100));
  await writeChangeSet(db, {
    workspaceId,
    baseRevision: 3,
    changeSet: once,
    operation: operation(alexId, assign("once", 100)),
  });
  const after = await loadRows(db, workspaceId);
  const again = executeWithChanges(
    rowsToBook(after),
    "alex",
    assign("other", 5),
  ).changeSet;
  await assert.rejects(
    writeChangeSet(db, {
      workspaceId,
      baseRevision: 4,
      changeSet: { ...again, operationId: "once" },
      operation: operation(alexId, assign("once", 100)),
    }),
  );
  assert.equal(await revisionOf(workspaceId), 4);
  assert.deepStrictEqual(
    sorted(await loadRows(db, workspaceId)),
    sorted(after),
  );
});

void test("of two writers at the same revision, one writes and the other learns the new revision", async () => {
  const corpus = buildCommandCorpus();
  const workspaceId = await household(corpus.steps.at(-1)!.after, 0);
  const book = rowsToBook(await loadRows(db, workspaceId));
  const commands: Command[] = [
    {
      type: "assign",
      id: "writer-a",
      categoryId: "rent",
      month: "2026-01",
      amount: 100,
    },
    {
      type: "assign",
      id: "writer-b",
      categoryId: "rent",
      month: "2026-01",
      amount: 200,
    },
  ];
  const results = await Promise.allSettled(
    commands.map((command) =>
      writeChangeSet(db, {
        workspaceId,
        baseRevision: 0,
        changeSet: executeWithChanges(book, "alex", command).changeSet,
        operation: operation(alexId, command),
      }),
    ),
  );
  const written = results.filter((result) => result.status === "fulfilled");
  const refused = results.filter((result) => result.status === "rejected");
  assert.equal(written.length, 1);
  assert.equal(refused.length, 1);
  assert.ok(refused[0]!.reason instanceof RevisionConflictError);
  assert.equal(refused[0]!.reason.revision, 1);
  assert.equal(await revisionOf(workspaceId), 1);

  // The other writer runs its command again on the new rows.
  const loser = commands[results.indexOf(refused[0]!)]!;
  const rows = await loadRows(db, workspaceId);
  await writeChangeSet(db, {
    workspaceId,
    baseRevision: 1,
    changeSet: executeWithChanges(rowsToBook(rows), "alex", loser).changeSet,
    operation: operation(alexId, loser),
  });
  const assignment = (await loadRows(db, workspaceId)).find(
    (row) => row.table === "assignment" && row.id === "alex/rent/2026-01",
  );
  const before = rows.find((row) => row.id === "alex/rent/2026-01");
  assert.equal(
    (assignment?.data as { amount: number }).amount,
    ((before?.data as { amount: number } | undefined)?.amount ?? 0) +
      (loser.type === "assign" ? loser.amount : 0),
  );
});

void test("operations keep their command and change set until pruned, and their record forever", async () => {
  const corpus = buildCommandCorpus();
  const workspaceId = await household(corpus.steps.at(-1)!.after, 0);
  const command: Command = {
    type: "assign",
    id: "pruned",
    categoryId: "rent",
    month: "2026-01",
    amount: 100,
  };
  await writeChangeSet(db, {
    workspaceId,
    baseRevision: 0,
    changeSet: executeWithChanges(
      rowsToBook(await loadRows(db, workspaceId)),
      "alex",
      command,
    ).changeSet,
    operation: operation(alexId, command),
  });
  const kept = await findOperation(db, workspaceId, "pruned");
  assert.deepEqual(kept?.command, command);
  assert.ok(kept?.changeSet);
  assert.equal(
    await pruneOperations(
      db,
      new Date(kept.createdAt.getTime() - 1000),
      workspaceId,
    ),
    0,
  );
  assert.equal(
    await pruneOperations(db, new Date(Date.now() + 60_000), workspaceId),
    1,
  );
  const pruned = await findOperation(db, workspaceId, "pruned");
  assert.deepEqual(
    { ...pruned, createdAt: undefined },
    { ...kept, createdAt: undefined, command: null, changeSet: null },
  );
});
