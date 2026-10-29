import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { rowKey, rowOwner, type WireRow } from "../../src/domain/rows";
import { PrismaClient } from "../../src/generated/prisma";
import {
  createDatabaseCaller as createCaller,
  databaseClientBuild,
  invitationFrom,
} from "./fixtures";
import { ObservedRevision } from "../../src/server/api/trpc";
import {
  BUDGET_MAINTENANCE_MESSAGE,
  CONNECTION_MAINTENANCE_MESSAGE,
  STORED_DATA_ALERT,
} from "../../src/server/services/stored-data";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { loadRows, writeChangeSet } from "../../src/server/storage/rows";

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
    createCaller({
      revision: new ObservedRevision(),
      db,
      userId,
      headers: new Headers(),
    });
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
    await bob.budget.joinInvitation({ id: await invitationFrom(db, a) });
    let revision = (await alice.budget.state({ month })).revision;
    for (const [caller, userId] of [
      [alice, a],
      [bob, b],
    ] as const) {
      ({ revision } = await caller.budget.execute({
        clientId: "test",
        baseRevision: revision,
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
        clientId: "test",
        baseRevision: revision,
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
    });
    const purchaseId = rowKey(a, `${a}-groceries`);
    const purchase = (await loadRows(db, member.workspaceId)).find(
      (row) => row.table === "transaction" && row.id === purchaseId,
    )!;
    await writeChangeSet(db, {
      workspaceId: member.workspaceId,
      baseRevision: revision,
      changeSet: {
        operationId: "newer-release",
        revision: 0,
        before: [purchase],
        after: [
          {
            ...purchase,
            data: { ...purchase.data!, kind: "rebate" },
          } as unknown as WireRow,
        ],
      },
      operation: {
        actorId: a,
        source: "user",
        type: "transaction.upsert",
        inputHash: "",
        command: null,
      },
    });
    const ownRows = async () =>
      (await loadRows(db, member.workspaceId)).filter(
        (row) => rowOwner(row) === a,
      );
    const unreadable = await ownRows();

    const owner = await alerts(() => alice.budget.state({ month }));
    assert.equal(owner.result.status, "maintenance");
    assert.equal(owner.result.view, null);
    const overview = await alerts(() => alice.budget.overview());
    assert.equal(overview.result.status, "maintenance");
    assert.deepEqual(overview.result.imports, []);
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
        record: "rows",
        workspaceId: member.workspaceId,
        userId: a,
        failures: [
          {
            part: "budget",
            budgetOwnerId: a,
            path: ["transaction", purchaseId, "kind"],
          },
        ],
      },
    );
    await assert.rejects(alice.budget.spending(), maintenance);
    await assert.rejects(
      alice.budget.execute({
        clientId: "test",
        baseRevision: owner.result.revision,
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
      alice.budget.execute({
        clientId: "test",
        baseRevision: owner.result.revision,
        command: {
          type: "revert",
          id: randomUUID(),
          targetOperationId: "newer-release",
        },
      }),
      maintenance,
    );

    // The partner's plan works: it loads, and changes save around the
    // unreadable budget.
    const partner = await bob.budget.state({ month });
    assert.equal(partner.status, "ready");
    assert.equal((await bob.budget.overview()).status, "ready");
    assert.equal(partner.view?.budget.userId, b);
    assert.equal(
      partner.view?.accounts.find((account) => account.id === `${b}-bank`)
        ?.balance,
      97500,
    );
    const addCategory = randomUUID();
    const saved = await bob.budget.execute({
      clientId: "test",
      baseRevision: partner.revision,
      command: {
        type: "category.add",
        id: addCategory,
        categoryId: "travel",
        name: "Travel",
      },
    });
    const undone = await bob.budget.execute({
      clientId: "test",
      baseRevision: saved.revision,
      command: {
        type: "revert",
        id: randomUUID(),
        targetOperationId: addCategory,
      },
    });
    assert.equal(undone.revision, saved.revision + 1);
    assert.deepEqual(
      await ownRows(),
      unreadable,
      "The unreadable budget is stored exactly as it was.",
    );
    // Browsers get no rows that don't read: the owner's pull waits, the
    // partner's holds none of the owner's budget anyway.
    await assert.rejects(
      alerts(() =>
        alice.sync.pull({ since: null, clientBuild: databaseClientBuild }),
      ),
      maintenance,
    );
    const pulled = await bob.sync.pull({
      since: null,
      clientBuild: databaseClientBuild,
    });
    assert.ok(pulled.rows.length > 0);
    assert.ok(!pulled.rows.some((row) => rowOwner(row) === a));

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
      ["rows", "BankConnection.imports"],
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
            budgetMembers: { some: { userId: b } },
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

void test("standing rules an earlier release stored still load, sync, and undo", async () => {
  const db = new PrismaClient();
  const a = `test-rules-${randomUUID()}`;
  const alice = createCaller({
    revision: new ObservedRevision(),
    db,
    userId: a,
    headers: new Headers(),
  });
  try {
    await alice.budget.onboard({
      name: "Alice",
      month,
      timezone: "America/Los_Angeles",
    });
    let { revision } = await alice.budget.execute({
      clientId: "test",
      baseRevision: (await alice.budget.state({ month })).revision,
      command: {
        type: "category.add",
        id: randomUUID(),
        categoryId: "dining",
        name: "Dining",
      },
    });
    const member = await db.workspaceMember.findUniqueOrThrow({
      where: { clerkUserId: a },
    });
    // The earlier release's rule.set, as it was stored.
    const rule: WireRow = {
      table: "rule",
      id: rowKey(a, "dining-rule"),
      revision: 0,
      deleted: false,
      data: {
        id: "dining-rule",
        fromCategoryId: "dining",
        toCategoryId: "dining",
        enabled: true,
        userId: a,
        sort: 0,
      },
    };
    ({ revision } = await writeChangeSet(db, {
      workspaceId: member.workspaceId,
      baseRevision: revision,
      changeSet: {
        operationId: "earlier-rule",
        revision: 0,
        before: [{ ...rule, deleted: true, data: null }],
        after: [rule],
      },
      operation: {
        actorId: a,
        source: "user",
        type: "rule.set",
        inputHash: "",
        command: null,
      },
    }));

    const state = await alice.budget.state({ month });
    assert.equal(state.status, "ready");
    const pulled = await alice.sync.pull({
      since: null,
      clientBuild: databaseClientBuild,
    });
    assert.ok(pulled.rows.some((row) => row.id === rule.id && !row.deleted));
    ({ revision } = await alice.budget.execute({
      clientId: "test",
      baseRevision: state.revision,
      command: {
        type: "category.add",
        id: randomUUID(),
        categoryId: "travel",
        name: "Travel",
      },
    }));
    const undone = await alice.budget.execute({
      clientId: "test",
      baseRevision: revision,
      command: {
        type: "revert",
        id: randomUUID(),
        targetOperationId: "earlier-rule",
      },
    });
    assert.ok(
      undone.changeSet?.after.some((row) => row.id === rule.id && row.deleted),
    );
    assert.equal((await alice.budget.state({ month })).status, "ready");
  } finally {
    const memberships = await db.workspaceMember.findMany({
      where: { clerkUserId: a },
    });
    await db.workspace.deleteMany({
      where: { id: { in: memberships.map((m) => m.workspaceId) } },
    });
    await db.user.deleteMany({ where: { clerkUserId: a } });
    await db.$disconnect();
  }
});
