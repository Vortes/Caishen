import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";

import { Prisma, PrismaClient } from "../../src/generated/prisma";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";

// The database, not code, refuses two live feeds into one budget account and
// a feed with no provider account behind it (ADR 0009). Nothing in this
// release writes these tables; the inserts here stand in for the writer.
assertDevelopmentDatabase(process.env);

async function fixture(t: TestContext) {
  const db = new PrismaClient();
  const userId = `test-bank-links-${randomUUID()}`;
  await db.user.create({ data: { clerkUserId: userId } });
  const connection = await db.bankConnection.create({
    data: {
      clerkUserId: userId,
      itemId: `item-${randomUUID()}`,
      encryptedToken: "",
      imports: {},
      accountMappings: {},
    },
  });
  t.after(async () => {
    await db.bankConnection.deleteMany({ where: { clerkUserId: userId } });
    await db.user.deleteMany({ where: { clerkUserId: userId } });
    await db.$disconnect();
  });
  const providerAccount = (
    providerAccountId: string,
    data: Partial<Prisma.BankAccountUncheckedCreateInput> = {},
  ) =>
    db.bankAccount.create({
      data: {
        connectionId: connection.id,
        providerAccountId,
        name: providerAccountId,
        type: "depository",
        subtype: "checking",
        mask: "1234",
        currency: "USD",
        ...data,
      },
    });
  const budgetAccount = { workspaceId: "household", userId, accountId: "cash" };
  const link = (
    bankAccountId: string,
    data: Partial<Prisma.BankAccountLinkUncheckedCreateInput> = {},
  ) =>
    db.bankAccountLink.create({
      data: {
        bankAccountId,
        ...budgetAccount,
        startDate: "2026-10-01",
        ...data,
      },
    });
  return { db, connection, providerAccount, link };
}

const refused = (code: string) => (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

void test("a budget account accepts one live link; a second live link and a link without a provider account are refused", async (t) => {
  const f = await fixture(t);
  const checking = await f.providerAccount("provider-checking");
  const renamed = await f.providerAccount("provider-checking-renamed");
  const earlier = await f.providerAccount("provider-checking-earlier");

  // A feed that ended keeps its history and leaves the budget account free.
  await f.link(earlier.id, { unlinkedAt: new Date("2026-09-30T00:00:00Z") });
  await f.link(checking.id);
  await assert.rejects(f.link(renamed.id), refused("P2002"));
  await assert.rejects(
    f.link("no-such-provider-account", { accountId: "savings" }),
    refused("P2003"),
  );

  // The same provider account cannot carry two links either.
  await assert.rejects(
    f.link(checking.id, { accountId: "savings" }),
    refused("P2002"),
  );
});

void test("one connection holds a persistent account id once among shared rows, and again on the row it retired", async (t) => {
  const f = await fixture(t);
  await f.providerAccount("provider-old", {
    persistentAccountId: "persistent-1",
    status: "retired",
  });
  await f.providerAccount("provider-new", {
    persistentAccountId: "persistent-1",
  });
  await assert.rejects(
    f.providerAccount("provider-duplicate", {
      persistentAccountId: "persistent-1",
    }),
    refused("P2002"),
  );
  // The same Plaid id cannot appear twice on one connection.
  await assert.rejects(f.providerAccount("provider-new"), refused("P2002"));
  // Two rows without a persistent id never collide.
  await f.providerAccount("provider-plain-one");
  await f.providerAccount("provider-plain-two");
});
