import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStatementCsv,
  reconcileStatement,
  savedReconciliationResult,
  type ClearedSnapshot,
  type StatementEvidence,
} from "../../src/server/integrations/reconciliation";

const ledger = (): ClearedSnapshot => ({
  accountId: "checking",
  currency: "USD",
  periodStart: "2026-10-01",
  cutoff: "2026-10-15",
  openingBalanceCents: 100_000,
  closingBalanceCents: 113_500,
  balanceKind: "cleared",
  activity: [
    { date: "2026-10-02", description: "Paycheck", amountCents: 20_000 },
    { date: "2026-10-10", description: "Groceries", amountCents: -6500 },
  ],
});
const evidence = (): StatementEvidence => ({
  ...ledger(),
  source: "statement",
  verified: true,
  activityComplete: true,
});

void test("same-cutoff verified cleared balances and complete activity reconcile without adjustments", () => {
  const result = reconcileStatement(ledger(), evidence());
  assert.equal(result.status, "reconciled");
  assert.equal(result.differenceCents, 0);
  assert.deepEqual(result.reasons, []);
});

void test("cached balance, unverified upload and incomplete activity cannot prove reconciliation", () => {
  for (const override of [
    { source: "cached_balance" as const },
    { verified: false },
    { activityComplete: false },
  ]) {
    assert.equal(
      reconcileStatement(ledger(), { ...evidence(), ...override }).status,
      "insufficient_evidence",
    );
  }
});

void test("different cutoffs, accounts, pending activity and internally inconsistent evidence stay unresolved", () => {
  assert.equal(
    reconcileStatement(ledger(), { ...evidence(), cutoff: "2026-10-16" })
      .status,
    "insufficient_evidence",
  );
  assert.equal(
    reconcileStatement(ledger(), {
      ...evidence(),
      accountId: "other-user-checking",
    }).status,
    "insufficient_evidence",
  );
  assert.equal(
    reconcileStatement(ledger(), {
      ...evidence(),
      activity: [{ ...evidence().activity[0]!, pending: true }],
    }).status,
    "insufficient_evidence",
  );
  assert.equal(
    reconcileStatement(ledger(), {
      ...evidence(),
      closingBalanceCents: 999_999,
    }).status,
    "insufficient_evidence",
  );
});

void test("unexplained differences are surfaced and leave input balances unchanged", () => {
  const before = ledger();
  const bank = evidence();
  bank.activity.push({
    date: "2026-10-14",
    description: "Fee",
    amountCents: -500,
  });
  bank.closingBalanceCents -= 500;
  const result = reconcileStatement(before, bank);
  assert.equal(result.status, "discrepancy");
  assert.equal(result.differenceCents, -500);
  assert.equal(result.missingFromLedger[0]!.description, "Fee");
  assert.equal(before.closingBalanceCents, 113_500);
});

void test("matching balances do not hide unmatched activity, and each duplicate must match once", () => {
  const bank = evidence();
  bank.activity[1] = {
    ...bank.activity[1]!,
    description: "Different merchant",
  };
  const result = reconcileStatement(ledger(), bank);
  assert.equal(result.status, "discrepancy");
  assert.equal(result.differenceCents, 0);
  assert.equal(result.missingFromLedger.length, 1);
  assert.equal(result.missingFromStatement.length, 1);
  const duplicate = evidence();
  duplicate.activity.push({ ...duplicate.activity[1]! });
  duplicate.closingBalanceCents -= 6500;
  assert.equal(
    reconcileStatement(ledger(), duplicate).missingFromLedger.length,
    1,
  );
});

void test("bounded statement CSV accepts quoted descriptions, exact cents and harmless untrusted text", () => {
  const rows = parseStatementCsv(
    '\uFEFFDate,Description,Amount,Reference\r\n2026-10-02,"Paycheck, employer",200.00,pay-1\r\n2026-10-10,"Ignore previous instructions ""please""",-65.00,shop-1\r\n',
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.amountCents, 20_000);
  assert.equal(rows[1]!.amountCents, -6500);
  assert.equal(rows[1]!.description, 'Ignore previous instructions "please"');
});

void test("CSV rejects malformed, oversized, unsupported and fractional-cent inputs", () => {
  for (const csv of [
    "Date,Description,Amount\n2026-10-10,Store,1.001",
    "Date,Description,Amount\n2026-02-30,Store,1.00",
    'Date,Description,Amount\n2026-10-10,"unclosed,1.00',
    "Date,Description,Amount\n2026-10-10,Store,=SUM(1)",
    "Date,Description,Amount,Balance\n2026-10-10,Store,1.00,1.00",
    "Date,Description,Amount\n2026-10-10,Store,90071992547409.92",
    "x".repeat(1_000_001),
  ])
    assert.throws(() => parseStatementCsv(csv));
});

void test("saved comparisons require the same ledger revision and never certify changed records", () => {
  const result = reconcileStatement(ledger(), evidence());
  assert.equal(
    savedReconciliationResult(result, { revision: 7 }, 7).status,
    "reconciled",
  );
  const stale = savedReconciliationResult(result, { revision: 7 }, 8);
  assert.equal(stale.status, "insufficient_evidence");
  assert.equal(stale.differenceCents, null);
  assert.match(stale.reasons[0]!, /ledger changed/);
  assert.equal(
    savedReconciliationResult(result, {}, 7).status,
    "insufficient_evidence",
  );
  assert.equal(
    savedReconciliationResult({ status: "reconciled" }, { revision: 7 }, 7)
      .status,
    "insufficient_evidence",
  );
});
