import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";
import { ObservedRevision } from "../../src/server/api/trpc";
import {
  CLIENT_FORMAT,
  CLIENT_FORMAT_HEADER,
} from "../../src/domain/client-format";
import type { Command } from "../../src/domain/engine";
import { partnerEntryId } from "../../src/domain/partner-ledger";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";

assertDevelopmentDatabase(process.env);
const db = new PrismaClient();
const users: string[] = [];
const month = "2026-10";

after(async () => {
  await db.workspace.deleteMany({
    where: { budgetMembers: { some: { userId: { in: users } } } },
  });
  await db.user.deleteMany({ where: { clerkUserId: { in: users } } });
  await db.$disconnect();
});

// A person with a budget, a checking account, and a Food category, whose
// profile gives their first name.
async function member(firstName: string) {
  const id = `test-disconnect-${randomUUID()}`;
  users.push(id);
  const api = createCaller({
    db,
    userId: id,
    headers: new Headers({ [CLIENT_FORMAT_HEADER]: String(CLIENT_FORMAT) }),
    revision: new ObservedRevision(),
  });
  await api.budget.onboard({
    name: `${firstName}’s budget`,
    month,
    timezone: "America/Los_Angeles",
  });
  await db.user.update({ where: { clerkUserId: id }, data: { firstName } });
  const run = async (command: Command) => {
    const state = await api.budget.state({ month });
    return api.budget.execute({
      command,
      baseRevision: state.revision,
      clientId: "disconnect-test",
    });
  };
  await run({
    type: "account.add",
    id: randomUUID(),
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
    date: `${month}-01`,
  });
  await run({
    type: "category.add",
    id: randomUUID(),
    categoryId: "food",
    name: "Food",
  });
  const view = async () => (await api.budget.state({ month })).view!;
  return { id, api, run, view };
}

const shared = (transactionId: string, amount: number, share: number) =>
  ({
    type: "transaction.upsert",
    id: randomUUID(),
    transactionId,
    accountId: "checking",
    amount,
    date: `${month}-02`,
    payee: "Market",
    categoryId: "food",
    counterpartyShare: { accountId: "counterparty:partner", amount: share },
  }) satisfies Command;

const workspaceOf = async (userId: string) =>
  (
    await db.workspaceMember.findUniqueOrThrow({
      where: { clerkUserId: userId },
    })
  ).workspaceId;

void test("disconnecting splits the household and freezes the partner ledger on both sides", async () => {
  const jordan = await member("Jordan");
  const alex = await member("Alex");
  await alex.api.budget.join({ code: (await jordan.api.budget.invite()).code });
  await jordan.run(shared("dinner", -10_000, 5_000));
  await alex.run(shared("groceries", -6_000, 3_000));
  await alex.run({
    type: "partner.categorize",
    id: randomUUID(),
    entryId: partnerEntryId(jordan.id, "dinner", "dinner"),
    categoryId: "food",
  });
  const before = { jordan: await jordan.view(), alex: await alex.view() };
  const partnerBalance = (view: typeof before.jordan) =>
    view.accounts.find((account) => account.kind === "partner")?.balance;
  assert.equal(partnerBalance(before.jordan), 2_000);
  assert.equal(partnerBalance(before.alex), -2_000);

  await jordan.api.budget.disconnect();

  assert.notEqual(await workspaceOf(jordan.id), await workspaceOf(alex.id));
  for (const [person, view, formerName, balance] of [
    [jordan, await jordan.view(), "Alex", 2_000],
    [alex, await alex.view(), "Jordan", -2_000],
  ] as const) {
    const was = before[person === jordan ? "jordan" : "alex"];
    assert.equal(view.members.length, 1, "each person is on their own");
    assert.equal(partnerBalance(view), undefined, "the partner slot is free");
    const closed = view.accounts.filter((a) => a.kind === "former-partner");
    assert.equal(closed.length, 1);
    assert.equal(closed[0]!.name, formerName);
    assert.equal(closed[0]!.balance, balance, "the balance is frozen");
    assert.equal(closed[0]!.closed?.by, jordan.id, "who disconnected");
    assert.equal(view.readyToAssign, was.readyToAssign);
    assert.equal(view.cash, was.cash);
    assert.deepEqual(
      view.categories.find((category) => category.id === "food")?.activity,
      was.categories.find((category) => category.id === "food")?.activity,
      "the history stays spent where it was",
    );
    assert.equal(
      view.formerPartnerLedgers[closed[0]!.id]?.length,
      2,
      "both shared purchases stay in the closed account's register",
    );
    // Nothing new reaches the closed account, nor changes what it holds.
    await assert.rejects(
      () =>
        person.run({
          ...shared(`late-${person.id}`, -2_000, 1_000),
          counterpartyShare: { accountId: closed[0]!.id, amount: 1_000 },
        }),
      { message: /frozen/ },
    );
  }
  await assert.rejects(
    () =>
      jordan.run({
        ...shared("dinner", -20_000, 10_000),
        counterpartyShare: undefined,
      }),
    { message: /frozen/ },
  );
  await assert.rejects(() => alex.api.budget.disconnect(), {
    message: /partner/,
  });

  // Partnering again, even with the same person, opens a fresh ledger.
  await jordan.api.budget.join({ code: (await alex.api.budget.invite()).code });
  const again = await jordan.view();
  assert.equal(partnerBalance(again), 0);
  assert.equal(
    again.accounts.find((account) => account.kind === "former-partner")
      ?.balance,
    2_000,
  );
  assert.equal(again.readyToAssign, before.jordan.readyToAssign);
});
