import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTransactionSync,
  normalizePlaidTransaction,
} from "../../src/server/integrations/transactions";
import {
  bankAccountDetails,
  bankInboxItems,
  readBankConnection,
} from "../../src/server/services/banks";

// The inbox of a connection whose column holds these details, with its
// import state in rows (ADR 0006).
function inbox(column: unknown, rows?: { records: unknown[] }) {
  const connection = {
    id: "connection-alice",
    clerkUserId: "alice",
    imports: column,
    accountMappings: {},
  };
  return bankInboxItems(
    [
      readBankConnection(
        connection,
        new Map(
          rows
            ? [
                [
                  connection.id,
                  { resolved: {}, errors: {}, reviews: {}, ...rows } as never,
                ],
              ]
            : [],
        ),
      ),
    ],
    undefined,
  );
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
  const items = inbox(metadata, { records });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.payee, "Bookshop");
  assert.equal(items[0]!.amount, -1250);
  assert.equal(items[0]!.providerAccountId, "provider-checking");
  // Import state the column held before rows is never read from it.
  assert.deepEqual(inbox(imports), []);
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
  assert.deepEqual(inbox(imports), []);
});
