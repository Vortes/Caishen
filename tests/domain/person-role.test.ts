import assert from "node:assert/strict";
import test from "node:test";
import {
  addMember,
  closePartnerLedger,
  createBook,
  execute,
  type Book,
} from "../../src/domain/engine";
import { keepsCardRules, personRole } from "../../src/domain/person-role";
import { withPeople } from "../../src/domain/people";
import { linkedPersonId, personId, withPerson } from "./fixtures/people";

const month = "2026-10";

void test("someone you added by name is a plain person", () => {
  const book = withPerson(
    withPeople(createBook("alan", "Alan", month)),
    "alan",
    "Mom",
  );
  const mom = book.budgets.alan!.accounts.find(
    (account) => account.id === personId("Mom"),
  )!;

  assert.equal(personRole(mom), "person");
});

void test("a checking account is nobody", () => {
  const book = execute(createBook("alan", "Alan", month), "alan", {
    type: "account.add",
    id: "checking",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  const checking = book.budgets.alan!.accounts.find(
    (account) => account.id === "checking",
  )!;

  assert.equal(personRole(checking), undefined);
});

// Alan and Jordan share one household; withPeople links each to the other.
function household(): Book {
  return withPeople(
    addMember(createBook("alan", "Alan", month), "jordan", "Jordan", month),
  );
}

void test("the person linked to the other member of the household is the partner", () => {
  const budget = household().budgets.alan!;
  const jordan = budget.accounts.find(
    (account) => account.linkedUserId === "jordan",
  )!;

  assert.equal(personRole(jordan), "partner");
  assert.equal(keepsCardRules(jordan, budget), true);
});

const disconnect = (book: Book) =>
  closePartnerLedger(book, "alan", {
    id: "parted",
    name: "Jordan",
    at: "2026-10-20T12:00:00.000Z",
    by: "jordan",
  }).budgets.alan!;

void test("a partner who disconnected after sharing a purchase is a former partner", () => {
  let book = household();
  book = execute(book, "jordan", {
    type: "account.add",
    id: "checking",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  book = execute(book, "jordan", {
    type: "transaction.upsert",
    id: "groceries",
    transactionId: "groceries",
    accountId: "checking",
    date: "2026-10-10",
    amount: -4_000,
    payee: "Store",
    counterpartyShare: {
      accountId: linkedPersonId(book, "jordan"),
      amount: 4_000,
    },
    recordedAt: "2026-10-10T12:00:00Z",
  });
  const budget = disconnect(book);
  const jordan = budget.accounts.find(
    (account) => account.id === "counterparty:former:parted",
  )!;

  assert.equal(budget.formerPartnerEntries?.length, 1);
  assert.equal(personRole(jordan), "former-partner");
  assert.equal(keepsCardRules(jordan, budget), true);
});

// A former partner is any closed person, so their ledger stays frozen, but
// only a ledger frozen with entries in it keeps the card rules (ADR 0015).
void test("a partner who disconnected before sharing anything is a former partner without card rules", () => {
  const budget = disconnect(household());
  const jordan = budget.accounts.find(
    (account) => account.id === "counterparty:former:parted",
  )!;

  assert.equal(budget.formerPartnerEntries?.length ?? 0, 0);
  assert.equal(personRole(jordan), "former-partner");
  assert.equal(keepsCardRules(jordan, budget), false);
});
