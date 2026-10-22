import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import nextEnv from "@next/env";
import { Prisma, PrismaClient } from "../../src/generated/prisma";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { buildDevelopmentSeed } from "../../src/server/dev/seed-scenarios";
import {
  copyHousehold,
  verifyHousehold,
} from "../../src/server/storage/book-copy";
import { loadRows, operationIds } from "../../src/server/storage/rows";

nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
const run = randomUUID();
const alexId = `test-copy-alex-${run}`;
const jordanId = `test-copy-jordan-${run}`;
const workspaceId = `test-copy-${run}`;
const connectionId = `test-copy-bank-${run}`;

test.after(async () => {
  await db.workspace.deleteMany({ where: { id: workspaceId } });
  await db.budgetOperation.deleteMany({ where: { workspaceId } });
  await db.bankConnection.deleteMany({ where: { id: connectionId } });
  await db.user.deleteMany({
    where: { clerkUserId: { in: [alexId, jordanId] } },
  });
  await db.$disconnect();
});

void test("the development seed, its bank imports, and its operations copy to rows that hold the same household to the cent", async () => {
  await db.user.createMany({
    data: [{ clerkUserId: alexId }, { clerkUserId: jordanId }],
  });
  const seed = buildDevelopmentSeed({
    userId: alexId,
    partnerId: jordanId,
    asOf: "2026-10-21",
  });
  await db.workspace.create({
    data: {
      id: workspaceId,
      revision: 5,
      book: JSON.parse(JSON.stringify(seed.book)) as object,
      members: { create: [{ clerkUserId: alexId }, { clerkUserId: jordanId }] },
      operations: {
        create: {
          operationId: "saved-operation",
          actorId: alexId,
          source: "user",
          type: "assign",
          commandHash: "a".repeat(64),
          revision: 5,
        },
      },
    },
  });
  await db.bankConnection.create({
    data: {
      id: connectionId,
      clerkUserId: alexId,
      itemId: connectionId,
      encryptedToken: "unused",
      imports: JSON.parse(
        readFileSync(
          new URL(
            "../stored-data/samples/BankConnection.imports/synced-with-reviews.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ) as object,
      accountMappings: {},
    },
  });

  const copied = await copyHousehold(db, workspaceId);
  assert.ok(!("problem" in copied));
  assert.equal(copied.status, "copied");
  const verified = await verifyHousehold(db, workspaceId, "2026-10");
  assert.ok(!("problem" in verified));
  assert.deepEqual(verified.mismatches, []);
  assert.equal(verified.budgets, 2);
  // Three months for each budget, whole and as each partner holds them.
  assert.equal(verified.monthViews, 12);

  const rows = await loadRows(db, workspaceId);
  assert.equal(rows.length, copied.rows);
  assert.ok(rows.every((row) => row.revision === 5 && !row.deleted));
  assert.equal(
    rows.filter((row) => row.table === "bankImport").length,
    5,
    "one row per logical bank transaction",
  );
  assert.equal(
    (await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } }))
      .revision,
    5,
    "copying keeps the revision",
  );
  assert.deepEqual(
    (await operationIds(db, workspaceId)).sort(),
    ["saved-operation", ...seed.book.audit.map((entry) => entry.id)].sort(),
  );

  // Copying again changes nothing.
  assert.deepEqual(await copyHousehold(db, workspaceId), {
    ...copied,
    status: "unchanged",
  });

  // Rows that differ from the book are the app's: the copy never replaces
  // them, and verifying reports the difference.
  const book = structuredClone(seed.book);
  book.budgets[alexId]!.name = "Renamed";
  await db.workspace.update({
    where: { id: workspaceId },
    data: { book: JSON.parse(JSON.stringify(book)) as object },
  });
  const mismatched = await verifyHousehold(db, workspaceId, "2026-10");
  assert.ok(!("problem" in mismatched) && mismatched.mismatches.length > 0);
  const refused = await copyHousehold(db, workspaceId);
  assert.ok("problem" in refused);
  assert.match(refused.problem, /the app wrote them/);
  assert.deepEqual(
    (await loadRows(db, workspaceId)).find(
      (row) => row.table === "member" && row.id === alexId,
    )?.data,
    { userId: alexId, name: seed.book.budgets[alexId]!.name, sort: 0 },
  );

  // A book this code can't read is reported, not copied.
  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      book: { ...(JSON.parse(JSON.stringify(book)) as object), version: 2 },
    },
  });
  const unreadable = await copyHousehold(db, workspaceId);
  assert.ok("problem" in unreadable);
  assert.match(unreadable.problem, /can't be read/);

  // A household created after the switch to rows has no book to copy.
  await db.workspace.update({
    where: { id: workspaceId },
    data: { book: Prisma.DbNull },
  });
  assert.deepEqual(await copyHousehold(db, workspaceId), {
    status: "rowsOnly",
    rows: 0,
    operations: 0,
  });
});
