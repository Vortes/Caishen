import assert from "node:assert/strict";
import test from "node:test";
import {
  AccountingError,
  addMember,
  createBook,
  execute,
  personalLedger,
  withCounterpartyAccounts,
} from "../../src/domain/engine";

void test("F1: the non-payer and household refuse a share reduction without the payer's purpose category", () => {
  let book = withCounterpartyAccounts(
    addMember(createBook("a", "A", "2026-10"), "b", "B", "2026-10"),
  );
  book = execute(book, "a", {
    type: "account.add",
    id: "account",
    accountId: "cash",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  book = execute(book, "a", {
    type: "transaction.upsert",
    id: "purchase",
    transactionId: "purchase",
    accountId: "cash",
    date: "2026-10-10",
    payee: "Shared dinner",
    amount: -5000,
    counterpartyShare: { accountId: "counterparty:partner", amount: 5000 },
    recordedAt: "2026-10-10T12:00:00Z",
  });
  const command = {
    type: "partner.edit",
    id: "reduce",
    entryId: book.partnerEntries![0]!.id,
    share: 2500,
    recordedAt: "2026-10-11T12:00:00Z",
  } as const;
  for (const state of [personalLedger(book, "b"), book])
    assert.throws(() => execute(state, "b", command), {
      name: AccountingError.name,
      message: "Choose a purpose category for your part of it",
    });
});
