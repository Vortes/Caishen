import assert from "node:assert/strict";
import test from "node:test";
import {
  addMember,
  createBook,
  execute,
  LINKED_PERSON_ACCOUNT_ID,
  projectBook,
  type Book,
  type Command,
} from "../../src/domain/engine";
import { lacksPeople, withPeople } from "../../src/domain/people";
import {
  asLegacyReimbursements,
  envelopeOf,
  personId,
  withPerson,
} from "./fixtures/people";

const month = "2026-10";
const LEGACY_ACCOUNT = "counterparty:reimbursements";
const LEGACY_ENVELOPE = "envelope:reimbursements";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

// Alex owes 3,000 for dinner and 2,000 of lunch, recorded once as " alex ",
// and repaid 1,000; Bo owes 1,500 for a taxi. Alex's envelope holds the
// float.
function peopleBook(): Book {
  let book = withPeople(createBook("alan", "Alan", month));
  let sequence = 0;
  const run = (command: WithoutId<Command>) => {
    book = execute(book, "alan", { ...command, id: `step-${++sequence}` });
  };
  run({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  run({ type: "category.add", categoryId: "dining", name: "Dining" });
  book = withPerson(book, "alan", "Alex");
  book = withPerson(book, "alan", "Twin");
  book = withPerson(book, "alan", "Bo");
  const at = (day: number) => ({
    date: `${month}-${String(day).padStart(2, "0")}`,
    recordedAt: `${month}-${String(day).padStart(2, "0")}T12:00:00Z`,
  });
  run({
    type: "transaction.upsert",
    transactionId: "dinner",
    accountId: "checking",
    amount: -3_000,
    payee: "Dinner",
    counterpartyShare: { accountId: personId("Alex"), amount: 3_000 },
    ...at(5),
  });
  run({
    type: "transaction.upsert",
    transactionId: "lunch",
    accountId: "checking",
    amount: -3_000,
    payee: "Lunch",
    lines: [
      { lineId: "mine", categoryId: "dining", amount: -1_000 },
      {
        lineId: "theirs",
        amount: -2_000,
        counterpartyShare: { accountId: personId("Twin"), amount: 2_000 },
      },
    ],
    ...at(6),
  });
  run({
    type: "transaction.upsert",
    transactionId: "taxi",
    accountId: "checking",
    amount: -1_500,
    payee: "Taxi",
    counterpartyShare: { accountId: personId("Bo"), amount: 1_500 },
    ...at(7),
  });
  run({
    type: "counterparty.receive",
    counterpartyAccountId: personId("Alex"),
    cashAccountId: "checking",
    amount: 1_000,
    ...at(8),
  });
  run({
    type: "assign.set",
    categoryId: envelopeOf("Alex"),
    month,
    amount: 5_000,
  });
  run({
    type: "assign.set",
    categoryId: envelopeOf("Alex"),
    month: "2026-11",
    amount: 2_000,
  });
  return book;
}

// The same budget as stored before people: one Reimbursements account whose
// entries name their person, with Twin's entries spelled " alex ".
const legacyNames: Record<string, string> = {
  [personId("Alex")]: "Alex",
  [personId("Twin")]: " alex ",
  [personId("Bo")]: "Bo",
};
const toLegacy = (book: Book) =>
  asLegacyReimbursements(book, "alan", legacyNames);

const shares = (book: Book) =>
  JSON.stringify(book.budgets.alan!.transactions) +
  JSON.stringify(book.budgets.alan!.payeeMemory);

void test("each name a Reimbursements entry used becomes one person, matched without case or surrounding space", () => {
  const legacy = toLegacy(peopleBook());
  assert.equal(lacksPeople(legacy), true);
  const migrated = withPeople(legacy);
  const budget = migrated.budgets.alan!;

  assert.deepEqual(
    budget.accounts
      .filter((account) => account.kind === "person")
      .map(({ id, name }) => ({ id, name })),
    [
      { id: personId("Alex"), name: "Alex" },
      { id: personId("Bo"), name: "Bo" },
    ],
  );
  assert.deepEqual(
    budget.categories
      .filter((category) => category.counterpartyAccountId)
      .map(({ id, name, group, counterpartyAccountId }) => ({
        id,
        name,
        group,
        counterpartyAccountId,
      })),
    [
      {
        id: envelopeOf("Alex"),
        name: "Alex",
        group: "People",
        counterpartyAccountId: personId("Alex"),
      },
      {
        id: envelopeOf("Bo"),
        name: "Bo",
        group: "People",
        counterpartyAccountId: personId("Bo"),
      },
    ],
  );
  assert.equal(lacksPeople(migrated), false);
  assert.deepEqual(withPeople(migrated), migrated);
});

void test("shares, line shares, their history, repayments, and remembered shares point at the person and name nobody", () => {
  const migrated = withPeople(toLegacy(peopleBook()));
  const budget = migrated.budgets.alan!;
  const transaction = (id: string) =>
    budget.transactions.find((item) => item.id === id)!;

  assert.deepEqual(transaction("dinner").counterpartyShare, {
    accountId: personId("Alex"),
    amount: 3_000,
  });
  assert.deepEqual(transaction("lunch").lines![1]!.counterpartyShare, {
    accountId: personId("Alex"),
    amount: 2_000,
  });
  const repayment = budget.transactions.find(
    (item) => item.linkedCounterpartyAccountId,
  )!;
  assert.equal(repayment.linkedCounterpartyAccountId, personId("Alex"));
  assert.equal("counterpartyName" in repayment, false);
  assert.deepEqual(
    transaction("taxi")
      .history.flatMap((change) => change.shareChanges ?? [])
      .map((change) => change.next),
    [{ accountId: personId("Bo"), amount: 1_500 }],
  );
  assert.deepEqual(
    Object.values(budget.payeeMemory ?? {}).flatMap((memory) =>
      memory.counterpartyShare ? [memory.counterpartyShare] : [],
    ),
    [
      { accountId: personId("Alex"), amount: 3_000 },
      { accountId: personId("Bo"), amount: 1_500 },
    ],
  );
  assert.doesNotMatch(shares(migrated), /counterpartyName|reimbursements/);
});

void test("the float moves to the person owed most, so balances and every month's Ready to Assign stay as they were", () => {
  const original = peopleBook();
  const migrated = withPeople(toLegacy(original));

  for (const selected of [month, "2026-11"]) {
    const before = projectBook(original, "alan", selected);
    const after = projectBook(migrated, "alan", selected);
    assert.equal(after.readyToAssign, before.readyToAssign);
    const owed = (view: typeof before) =>
      view.accounts
        .filter((account) => account.kind === "person")
        .map(({ id, balance }) => [id, balance]);
    assert.deepEqual(owed(after), [
      [personId("Alex"), 4_000],
      [personId("Bo"), 1_500],
    ]);
    assert.equal(
      after.categories.find((item) => item.id === envelopeOf("Alex"))!
        .available,
      before.categories.find((item) => item.id === envelopeOf("Alex"))!
        .available +
        before.categories.find((item) => item.id === envelopeOf("Twin"))!
          .available,
    );
  }
  assert.deepEqual(
    migrated.budgets
      .alan!.assignments.filter((assignment) =>
        assignment.categoryId.startsWith("envelope:"),
      )
      .map(({ categoryId, month: assigned, amount }) => [
        categoryId,
        assigned,
        amount,
      ]),
    [
      [envelopeOf("Alex"), month, 5_000],
      [envelopeOf("Alex"), "2026-11", 2_000],
    ],
  );
});

void test("a Reimbursements float with nobody named returns to Ready to Assign, and the account goes", () => {
  let book = withPeople(createBook("alan", "Alan", month));
  book = execute(book, "alan", {
    type: "account.add",
    id: "checking",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  const legacy = structuredClone(book);
  const budget = legacy.budgets.alan!;
  budget.accounts.push({
    id: LEGACY_ACCOUNT,
    name: "Reimbursements",
    kind: "reimbursements",
    openingBalance: 0,
    date: `${month}-01`,
  });
  budget.categories.push({
    id: LEGACY_ENVELOPE,
    name: "Reimbursements",
    group: "People",
    counterpartyAccountId: LEGACY_ACCOUNT,
  });
  budget.assignments.push({
    id: "float",
    categoryId: LEGACY_ENVELOPE,
    month,
    amount: 20_000,
  });

  const migrated = withPeople(legacy);
  assert.deepEqual(migrated, book);
  assert.equal(projectBook(migrated, "alan", month).readyToAssign, 100_000);
});

void test("the Partner account becomes the person linked to the other member, and a former partner's a closed person", () => {
  const partnered = withPeople(
    addMember(createBook("alan", "Alan", month), "anna", "Anna", month),
  );
  const legacy = structuredClone(partnered);
  for (const budget of Object.values(legacy.budgets))
    budget.accounts = budget.accounts.map((account) => {
      if (account.id !== LINKED_PERSON_ACCOUNT_ID) return account;
      const kept = { ...account, kind: "partner" as const };
      delete kept.linkedUserId;
      return kept;
    });
  legacy.budgets.alan!.accounts.push({
    id: "counterparty:former:sam",
    name: "Sam",
    kind: "former-partner",
    openingBalance: 0,
    date: `${month}-01`,
    closed: { at: "2026-09-01T00:00:00.000Z", by: "alan" },
  });
  assert.equal(lacksPeople(legacy), true);

  const migrated = withPeople(legacy);
  assert.deepEqual(
    migrated.budgets.alan!.accounts.map(
      ({ id, kind, linkedUserId, closed }) => ({
        id,
        kind,
        linkedUserId,
        closed: Boolean(closed),
      }),
    ),
    [
      {
        id: LINKED_PERSON_ACCOUNT_ID,
        kind: "person",
        linkedUserId: "anna",
        closed: false,
      },
      {
        id: "counterparty:former:sam",
        kind: "person",
        linkedUserId: undefined,
        closed: true,
      },
    ],
  );
  assert.equal(migrated.budgets.anna!.accounts[0]!.linkedUserId, "alan");
  assert.equal(lacksPeople(migrated), false);
});

void test("a repayment is recorded from an unlinked person, and refused from the linked one", () => {
  let book = withPerson(
    withPeople(
      addMember(createBook("alan", "Alan", month), "anna", "Anna", month),
    ),
    "alan",
    "Mom",
  );
  book = execute(book, "alan", {
    type: "account.add",
    id: "checking",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  book = execute(book, "alan", {
    type: "transaction.upsert",
    id: "lunch",
    transactionId: "lunch",
    accountId: "checking",
    date: `${month}-05`,
    amount: -2_000,
    payee: "Lunch",
    counterpartyShare: { accountId: personId("Mom"), amount: 2_000 },
    recordedAt: `${month}-05T12:00:00Z`,
  });
  const receive = (counterpartyAccountId: string) =>
    execute(book, "alan", {
      type: "counterparty.receive",
      id: "repaid",
      counterpartyAccountId,
      cashAccountId: "checking",
      date: `${month}-06`,
      amount: 2_000,
      recordedAt: `${month}-06T12:00:00Z`,
    });

  const repaid = projectBook(receive(personId("Mom")), "alan", month);
  assert.equal(
    repaid.accounts.find((item) => item.id === personId("Mom"))!.balance,
    0,
  );
  assert.equal(repaid.readyToAssign, 100_000);
  assert.throws(
    () => receive(LINKED_PERSON_ACCOUNT_ID),
    /come from both partners' bank imports/,
  );
});
