import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { mock } from "node:test";
import {
  addMember,
  createBook,
  execute,
  withCounterpartyAccounts,
} from "../../src/domain/engine";
import {
  CLIENT_FORMAT,
  CLIENT_FORMAT_HEADER,
} from "../../src/domain/client-format";
import { bookToRows } from "../../src/domain/rows";
import { PrismaClient } from "../../src/generated/prisma";
import { createCaller } from "../../src/server/api/root";
import { ObservedRevision } from "../../src/server/api/trpc";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import {
  applyTransactionSync,
  normalizePlaidTransaction,
} from "../../src/server/integrations/transactions";
import { importStateRows } from "../../src/server/services/bank-import-rows";
import { bankInbox, syncBanks } from "../../src/server/services/banks";
import { settleFromImports } from "../../src/server/services/partner-settlements";
import { replaceRows } from "../../src/server/storage/rows";
import { encryptBankToken } from "../../src/server/token-crypto";

const url = new URL(process.env.DATABASE_URL!);
if (!(
  url.hostname === "127.0.0.1" &&
  url.pathname === "/caishen_test_settlement_rejection"
))
  assertDevelopmentDatabase(process.env);
const db = new PrismaClient();

void test("rejecting a settlement returns both imports to review and later syncs leave them unmatched", async () => {
  const suffix = randomUUID();
  const alan = `test-settlement-alan-${suffix}`;
  const anna = `test-settlement-anna-${suffix}`;
  const workspaceId = `test-settlement-${suffix}`;
  const previous = { ...process.env };
  process.env.PLAID_CLIENT_ID = "settlement-test";
  process.env.PLAID_SECRET = "settlement-test";
  process.env.PLAID_ENV = "sandbox";
  process.env.BANK_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
  try {
    await db.user.createMany({
      data: [
        { clerkUserId: alan, firstName: "Alan", active: true },
        { clerkUserId: anna, firstName: "Anna", active: true },
      ],
    });
    await db.workspace.create({ data: { id: workspaceId, revision: 1 } });
    await db.workspaceMember.createMany({
      data: [alan, anna].map((clerkUserId) => ({ clerkUserId, workspaceId })),
    });
    let book = withCounterpartyAccounts(
      addMember(createBook(alan, "Alan", "2026-10"), anna, "Anna", "2026-10"),
    );
    const imports = [];
    for (const [userId, amount, payee] of [
      [alan, -50, "Venmo from Anna"],
      [anna, 50, "Venmo to Alan"],
    ] as const) {
      book = execute(book, userId, {
        type: "account.add",
        id: `checking-${userId}`,
        accountId: "checking",
        name: "Checking",
        kind: "cash",
        openingBalance: 100_000,
      });
      const connectionId = `connection-${userId}`;
      await db.bankConnection.create({
        data: {
          id: connectionId,
          clerkUserId: userId,
          itemId: `item-${userId}`,
          encryptedToken: encryptBankToken("test-access-token", userId),
          cursor: "initial",
          imports: {},
          accountMappings: {
            "provider-checking": {
              accountId: "checking",
              startDate: "2026-10-01",
            },
          },
        },
      });
      const fact = normalizePlaidTransaction({
        transaction_id: `payment-${userId}`,
        account_id: "provider-checking",
        pending: false,
        amount,
        iso_currency_code: "USD",
        date: "2026-10-12",
        name: payee,
      });
      const records = applyTransactionSync(
        [],
        { added: [fact], modified: [], removed: [] },
        connectionId,
      ).records;
      imports.push(
        ...importStateRows(userId, connectionId, {
          records,
          resolved: {},
          errors: {},
          reviews: {},
        }),
      );
    }
    await replaceRows(db, workspaceId, [...bookToRows(book), ...imports], 1);
    const caller = (userId: string) =>
      createCaller({
        db,
        userId,
        headers: new Headers({ [CLIENT_FORMAT_HEADER]: String(CLIENT_FORMAT) }),
        revision: new ObservedRevision(),
      });
    const api = caller(alan);
    assert.deepEqual(await settleFromImports(db, alan), {
      settled: 1,
      repaid: 0,
    });
    assert.deepEqual(await bankInbox(db, alan), []);
    assert.deepEqual(await bankInbox(db, anna), []);
    const matched = await api.budget.state({ month: "2026-10" });
    assert.ok(matched.view);
    const settlement = matched.view.partnerSettlements[0]!;
    await api.budget.execute({
      command: {
        type: "partner.settlement.reject",
        id: randomUUID(),
        settlementId: settlement.id,
      },
      baseRevision: matched.revision,
      clientId: "test",
    });
    assert.deepEqual(
      (await bankInbox(db, alan)).map((item) => [item.payee, item.amount]),
      [["Venmo from Anna", 5_000]],
    );
    assert.deepEqual(
      (await bankInbox(db, anna)).map((item) => [item.payee, item.amount]),
      [["Venmo to Alan", -5_000]],
    );
    mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      const path = new URL(input instanceof Request ? input.url : input)
        .pathname;
      const accounts = [
        {
          account_id: "provider-checking",
          name: "Checking",
          official_name: null,
          mask: "1234",
          type: "depository",
          subtype: "checking",
          balances: {
            current: 1000,
            available: 1000,
            iso_currency_code: "USD",
            unofficial_currency_code: null,
          },
        },
      ];
      return Response.json(
        path === "/transactions/sync"
          ? {
              added: [],
              modified: [],
              removed: [],
              accounts,
              next_cursor: "next",
              has_more: false,
              transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
            }
          : {
              accounts,
              item: { institution_id: "test", institution_name: "Test" },
            },
      );
    });
    for (const userId of [alan, anna]) {
      await syncBanks(db, userId);
      const state = await caller(userId).budget.state({ month: "2026-10" });
      assert.ok(state.view);
      assert.equal(
        state.view.accounts.find((item) => item.id === "checking")!.balance,
        100_000,
      );
      assert.deepEqual(state.view.partnerSettlements, []);
      assert.equal(state.imports.length, 1);
    }
  } finally {
    mock.restoreAll();
    for (const key of [
      "PLAID_CLIENT_ID",
      "PLAID_SECRET",
      "PLAID_ENV",
      "BANK_TOKEN_ENCRYPTION_KEY",
    ]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await db.bankConnection.deleteMany({
      where: { clerkUserId: { in: [alan, anna] } },
    });
    await db.workspace.deleteMany({ where: { id: workspaceId } });
    await db.user.deleteMany({ where: { clerkUserId: { in: [alan, anna] } } });
    await db.$disconnect();
  }
});
