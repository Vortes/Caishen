import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { PrismaClient, type Prisma } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";
import {
  BUDGET_MAINTENANCE_MESSAGE,
  CONNECTION_MAINTENANCE_MESSAGE,
  STORED_DATA_ALERT,
} from "../../src/server/services/stored-data";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";

assertDevelopmentDatabase(process.env);

const month = "2026-10";
const maintenance = (error: unknown) =>
  error instanceof TRPCError &&
  error.code === "SERVICE_UNAVAILABLE" &&
  error.message === BUDGET_MAINTENANCE_MESSAGE;

// Alerts are structured console.error lines; collect them per request.
async function alerts<T>(run: () => Promise<T>) {
  const lines: Record<string, unknown>[] = [];
  const original = console.error;
  console.error = (line: unknown) => {
    if (typeof line === "string" && line.startsWith(`${STORED_DATA_ALERT} `))
      lines.push(
        JSON.parse(line.slice(STORED_DATA_ALERT.length + 1)) as Record<
          string,
          unknown
        >,
      );
    else original(line);
  };
  try {
    return { result: await run(), lines };
  } finally {
    console.error = original;
  }
}

void test("an unreadable personal budget puts only its owner's plan under maintenance and is never written over", async () => {
  const db = new PrismaClient();
  const a = `test-unreadable-a-${randomUUID()}`,
    b = `test-unreadable-b-${randomUUID()}`;
  const api = (userId: string) =>
    createCaller({ db, userId, headers: new Headers() });
  const alice = api(a),
    bob = api(b);
  try {
    for (const [caller, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
    ] as const)
      await caller.budget.onboard({
        name,
        month,
        timezone: "America/Los_Angeles",
      });
    await bob.budget.join({ code: (await alice.budget.invite()).code });
    let revision = (await alice.budget.state({ month })).revision;
    for (const [caller, userId] of [
      [alice, a],
      [bob, b],
    ] as const) {
      ({ revision } = await caller.budget.execute({
        expectedRevision: revision,
        command: {
          type: "account.add",
          id: randomUUID(),
          accountId: `${userId}-bank`,
          name: "Checking",
          kind: "cash",
          openingBalance: 100000,
          date: `${month}-01`,
        },
      }));
      ({ revision } = await caller.budget.execute({
        expectedRevision: revision,
        command: {
          type: "transaction.upsert",
          id: randomUUID(),
          transactionId: `${userId}-groceries`,
          accountId: `${userId}-bank`,
          date: `${month}-02`,
          amount: -2500,
          payee: "Market",
        },
      }));
    }

    // A release newer than this code saved a transaction kind it can't read.
    const member = await db.workspaceMember.findUniqueOrThrow({
      where: { clerkUserId: a },
      include: { workspace: true },
    });
    const book = member.workspace.book as {
      budgets: Record<string, { transactions: Record<string, unknown>[] }>;
    };
    book.budgets[a]!.transactions[0]!.kind = "rebate";
    await db.workspace.update({
      where: { id: member.workspaceId },
      data: { book: book as unknown as Prisma.InputJsonValue },
    });
    const unreadable = structuredClone(book.budgets[a]);

    const owner = await alerts(() => alice.budget.state({ month }));
    assert.equal(owner.result.status, "maintenance");
    assert.equal(owner.result.view, null);
    assert.equal(owner.lines.length, 1);
    assert.deepEqual(
      {
        ...owner.lines[0],
        failures: (owner.lines[0]!.failures as Record<string, unknown>[]).map(
          ({ part, budgetOwnerId, issues }) => ({
            part,
            budgetOwnerId,
            path: (issues as { path: unknown[] }[])[0]!.path,
          }),
        ),
      },
      {
        alert: STORED_DATA_ALERT,
        record: "Workspace.book",
        workspaceId: member.workspaceId,
        userId: a,
        failures: [
          {
            part: "budget",
            budgetOwnerId: a,
            path: ["budgets", a, "transactions", 0, "kind"],
          },
        ],
      },
    );
    await assert.rejects(alice.budget.spending(), maintenance);
    await assert.rejects(
      alice.budget.execute({
        expectedRevision: owner.result.revision,
        command: {
          type: "category.add",
          id: randomUUID(),
          categoryId: "gifts",
          name: "Gifts",
        },
      }),
      maintenance,
    );
    await assert.rejects(
      alice.budget.changeHistory({
        direction: "undo",
        expectedRevision: owner.result.revision,
        operationId: randomUUID(),
      }),
      maintenance,
    );

    // The partner's plan works: it loads, and changes save around the
    // unreadable budget.
    const partner = await bob.budget.state({ month });
    assert.equal(partner.status, "ready");
    assert.equal(partner.view?.budget.userId, b);
    assert.equal(
      partner.view?.accounts.find((account) => account.id === `${b}-bank`)
        ?.balance,
      97500,
    );
    const saved = await bob.budget.execute({
      expectedRevision: partner.revision,
      command: {
        type: "category.add",
        id: randomUUID(),
        categoryId: "travel",
        name: "Travel",
      },
    });
    const undone = await bob.budget.changeHistory({
      direction: "undo",
      expectedRevision: saved.revision,
      operationId: randomUUID(),
    });
    assert.equal(undone.revision, saved.revision + 1);
    const stored = await db.workspace.findUniqueOrThrow({
      where: { id: member.workspaceId },
    });
    assert.deepEqual(
      (stored.book as typeof book).budgets[a],
      unreadable,
      "The unreadable budget is stored exactly as it was.",
    );

    // An unreadable bank connection takes down only that connection.
    await db.bankConnection.create({
      data: {
        clerkUserId: b,
        itemId: `fixture-item-${randomUUID()}`,
        encryptedToken: "fixture-only-no-provider-token",
        imports: { records: [], resolved: {}, errors: {}, cursorV2: "x" },
        accountMappings: {},
      },
    });
    const withConnection = await alerts(() => bob.budget.state({ month }));
    assert.equal(withConnection.result.status, "ready");
    assert.deepEqual(
      withConnection.result.connections.map(({ error, accounts }) => ({
        error,
        accounts,
      })),
      [{ error: CONNECTION_MAINTENANCE_MESSAGE, accounts: [] }],
    );
    assert.deepEqual(
      withConnection.lines.map((line) => line.record),
      ["Workspace.book", "BankConnection.imports"],
    );
  } finally {
    const memberships = await db.workspaceMember.findMany({
      where: { clerkUserId: { in: [a, b] } },
    });
    await db.workspace.deleteMany({
      where: {
        OR: [
          { id: { in: memberships.map((m) => m.workspaceId) } },
          {
            members: { none: {} },
            book: { path: ["budgets", b, "userId"], equals: b },
          },
        ],
      },
    });
    await db.bankConnection.deleteMany({
      where: { clerkUserId: { in: [a, b] } },
    });
    await db.user.deleteMany({ where: { clerkUserId: { in: [a, b] } } });
    await db.$disconnect();
  }
});
