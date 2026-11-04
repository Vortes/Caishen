import assert from "node:assert/strict";
import test from "node:test";
import {
  addMember,
  createBook,
  execute,
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
const LEGACY_ENVELOPE = "envelope:reimbursements";
const LEGACY_PARTNER = "counterparty:partner";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

// Mom owes 3,000 for dinner, 2,000 of lunch, and 1,500 for a taxi, and
// repaid 1,000. Her envelope holds a float in October and November.
function momBook(): Book {
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
  book = withPerson(book, "alan", "Mom");
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
    counterpartyShare: { accountId: personId("Mom"), amount: 3_000 },
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
        counterpartyShare: { accountId: personId("Mom"), amount: 2_000 },
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
    counterpartyShare: { accountId: personId("Mom"), amount: 1_500 },
    ...at(7),
  });
  run({
    type: "counterparty.receive",
    counterpartyAccountId: personId("Mom"),
    cashAccountId: "checking",
    amount: 1_000,
    ...at(8),
  });
  run({
    type: "assign.set",
    categoryId: envelopeOf("Mom"),
    month,
    amount: 5_000,
  });
  run({
    type: "assign.set",
    categoryId: envelopeOf("Mom"),
    month: "2026-11",
    amount: 2_000,
  });
  return book;
}

// The same budget as stored before people: one Reimbursements account whose
// entries all name Mom, its float in the Reimbursements envelope.
const toLegacy = (book: Book, names: Record<string, string> = {}) =>
  asLegacyReimbursements(book, "alan", names);

const shares = (book: Book) =>
  JSON.stringify(book.budgets.alan!.transactions) +
  JSON.stringify(book.budgets.alan!.payeeMemory);

void test("the one name a Reimbursements account's entries used becomes a person with a paired envelope", () => {
  const legacy = toLegacy(momBook());
  assert.equal(lacksPeople(legacy), true);
  const migrated = withPeople(legacy);
  const budget = migrated.budgets.alan!;

  assert.deepEqual(
    budget.accounts
      .filter((account) => account.kind === "person")
      .map(({ id, name }) => ({ id, name })),
    [{ id: personId("Mom"), name: "Mom" }],
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
        id: envelopeOf("Mom"),
        name: "Mom",
        group: "People",
        counterpartyAccountId: personId("Mom"),
      },
    ],
  );
  assert.equal(lacksPeople(migrated), false);
  assert.deepEqual(withPeople(migrated), migrated);
});

void test("shares, line shares, their history, repayments, and remembered shares point at the person and name nobody", () => {
  const migrated = withPeople(toLegacy(momBook()));
  const budget = migrated.budgets.alan!;
  const transaction = (id: string) =>
    budget.transactions.find((item) => item.id === id)!;

  assert.deepEqual(transaction("dinner").counterpartyShare, {
    accountId: personId("Mom"),
    amount: 3_000,
  });
  assert.deepEqual(transaction("lunch").lines![1]!.counterpartyShare, {
    accountId: personId("Mom"),
    amount: 2_000,
  });
  const repayment = budget.transactions.find(
    (item) => item.linkedCounterpartyAccountId,
  )!;
  assert.equal(repayment.linkedCounterpartyAccountId, personId("Mom"));
  assert.equal("counterpartyName" in repayment, false);
  assert.deepEqual(
    transaction("taxi")
      .history.flatMap((change) => change.shareChanges ?? [])
      .map((change) => change.next),
    [{ accountId: personId("Mom"), amount: 1_500 }],
  );
  assert.deepEqual(
    Object.values(budget.payeeMemory ?? {}).flatMap((memory) =>
      memory.counterpartyShare ? [memory.counterpartyShare] : [],
    ),
    [
      { accountId: personId("Mom"), amount: 3_000 },
      { accountId: personId("Mom"), amount: 1_500 },
    ],
  );
  assert.doesNotMatch(shares(migrated), /counterpartyName|reimbursements/);
});

void test("the float moves to the person's envelope, so balances and every month's Ready to Assign stay as they were", () => {
  const original = momBook();
  const migrated = withPeople(toLegacy(original));

  for (const selected of [month, "2026-11"]) {
    const before = projectBook(original, "alan", selected);
    const after = projectBook(migrated, "alan", selected);
    assert.equal(after.readyToAssign, before.readyToAssign);
    assert.deepEqual(
      after.accounts
        .filter((account) => account.kind === "person")
        .map(({ id, balance }) => [id, balance]),
      [[personId("Mom"), 5_500]],
    );
    const available = (view: typeof before) =>
      view.categories.find((item) => item.id === envelopeOf("Mom"))!.available;
    assert.equal(available(after), available(before));
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
      [envelopeOf("Mom"), month, 5_000],
      [envelopeOf("Mom"), "2026-11", 2_000],
    ],
  );
});

void test("an empty Reimbursements account and envelope go, and nothing else changes", () => {
  let book = withPeople(createBook("alan", "Alan", month));
  book = execute(book, "alan", {
    type: "account.add",
    id: "checking",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });

  assert.deepEqual(withPeople(toLegacy(book)), book);
});

// Mom's budget with one more person, Other, who owes 800 for a coffee.
function withOther(book: Book): Book {
  return execute(withPerson(book, "alan", "Other"), "alan", {
    type: "transaction.upsert",
    id: "coffee",
    transactionId: "coffee",
    accountId: "checking",
    date: `${month}-09`,
    amount: -800,
    payee: "Coffee",
    counterpartyShare: { accountId: personId("Other"), amount: 800 },
    recordedAt: `${month}-09T12:00:00Z`,
  });
}

void test("two spellings of one name are refused instead of merged into one person", () => {
  const legacy = toLegacy(withOther(momBook()), {
    [personId("Other")]: " mom ",
  });

  assert.equal(lacksPeople(legacy), true);
  assert.throws(() => withPeople(legacy), /spelled more than one way/);
});

void test("a Reimbursements share stored without a name is refused instead of given to someone", () => {
  const legacy = toLegacy(withOther(momBook()));
  const coffee = legacy.budgets.alan!.transactions.find(
    (item) => item.id === "coffee",
  )!;
  delete coffee.counterpartyShare!.counterpartyName;

  assert.equal(lacksPeople(legacy), true);
  assert.throws(() => withPeople(legacy), /without a name/);
});

void test("a Reimbursements float is refused when more than one person could hold it", () => {
  const legacy = toLegacy(withOther(momBook()));

  assert.equal(lacksPeople(legacy), true);
  assert.throws(() => withPeople(legacy), /float/);
});

void test("a Reimbursements float with nobody named is refused instead of returned to Ready to Assign", () => {
  const legacy = toLegacy(withPeople(createBook("alan", "Alan", month)));
  legacy.budgets.alan!.assignments.push({
    id: "float",
    categoryId: LEGACY_ENVELOPE,
    month,
    amount: 20_000,
  });

  assert.equal(lacksPeople(legacy), true);
  assert.throws(() => withPeople(legacy), /float/);
});

void test("a Reimbursements name that is already a person is refused instead of becoming a second one", () => {
  const legacy = execute(toLegacy(momBook()), "alan", {
    type: "person.add",
    id: "mom-again",
    accountId: personId("Mom"),
    name: "Mom",
  });

  assert.equal(lacksPeople(legacy), true);
  assert.throws(() => withPeople(legacy), /already a person/);
});

void test("the Partner account becomes the person linked to the other member, and a former partner's a closed person", () => {
  // Partnered budgets as stored before people: each with a Partner account
  // and its envelope, and Alan's with a former partner's closed account.
  const legacy = addMember(
    createBook("alan", "Alan", month),
    "anna",
    "Anna",
    month,
  );
  for (const budget of Object.values(legacy.budgets)) {
    budget.accounts.push({
      id: LEGACY_PARTNER,
      name: "Partner",
      kind: "partner",
      date: `${month}-01`,
    });
    budget.categories.push({
      id: "envelope:partner",
      name: "Partner",
      group: "People",
      counterpartyAccountId: LEGACY_PARTNER,
    });
  }
  legacy.budgets.alan!.accounts.push({
    id: "counterparty:former:sam",
    name: "Sam",
    kind: "former-partner",
    date: `${month}-01`,
    closed: { at: "2026-09-01T00:00:00.000Z", by: "alan" },
  });
  legacy.budgets.alan!.categories.push({
    id: "envelope:former:sam",
    name: "Sam",
    group: "People",
    counterpartyAccountId: "counterparty:former:sam",
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
        id: LEGACY_PARTNER,
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
  assert.deepEqual(withPeople(migrated), migrated);
});

void test("a Partner account in a budget without a partner is refused instead of becoming an unlinked person", () => {
  const legacy = createBook("alan", "Alan", month);
  legacy.budgets.alan!.accounts.push({
    id: LEGACY_PARTNER,
    name: "Partner",
    kind: "partner",
    date: `${month}-01`,
  });

  assert.equal(lacksPeople(legacy), true);
  assert.throws(() => withPeople(legacy), /without a partner/);
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
    () =>
      receive(
        book.budgets.alan!.accounts.find((item) => item.linkedUserId)!.id,
      ),
    /come from both partners' bank imports/,
  );
});

// A partnered book whose linked people were stored under ordinary person
// ids, with Alan's partner owing him 2,000 for lunch.
function linkedUnderPersonIds(): Book {
  let book = addMember(
    createBook("alan", "Alan", month),
    "anna",
    "Anna",
    month,
  );
  book = withPerson(book, "alan", "Anna");
  book = withPerson(book, "anna", "Alan");
  for (const [userId, other] of [
    ["alan", "anna"],
    ["anna", "alan"],
  ] as const)
    book.budgets[userId]!.accounts = book.budgets[userId]!.accounts.map(
      (account) =>
        account.kind === "person"
          ? { ...account, linkedUserId: other }
          : account,
    );
  book = execute(book, "alan", {
    type: "account.add",
    id: "checking",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  return execute(book, "alan", {
    type: "transaction.upsert",
    id: "lunch",
    transactionId: "lunch",
    accountId: "checking",
    date: `${month}-05`,
    amount: -2_000,
    payee: "Lunch",
    counterpartyShare: { accountId: personId("Anna"), amount: 2_000 },
    recordedAt: `${month}-05T12:00:00Z`,
  });
}

void test("a person already linked to the other member stays the partner, whatever their account's id", () => {
  const book = linkedUnderPersonIds();

  assert.equal(lacksPeople(book), false);
  const loaded = withPeople(book);
  assert.deepEqual(loaded, book);
  assert.deepEqual(
    projectBook(loaded, "anna", month)
      .accounts.filter((account) => account.kind === "person")
      .map(({ name, balance }) => [name, balance]),
    [["Alan", -2_000]],
  );
});

void test("a budget whose linked person isn't the other member is refused, not relinked", () => {
  const book = linkedUnderPersonIds();
  const selfLinked = structuredClone(book);
  selfLinked.budgets.alan!.accounts = selfLinked.budgets.alan!.accounts.map(
    (account) =>
      account.linkedUserId ? { ...account, linkedUserId: "alan" } : account,
  );

  assert.equal(lacksPeople(selfLinked), true);
  assert.throws(
    () => withPeople(selfLinked),
    /linked person isn't the other member/,
  );
});

void test("a linked person in a one-member household is refused without changing the book", () => {
  const book = withPerson(createBook("alan", "Alan", month), "alan", "Anna");
  book.budgets.alan!.accounts[0]!.linkedUserId = "anna";
  const before = structuredClone(book);

  assert.equal(lacksPeople(book), true);
  assert.throws(() => withPeople(book), /linked person.*without a partner/);
  assert.deepEqual(book, before);
});
