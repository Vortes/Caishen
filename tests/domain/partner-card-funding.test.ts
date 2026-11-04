import assert from "node:assert/strict";
import test from "node:test";
import {
  addMember,
  createBook,
  execute,
  personEnvelopeId,
  projectBook,
  type Book,
  type Command,
} from "../../src/domain/engine";
import { withPeople } from "../../src/domain/people";
import { personalSpendingEntries } from "../../src/domain/spending";
import { linkedPersonId } from "./fixtures/people";

const month = "2026-10";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

// Alan and Anna each have $5,000 in checking. Alan budgets Groceries,
// Parking and Dining; Anna pays for things and shares them with him, so
// Anna is Alan's linked person and her account works like a credit card.
function household() {
  let book: Book = withPeople(
    addMember(createBook("alan", "Alan", month), "anna", "Anna", month),
  );
  let sequence = 0;
  const run = (actorId: string, command: WithoutId<Command>) => {
    book = execute(book, actorId, {
      ...command,
      id: `operation-${++sequence}`,
    });
    return book;
  };
  for (const userId of ["alan", "anna"])
    run(userId, {
      type: "account.add",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      openingBalance: 500_000,
    });
  for (const [categoryId, name] of [
    ["groceries", "Groceries"],
    ["parking", "Parking"],
    ["dining", "Dining"],
  ] as const)
    run("alan", { type: "category.add", categoryId, name });
  run("anna", { type: "category.add", categoryId: "home", name: "Home" });
  const anna = linkedPersonId(book, "alan");
  let purchases = 0;
  return {
    run,
    get book() {
      return book;
    },
    anna,
    envelope: personEnvelopeId(anna),
    // Anna pays for something on her checking account and shares part of
    // it with Alan. Returns the entry's id in the partner ledger.
    // A negative amount is a refund.
    annaBuys(
      amount: number,
      share: number,
      { date = "2026-10-10", payee = "Store" } = {},
    ) {
      const transactionId = `anna-${++purchases}`;
      run("anna", {
        type: "transaction.upsert",
        transactionId,
        accountId: "checking",
        date,
        amount: -amount,
        payee,
        ...(share < Math.abs(amount) ? { categoryId: "home" } : {}),
        counterpartyShare: {
          accountId: linkedPersonId(book, "anna"),
          amount: share,
        },
        recordedAt: `${date}T12:00:00Z`,
      });
      return `anna:${transactionId}:${transactionId}`;
    },
    // Alan pays for something that's entirely Anna's.
    alanBuys(amount: number, accountId = "checking", date = "2026-10-11") {
      run("alan", {
        type: "transaction.upsert",
        transactionId: `alan-${++purchases}`,
        accountId,
        date,
        amount: -amount,
        payee: "Pharmacy",
        counterpartyShare: { accountId: anna, amount },
        recordedAt: `${date}T12:00:00Z`,
      });
    },
    // Alan pays Anna from checking: positive pays her, negative is her
    // paying him.
    alanPays(amount: number, date = "2026-10-20") {
      run("alan", {
        type: "partner.settle",
        settlementId: `settlement-${date}-${amount}`,
        method: "Bank transfer",
        legs: [
          {
            userId: "alan",
            accountId: "checking",
            date,
            amount: -amount,
            payee: "Anna",
          },
          {
            userId: "anna",
            accountId: "checking",
            date,
            amount,
            payee: "Alan",
          },
        ],
      });
    },
    view: (selectedMonth = month) => projectBook(book, "alan", selectedMonth),
  };
}

type View = ReturnType<typeof projectBook>;
const category = (view: View, id: string) =>
  view.categories.find((item) => item.id === id)!;

void test("a partner's purchase with no category takes nothing from Ready to Assign", () => {
  const home = household();
  home.annaBuys(8_000, 4_000);

  assert.equal(home.view().readyToAssign, 500_000);
});

void test("categorizing your part pays it from the category into the partner's envelope, like a card purchase", () => {
  const home = household();
  home.run("alan", {
    type: "assign",
    categoryId: "groceries",
    month,
    amount: 10_000,
  });
  const entryId = home.annaBuys(8_000, 4_000);
  home.run("alan", {
    type: "partner.categorize",
    entryId,
    categoryId: "groceries",
  });

  const view = home.view();
  const groceries = category(view, "groceries");
  assert.deepEqual(
    {
      available: groceries.available,
      cashActivity: groceries.cashActivity,
      creditActivity: groceries.creditActivity,
    },
    { available: 6_000, cashActivity: 0, creditActivity: -4_000 },
  );
  assert.equal(category(view, home.envelope).available, 4_000);
  assert.equal(view.readyToAssign, 490_000);
});

// Groceries holds $30 when Alan files his $40 part of Anna's purchase there.
function shortGroceries() {
  const home = household();
  home.run("alan", {
    type: "assign",
    categoryId: "groceries",
    month,
    amount: 3_000,
  });
  const entryId = home.annaBuys(8_000, 4_000);
  home.run("alan", {
    type: "partner.categorize",
    entryId,
    categoryId: "groceries",
  });
  return { ...home, entryId };
}

void test("a category that can't cover your part is overspent on credit, not cash", () => {
  const home = shortGroceries();

  const view = home.view();
  const groceries = category(view, "groceries");
  assert.deepEqual(
    {
      available: groceries.available,
      cashOverspending: groceries.cashOverspending,
    },
    { available: -1_000, cashOverspending: 0 },
  );
  assert.equal(category(view, home.envelope).available, 3_000);
  assert.equal(view.readyToAssign, 497_000);
});

void test("a category short on your part resets at month end without charging next month's Ready to Assign", () => {
  const home = shortGroceries();

  const november = home.view("2026-11");
  assert.equal(category(november, "groceries").available, 0);
  assert.equal(november.readyToAssign, 497_000);
});

void test("what a short category couldn't cover stays on the partner's envelope as still to fund", () => {
  const home = shortGroceries();

  for (const selected of [month, "2026-11"]) {
    const view = home.view(selected);
    assert.equal(category(view, home.envelope).available, 3_000);
    assert.deepEqual(
      {
        owed: view.partnerFunding?.owed,
        stillToFund: view.partnerFunding?.stillToFund,
      },
      { owed: 4_000, stillToFund: 1_000 },
      selected,
    );
  }
});

void test("a share with no category is still to fund and sets nothing aside", () => {
  const home = household();
  home.annaBuys(8_000, 4_000);

  const view = home.view();
  assert.equal(category(view, home.envelope).available, 0);
  assert.equal(view.partnerFunding?.stillToFund, 4_000);
  assert.equal(view.readyToAssign, 500_000);
});

void test("assigning to the partner's envelope covers what's still to fund", () => {
  const home = shortGroceries();
  home.run("alan", {
    type: "assign",
    categoryId: home.envelope,
    month,
    amount: 1_000,
  });

  const view = home.view();
  assert.equal(category(view, home.envelope).available, 4_000);
  assert.equal(view.partnerFunding?.stillToFund, 0);
  assert.equal(view.readyToAssign, 496_000);
});

// Groceries holds $100 and covers all of Alan's $40 part of Anna's purchase.
function fundedGroceries() {
  const home = household();
  home.run("alan", {
    type: "assign",
    categoryId: "groceries",
    month,
    amount: 10_000,
  });
  const entryId = home.annaBuys(8_000, 4_000);
  home.run("alan", {
    type: "partner.categorize",
    entryId,
    categoryId: "groceries",
  });
  return { ...home, entryId };
}

void test("paying your partner spends from their envelope and never touches Ready to Assign", () => {
  const home = fundedGroceries();
  home.alanPays(4_000);

  const view = home.view();
  assert.equal(category(view, home.envelope).available, 0);
  assert.equal(category(view, "groceries").available, 6_000);
  assert.deepEqual(
    {
      owed: view.partnerFunding?.owed,
      stillToFund: view.partnerFunding?.stillToFund,
    },
    { owed: 0, stillToFund: 0 },
  );
  assert.equal(view.cash, 496_000);
  assert.equal(view.readyToAssign, 490_000);
});

void test("paying your partner more than their envelope holds is cash overspending on the envelope", () => {
  const home = shortGroceries();
  home.alanPays(4_000);

  const view = home.view();
  const envelope = category(view, home.envelope);
  assert.deepEqual(
    {
      available: envelope.available,
      cashOverspending: envelope.cashOverspending,
    },
    { available: -1_000, cashOverspending: 1_000 },
  );
  assert.equal(view.partnerFunding?.owed, 0);
  assert.equal(view.readyToAssign, 497_000);
});

void test("when you owe each other, the envelope only needs what you owe on net", () => {
  const home = fundedGroceries();
  home.alanBuys(1_500);

  const view = home.view();
  assert.equal(category(view, home.envelope).available, 2_500);
  assert.deepEqual(
    {
      owed: view.partnerFunding?.owed,
      stillToFund: view.partnerFunding?.stillToFund,
    },
    { owed: 2_500, stillToFund: 0 },
  );
  assert.equal(view.readyToAssign, 490_000);
});

void test("money set aside to front your partner on your card stays in their envelope after you settle", () => {
  const home = fundedGroceries();
  home.run("alan", {
    type: "account.add",
    accountId: "visa",
    name: "Visa",
    kind: "credit",
    openingBalance: 0,
  });
  home.run("alan", {
    type: "assign",
    categoryId: home.envelope,
    month,
    amount: 1_500,
  });
  home.alanBuys(1_500, "visa");
  home.alanPays(2_500);

  const view = home.view();
  assert.equal(category(view, home.envelope).available, 1_500);
  assert.equal(
    view.accounts.find((item) => item.id === "visa")!.reserve,
    1_500,
  );
  assert.equal(view.partnerFunding?.owed, 0);
  assert.equal(view.readyToAssign, 488_500);
});

void test("when your partner owes you overall, fronting works as before", () => {
  const home = fundedGroceries();
  home.alanBuys(6_500);

  let view = home.view();
  let envelope = category(view, home.envelope);
  assert.deepEqual(
    {
      available: envelope.available,
      cashOverspending: envelope.cashOverspending,
    },
    { available: -2_500, cashOverspending: 2_500 },
  );
  assert.equal(category(view, "groceries").available, 6_000);
  assert.equal(view.partnerFunding?.owed, 0);
  assert.equal(view.readyToAssign, 490_000);

  home.alanPays(-2_500);
  view = home.view();
  envelope = category(view, home.envelope);
  assert.deepEqual(
    {
      available: envelope.available,
      cashOverspending: envelope.cashOverspending,
    },
    { available: 0, cashOverspending: 0 },
  );
  assert.equal(view.readyToAssign, 490_000);
});

void test("a refund of your partner's purchase releases what was set aside back to its category", () => {
  const home = fundedGroceries();
  const refund = home.annaBuys(-8_000, 4_000, { date: "2026-11-03" });
  home.run("alan", {
    type: "partner.categorize",
    entryId: refund,
    categoryId: "groceries",
  });

  const view = home.view("2026-11");
  assert.equal(category(view, "groceries").available, 10_000);
  assert.equal(category(view, home.envelope).available, 0);
  assert.equal(view.partnerFunding?.owed, 0);
  assert.equal(view.readyToAssign, 490_000);
});

void test("a smaller share reduces what's still to fund before what was set aside", () => {
  const home = shortGroceries();
  home.run("anna", {
    type: "partner.edit",
    entryId: home.entryId,
    share: 3_500,
    recordedAt: "2026-10-12T12:00:00Z",
  });

  let view = home.view();
  assert.equal(category(view, home.envelope).available, 3_000);
  assert.equal(view.partnerFunding?.stillToFund, 500);

  home.run("anna", {
    type: "partner.edit",
    entryId: home.entryId,
    share: 1_000,
    recordedAt: "2026-10-13T12:00:00Z",
  });
  view = home.view();
  assert.equal(category(view, "groceries").available, 2_000);
  assert.equal(category(view, home.envelope).available, 1_000);
  assert.equal(view.partnerFunding?.stillToFund, 0);
});

void test("writing off your part returns what was set aside to its category", () => {
  const home = fundedGroceries();
  home.run("anna", {
    type: "partner.edit",
    entryId: home.entryId,
    share: 0,
    recordedAt: "2026-11-02T12:00:00Z",
  });

  const view = home.view("2026-11");
  assert.equal(category(view, "groceries").available, 10_000);
  assert.equal(category(view, home.envelope).available, 0);
  assert.equal(view.readyToAssign, 490_000);
});

void test("moving money out of your partner's envelope is allowed and leaves more still to fund", () => {
  const home = fundedGroceries();
  home.run("alan", {
    type: "assign",
    categoryId: home.envelope,
    month,
    amount: -1_500,
  });

  const view = home.view();
  assert.equal(category(view, home.envelope).available, 2_500);
  assert.equal(view.partnerFunding?.stillToFund, 1_500);
  assert.equal(view.readyToAssign, 491_500);
});

void test("other people's envelopes keep working as before", () => {
  const home = fundedGroceries();
  home.run("alan", {
    type: "person.add",
    accountId: "mom",
    name: "Mom",
  });
  const mom = home
    .view()
    .categories.find((item) => item.counterpartyAccountId === "mom")!.id;
  home.run("alan", {
    type: "transaction.upsert",
    transactionId: "mom-lunch",
    accountId: "checking",
    date: "2026-10-14",
    amount: -1_500,
    payee: "Lunch",
    counterpartyShare: { accountId: "mom", amount: 1_500 },
    recordedAt: "2026-10-14T12:00:00Z",
  });

  const view = home.view();
  const envelope = category(view, mom);
  assert.deepEqual(
    {
      available: envelope.available,
      cashOverspending: envelope.cashOverspending,
    },
    { available: -1_500, cashOverspending: 1_500 },
  );
  assert.equal(view.readyToAssign, 490_000);
});

void test("what you spent on your partner's purchase is the same however it was funded", () => {
  const spent = (home: ReturnType<typeof household>) => ({
    reflect: personalSpendingEntries(home.book, "alan"),
    activity: category(home.view(), "groceries").activity,
    spentLastMonth: category(home.view("2026-11"), "groceries").history.spent,
  });
  const funded = spent(fundedGroceries());

  assert.equal(funded.activity, -4_000);
  assert.deepEqual(funded.spentLastMonth, [4_000]);
  assert.deepEqual(spent(shortGroceries()), funded);
});

// In October Alan files Anna's grocery run under Groceries, which covers it,
// and her parking under Parking, which holds $10 of his $30 part. Her
// pharmacy run has no category yet.
function threePurchases() {
  const home = fundedGroceries();
  home.run("alan", {
    type: "assign",
    categoryId: "parking",
    month,
    amount: 1_000,
  });
  const parking = home.annaBuys(6_000, 3_000, {
    date: "2026-10-15",
    payee: "Garage",
  });
  home.run("alan", {
    type: "partner.categorize",
    entryId: parking,
    categoryId: "parking",
  });
  const pharmacy = home.annaBuys(2_000, 2_000, {
    date: "2026-10-16",
    payee: "Pharmacy",
  });
  return { ...home, groceries: home.entryId, parking, pharmacy };
}

void test("each of your partner's purchases shows how much of your part is set aside", () => {
  const home = threePurchases();

  const funding = home.view().partnerFunding!;
  assert.deepEqual(
    funding.entries.map(
      ({ entryId, payee, date, amount, categoryId, setAside, short }) => ({
        entryId,
        payee,
        date,
        amount,
        categoryId,
        setAside,
        short,
      }),
    ),
    [
      {
        entryId: home.groceries,
        payee: "Store",
        date: "2026-10-10",
        amount: 4_000,
        categoryId: "groceries",
        setAside: 4_000,
        short: 0,
      },
      {
        entryId: home.parking,
        payee: "Garage",
        date: "2026-10-15",
        amount: 3_000,
        categoryId: "parking",
        setAside: 1_000,
        short: 2_000,
      },
      {
        entryId: home.pharmacy,
        payee: "Pharmacy",
        date: "2026-10-16",
        amount: 2_000,
        categoryId: undefined,
        setAside: 0,
        short: 2_000,
      },
    ],
  );
  assert.deepEqual(
    {
      owed: funding.owed,
      stillToFund: funding.stillToFund,
      needsCategory: funding.entries.map((entry) => entry.needsCategory),
    },
    { owed: 9_000, stillToFund: 4_000, needsCategory: [false, false, true] },
  );
});

void test("earlier purchases still short or without a category stay in the list", () => {
  const home = threePurchases();
  const bakery = home.annaBuys(1_000, 500, {
    date: "2026-11-04",
    payee: "Bakery",
  });

  assert.deepEqual(
    home
      .view("2026-11")
      .partnerFunding!.entries.map(({ entryId, month, short }) => ({
        entryId,
        month,
        short,
      })),
    [
      { entryId: home.parking, month, short: 2_000 },
      { entryId: home.pharmacy, month, short: 2_000 },
      { entryId: bakery, month: "2026-11", short: 500 },
    ],
  );
});
