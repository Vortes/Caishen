import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "../../src/generated/prisma";
import { isCounterparty } from "../../src/domain/engine";
import { ObservedRevision } from "../../src/server/api/trpc";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import {
  apiFixture,
  createDatabaseCaller as createCaller,
  invitationFrom,
} from "./fixtures";

assertDevelopmentDatabase(process.env);
const month = "2026-10";
async function fixture(t: TestContext) {
  const { db, people } = await apiFixture(t, ["Alice", "Bob", "Eve"]);
  const [alice, bob, eve] = people as [
    (typeof people)[number],
    (typeof people)[number],
    (typeof people)[number],
  ];
  await alice.run({
    type: "account.add",
    id: randomUUID(),
    accountId: "alice-bank",
    name: "Alice private bank",
    kind: "cash",
    openingBalance: 500_000,
    date: "2026-10-01",
  });
  await alice.run({
    type: "category.add",
    id: randomUUID(),
    categoryId: "alice-private",
    name: "Alice secret category",
  });
  return { db, alice, bob, eve };
}
async function purchaseFixture(t: TestContext) {
  const f = await fixture(t);
  await f.alice.run({
    type: "assign",
    id: randomUUID(),
    categoryId: "alice-private",
    month,
    amount: 20_000,
  });
  await f.alice.run(purchase(-10_000));
  return f;
}
function purchase(amount: number) {
  return {
    type: "transaction.upsert" as const,
    id: randomUUID(),
    transactionId: "secret-purchase",
    accountId: "alice-bank",
    date: "2026-10-02",
    amount,
    payee: "Private merchant",
    categoryId: "alice-private",
    reviewed: false,
  };
}
void test("a signed-out request cannot read a budget", async () => {
  const db = new PrismaClient();
  try {
    const api = createCaller({
      db,
      userId: null,
      headers: new Headers(),
      revision: new ObservedRevision(),
    });
    await assert.rejects(api.budget.state({ month }), { code: "UNAUTHORIZED" });
  } finally {
    await db.$disconnect();
  }
});
void test("a new user can create a budget through the API", async () => {
  const db = new PrismaClient();
  const userId = `test-new-${randomUUID()}`;
  const api = createCaller({
    db,
    userId,
    headers: new Headers(),
    revision: new ObservedRevision(),
  });
  try {
    assert.equal((await api.budget.overview()).status, "new");
    await api.budget.onboard({
      name: "Alice",
      month,
      timezone: "America/Los_Angeles",
    });
    assert.equal((await api.budget.overview()).status, "ready");
  } finally {
    await db.workspace.deleteMany({
      where: { members: { some: { clerkUserId: userId } } },
    });
    await db.user.deleteMany({ where: { clerkUserId: userId } });
    await db.$disconnect();
  }
});
void test("retried API commands keep one financial effect and reject conflicting reuse", async (t) => {
  const { alice } = await fixture(t);
  const submitted = {
    type: "category.add" as const,
    id: randomUUID(),
    categoryId: "defaulted",
    name: "Default group",
  };
  const beforeCategory = (await alice.state()).revision;
  const added = await alice.api.budget.execute({
    clientId: "test",
    baseRevision: beforeCategory,
    command: submitted,
  });
  assert.deepEqual(
    await alice.api.budget.execute({
      clientId: "test",
      baseRevision: beforeCategory,
      command: submitted,
    }),
    added,
  );
  assert.equal(
    (await alice.state()).view!.budget.categories.filter(
      (category) => category.id === "defaulted",
    ).length,
    1,
  );
  const command = {
    type: "assign" as const,
    id: randomUUID(),
    categoryId: "alice-private",
    month,
    amount: 20_000,
  };
  const first = await alice.run(command);
  assert.deepEqual(
    await alice.api.budget.execute({
      clientId: "test",
      baseRevision: first.revision - 1,
      command,
    }),
    { ...first, rebased: false },
  );
  assert.equal((await alice.state()).view!.readyToAssign, 480_000);
  await assert.rejects(alice.run({ ...command, amount: 30_000 }), {
    code: "BAD_REQUEST",
    message: /different details/,
  });
});
void test("a saved purchase changes cash and personal spending through API reads", async (t) => {
  const { alice } = await purchaseFixture(t);
  const own = await alice.state();
  assert.equal(own.view!.cash, 490_000);
  assert.equal(own.view!.readyToAssign, 480_000);
  assert.equal(own.view!.personalSpending, 10_000);
});
void test("the API refuses future deposits and opening balances", async (t) => {
  const { alice } = await fixture(t);
  await assert.rejects(
    alice.run({
      type: "transaction.upsert",
      id: randomUUID(),
      transactionId: "future-income",
      accountId: "alice-bank",
      date: "2100-01-01",
      amount: 100_000,
      payee: "Future payroll",
    }),
    { code: "BAD_REQUEST" },
  );
  await assert.rejects(
    alice.run({
      type: "account.add",
      id: randomUUID(),
      accountId: "future-bank",
      name: "Future bank",
      kind: "cash",
      openingBalance: 100_000,
      date: "2100-01-01",
    }),
    { code: "BAD_REQUEST" },
  );
  assert.equal((await alice.state()).view!.cash, 500_000);
});
void test("another user's private accounts and purchases are inaccessible", async (t) => {
  const { db, alice, bob, eve } = await purchaseFixture(t);
  assert.equal(
    (await bob.state()).view!.accounts.filter(
      (account) => !isCounterparty(account),
    ).length,
    0,
  );
  await assert.rejects(bob.run({ ...purchase(-100), transactionId: "stolen" }));
  const invitation = await invitationFrom(db, alice.userId);
  await bob.api.budget.joinInvitation({ id: invitation });
  const shared = await bob.state();
  assert.equal(shared.view!.members.length, 2);
  for (const privateValue of [
    "Private merchant",
    "Alice secret category",
    "Alice private bank",
  ])
    assert.ok(!JSON.stringify(shared).includes(privateValue));
  await assert.rejects(eve.api.budget.joinInvitation({ id: invitation }), {
    code: "BAD_REQUEST",
    message: /already accepted/,
  });
  assert.equal((await eve.state()).view!.members.length, 1);
  assert.ok(!JSON.stringify(await eve.state()).includes("Alice"));
});
void test("joining a household survives a serialization conflict", async (t) => {
  const { db, alice, bob } = await fixture(t);
  const id = await invitationFrom(db, alice.userId);
  let conflict = true;
  const retrying = new Proxy(db, {
    get(target, property) {
      if (property === "$transaction")
        return async (...args: unknown[]) => {
          const options = args[1];
          if (
            conflict &&
            typeof options === "object" &&
            options !== null &&
            "isolationLevel" in options &&
            options.isolationLevel ===
              Prisma.TransactionIsolationLevel.Serializable
          ) {
            conflict = false;
            throw new Prisma.PrismaClientKnownRequestError(
              "Simulated serialization conflict",
              { code: "P2034", clientVersion: Prisma.prismaVersion.client },
            );
          }
          return Reflect.apply(
            target.$transaction.bind(target),
            target,
            args,
          ) as unknown;
        };
      return Reflect.get(target, property) as unknown;
    },
  });
  await createCaller({
    db: retrying,
    userId: bob.userId,
    headers: new Headers(),
    revision: new ObservedRevision(),
  }).budget.joinInvitation({ id });
  assert.equal(conflict, false, "the database failure was exercised");
  assert.equal((await bob.state()).view!.members.length, 2);
});
void test("concurrent personal changes both persist in a joined household", async (t) => {
  const { db, alice, bob } = await fixture(t);
  await bob.api.budget.joinInvitation({
    id: await invitationFrom(db, alice.userId),
  });
  const baseRevision = (await alice.state()).revision;
  const results = await Promise.all(
    [alice, bob].map((person, index) =>
      person.api.budget.execute({
        clientId: "test",
        baseRevision,
        command: {
          type: "category.add",
          id: randomUUID(),
          categoryId: `concurrent-${index}`,
          name: `Concurrent ${index}`,
        },
      }),
    ),
  );
  assert.deepEqual(results.map((result) => result.rebased).sort(), [
    false,
    true,
  ]);
  assert.deepEqual(results.map((result) => result.revision).sort(), [
    baseRevision + 1,
    baseRevision + 2,
  ]);
  for (const [index, person] of [alice, bob].entries())
    assert.ok(
      (await person.state()).view!.categories.some(
        (category) => category.id === `concurrent-${index}`,
      ),
    );
});
