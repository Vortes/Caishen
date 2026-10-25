import assert from "node:assert/strict";
import test from "node:test";

import { createBook, execute, projectBook } from "../../src/domain/engine";
import { type BankAccount } from "../../src/server/integrations/plaid";
import {
  applyTransactionSync,
  normalizePlaidTransaction,
} from "../../src/server/integrations/transactions";
import {
  bankAccountOpening,
  bankImportEligibility,
  bankMappingsSchema,
  openingSnapshot,
} from "../../src/server/services/bank-account-setup";

const account: BankAccount = {
  accountId: "checking",
  name: "Chase checking",
  officialName: null,
  mask: "1234",
  type: "depository",
  subtype: "checking",
  currentBalance: 1200.5,
  availableBalance: 1100,
  currency: "USD",
};
const fact = (id: string, date: string, pending = false) =>
  normalizePlaidTransaction({
    transaction_id: id,
    account_id: "checking",
    pending,
    amount: 20,
    iso_currency_code: "USD",
    date,
    name: "Coffee",
  });

void test("bank metadata creates cash and credit balances without treating debt as Ready to Assign", () => {
  let book = createBook("alice", "Alice", "2026-10");
  for (const [id, name, provider] of [
    ["cash", "Daily checking", account],
    [
      "card",
      "Travel card",
      {
        ...account,
        type: "credit",
        subtype: "credit card",
        currentBalance: 200.25,
      },
    ],
  ] as const) {
    book = execute(book, "alice", {
      type: "account.add",
      id,
      accountId: id,
      name,
      date: "2026-10-19",
      ...bankAccountOpening(provider),
    });
  }
  const view = projectBook(book, "alice", "2026-10");
  assert.equal(view.cash, 120050);
  assert.equal(view.readyToAssign, 120050);
  assert.equal(
    view.accounts.find((value) => value.id === "card")!.balance,
    -20025,
  );
  assert.equal(view.budget.categories[0]!.name, "Travel card payment");
});

void test("bank account setup rejects unavailable, unsupported, non-USD, fractional-cent and unsafe balances", () => {
  for (const patch of [
    { type: "investment" },
    { type: "loan" },
    { type: "credit", subtype: "line of credit" },
    { currency: "CAD" },
    { currency: null },
    { currentBalance: null },
    { currentBalance: 1.001 },
    { currentBalance: Infinity },
    { currentBalance: Number.MAX_SAFE_INTEGER },
  ])
    assert.throws(() => bankAccountOpening({ ...account, ...patch }));
  assert.deepEqual(
    bankAccountOpening({
      ...account,
      type: "credit",
      subtype: "credit card",
      currentBalance: 0,
    }),
    { kind: "credit", openingBalance: 0 },
  );
});

void test("opening snapshot excludes posted baseline, retains same-day new activity, and only imports pending successors once", () => {
  const initial = applyTransactionSync(
    [],
    {
      added: [
        fact("history", "2026-10-01"),
        fact("posted-today", "2026-10-19"),
        fact("pending-today", "2026-10-19", true),
        fact("pending-before", "2026-10-18", true),
      ],
      modified: [],
      removed: [],
    },
    "connection",
  ).records;
  const mapping = {
    accountId: "cash",
    startDate: "2026-10-19",
    openingSnapshot: openingSnapshot(initial, "checking"),
  };
  const initialRecord = (id: string) =>
    initial.find((record) => record.current.providerTransactionId === id)!;
  assert.equal(
    bankImportEligibility(mapping, initialRecord("history")),
    "opening_snapshot",
  );
  assert.equal(
    bankImportEligibility(mapping, initialRecord("posted-today")),
    "opening_snapshot",
  );
  assert.equal(
    bankImportEligibility(mapping, initialRecord("pending-today")),
    "eligible",
  );
  assert.equal(
    bankImportEligibility(mapping, initialRecord("pending-before")),
    "before_start",
  );
  const posted = {
    ...fact("posted-pending", "2026-10-19"),
    pendingTransactionId: "pending-before",
  };
  const next = applyTransactionSync(
    initial,
    {
      added: [posted, fact("later-today", "2026-10-19")],
      modified: [],
      removed: [],
    },
    "connection",
  );
  const successor = next.records.find(
    (record) => record.current.providerTransactionId === "posted-pending",
  )!;
  assert.equal(successor.id, initialRecord("pending-before").id);
  assert.equal(bankImportEligibility(mapping, successor), "eligible");
  assert.equal(
    bankImportEligibility(mapping, next.records.at(-1)!),
    "eligible",
  );
  assert.equal(
    applyTransactionSync(
      next.records,
      { added: [posted], modified: [], removed: [] },
      "connection",
    ).changes.length,
    0,
  );
});

void test("changes to posted opening activity require investigation instead of becoming a second purchase", () => {
  const records = applyTransactionSync(
    [],
    { added: [fact("baseline", "2026-10-19")], modified: [], removed: [] },
    "connection",
  ).records;
  const mapping = {
    accountId: "cash",
    startDate: "2026-10-19",
    openingSnapshot: openingSnapshot(records, "checking"),
  };
  const modified = applyTransactionSync(
    records,
    {
      added: [],
      modified: [{ ...records[0]!.current, amountCents: 2500 }],
      removed: [],
    },
    "connection",
  ).records[0]!;
  assert.equal(
    bankImportEligibility(mapping, modified),
    "opening_snapshot_changed",
  );
  const removed = applyTransactionSync(
    records,
    {
      added: [],
      modified: [],
      removed: [
        { providerTransactionId: "baseline", providerAccountId: "checking" },
      ],
    },
    "connection",
  ).records[0]!;
  assert.equal(
    bankImportEligibility(mapping, removed),
    "opening_snapshot_changed",
  );
});

void test("legacy mappings retain their explicit import start without a current-balance snapshot", () => {
  const mappings = bankMappingsSchema.parse({
    checking: { accountId: "cash", startDate: "2026-10-19" },
  });
  const before = applyTransactionSync(
    [],
    { added: [fact("before", "2026-10-18")], modified: [], removed: [] },
    "connection",
  ).records[0]!;
  assert.equal(
    bankImportEligibility(mappings.checking, before),
    "before_start",
  );
  assert.equal(bankImportEligibility(undefined, before), "eligible");
});

void test("opening snapshots quarantine uncertain pending matches while normal pending successors remain importable", () => {
  const initial = applyTransactionSync(
    [],
    {
      added: [
        fact("ambiguous-pending", "2026-10-19", true),
        fact("ambiguous-posted", "2026-10-19"),
        {
          ...fact("normal-pending", "2026-10-19", true),
          name: "Bus fare",
          amountCents: 3000,
        },
        {
          ...fact("private-pending", "2026-10-19", true),
          providerAccountId: "other-account",
        },
      ],
      modified: [],
      removed: [],
    },
    "connection",
  );
  const record = (id: string) =>
    initial.records.find((item) => item.current.providerTransactionId === id)!;
  const uncertain = record("ambiguous-pending");
  const normal = record("normal-pending");
  assert.equal(uncertain.matchStatus, "confirmed");
  assert.equal(initial.reviewItems.length, 1);
  const review = initial.reviewItems[0]!;
  const mapping = {
    accountId: "cash",
    startDate: "2026-10-19",
    openingSnapshot: openingSnapshot(initial.records, "checking", {
      [review.logicalTransactionId]: [
        {
          ...review,
          candidateIds: [...review.candidateIds, record("private-pending").id],
        },
      ],
    }),
  };
  assert.deepEqual(mapping.openingSnapshot.reviewImportIds, [uncertain.id]);
  assert.equal(
    bankImportEligibility(mapping, uncertain),
    "opening_snapshot_changed",
  );
  assert.equal(
    bankImportEligibility(mapping, record("ambiguous-posted")),
    "opening_snapshot",
  );
  assert.equal(bankImportEligibility(mapping, normal), "eligible");

  const next = applyTransactionSync(
    initial.records,
    {
      added: [
        {
          ...fact("ambiguous-successor", "2026-10-19"),
          pendingTransactionId: "ambiguous-pending",
        },
        {
          ...fact("normal-successor", "2026-10-19"),
          pendingTransactionId: "normal-pending",
          name: "Bus fare",
          amountCents: 3000,
        },
      ],
      modified: [],
      removed: [],
    },
    "connection",
  );
  const ambiguousSuccessor = next.records.find(
    (item) => item.id === uncertain.id,
  )!;
  const normalSuccessor = next.records.find((item) => item.id === normal.id)!;
  assert.equal(
    bankImportEligibility(mapping, ambiguousSuccessor),
    "opening_snapshot_changed",
  );
  assert.equal(bankImportEligibility(mapping, normalSuccessor), "eligible");
});

void test("a pending record with conflicting identity is quarantined even when saved review evidence is unavailable", () => {
  const records = applyTransactionSync(
    [],
    {
      added: [fact("conflict", "2026-10-19", true)],
      modified: [],
      removed: [],
    },
    "connection",
  ).records;
  records[0]!.matchStatus = "needs_review";
  const snapshot = openingSnapshot(records, "checking");
  assert.deepEqual(snapshot.reviewImportIds, [records[0]!.id]);
});

void test("an overpaid bank card opens with assignable credit without counting opening imports twice", () => {
  const opening = bankAccountOpening({
    ...account,
    type: "credit",
    subtype: "credit card",
    currentBalance: -100.25,
  });
  assert.deepEqual(opening, { kind: "credit", openingBalance: 10_025 });
  const book = execute(createBook("alice", "Alice", "2026-10"), "alice", {
    type: "account.add",
    id: "open",
    accountId: "card",
    name: "Overpaid card",
    date: "2026-10-19",
    ...opening,
  });
  const view = projectBook(book, "alice", "2026-10");
  assert.equal(view.readyToAssign, 10_025);
  assert.equal(view.cash, 0);
  assert.equal(view.accounts[0]!.reserve, 0);
  const records = applyTransactionSync(
    [],
    { added: [fact("old-purchase", "2026-10-19")], modified: [], removed: [] },
    "connection",
  ).records;
  const mapping = {
    accountId: "card",
    startDate: "2026-10-19",
    openingSnapshot: openingSnapshot(records, "checking"),
  };
  assert.equal(bankImportEligibility(mapping, records[0]!), "opening_snapshot");
});
