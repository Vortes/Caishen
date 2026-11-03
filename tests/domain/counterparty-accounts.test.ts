import assert from "node:assert/strict";
import test from "node:test";
import { bookToRows, rowsToBook } from "../../src/domain/rows";
import {
  rememberedCategory,
  rememberedCounterpartyShare,
} from "../../src/domain/payee-memory";
import {
  addMember,
  createBook,
  execute,
  projectBook,
  type Book,
  type Command,
} from "../../src/domain/engine";
import { withPeople } from "../../src/domain/people";
import { envelopeOf, personId, withPerson } from "./fixtures/people";

const month = "2026-10";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

// A personal budget with $1,000 in checking and three people: Mom, Dad,
// and a friend.
function solo() {
  let book = withPeople(createBook("alan", "Alan", month));
  for (const name of ["Mom", "Dad", "Friend"])
    book = withPerson(book, "alan", name);
  let sequence = 0;
  const run = (command: WithoutId<Command>) => {
    book = execute(book, "alan", {
      ...command,
      id: `operation-${++sequence}`,
    });
    return book;
  };
  run({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  return {
    run,
    get book() {
      return book;
    },
    view: (selectedMonth = month) => projectBook(book, "alan", selectedMonth),
  };
}

const people = (book: Book, userId: string) => {
  const view = projectBook(book, userId, month);
  return {
    accounts: view.accounts
      .filter((account) => account.kind === "person")
      .map(({ name, balance, linkedUserId }) => ({
        name,
        balance,
        ...(linkedUserId ? { linkedUserId } : {}),
      })),
    envelopes: view.categories
      .filter((category) => category.counterpartyAccountId)
      .map(({ name, group, counterpartyAccountId }) => ({
        name,
        group,
        person: view.accounts.find(
          (account) => account.id === counterpartyAccountId,
        )?.name,
      })),
  };
};

void test("a personal budget starts with nobody, and each person added gets an account and paired envelope in People", () => {
  const book = withPeople(createBook("alan", "Alan", month));
  assert.deepEqual(people(book, "alan"), { accounts: [], envelopes: [] });

  assert.deepEqual(people(withPerson(book, "alan", "Mom"), "alan"), {
    accounts: [{ name: "Mom", balance: 0 }],
    envelopes: [{ name: "Mom", group: "People", person: "Mom" }],
  });
});

void test("adding a person whose name is already one of your people is refused", () => {
  const book = withPerson(
    withPeople(createBook("alan", "Alan", month)),
    "alan",
    "Mom",
  );
  assert.throws(
    () =>
      execute(book, "alan", {
        type: "person.add",
        id: "again",
        accountId: personId("Mom 2"),
        name: " mom ",
      }),
    /already one of your people/,
  );
});

void test("renaming a person renames their account and paired envelope", () => {
  const book = execute(
    withPerson(withPeople(createBook("alan", "Alan", month)), "alan", "Mom"),
    "alan",
    {
      type: "person.rename",
      id: "rename",
      accountId: personId("Mom"),
      name: "Mother",
    },
  );
  assert.deepEqual(people(book, "alan"), {
    accounts: [{ name: "Mother", balance: 0 }],
    envelopes: [{ name: "Mother", group: "People", person: "Mother" }],
  });
});

void test("creating and renaming people use the same unique normalized name", () => {
  const book = withPerson(
    withPerson(createBook("alan", "Alan", month), "alan", "Mom Smith"),
    "alan",
    "Dad",
  );
  const before = structuredClone(book);
  for (const command of [
    {
      type: "person.rename",
      id: "rename-dad",
      accountId: personId("Dad"),
      name: " mom   SMITH ",
    },
    {
      type: "person.add",
      id: "add-duplicate",
      accountId: "another-mom",
      name: " mom   SMITH ",
    },
  ] satisfies Command[])
    assert.throws(
      () => execute(book, "alan", command),
      /already one of your people/,
    );
  assert.deepEqual(book, before);

  const renamed = execute(book, "alan", {
    type: "person.rename",
    id: "change-spelling",
    accountId: personId("Mom Smith"),
    name: "MOM SMITH",
  });
  assert.deepEqual(
    people(renamed, "alan").accounts.map((account) => account.name),
    ["MOM SMITH", "Dad"],
  );
});

void test("partners each get a person linked to the other, ahead of everyone else, and adding them again changes nothing", () => {
  let book = withPerson(
    withPeople(createBook("alan", "Alan", month)),
    "alan",
    "Mom",
  );
  book = withPeople(addMember(book, "anna", "Anna", month));

  assert.deepEqual(people(book, "alan"), {
    accounts: [
      { name: "Partner", balance: 0, linkedUserId: "anna" },
      { name: "Mom", balance: 0 },
    ],
    envelopes: [
      { name: "Mom", group: "People", person: "Mom" },
      { name: "Partner", group: "People", person: "Partner" },
    ],
  });
  assert.deepEqual(people(book, "anna"), {
    accounts: [{ name: "Partner", balance: 0, linkedUserId: "alan" }],
    envelopes: [{ name: "Partner", group: "People", person: "Partner" }],
  });
  assert.deepEqual(withPeople(book), book);
});

void test("a float assigned to a person's envelope comes out of Ready to Assign and stays available", () => {
  const budget = solo();
  assert.equal(budget.view().readyToAssign, 100_000);

  budget.run({
    type: "assign.set",
    categoryId: envelopeOf("Mom"),
    month,
    amount: 20_000,
  });

  const envelope = (view: ReturnType<typeof budget.view>) =>
    view.categories.find((item) => item.id === envelopeOf("Mom"))!;
  assert.equal(budget.view().readyToAssign, 80_000);
  assert.equal(envelope(budget.view()).available, 20_000);
  // Next month the float is still there and still not Ready to Assign.
  assert.equal(budget.view("2026-11").readyToAssign, 80_000);
  assert.equal(envelope(budget.view("2026-11")).available, 20_000);
});

void test("spending can't be categorized into a paired envelope", () => {
  const budget = solo();
  const purchase = {
    type: "transaction.upsert",
    transactionId: "lunch",
    accountId: "checking",
    date: "2026-10-05",
    amount: -1_500,
    payee: "Lunch",
  } as const;

  assert.throws(
    () => budget.run({ ...purchase, categoryId: envelopeOf("Mom") }),
    /paired envelope/,
  );
  budget.run(purchase);
  assert.throws(
    () =>
      budget.run({
        type: "transaction.categorize",
        transactionId: "lunch",
        categoryId: envelopeOf("Mom"),
      }),
    /paired envelope/,
  );
  assert.throws(
    () =>
      budget.run({
        type: "transaction.categorize.batch",
        transactionIds: ["lunch"],
        categoryId: envelopeOf("Mom"),
      }),
    /paired envelope/,
  );
});

void test("nothing is recorded on a counterparty account directly", () => {
  const budget = solo();
  const entry = /come from shares, repayments, and settlements/;

  assert.throws(
    () =>
      budget.run({
        type: "transaction.upsert",
        transactionId: "owed",
        accountId: personId("Mom"),
        date: "2026-10-05",
        amount: 4_000,
        payee: "Sam",
      }),
    entry,
  );
  assert.throws(
    () =>
      budget.run({
        type: "transaction.upsert",
        transactionId: "repaid",
        accountId: "checking",
        transferAccountId: personId("Mom"),
        date: "2026-10-05",
        amount: 4_000,
        payee: "Transfer",
      }),
    entry,
  );
  assert.throws(
    () =>
      budget.run({
        type: "account.reconcile",
        accountId: personId("Mom"),
        date: "2026-10-05",
        balance: 4_000,
        adjustmentId: "adjust",
      }),
    entry,
  );
  assert.equal(budget.view().readyToAssign, 100_000);
});

void test("a purchase entirely for Mom needs no personal category and can be reviewed", () => {
  const budget = solo();
  budget.run({
    type: "transaction.upsert",
    transactionId: "noodles",
    accountId: "checking",
    date: "2026-10-05",
    amount: -1_154,
    payee: "Noodles Plus",
    counterpartyShare: {
      accountId: personId("Mom"),
      amount: 1_154,
    },
    recordedAt: "2026-10-05T12:00:00Z",
    reviewed: false,
  });
  budget.run({ type: "transaction.approve", transactionIds: ["noodles"] });
  const view = budget.view();
  assert.equal(view.personalSpending, 0);
  assert.equal(view.readyToAssign, 100_000);
  assert.equal(
    view.accounts.find((item) => item.id === "checking")!.balance,
    98_846,
  );
  assert.equal(
    view.accounts.find((item) => item.id === personId("Mom"))!.balance,
    1_154,
  );
  assert.equal(
    view.categories.find((item) => item.counterpartyAccountId)!.available,
    -1_154,
  );
  assert.equal(view.budget.transactions[0]!.categoryId, undefined);
  assert.equal(view.budget.transactions[0]!.reviewed, true);
});

void test("repayment funds a fully shared card purchase and a later refund leaves money owed back to Mom", () => {
  const budget = solo();
  budget.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  budget.run({
    type: "transaction.upsert",
    transactionId: "noodles",
    accountId: "card",
    date: "2026-10-05",
    amount: -1_154,
    payee: "Noodles Plus",
    counterpartyShare: {
      accountId: personId("Mom"),
      amount: 1_154,
    },
    recordedAt: "2026-10-05T12:00:00Z",
  });
  assert.equal(
    budget.view().accounts.find((item) => item.id === "card")!.reserve,
    0,
  );
  budget.run({
    type: "counterparty.receive",
    counterpartyAccountId: personId("Mom"),
    cashAccountId: "checking",
    date: "2026-10-06",
    amount: 1_154,
    recordedAt: "2026-10-06T12:00:00Z",
  });
  assert.equal(
    budget.view().accounts.find((item) => item.id === "card")!.reserve,
    1_154,
  );
  budget.run({
    type: "transaction.upsert",
    transactionId: "refund",
    accountId: "card",
    date: "2026-10-07",
    amount: 1_154,
    payee: "Noodles Plus",
    counterpartyShare: {
      accountId: personId("Mom"),
      amount: 1_154,
    },
    recordedAt: "2026-10-07T12:00:00Z",
  });
  const view = budget.view();
  assert.equal(
    view.budget.transactions.find((item) => item.id === "refund")!.categoryId,
    undefined,
  );
  assert.equal(view.accounts.find((item) => item.id === "card")!.balance, 0);
  assert.equal(
    view.accounts.find((item) => item.id === personId("Mom"))!.balance,
    -1_154,
  );
  assert.equal(
    view.categories.find((item) => item.counterpartyAccountId)!.available,
    1_154,
  );
  assert.equal(view.readyToAssign, 100_000);
  assert.equal(view.personalSpending, 0);
});

void test("taking back part or all of Mom's share asks for a personal category at that point", () => {
  const budget = solo();
  budget.run({ type: "category.add", categoryId: "dining", name: "Dining" });
  const purchase = {
    type: "transaction.upsert",
    transactionId: "noodles",
    accountId: "checking",
    date: "2026-10-05",
    amount: -1_154,
    payee: "Noodles Plus",
    recordedAt: "2026-10-05T12:00:00Z",
  } as const;
  const share = {
    accountId: personId("Mom"),
    amount: 1_154,
  };
  budget.run({ ...purchase, counterpartyShare: share });
  assert.throws(
    () => budget.run({ ...purchase, counterpartyShare: null }),
    /category/,
  );
  assert.throws(
    () =>
      budget.run({ ...purchase, counterpartyShare: { ...share, amount: 700 } }),
    /category/,
  );
  budget.run({
    ...purchase,
    categoryId: "dining",
    counterpartyShare: { ...share, amount: 700 },
  });
  assert.equal(budget.view().personalSpending, 454);
  assert.equal(
    budget.view().categories.find((item) => item.id === "dining")!.activity,
    -454,
  );
  budget.run({ ...purchase, categoryId: "dining", counterpartyShare: share });
  assert.equal(budget.view().budget.transactions[0]!.categoryId, undefined);
  budget.run({ ...purchase, categoryId: "dining", counterpartyShare: null });
  assert.equal(budget.view().personalSpending, 1_154);
  assert.equal(
    budget.view().accounts.find((item) => item.id === personId("Mom"))!.balance,
    0,
  );
});

void test("a split keeps its fully reimbursable line without a category through save and load", () => {
  const budget = solo();
  budget.run({ type: "category.add", categoryId: "dining", name: "Dining" });
  budget.run({
    type: "transaction.upsert",
    transactionId: "dinner",
    accountId: "checking",
    date: "2026-10-05",
    amount: -2_000,
    payee: "Noodles Plus",
    recordedAt: "2026-10-05T12:00:00Z",
    lines: [
      { lineId: "mine", categoryId: "dining", amount: -846 },
      {
        lineId: "mom",
        amount: -1_154,
        counterpartyShare: {
          accountId: personId("Mom"),
          amount: 1_154,
        },
      },
    ],
  });
  const restored = rowsToBook(bookToRows(budget.book));
  const view = projectBook(restored, "alan", month);
  assert.equal(view.personalSpending, 846);
  assert.equal(
    view.categories.find((item) => item.id === "dining")!.activity,
    -846,
  );
  assert.equal(
    view.accounts.find((item) => item.id === personId("Mom"))!.balance,
    1_154,
  );
  assert.equal(view.budget.transactions[0]!.lines![1]!.categoryId, undefined);
});

void test("a fully reimbursable payee remembers the person without a purpose category", () => {
  const budget = solo();
  budget.run({
    type: "transaction.upsert",
    transactionId: "noodles",
    accountId: "checking",
    date: "2026-10-05",
    amount: -1_154,
    payee: "Noodles Plus",
    recordedAt: "2026-10-05T12:00:00Z",
    counterpartyShare: {
      accountId: personId("Mom"),
      amount: 1_154,
    },
  });
  const restored = rowsToBook(bookToRows(budget.book)).budgets.alan!;
  const next = { payee: "NOODLES PLUS", accountId: "checking", amount: -2_000 };
  assert.equal(rememberedCategory(restored, next), undefined);
  assert.deepEqual(rememberedCounterpartyShare(restored, next), {
    accountId: personId("Mom"),
    amount: 2_000,
  });
  assert.equal(
    rememberedCounterpartyShare(restored, { ...next, amount: 2_000 }),
    undefined,
  );
});

void test("a fully shared recorded partner purchase matches its bank import without a payer category", () => {
  let book = withPeople(
    addMember(createBook("alan", "Alan", month), "anna", "Anna", month),
  );
  book = execute(book, "alan", {
    type: "account.add",
    id: "cash",
    accountId: "cash",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  book = execute(book, "alan", {
    type: "partner.record",
    id: "record",
    entryId: "dinner",
    payerId: "alan",
    date: "2026-10-05",
    payee: "Noodles Plus",
    amount: 1_154,
    share: 1_154,
    recordedAt: "2026-10-05T12:00:00Z",
  });
  book = execute(book, "alan", {
    type: "partner.match",
    id: "match",
    entryId: "dinner",
    transactionId: "bank",
    accountId: "cash",
    date: "2026-10-05",
    amount: -1_154,
    status: "posted",
    recordedAt: "2026-10-05T12:00:00Z",
  });
  const view = projectBook(book, "alan", month);
  assert.equal(view.personalSpending, 0);
  assert.equal(view.budget.transactions[0]!.categoryId, undefined);
  assert.equal(
    view.accounts.find((item) => item.linkedUserId === "anna")!.balance,
    1_154,
  );
});

void test("a bank amount update keeps a category-free purchase fully reimbursable", () => {
  const budget = solo();
  const purchase = {
    type: "transaction.upsert",
    transactionId: "noodles",
    accountId: "checking",
    date: "2026-10-05",
    amount: -1_154,
    payee: "Noodles Plus",
    status: "pending",
    recordedAt: "2026-10-05T12:00:00Z",
  } as const;
  budget.run({
    ...purchase,
    counterpartyShare: {
      accountId: personId("Mom"),
      amount: 1_154,
    },
  });
  const updated = execute(
    budget.book,
    "alan",
    { ...purchase, id: "posted", amount: -1_500, status: "posted" },
    "provider",
  );
  const view = projectBook(updated, "alan", month);
  assert.equal(view.personalSpending, 0);
  assert.equal(
    view.accounts.find((item) => item.id === personId("Mom"))!.balance,
    1_500,
  );
  assert.equal(view.budget.transactions[0]!.categoryId, undefined);
});

void test("rounding a bank amount update keeps fully reimbursable split lines whole", () => {
  const budget = solo();
  const purchase = {
    type: "transaction.upsert",
    transactionId: "noodles",
    accountId: "checking",
    date: "2026-10-05",
    amount: -1_000,
    payee: "Noodles Plus",
    recordedAt: "2026-10-05T12:00:00Z",
  } as const;
  budget.run({
    ...purchase,
    lines: [300, 300, 400].map((amount, index) => ({
      lineId: `person-${index}`,
      amount: -amount,
      counterpartyShare: {
        accountId: personId(["Mom", "Dad", "Friend"][index]!),
        amount,
      },
    })),
  });
  const updated = execute(
    budget.book,
    "alan",
    {
      ...purchase,
      id: "posted",
      amount: -1_101,
    },
    "provider",
  );
  const view = projectBook(updated, "alan", month);
  assert.equal(view.personalSpending, 0);
  assert.equal(
    view.accounts
      .filter((item) => item.kind === "person")
      .reduce((total, item) => total + item.balance, 0),
    1_101,
  );
});

void test("batch categorization leaves fully reimbursable lines without a purpose", () => {
  const budget = solo();
  budget.run({
    type: "category.add",
    categoryId: "dining",
    name: "Dining",
    group: "Everyday",
  });
  budget.run({
    type: "transaction.upsert",
    transactionId: "noodles",
    accountId: "checking",
    date: "2026-10-05",
    amount: -1_154,
    payee: "Noodles Plus",
    recordedAt: "2026-10-05T12:00:00Z",
    counterpartyShare: {
      accountId: personId("Mom"),
      amount: 1_154,
    },
  });
  budget.run({
    type: "transaction.categorize.batch",
    transactionIds: ["noodles"],
    categoryId: "dining",
  });
  assert.equal(budget.view().budget.transactions[0]!.categoryId, undefined);
  assert.equal(budget.view().personalSpending, 0);
});
