import assert from "node:assert/strict";
import test from "node:test";
import {
  addMember,
  counterpartyId,
  createBook,
  execute,
  projectBook,
  withCounterpartyAccounts,
} from "../../src/domain/engine";

function matchedSettlement() {
  let book = withCounterpartyAccounts(
    addMember(createBook("alan", "Alan", "2026-10"), "anna", "Anna", "2026-10"),
  );
  for (const actor of ["alan", "anna"])
    book = execute(book, actor, {
      type: "account.add",
      id: `checking-${actor}`,
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      openingBalance: 100_000,
    });
  return execute(
    book,
    "alan",
    {
      type: "partner.settle",
      id: "matched",
      settlementId: "bad-match",
      method: "Venmo",
      legs: [
        {
          userId: "anna",
          accountId: "checking",
          date: "2026-10-12",
          amount: -5_000,
          payee: "Venmo to Alan",
          providerId: "anna-payment",
        },
        {
          userId: "alan",
          accountId: "checking",
          date: "2026-10-12",
          amount: 5_000,
          payee: "Venmo from Anna",
          providerId: "alan-deposit",
        },
      ],
    },
    "provider",
  );
}

void test("either partner can reject a settlement and restore both budgets", () => {
  for (const actor of ["alan", "anna"]) {
    const matched = matchedSettlement();
    assert.equal(
      projectBook(matched, "alan", "2026-10").accounts.find(
        (item) => item.id === "checking",
      )!.balance,
      105_000,
    );
    const rejected = execute(matched, actor, {
      type: "partner.settlement.reject",
      id: `reject-${actor}`,
      settlementId: "bad-match",
      recordedAt: "2026-10-20T12:00:00.000Z",
    });
    for (const userId of ["alan", "anna"]) {
      const view = projectBook(rejected, userId, "2026-10");
      assert.equal(
        view.accounts.find((item) => item.id === "checking")!.balance,
        100_000,
      );
      assert.equal(
        view.accounts.find((item) => item.id === counterpartyId("partner"))!
          .balance,
        0,
      );
      assert.equal(view.partnerLedger.length, 0);
    }
    assert.equal(rejected.partnerSettlements![0]!.removed, true);
    assert.deepEqual(rejected.partnerSettlements![0]!.history.at(-1), {
      actorId: actor,
      operationId: `reject-${actor}`,
      at: "2026-10-20T12:00:00.000Z",
      reason: "removed",
    });
  }
});

void test("rejecting a settlement requires an explicit user decision", () => {
  for (const source of ["agent", "provider"] as const)
    assert.throws(
      () =>
        execute(
          matchedSettlement(),
          "alan",
          {
            type: "partner.settlement.reject",
            id: `reject-${source}`,
            settlementId: "bad-match",
          },
          source,
        ),
      /requires a user action/,
    );
});
