import type { TestContext } from "node:test";
import { PrismaClient as TestDatabase } from "../../src/generated/prisma";
import { ObservedRevision } from "../../src/server/api/trpc";
import type { Command } from "../../src/domain/engine";
import { createCaller } from "../../src/server/api/root";
import {
  CLIENT_FORMAT,
  CLIENT_FORMAT_HEADER,
} from "../../src/domain/client-format";
import { randomUUID } from "node:crypto";
import { bookToRows } from "../../src/domain/rows";
import type { Book } from "../../src/domain/engine";
import type { Prisma, PrismaClient } from "../../src/generated/prisma";
import {
  importStateChange,
  type ImportRowState,
} from "../../src/server/services/bank-import-rows";
import { households } from "../../src/server/storage/households";
import {
  readHouseholdRevision,
  replaceRows,
  writeChangeSet,
} from "../../src/server/storage/rows";

// Households and bank connections set up for database tests, stored the way
// the app stores them (ADR 0006).

/** A household holding a book's rows, with its members. */
export async function createHousehold(
  db: PrismaClient,
  book: Book,
  id?: string,
) {
  const workspace = await db.workspace.create({
    data: { id, revision: 1, resetRevision: 1 },
  });
  await replaceRows(db, workspace.id, bookToRows(book), 1);
  await db.workspaceMember.createMany({
    data: Object.keys(book.budgets).map((clerkUserId) => ({
      clerkUserId,
      workspaceId: workspace.id,
    })),
  });
  return workspace.id;
}

/**
 * Sets a member's bank connection's import state: its import rows, and
 * any connection details on the connection itself.
 */
export async function setConnectionImports(
  db: PrismaClient,
  userId: string,
  connectionId: string,
  state: Partial<ImportRowState> & Record<string, unknown>,
) {
  const { records, resolved, errors, reviews, ...details } = state;
  const household = (await households.load(db, userId))!;
  const change = importStateChange(household.rows, userId, connectionId, {
    records: records ?? [],
    resolved: resolved ?? {},
    errors: errors ?? {},
    reviews: reviews ?? {},
  });
  if (change.after.length) {
    const operationId = randomUUID();
    await writeChangeSet(db, {
      workspaceId: household.workspaceId,
      baseRevision: (await readHouseholdRevision(db, userId))!.revision,
      changeSet: { ...change, operationId },
      operation: {
        actorId: userId,
        source: "provider",
        type: "test.imports",
        inputHash: operationId,
        command: null,
      },
    });
  }
  await db.bankConnection.update({
    where: { id: connectionId },
    data: { imports: details as Prisma.InputJsonValue },
  });
}

/** A bank connection with its import state, as bank updates leave it. */
export async function createBankConnection(
  db: PrismaClient,
  {
    data,
  }: { data: Prisma.BankConnectionUncheckedCreateInput & { id: string } },
) {
  await db.bankConnection.create({ data: { ...data, imports: {} } });
  await setConnectionImports(
    db,
    data.clerkUserId,
    data.id,
    data.imports as Partial<ImportRowState> & Record<string, unknown>,
  );
}

/** An API client speaking the same supported format as the browser. */
export function createDatabaseCaller(
  context: Extract<Parameters<typeof createCaller>[0], { headers: Headers }>,
) {
  const headers = new Headers(context.headers);
  headers.set(CLIENT_FORMAT_HEADER, String(CLIENT_FORMAT));
  return createCaller({ ...context, headers });
}

/** Fresh API users and budgets; each test owns and removes its data. */
export async function apiFixture(t: TestContext, names = ["Alice"]) {
  const db = new TestDatabase();
  const users = names.map(() => `test-api-${randomUUID()}`);
  const month = "2026-10";
  t.after(async () => {
    await db.reviewEvidence.deleteMany({
      where: { clerkUserId: { in: users } },
    });
    await db.bankConnection.deleteMany({
      where: { clerkUserId: { in: users } },
    });
    await db.workspace.deleteMany({
      where: {
        OR: [
          { members: { some: { clerkUserId: { in: users } } } },
          { budgetMembers: { some: { userId: { in: users } } } },
        ],
      },
    });
    await db.user.deleteMany({ where: { clerkUserId: { in: users } } });
    await db.$disconnect();
  });
  const people = [];
  for (const [index, userId] of users.entries()) {
    const api = createDatabaseCaller({
      db,
      userId,
      headers: new Headers(),
      revision: new ObservedRevision(),
    });
    const state = () => api.budget.state({ month });
    const run = async (command: Command) =>
      api.budget.execute({
        command,
        clientId: "test",
        baseRevision: (await state()).revision,
      });
    await api.budget.onboard({
      name: names[index]!,
      month,
      timezone: "America/Los_Angeles",
    });
    people.push({ userId, api, state, run });
  }
  return { db, people, month };
}
