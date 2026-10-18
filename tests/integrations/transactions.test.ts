import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTransactionSync,
  findManualMatchCandidates,
  normalizePlaidTransaction,
  storedImportsSchema,
  type TransactionSyncDelta,
} from "../../src/server/integrations/transactions";

const raw = (overrides: Record<string, unknown> = {}) => ({
  transaction_id: "pending-1",
  account_id: "card-1",
  pending_transaction_id: null,
  pending: true,
  amount: 30,
  iso_currency_code: "USD",
  date: "2026-10-10",
  authorized_date: "2026-10-10",
  name: "Cafe",
  merchant_name: "Cafe",
  ...overrides,
});
const empty = (): TransactionSyncDelta => ({
  added: [],
  modified: [],
  removed: [],
});

void test("USD import preserves integer cents, sign, and rejects unsupported precision/currency/dates", () => {
  assert.equal(
    normalizePlaidTransaction(raw({ amount: 12.34 })).amountCents,
    1234,
  );
  assert.equal(
    normalizePlaidTransaction(raw({ amount: -12.34 })).amountCents,
    -1234,
  );
  assert.throws(() => normalizePlaidTransaction(raw({ amount: 12.345 })));
  assert.throws(() =>
    normalizePlaidTransaction(raw({ iso_currency_code: "EUR" })),
  );
  assert.throws(() => normalizePlaidTransaction(raw({ date: "2026-02-30" })));
  assert.throws(() =>
    normalizePlaidTransaction(raw({ pending_transaction_id: "pending-1" })),
  );
});

void test("restaurant $30 authorization becomes one $36 purchase and retains category and inspectable history", () => {
  const first = applyTransactionSync(
    [],
    { ...empty(), added: [normalizePlaidTransaction(raw())] },
    "item-1",
  );
  first.records[0]!.categoryId = "dining";
  const posted = normalizePlaidTransaction(
    raw({
      transaction_id: "posted-1",
      pending_transaction_id: "pending-1",
      pending: false,
      amount: 36,
      date: "2026-10-12",
    }),
  );
  const next = applyTransactionSync(
    first.records,
    {
      ...empty(),
      added: [posted],
      removed: [
        { providerTransactionId: "pending-1", providerAccountId: "card-1" },
      ],
    },
    "item-1",
  );
  assert.equal(next.records.length, 1);
  assert.equal(next.records[0]!.id, first.records[0]!.id);
  assert.equal(next.records[0]!.current.amountCents, 3600);
  assert.equal(next.records[0]!.categoryId, "dining");
  assert.equal(next.records[0]!.removed, false);
  assert.equal(next.records[0]!.history[1]!.kind, "pending_posted");
  assert.deepEqual(next.records[0]!.providerTransactionIds, [
    "pending-1",
    "posted-1",
  ]);
  assert.equal(next.changes[0]!.before!.current.amountCents, 3000);
  assert.equal(next.changes[0]!.after.current.amountCents, 3600);
});

void test("replaying additions, modifications, pending aliases and removals has no additional effects", () => {
  const pending = normalizePlaidTransaction(raw());
  const posted = normalizePlaidTransaction(
    raw({
      transaction_id: "posted-1",
      pending_transaction_id: "pending-1",
      pending: false,
      amount: 36,
    }),
  );
  const delta = {
    ...empty(),
    added: [posted, pending],
    removed: [
      { providerTransactionId: "pending-1", providerAccountId: "card-1" },
    ],
  };
  const first = applyTransactionSync([], delta, "item-1");
  const replay = applyTransactionSync(first.records, delta, "item-1");
  assert.deepEqual(replay.changes, []);
  assert.equal(replay.records.length, 1);
  const removed = {
    ...empty(),
    added: [posted],
    removed: [
      { providerTransactionId: "posted-1", providerAccountId: "card-1" },
    ],
  };
  const deleted = applyTransactionSync(first.records, removed, "item-1");
  assert.equal(deleted.records[0]!.removed, true);
  assert.deepEqual(
    applyTransactionSync(deleted.records, removed, "item-1").changes,
    [],
  );
});

void test("posted modifications and removals update the existing logical record only", () => {
  const posted = normalizePlaidTransaction(
    raw({ transaction_id: "posted-1", pending: false }),
  );
  const first = applyTransactionSync(
    [],
    { ...empty(), added: [posted] },
    "item-1",
  );
  const changed = { ...posted, amountCents: 3500 };
  const modified = applyTransactionSync(
    first.records,
    { ...empty(), modified: [changed] },
    "item-1",
  );
  assert.equal(modified.records[0]!.current.amountCents, 3500);
  assert.equal(modified.records[0]!.history.at(-1)!.kind, "modified");
  assert.deepEqual(
    applyTransactionSync(
      modified.records,
      { ...empty(), modified: [changed] },
      "item-1",
    ).changes,
    [],
  );
  const removed = applyTransactionSync(
    modified.records,
    {
      ...empty(),
      removed: [
        { providerTransactionId: "posted-1", providerAccountId: "card-1" },
      ],
    },
    "item-1",
  );
  assert.equal(removed.records.length, 1);
  assert.equal(removed.records[0]!.removed, true);
  assert.equal(removed.changes.length, 1);
});

void test("explicit posting evidence works after the pending record was removed in an earlier sync", () => {
  const first = applyTransactionSync(
    [],
    {
      ...empty(),
      added: [normalizePlaidTransaction(raw())],
      removed: [
        { providerTransactionId: "pending-1", providerAccountId: "card-1" },
      ],
    },
    "item-1",
  );
  first.records[0]!.categoryId = "dining";
  const next = applyTransactionSync(
    first.records,
    {
      ...empty(),
      added: [
        normalizePlaidTransaction(
          raw({
            transaction_id: "posted-1",
            pending_transaction_id: "pending-1",
            pending: false,
            amount: 36,
          }),
        ),
      ],
    },
    "item-1",
  );
  assert.equal(next.records.length, 1);
  assert.equal(next.records[0]!.removed, false);
  assert.equal(next.records[0]!.categoryId, "dining");
});

void test("merchant/date similarities require review and equal amounts alone never merge", () => {
  const first = applyTransactionSync(
    [],
    { ...empty(), added: [normalizePlaidTransaction(raw())] },
    "item-1",
  );
  const next = applyTransactionSync(
    first.records,
    {
      ...empty(),
      added: [
        normalizePlaidTransaction(
          raw({ transaction_id: "posted-1", pending: false, amount: 36 }),
        ),
      ],
    },
    "item-1",
  );
  assert.equal(next.records.length, 2);
  assert.equal(next.reviewItems.length, 1);
  assert.equal(next.records[1]!.matchStatus, "needs_review");
  const other = applyTransactionSync(
    first.records,
    {
      ...empty(),
      added: [
        normalizePlaidTransaction(
          raw({
            transaction_id: "posted-2",
            pending: false,
            merchant_name: "Other store",
            amount: 30,
          }),
        ),
      ],
    },
    "item-1",
  );
  assert.equal(other.records.length, 2);
  assert.equal(other.reviewItems.length, 0);
  assert.equal(
    findManualMatchCandidates(normalizePlaidTransaction(raw()), [
      {
        id: "manual",
        accountId: "card-1",
        date: "2026-10-10",
        merchant: "Other store",
        amountCents: 3000,
      },
    ]).length,
    0,
  );
});

void test("cross-account identity evidence is quarantined and does not alter bank facts", () => {
  const first = applyTransactionSync(
    [],
    { ...empty(), added: [normalizePlaidTransaction(raw())] },
    "item-1",
  );
  const next = applyTransactionSync(
    first.records,
    {
      ...empty(),
      added: [
        normalizePlaidTransaction(
          raw({
            transaction_id: "posted-1",
            pending_transaction_id: "pending-1",
            pending: false,
            account_id: "other-account",
            amount: 36,
          }),
        ),
      ],
    },
    "item-1",
  );
  assert.equal(next.records.length, 1);
  assert.equal(next.records[0]!.current.amountCents, 3000);
  assert.equal(next.records[0]!.matchStatus, "needs_review");
  assert.equal(next.reviewItems[0]!.kind, "conflicting_identity");
});

void test("provider IDs are scoped by connected item and preserve input immutability", () => {
  const first = applyTransactionSync(
    [],
    { ...empty(), added: [normalizePlaidTransaction(raw())] },
    "item-1",
  );
  const before = structuredClone(first.records);
  const next = applyTransactionSync(
    first.records,
    { ...empty(), added: [normalizePlaidTransaction(raw())] },
    "item-2",
  );
  assert.equal(next.records.length, 2);
  assert.notEqual(next.records[0]!.id, next.records[1]!.id);
  assert.deepEqual(first.records, before);
});

void test("stored import runtime validation rejects corrupted or extra database JSON fields", () => {
  const result = applyTransactionSync(
    [],
    { ...empty(), added: [normalizePlaidTransaction(raw())] },
    "item-1",
  );
  assert.deepEqual(storedImportsSchema.parse(result.records), result.records);
  assert.throws(() =>
    storedImportsSchema.parse([
      { ...result.records[0], providerTransactionIds: ["other-id"] },
    ]),
  );
  assert.throws(() =>
    storedImportsSchema.parse([
      { ...result.records[0], accessToken: "secret" },
    ]),
  );
});
