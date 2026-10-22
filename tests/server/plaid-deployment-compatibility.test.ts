import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTransactionSync,
  normalizePlaidTransaction,
} from "../../src/server/integrations/transactions";
import type { BankMapping } from "../../src/server/services/bank-account-setup";
import type { ImportRowState } from "../../src/server/services/bank-import-rows";
import { applyQuarantine } from "../../src/server/services/bank-quarantine";
import {
  bankAccountDetails,
  bankInboxItems,
  readBankConnection,
} from "../../src/server/services/banks";

// The inbox of a connection whose column holds these details, with its
// import state in rows (ADR 0006).
function inbox(
  column: unknown,
  rows?: Partial<ImportRowState>,
  accountMappings: Record<string, BankMapping> = {},
) {
  const connection = {
    id: "connection-alice",
    clerkUserId: "alice",
    imports: column,
    accountMappings,
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
                  {
                    records: [],
                    resolved: {},
                    errors: {},
                    reviews: {},
                    ...rows,
                  },
                ],
              ]
            : [],
        ),
      ),
    ],
    undefined,
  );
}

void test("budget loading accepts Plaid metadata and only shows imports after their account is added", async () => {
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
  assert.deepEqual(inbox(metadata, { records }), []);
  const items = inbox(
    metadata,
    { records },
    {
      "provider-checking": {
        accountId: "checking",
        startDate: "2026-10-01",
      },
    },
  );
  assert.equal(items.length, 1);
  assert.equal(items[0]!.payee, "Bookshop");
  assert.equal(items[0]!.amount, -1250);
  assert.equal(items[0]!.providerAccountId, "provider-checking");
  assert.equal(items[0]!.accountId, "checking");
  // Import state the column held before rows is never read from it.
  assert.deepEqual(inbox(imports), []);
});

void test("the bank inbox only shows unreadable transactions for accounts that have been added", () => {
  const reviews = applyQuarantine(
    {},
    "connection-alice",
    { added: [], modified: [], removed: [] },
    [
      {
        providerTransactionId: "checking-purchase",
        providerAccountId: "provider-checking",
        reason: "unsupported_currency",
        pending: false,
        date: "2026-10-20",
        name: "Checking purchase",
        amount: 12.5,
        currency: "CAD",
      },
      {
        providerTransactionId: "unadded-purchase",
        providerAccountId: "provider-unadded",
        reason: "unreadable",
        pending: false,
        date: "2026-10-20",
        name: "Unadded account purchase",
        amount: null,
        currency: "USD",
      },
    ],
    "2026-10-20",
  );

  const items = inbox(
    {},
    { reviews },
    {
      "provider-checking": {
        accountId: "checking",
        startDate: "2026-10-01",
      },
    },
  );
  assert.deepEqual(
    items.map(({ payee, accountId, quarantined }) => ({
      payee,
      accountId,
      quarantined,
    })),
    [{ payee: "Checking purchase", accountId: "checking", quarantined: true }],
  );
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
