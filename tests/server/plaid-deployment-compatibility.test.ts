import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTransactionSync,
  normalizePlaidTransaction,
} from "../../src/server/integrations/transactions";
import { bankAccountDetails, bankInbox } from "../../src/server/services/banks";
import { type Database } from "../../src/server/services/workspace";

function database(imports: unknown): Database {
  return {
    bankConnection: {
      findMany: async ({ where }: { where: { clerkUserId: string } }) => {
        assert.equal(where.clerkUserId, "alice");
        return [{ id: "connection-alice", imports, accountMappings: {} }];
      },
    },
    workspaceMember: { findUnique: async () => null },
  } as unknown as Database;
}

void test("budget loading accepts persisted Plaid account metadata alongside import history", async () => {
  const records = applyTransactionSync(
    [],
    {
      added: [
        normalizePlaidTransaction({
          transaction_id: "purchase-one",
          account_id: "provider-checking",
          pending: false,
          amount: 12.5,
          iso_currency_code: "USD",
          date: "2026-10-20",
          name: "Bookshop",
        }),
      ],
      modified: [],
      removed: [],
    },
    "connection-alice",
  ).records;
  const metadata = {
    accounts: [
      {
        accountId: "provider-checking",
        name: "Checking",
        officialName: null,
        mask: "1111",
        type: "depository",
        subtype: "checking",
        currentBalance: 1200.5,
        availableBalance: 1190,
        currency: "USD",
      },
    ],
    institutionId: "institution-one",
    institutionName: "Example Bank",
    transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
    synchronizedAccountIds: ["provider-checking"],
  };
  const imports = {
    records,
    resolved: {},
    errors: {},
    reviews: {},
    ...metadata,
  };

  assert.deepEqual(bankAccountDetails(imports), metadata);
  const inbox = await bankInbox(database(imports), "alice");
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0]!.payee, "Bookshop");
  assert.equal(inbox[0]!.amount, -1250);
  assert.equal(inbox[0]!.providerAccountId, "provider-checking");
});

void test("budget loading still accepts connections saved before Plaid account metadata", async () => {
  const imports = { records: [], resolved: {}, errors: {} };

  assert.deepEqual(bankAccountDetails(imports), {
    accounts: [],
    institutionId: null,
    institutionName: null,
    transactionStatus: null,
    synchronizedAccountIds: [],
  });
  assert.deepEqual(await bankInbox(database(imports), "alice"), []);
});
