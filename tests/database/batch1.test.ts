import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";
import { ObservedRevision } from "../../src/server/api/trpc";
import {
  CLIENT_FORMAT,
  CLIENT_FORMAT_HEADER,
} from "../../src/domain/client-format";
import { emailPreferenceToken } from "../../src/server/services/email-preferences";
import { deletePersonalBudget } from "../../src/server/services/account-deletion";
import type { Command } from "../../src/domain/engine";

const database = new URL(process.env.BATCH1_TEST_DATABASE_URL!);
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
assert.match(database.pathname, /^\/caishen_batch1_/);
const db = new PrismaClient({ datasourceUrl: database.toString() });
const users: string[] = [];
const workspaces = new Set<string>();
const caller = (userId: string) =>
  createCaller({
    db,
    userId,
    headers: new Headers({ [CLIENT_FORMAT_HEADER]: String(CLIENT_FORMAT) }),
    revision: new ObservedRevision(),
  });
const month = "2026-10";

async function member(name: string) {
  const id = `test-batch1-${randomUUID()}`;
  users.push(id);
  const api = caller(id);
  await api.budget.onboard({ name, month, timezone: "America/Los_Angeles" });
  const membership = await db.workspaceMember.findUniqueOrThrow({
    where: { clerkUserId: id },
  });
  workspaces.add(membership.workspaceId);
  return { id, api };
}

test.after(async () => {
  await db.workspace.deleteMany({ where: { id: { in: [...workspaces] } } });
  await db.user.deleteMany({ where: { clerkUserId: { in: users } } });
  await db.$disconnect();
});

void test("onboarding saves the chosen daily email preference", async () => {
  const id = `test-batch1-${randomUUID()}`;
  users.push(id);
  const api = caller(id);
  await api.budget.onboard({
    name: "My budget",
    month,
    timezone: "America/New_York",
    emailEnabled: false,
  });
  const membership = await db.workspaceMember.findUniqueOrThrow({
    where: { clerkUserId: id },
  });
  workspaces.add(membership.workspaceId);
  const state = await api.budget.state({ month });
  assert.equal(state.view?.budget.settings.emailEnabled, false);
  assert.equal(state.view?.budget.settings.timezone, "America/New_York");
});

void test("revisiting setup replaces only the categories selected during onboarding", async () => {
  const owner = await member("My budget");
  const save = async (names: string[]) => {
    const state = await owner.api.budget.state({ month });
    await owner.api.budget.setupCategories({
      operationId: randomUUID(),
      expectedRevision: state.revision,
      categories: names.map((name) => ({
        categoryId: `setup:Everyday:${name}`,
        name,
        group: "Everyday",
      })),
    });
  };
  await save(["Groceries", "Dining out"]);
  await save(["Groceries", "Climbing gym"]);
  const state = await owner.api.budget.state({ month });
  assert.deepEqual(
    state.view?.budget.categories
      .filter((category) => category.id.startsWith("setup:"))
      .map((category) => category.name),
    ["Groceries", "Climbing gym"],
  );
});

void test("a short partner code identifies its budget and can be joined only once", async () => {
  const host = await member("Jordan’s budget");
  const guest = await member("Alex’s budget");
  const third = await member("Someone else");
  const invite = await host.api.budget.invite();
  assert.match(
    invite.code,
    /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/,
  );
  const entered = invite.code.toLowerCase().replace("-", " ");
  const checked = await guest.api.budget.checkInvite({ code: entered });
  assert.equal(checked.name, "Jordan’s budget");
  await guest.api.budget.join({ code: entered });
  assert.equal((await guest.api.budget.overview()).status, "ready");
  await assert.rejects(() => third.api.budget.join({ code: invite.code }), {
    message: /already used/,
  });
});

void test("repeated invite guesses are limited before another code can be checked", async () => {
  const guest = await member("My budget");
  for (let attempt = 0; attempt < 10; attempt++)
    await assert.rejects(
      () => guest.api.budget.checkInvite({ code: "ZZZZ-ZZZZ" }),
      { code: "NOT_FOUND" },
    );
  await assert.rejects(
    () => guest.api.budget.checkInvite({ code: "YYYY-YYYY" }),
    { code: "TOO_MANY_REQUESTS" },
  );
});

void test("opening an email link leaves delivery on until its signed token is submitted", async () => {
  process.env.CLERK_SECRET_KEY = "batch1-test-signing-key";
  const owner = await member("My budget");
  const token = emailPreferenceToken(owner.id);
  const visitor = createCaller({
    db,
    userId: null,
    headers: new Headers(),
    revision: new ObservedRevision(),
  });
  assert.equal(
    (await visitor.budget.emailSubscription({ token })).enabled,
    true,
  );
  assert.equal(
    (await owner.api.budget.state({ month })).view?.budget.settings
      .emailEnabled,
    true,
  );
  await visitor.budget.setEmailSubscription({ token, enabled: false });
  assert.equal(
    (await owner.api.budget.state({ month })).view?.budget.settings
      .emailEnabled,
    false,
  );
  await visitor.budget.setEmailSubscription({ token, enabled: true });
  assert.equal(
    (await owner.api.budget.state({ month })).view?.budget.settings
      .emailEnabled,
    true,
  );
  await assert.rejects(
    () =>
      visitor.budget.setEmailSubscription({
        token: `${token}x`,
        enabled: false,
      }),
    { code: "NOT_FOUND" },
  );
});

void test("deleting a personal budget erases private data and freezes the partner’s existing balance", async () => {
  const owner = await member("Private budget");
  const partner = await member("Partner budget");
  const invite = await owner.api.budget.invite();
  await partner.api.budget.join({ code: invite.code });
  const run = async (api: typeof owner.api, command: Command) => {
    const state = await api.budget.state({ month });
    return api.budget.execute({
      command,
      baseRevision: state.revision,
      clientId: "batch1-test",
    });
  };
  for (const person of [owner, partner]) {
    await run(person.api, {
      type: "account.add",
      id: randomUUID(),
      accountId: "checking",
      name: "Private bank",
      kind: "cash",
      openingBalance: 100_000,
      date: "2026-10-01",
    });
    await run(person.api, {
      type: "category.add",
      id: randomUUID(),
      categoryId: "food",
      name: "Food",
    });
  }
  await run(owner.api, {
    type: "shared.create",
    id: randomUUID(),
    sharedCategoryId: "food",
    participants: [owner.id, partner.id],
    weights: { [owner.id]: 1, [partner.id]: 1 },
    categoryIds: { [owner.id]: "food", [partner.id]: "food" },
  });
  await run(owner.api, {
    type: "transaction.upsert",
    id: randomUUID(),
    transactionId: "shared-shop",
    accountId: "checking",
    amount: -10_000,
    date: "2026-10-02",
    payee: "Market",
    categoryId: "food",
    sharedCategoryId: "food",
  });
  const before = await partner.api.budget.state({ month });
  assert.equal(before.view?.settlement.youOwe, 5_000);
  await db.user.update({
    where: { clerkUserId: owner.id },
    data: { active: false, deletedAt: new Date() },
  });
  await deletePersonalBudget(db, owner.id);
  const after = await partner.api.budget.state({ month });
  assert.equal(after.view?.settlement.youOwe, 5_000);
  assert.equal(after.view?.cash, before.view?.cash);
  assert.equal(after.view?.personalSpending, before.view?.personalSpending);
  assert.equal(after.view?.sharedCategories[0]?.archived, true);
  assert.ok(!JSON.stringify(after).includes("Private budget"));
  await assert.rejects(() => owner.api.budget.state({ month }), {
    code: "FORBIDDEN",
  });
  await run(partner.api, {
    type: "transaction.upsert",
    id: randomUUID(),
    transactionId: "new-shop",
    accountId: "checking",
    amount: -2_000,
    date: "2026-10-03",
    payee: "Market",
    categoryId: "food",
  });
  assert.equal(
    (await partner.api.budget.state({ month })).view?.settlement.youOwe,
    5_000,
  );
  await deletePersonalBudget(db, owner.id);
  assert.equal(
    (await partner.api.budget.state({ month })).view?.settlement.youOwe,
    5_000,
  );
  await assert.rejects(
    () =>
      run(partner.api, {
        type: "transaction.upsert",
        id: randomUUID(),
        transactionId: "new-shared-shop",
        accountId: "checking",
        amount: -2_000,
        date: "2026-10-03",
        payee: "Market",
        categoryId: "food",
        sharedCategoryId: "food",
      }),
    { message: /frozen/ },
  );
});
