import assert from "node:assert/strict";
import test from "node:test";
import {
  addMember,
  bookSchema,
  createBook,
  execute,
  forecastLoan,
  mergeBooks,
  projectBook,
  splitAmount,
  type Book,
  type Command,
} from "../../src/domain/engine";

const month = "2026-10";
const date = "2026-10-10";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;
function fixture(cash = 500_000) {
  let book = createBook("alan", "Alan", month);
  let sequence = 0;
  const run = (
    command: WithoutId<Command>,
    actor = "alan",
    source: "user" | "agent" = "user",
  ) => {
    book = execute(
      book,
      actor,
      { ...command, id: `operation-${++sequence}` },
      source,
    );
    return book;
  };
  run({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: cash,
  });
  run({ type: "category.add", categoryId: "food", name: "Food" });
  return {
    run,
    get book() {
      return book;
    },
    set book(value: Book) {
      book = value;
    },
    view: (actor = "alan", selectedMonth = month) =>
      projectBook(book, actor, selectedMonth),
  };
}

void test("integer cents and largest-remainder splits conserve each cent deterministically", () => {
  assert.deepEqual(splitAmount(101, { partner: 1, alan: 1 }), {
    alan: 51,
    partner: 50,
  });
  assert.deepEqual(splitAmount(103, { alan: 1, partner: 2 }), {
    alan: 34,
    partner: 69,
  });
  assert.throws(() => splitAmount(1.1, { alan: 1, partner: 1 }));
  for (let amount = 0; amount < 1000; amount++)
    assert.equal(
      Object.values(splitAmount(amount, { a: 7, b: 13 })).reduce(
        (a, b) => a + b,
        0,
      ),
      amount,
    );
});

void test("assignments only use received cash, retain immutability, and cannot be made by an agent", () => {
  const setup = fixture(100_000);
  const before = structuredClone(setup.book);
  const next = execute(setup.book, "alan", {
    id: "assign-first",
    type: "assign",
    categoryId: "food",
    month,
    amount: 60_000,
  });
  assert.deepEqual(setup.book, before);
  assert.equal(projectBook(next, "alan", month).readyToAssign, 40_000);
  assert.throws(
    () =>
      execute(next, "alan", {
        id: "too-much",
        type: "assign",
        categoryId: "food",
        month,
        amount: 40_001,
      }),
    /existing Ready/,
  );
  assert.throws(
    () =>
      execute(
        next,
        "alan",
        { id: "ai", type: "assign", categoryId: "food", month, amount: 1 },
        "agent",
      ),
    /user action/,
  );
  assert.throws(
    () =>
      execute(next, "intruder", {
        id: "intruder",
        type: "category.add",
        categoryId: "bad",
        name: "Bad",
      }),
    /access denied/,
  );
});

void test("operation retries do not duplicate effects and conflicting reuse is rejected", () => {
  const setup = fixture();
  const command: Command = {
    id: "same-id",
    type: "assign",
    categoryId: "food",
    month,
    amount: 1000,
  };
  const first = execute(setup.book, "alan", command);
  assert.deepEqual(execute(first, "alan", command), first);
  assert.throws(
    () => execute(first, "alan", { ...command, amount: 2000 }),
    /different data/,
  );
});

void test("cash overspending reduces next month's Ready to Assign; positive envelopes carry", () => {
  const setup = fixture(100_000);
  setup.run({ type: "assign", categoryId: "food", month, amount: 20_000 });
  setup.run({ type: "category.add", categoryId: "savings", name: "Savings" });
  setup.run({ type: "assign", categoryId: "savings", month, amount: 10_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "purchase",
    accountId: "checking",
    date,
    amount: -30_000,
    payee: "Market",
    categoryId: "food",
  });
  assert.equal(setup.view().readyToAssign, 70_000);
  assert.equal(
    setup.view().categories.find((category) => category.id === "food")
      ?.available,
    -10_000,
  );
  assert.equal(setup.view("alan", "2026-11").readyToAssign, 60_000);
  assert.equal(
    setup
      .view("alan", "2026-11")
      .categories.find((category) => category.id === "food")?.available,
    0,
  );
  assert.equal(
    setup
      .view("alan", "2026-11")
      .categories.find((category) => category.id === "savings")?.available,
    10_000,
  );
});

void test("funded card purchases reserve real cash and payment consumes reserve without spending twice", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "account.add",
    accountId: "amex",
    name: "Amex",
    kind: "credit",
    openingBalance: 0,
  });
  setup.run({ type: "assign", categoryId: "food", month, amount: 20_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "dinner",
    accountId: "amex",
    date,
    amount: -12_000,
    payee: "Dinner",
    categoryId: "food",
  });
  assert.equal(
    setup.view().accounts.find((account) => account.id === "amex")?.reserve,
    12_000,
  );
  assert.equal(
    setup.view().categories.find((category) => category.id === "food")
      ?.available,
    8000,
  );
  assert.equal(setup.view().readyToAssign, 80_000);
  setup.run({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "amex",
    date: "2026-10-11",
    amount: 12_000,
  });
  assert.equal(setup.view().cash, 88_000);
  assert.equal(
    setup.view().accounts.find((account) => account.id === "amex")?.reserve,
    0,
  );
  assert.equal(
    setup.view().accounts.find((account) => account.id === "amex")?.balance,
    0,
  );
  assert.equal(setup.view().readyToAssign, 80_000);
  assert.equal(setup.view().personalSpending, 12_000);
});

void test("unfunded card spending remains debt across rollover without reducing cash Ready to Assign", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  setup.run({ type: "assign", categoryId: "food", month, amount: 5000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "food-charge",
    accountId: "card",
    date,
    amount: -8000,
    payee: "Food",
    categoryId: "food",
  });
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.shortfall,
    3000,
  );
  assert.equal(setup.view("alan", "2026-11").readyToAssign, 95_000);
  assert.equal(
    setup
      .view("alan", "2026-11")
      .categories.find((category) => category.id === "food")?.available,
    0,
  );
  assert.equal(
    setup
      .view("alan", "2026-11")
      .accounts.find((account) => account.id === "card")?.shortfall,
    3000,
  );
  assert.throws(
    () =>
      setup.run({
        type: "card.payment",
        cashAccountId: "checking",
        cardAccountId: "card",
        date,
        amount: 8000,
      }),
    /exceeds existing reserve/,
  );
});

void test("cash spending has funding priority over card spending in a mixed category", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  setup.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "card-charge",
    accountId: "card",
    date,
    amount: -8000,
    payee: "Card food",
    categoryId: "food",
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "cash-charge",
    accountId: "checking",
    date,
    amount: -5000,
    payee: "Cash food",
    categoryId: "food",
  });
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.reserve,
    5000,
  );
  assert.equal(setup.view().readyToAssign, 90_000);
});

void test("pending $30 restaurant becomes one posted $36 purchase with categorization and history", () => {
  const setup = fixture(100_000);
  setup.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "restaurant",
    accountId: "checking",
    date,
    amount: -3000,
    payee: "Restaurant",
    categoryId: "food",
    status: "pending",
    providerId: "pending-1",
    revision: 1,
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "restaurant",
    accountId: "checking",
    date: "2026-10-11",
    amount: -3600,
    payee: "Restaurant",
    status: "posted",
    providerId: "posted-1",
    revision: 2,
  });
  assert.equal(setup.view().personalSpending, 3600);
  assert.equal(setup.view().cash, 96_400);
  assert.equal(setup.view().budget.transactions.length, 1);
  assert.equal(setup.view().budget.transactions[0]?.categoryId, "food");
  assert.deepEqual(
    setup.view().budget.transactions[0]?.history.map((item) => item.amount),
    [-3000, -3600],
  );
});

void test("provider identity is unique and removals reverse bookkeeping without losing history", () => {
  const setup = fixture();
  setup.run({
    type: "transaction.upsert",
    transactionId: "first",
    accountId: "checking",
    date,
    amount: -1000,
    payee: "Store",
    categoryId: "food",
    providerId: "provider-1",
  });
  assert.throws(
    () =>
      setup.run({
        type: "transaction.upsert",
        transactionId: "second",
        accountId: "checking",
        date,
        amount: -1000,
        payee: "Store",
        providerId: "provider-1",
      }),
    /already exists/,
  );
  setup.run({ type: "transaction.remove", transactionId: "first" });
  assert.equal(setup.view().personalSpending, 0);
  assert.equal(setup.view().cash, 500_000);
  assert.equal(
    setup.view().budget.transactions[0]?.history.at(-1)?.reason,
    "removed",
  );
});

function household() {
  const setup = fixture(500_000);
  setup.book = addMember(setup.book, "partner", "Partner", month);
  setup.run(
    {
      type: "account.add",
      accountId: "partner-cash",
      name: "Private partner bank",
      kind: "cash",
      openingBalance: 500_000,
    },
    "partner",
  );
  setup.run({ type: "category.add", categoryId: "rent", name: "Rent" });
  setup.run({
    type: "category.add",
    categoryId: "utilities",
    name: "Utilities",
  });
  setup.run({
    type: "shared.create",
    sharedCategoryId: "shared-rent",
    participants: ["alan", "partner"],
    weights: { alan: 1, partner: 1 },
    categoryIds: { alan: "rent", partner: "partner-rent" },
  });
  setup.run({
    type: "shared.create",
    sharedCategoryId: "shared-utilities",
    participants: ["alan", "partner"],
    weights: { alan: 1, partner: 1 },
    categoryIds: { alan: "utilities", partner: "partner-utilities" },
  });
  return setup;
}

void test("$2,000 rent and $200 utilities produce $900 settlement and release only the $100 offset", () => {
  const setup = household();
  setup.run({ type: "assign", categoryId: "rent", month, amount: 100_000 });
  setup.run({ type: "assign", categoryId: "utilities", month, amount: 20_000 });
  setup.run(
    { type: "assign", categoryId: "partner-rent", month, amount: 200_000 },
    "partner",
  );
  setup.run(
    { type: "assign", categoryId: "partner-utilities", month, amount: 10_000 },
    "partner",
  );
  setup.run(
    {
      type: "transaction.upsert",
      transactionId: "rent-paid",
      accountId: "partner-cash",
      date,
      amount: -200_000,
      payee: "Landlord",
      categoryId: "partner-rent",
      sharedCategoryId: "shared-rent",
    },
    "partner",
  );
  setup.run({
    type: "transaction.upsert",
    transactionId: "utility-paid",
    accountId: "checking",
    date,
    amount: -20_000,
    payee: "Electric utility",
    categoryId: "utilities",
    sharedCategoryId: "shared-utilities",
  });
  const before = structuredClone(setup.book);
  const report = setup.view();
  assert.equal(report.personalSpending, 110_000);
  assert.equal(setup.view("partner").personalSpending, 110_000);
  assert.equal(report.amountPaid, 20_000);
  assert.equal(report.settlement.net, 90_000);
  assert.equal(
    report.categories.find((category) => category.id === "rent")?.reserved,
    100_000,
  );
  assert.equal(
    report.categories.find((category) => category.id === "rent")?.spendable,
    0,
  );
  assert.deepEqual(setup.book, before);
  setup.run({
    type: "settlement.record",
    settlementId: "october",
    otherUserId: "partner",
    date: "2026-10-31",
    accountId: "checking",
    amount: 90_000,
  });
  assert.equal(setup.view().readyToAssign - report.readyToAssign, 10_000);
  assert.equal(setup.view().cash, report.cash - 90_000);
  assert.equal(setup.view().settlement.net, 0);
  assert.equal(setup.view().personalSpending, 110_000);
  assert.equal(
    setup.view().categories.find((category) => category.id === "rent")
      ?.available,
    0,
  );
  assert.deepEqual(
    setup
      .view()
      .categories.filter((category) => category.id !== "food")
      .map((category) => ({
        id: category.id,
        cash: category.cashActivity,
        credit: category.creditActivity,
        settlement: category.settlementActivity,
      })),
    [
      { id: "rent", cash: 0, credit: 0, settlement: -100_000 },
      { id: "utilities", cash: -20_000, credit: 0, settlement: 0 },
    ],
    "The repayment and its offset both show as partner settlement",
  );
  assert.equal(
    setup.view("partner").cash,
    300_000,
    "Recording the payer's transfer must not invent a creditor bank deposit",
  );
  setup.run(
    {
      type: "settlement.receive",
      settlementId: "october",
      accountId: "partner-cash",
      date: "2026-10-31",
    },
    "partner",
  );
  assert.equal(setup.view("partner").cash, 390_000);
  assert.equal(setup.view("partner").earnings, 0);
});

void test("opening amounts are already split, create no cash or spending, and survive month changes", () => {
  const setup = household();
  const cash = setup.view().cash;
  setup.run({
    type: "opening.add",
    obligationId: "old-rent",
    sharedCategoryId: "shared-rent",
    debtorId: "alan",
    creditorId: "partner",
    amount: 25_001,
  });
  assert.equal(setup.view().settlement.net, 25_001);
  assert.equal(setup.view("alan", "2026-11").settlement.net, 25_001);
  assert.equal(setup.view().cash, cash);
  assert.equal(setup.view().personalSpending, 0);
  assert.equal(setup.view().budget.transactions.length, 0);
});

void test("shared split changes affect future expenses, with explicit purchase exceptions and immutable paid history", () => {
  const setup = household();
  setup.run({
    type: "transaction.upsert",
    transactionId: "old",
    accountId: "checking",
    date,
    amount: -10_000,
    payee: "Old bill",
    categoryId: "utilities",
    sharedCategoryId: "shared-utilities",
  });
  setup.run(
    {
      type: "shared.rule",
      sharedCategoryId: "shared-utilities",
      weights: { alan: 1, partner: 3 },
    },
    "partner",
  );
  setup.run({
    type: "transaction.upsert",
    transactionId: "new",
    accountId: "checking",
    date,
    amount: -10_000,
    payee: "New bill",
    categoryId: "utilities",
    sharedCategoryId: "shared-utilities",
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "exception",
    accountId: "checking",
    date,
    amount: -10_001,
    payee: "Exception bill",
    categoryId: "utilities",
    sharedCategoryId: "shared-utilities",
    shares: { alan: 9000, partner: 1001 },
  });
  assert.deepEqual(
    setup
      .view()
      .budget.transactions.map((transaction) => transaction.shares?.partner),
    [5000, 7500, 1001],
  );
});

void test("each participant sees a shared category under their own paired category name", () => {
  const setup = fixture(500_000);
  setup.book = addMember(setup.book, "partner", "Partner", month);
  setup.run({
    type: "category.add",
    categoryId: "utilities",
    name: "Utilities",
  });
  setup.run(
    { type: "category.add", categoryId: "bills", name: "Monthly bills" },
    "partner",
  );
  setup.run({ type: "category.add", categoryId: "rent", name: "Rent" });
  for (const [sharedCategoryId, partnerCategory] of [
    ["shared-utilities", "bills"],
    ["shared-rent", "partner-rent"],
  ] as const)
    setup.run({
      type: "shared.create",
      sharedCategoryId,
      participants: ["alan", "partner"],
      weights: { alan: 1, partner: 1 },
      categoryIds: {
        alan: sharedCategoryId.slice("shared-".length),
        partner: partnerCategory,
      },
    });
  const names = (actor: string) =>
    setup.view(actor).sharedCategories.map((shared) => shared.name);
  assert.deepEqual(names("alan"), ["Utilities", "Rent"]);
  assert.deepEqual(names("partner"), ["Monthly bills", "Rent"]);
  assert.deepEqual(
    setup.book.budgets.partner?.categories.find(
      (category) => category.id === "partner-rent",
    )?.name,
    "Rent",
    "a category created for the partner is named after the sharer's category",
  );
  assert.equal(
    "name" in (setup.book.sharedCategories[0] ?? {}),
    false,
    "shared categories store no name of their own",
  );
});

void test("either participant can change a shared split for future purchases without rewriting history", () => {
  const setup = household();
  setup.run({
    type: "transaction.upsert",
    transactionId: "before-update",
    accountId: "checking",
    date,
    amount: -10_000,
    payee: "Utilities",
    categoryId: "utilities",
    sharedCategoryId: "shared-utilities",
  });
  const before = structuredClone(setup.book);
  setup.run(
    {
      type: "shared.rule",
      sharedCategoryId: "shared-utilities",
      weights: { alan: 25, partner: 75 },
    },
    "partner",
  );
  for (const actor of ["alan", "partner"]) {
    const shared = setup
      .view(actor)
      .sharedCategories.find((category) => category.id === "shared-utilities")!;
    assert.deepEqual(shared.weights, { alan: 25, partner: 75 });
    assert.deepEqual(
      setup.book.budgets[actor],
      before.budgets[actor],
      "editing the shared rule preserves personal categories, funding, and transactions",
    );
  }
  assert.deepEqual(setup.book.obligations, before.obligations);
  assert.deepEqual(bookSchema.parse(setup.book), setup.book);
  setup.run({
    type: "shared.rule",
    sharedCategoryId: "shared-utilities",
    weights: { alan: 25, partner: 75 },
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "after-update",
    accountId: "checking",
    date,
    amount: -10_000,
    payee: "Next bill",
    categoryId: "utilities",
    sharedCategoryId: "shared-utilities",
  });
  assert.deepEqual(
    setup.view().budget.transactions.map((transaction) => transaction.shares),
    [
      { alan: 5000, partner: 5000 },
      { alan: 2500, partner: 7500 },
    ],
  );
});

void test("either participant can delete an unused shared category while keeping both funded personal categories", () => {
  for (const actor of ["alan", "partner"]) {
    const setup = household();
    setup.run({ type: "assign", categoryId: "rent", month, amount: 10_000 });
    setup.run(
      { type: "assign", categoryId: "partner-rent", month, amount: 20_000 },
      "partner",
    );
    const before = structuredClone(setup.book);
    const command: Command = {
      type: "shared.remove",
      id: "delete-rent",
      sharedCategoryId: "shared-rent",
    };
    setup.book = execute(setup.book, actor, command);
    assert.deepEqual(setup.book.budgets, before.budgets);
    assert.deepEqual(setup.book.obligations, before.obligations);
    assert.deepEqual(setup.book.sharedCategories, [before.sharedCategories[1]]);
    assert.deepEqual(execute(setup.book, actor, command), setup.book);
    assert.deepEqual(bookSchema.parse(setup.book), setup.book);
    for (const participant of ["alan", "partner"])
      assert.ok(
        !setup
          .view(participant)
          .sharedCategories.some((category) => category.id === "shared-rent"),
      );
    assert.throws(
      () =>
        setup.run({
          type: "opening.add",
          obligationId: "deleted-rent-opening",
          sharedCategoryId: "shared-rent",
          debtorId: "alan",
          creditorId: "partner",
          amount: 100,
        }),
      /access denied/,
    );
  }
});

void test("shared category deletion preserves opening balances even after settlement", () => {
  const setup = household();
  setup.run({
    type: "opening.add",
    obligationId: "opening-rent",
    sharedCategoryId: "shared-rent",
    debtorId: "alan",
    creditorId: "partner",
    amount: 1000,
  });
  const remove = () =>
    setup.run({
      type: "shared.remove",
      sharedCategoryId: "shared-rent",
    });
  assert.throws(remove, /recorded activity cannot be deleted/);
  setup.run({
    type: "settlement.record",
    settlementId: "paid-opening",
    otherUserId: "partner",
    date,
    accountId: "checking",
    amount: 1000,
  });
  assert.equal(setup.view().settlement.net, 0);
  const before = structuredClone(setup.book);
  assert.throws(remove, /recorded activity cannot be deleted/);
  assert.deepEqual(setup.book, before);
});

void test("shared category deletion checks both participants' transactions including removed expenses with no obligation", () => {
  const setup = household();
  setup.run(
    {
      type: "transaction.upsert",
      transactionId: "partner-expense",
      accountId: "partner-cash",
      date,
      amount: -1000,
      payee: "Rent",
      categoryId: "partner-rent",
      sharedCategoryId: "shared-rent",
      shares: { alan: 0, partner: 1000 },
    },
    "partner",
  );
  assert.equal(setup.book.obligations.length, 0);
  const remove = () =>
    setup.run({
      type: "shared.remove",
      sharedCategoryId: "shared-rent",
    });
  assert.throws(remove, /recorded activity cannot be deleted/);
  setup.run(
    { type: "transaction.remove", transactionId: "partner-expense" },
    "partner",
  );
  assert.throws(remove, /recorded activity cannot be deleted/);
});

void test("shared updates and deletes enforce participant access and require a user decision", () => {
  const setup = household();
  for (const command of [
    {
      type: "shared.rule",
      sharedCategoryId: "shared-rent",
      weights: { alan: 1, partner: 1 },
    },
    { type: "shared.remove", sharedCategoryId: "shared-rent" },
  ] satisfies WithoutId<Command>[]) {
    assert.throws(() => setup.run(command, "outsider"), /access denied/);
    assert.throws(() => setup.run(command, "alan", "agent"), /user action/);
    assert.throws(
      () => setup.run({ ...command, sharedCategoryId: "missing" }),
      /access denied/,
    );
  }
  const invalidWeights: Record<string, number>[] = [
    { alan: 0, partner: 0 },
    { alan: -1, partner: 2 },
    { alan: 1, outsider: 1 },
  ];
  for (const weights of invalidWeights) {
    const before = structuredClone(setup.book);
    assert.throws(() =>
      setup.run({
        type: "shared.rule",
        sharedCategoryId: "shared-rent",
        weights,
      }),
    );
    assert.deepEqual(setup.book, before);
  }
});

void test("rent uses its due expense month while the actual account outflow keeps its payment date", () => {
  const setup = household();
  setup.run({
    type: "transaction.upsert",
    transactionId: "early-rent",
    accountId: "checking",
    date: "2026-10-25",
    expenseMonth: "2026-11",
    amount: -200_000,
    payee: "Landlord",
    categoryId: "rent",
    sharedCategoryId: "shared-rent",
  });
  assert.equal(setup.view().cash, 300_000);
  assert.equal(setup.view().personalSpending, 0);
  assert.equal(setup.view("alan", "2026-11").personalSpending, 100_000);
  assert.equal(setup.view("partner", "2026-11").personalSpending, 100_000);
});

void test("server projections exclude unrelated partner spending, account details, balances and audit input", () => {
  const setup = household();
  setup.run(
    {
      type: "category.add",
      categoryId: "secret-category",
      name: "Secret category",
    },
    "partner",
  );
  setup.run(
    {
      type: "transaction.upsert",
      transactionId: "secret-transaction",
      accountId: "partner-cash",
      date,
      amount: -1234,
      payee: "Secret merchant",
      categoryId: "secret-category",
    },
    "partner",
  );
  const serialized = JSON.stringify(setup.view());
  for (const secret of [
    "Secret merchant",
    "Secret category",
    "secret-transaction",
    "Private partner bank",
  ])
    assert.ok(!serialized.includes(secret));
  assert.throws(
    () =>
      setup.run({
        type: "transaction.categorize",
        transactionId: "secret-transaction",
        categoryId: "food",
      }),
    /access denied/,
  );
  assert.throws(
    () =>
      setup.run({
        type: "transaction.upsert",
        transactionId: "steal",
        accountId: "partner-cash",
        date,
        amount: -1,
        payee: "Steal",
      }),
    /access denied/,
  );
});

void test("shared statement exposes enough purchase facts to verify a changed split without partner account details", () => {
  const setup = household();
  setup.run(
    {
      type: "transaction.upsert",
      transactionId: "shared-proof",
      accountId: "partner-cash",
      date,
      amount: -10_001,
      payee: "Shared merchant",
      categoryId: "partner-rent",
      sharedCategoryId: "shared-rent",
      shares: { alan: 7001, partner: 3000 },
    },
    "partner",
  );
  setup.run({
    type: "shared.rule",
    sharedCategoryId: "shared-rent",
    weights: { alan: 1, partner: 1 },
  });
  const rent = setup
    .view()
    .sharedStatement.categories.find(
      (category) => category.sharedCategoryId === "shared-rent",
    )!;
  const purchase = rent.purchases[0]!;
  assert.equal(purchase.amountPaid, 10_001);
  assert.equal(purchase.yourShare, 7001);
  assert.equal(purchase.partnerShare, 3000);
  assert.equal(purchase.paidByYou, false);
  assert.equal(purchase.effect, 7001);
  assert.equal(purchase.splitDiffersFromRule, true);
  assert.ok(!JSON.stringify(rent).includes("partner-cash"));
  assert.ok(!JSON.stringify(rent).includes("partner-rent"));
  assert.ok(!("accountId" in purchase));
});

type Household = ReturnType<typeof household>;
function sharedPurchase(
  setup: Household,
  actor: "alan" | "partner",
  transactionId: string,
  shared: "rent" | "utilities",
  amount: number,
  day = date,
  shares?: Record<string, number>,
) {
  setup.run(
    {
      type: "transaction.upsert",
      transactionId,
      accountId: actor === "alan" ? "checking" : "partner-cash",
      date: day,
      amount: -amount,
      payee: transactionId,
      categoryId: actor === "alan" ? shared : `partner-${shared}`,
      sharedCategoryId: `shared-${shared}`,
      shares,
    },
    actor,
  );
}
function statementLines(setup: Household, actor = "alan", selected = month) {
  const view = setup.view(actor, selected);
  const statement = view.sharedStatement;
  assert.equal(
    statement.balance,
    view.settlement.net,
    `${actor} ${selected}: statement must reconcile with the net settlement`,
  );
  assert.equal(
    view.categories.reduce((total, category) => total + category.reserved, 0),
    view.settlement.youOwe,
    "set-aside cash covers exactly the unpaid amounts you owe",
  );
  for (const category of view.categories)
    assert.equal(category.spendable, category.available - category.reserved);
  return {
    view,
    statement,
    carried: statement.carried.amount,
    effect: (shared: string) =>
      statement.categories.find(
        (category) => category.sharedCategoryId === `shared-${shared}`,
      )!.effect,
  };
}

void test("the monthly shared statement lists each category's own purchases and reconciles with the net after partial repayments", () => {
  const setup = household();
  setup.run({ type: "assign", categoryId: "rent", month, amount: 130_000 });
  sharedPurchase(setup, "partner", "rent-oct", "rent", 260_000, "2026-10-02");
  sharedPurchase(setup, "alan", "power-oct", "utilities", 18_942, "2026-10-03");
  sharedPurchase(setup, "alan", "water-oct", "utilities", 5_001, "2026-10-04");
  let lines = statementLines(setup);
  assert.equal(lines.effect("rent"), 130_000);
  assert.equal(lines.effect("utilities"), -(9_471 + 2_500));
  assert.equal(lines.view.settlement.net, 130_000 - 11_971);
  assert.deepEqual(
    lines.statement.categories
      .find((category) => category.sharedCategoryId === "shared-utilities")!
      .purchases.map((purchase) => [purchase.payee, purchase.effect]),
    [
      ["power-oct", -9_471],
      ["water-oct", -2_500],
    ],
  );
  setup.run({
    type: "settlement.record",
    settlementId: "partial",
    otherUserId: "partner",
    date: "2026-10-16",
    accountId: "checking",
    amount: 25_000,
  });
  lines = statementLines(setup);
  assert.equal(
    lines.effect("rent"),
    130_000,
    "category lines show the month's purchases, not how repayments were allocated",
  );
  assert.equal(lines.effect("utilities"), -11_971);
  assert.deepEqual(
    lines.statement.repayments.map((repayment) => [
      repayment.amount,
      repayment.effect,
      repayment.paidByYou,
      repayment.receivedOn,
    ]),
    [[25_000, -25_000, true, undefined]],
  );
  assert.equal(lines.view.settlement.net, 130_000 - 11_971 - 25_000);
  const partnerLines = statementLines(setup, "partner");
  assert.equal(partnerLines.effect("rent"), -130_000);
  assert.equal(partnerLines.statement.balance, -lines.statement.balance);
  assert.deepEqual(
    partnerLines.statement.awaitingYourConfirmation.map(
      (item) => item.settlementId,
    ),
    ["partial"],
  );
  setup.run(
    {
      type: "settlement.receive",
      settlementId: "partial",
      accountId: "partner-cash",
      date: "2026-10-18",
    },
    "partner",
  );
  assert.equal(
    statementLines(setup, "partner").statement.repayments[0]?.receivedOn,
    "2026-10-18",
  );
  assert.equal(
    statementLines(setup).statement.repayments[0]?.receivedOn,
    "2026-10-18",
    "the payer sees when their repayment was confirmed",
  );
});

void test("a purchase keeps the split it was recorded with after the rule changes mid-month", () => {
  const setup = household();
  sharedPurchase(setup, "alan", "early", "utilities", 10_000, "2026-10-02");
  setup.run(
    {
      type: "shared.rule",
      sharedCategoryId: "shared-utilities",
      weights: { alan: 3, partner: 1 },
    },
    "partner",
  );
  sharedPurchase(setup, "alan", "late", "utilities", 10_000, "2026-10-20");
  sharedPurchase(setup, "partner", "custom", "utilities", 9_999, "2026-10-21", {
    alan: 1_000,
    partner: 8_999,
  });
  const lines = statementLines(setup);
  const purchases = lines.statement.categories.find(
    (category) => category.sharedCategoryId === "shared-utilities",
  )!.purchases;
  assert.deepEqual(
    purchases.map((purchase) => [
      purchase.transactionId,
      purchase.yourShare,
      purchase.effect,
      purchase.splitDiffersFromRule,
    ]),
    [
      ["early", 5_000, -5_000, true],
      ["late", 7_500, -2_500, false],
      ["custom", 1_000, 1_000, true],
    ],
  );
  assert.equal(lines.effect("utilities"), -6_500);
});

void test("opening amounts are carried into the first month and then roll into each month's closing balance", () => {
  const setup = household();
  setup.run({
    type: "opening.add",
    obligationId: "old-rent",
    sharedCategoryId: "shared-rent",
    debtorId: "alan",
    creditorId: "partner",
    amount: 17_500,
  });
  setup.run({
    type: "opening.add",
    obligationId: "old-power",
    sharedCategoryId: "shared-utilities",
    debtorId: "partner",
    creditorId: "alan",
    amount: 2_500,
  });
  let october = statementLines(setup);
  assert.equal(october.statement.carried.from, "opening");
  assert.equal(october.carried, 15_000);
  assert.deepEqual(
    october.statement.carried.opening.map((item) => [item.name, item.effect]),
    [
      ["Rent", 17_500],
      ["Utilities", -2_500],
    ],
  );
  sharedPurchase(setup, "partner", "rent-oct", "rent", 200_000, "2026-10-02");
  setup.run({
    type: "settlement.record",
    settlementId: "october",
    otherUserId: "partner",
    date: "2026-10-20",
    accountId: "checking",
    amount: 115_000,
  });
  october = statementLines(setup);
  assert.equal(october.statement.balance, 0);
  const november = statementLines(setup, "alan", "2026-11");
  assert.equal(november.statement.carried.from, "earlier-months");
  assert.equal(november.carried, 0);
  const partnerOctober = statementLines(setup, "partner");
  assert.equal(partnerOctober.carried, -15_000);
});

void test("past months keep their own statement while later activity carries forward", () => {
  const setup = household();
  sharedPurchase(setup, "partner", "rent-oct", "rent", 200_000, "2026-10-02");
  sharedPurchase(setup, "alan", "power-oct", "utilities", 20_000, "2026-10-05");
  setup.run({
    type: "settlement.record",
    settlementId: "late-october",
    otherUserId: "partner",
    date: "2026-10-30",
    accountId: "checking",
    amount: 50_000,
  });
  sharedPurchase(setup, "alan", "power-nov", "utilities", 30_000, "2026-11-04");
  sharedPurchase(setup, "partner", "rent-nov", "rent", 200_000, "2026-11-02");
  setup.run(
    {
      type: "settlement.receive",
      settlementId: "late-october",
      accountId: "partner-cash",
      date: "2026-11-01",
    },
    "partner",
  );
  setup.run({
    type: "settlement.record",
    settlementId: "november",
    otherUserId: "partner",
    date: "2026-11-20",
    accountId: "checking",
    amount: 10_000,
  });
  const october = statementLines(setup);
  assert.equal(october.carried, 0);
  assert.equal(october.statement.carried.from, "nothing");
  assert.equal(october.statement.balance, 100_000 - 10_000 - 50_000);
  assert.deepEqual(
    october.statement.repayments.map((item) => [
      item.settlementId,
      item.receivedOn,
    ]),
    [["late-october", undefined]],
    "a receipt recorded after the month is not shown as received in that month",
  );
  assert.deepEqual(
    statementLines(setup, "partner").statement.awaitingYourConfirmation.map(
      (item) => item.settlementId,
    ),
    ["late-october"],
  );
  const november = statementLines(setup, "alan", "2026-11");
  assert.equal(november.carried, october.statement.balance);
  assert.equal(november.effect("rent"), 100_000);
  assert.equal(november.effect("utilities"), -15_000);
  assert.deepEqual(
    november.statement.repayments.map((item) => item.settlementId),
    ["november"],
  );
  assert.equal(november.statement.balance, 40_000 + 100_000 - 15_000 - 10_000);
  assert.equal(
    statementLines(setup, "alan", "2026-12").carried,
    november.statement.balance,
  );
});

void test("a repayment from the partner while they owe the net adds to the viewer's side of the statement", () => {
  const setup = household();
  sharedPurchase(setup, "alan", "costco", "utilities", 28_000, "2026-10-01");
  setup.run(
    {
      type: "settlement.record",
      settlementId: "partner-pays",
      otherUserId: "alan",
      date: "2026-10-01",
      accountId: "partner-cash",
      amount: 12_000,
    },
    "partner",
  );
  sharedPurchase(setup, "partner", "rent", "rent", 200_000, "2026-10-02");
  const lines = statementLines(setup);
  assert.deepEqual(
    lines.statement.repayments.map((item) => [item.paidByYou, item.effect]),
    [[false, 12_000]],
  );
  assert.equal(lines.statement.balance, -14_000 + 12_000 + 100_000);
  assert.deepEqual(
    lines.statement.awaitingYourConfirmation.map((item) => item.amount),
    [12_000],
  );
  assert.throws(
    () =>
      setup.run(
        {
          type: "settlement.record",
          settlementId: "wrong-direction",
          otherUserId: "alan",
          date: "2026-10-03",
          accountId: "partner-cash",
          amount: 1_000,
        },
        "partner",
      ),
    /The other member owes the net payment/,
  );
});

void test("shared statements reconcile with the net settlement for both members across varied months", () => {
  const setup = household();
  let seed = 7;
  const next = () => (seed = (seed * 48_271) % 2_147_483_647);
  const months = ["2026-10", "2026-11", "2026-12"];
  for (const [index, selected] of months.entries())
    for (let step = 0; step < 12; step++) {
      const day = `${selected}-${String(1 + step * 2).padStart(2, "0")}`;
      const choice = next() % 5;
      if (choice < 3)
        sharedPurchase(
          setup,
          next() % 2 ? "alan" : "partner",
          `p-${index}-${step}`,
          next() % 2 ? "rent" : "utilities",
          1 + (next() % 40_000),
          day,
        );
      else if (choice === 3)
        setup.run(
          {
            type: "shared.rule",
            sharedCategoryId: next() % 2 ? "shared-rent" : "shared-utilities",
            weights: { alan: 1 + (next() % 5), partner: 1 + (next() % 5) },
          },
          next() % 2 ? "alan" : "partner",
        );
      else {
        const net = projectBook(setup.book, "alan", selected).settlement.net;
        if (!net) continue;
        const payer = net > 0 ? "alan" : "partner";
        setup.run(
          {
            type: "settlement.record",
            settlementId: `s-${index}-${step}`,
            otherUserId: payer === "alan" ? "partner" : "alan",
            date: day,
            accountId: payer === "alan" ? "checking" : "partner-cash",
            amount: Math.max(1, Math.floor(Math.abs(net) / 2)),
          },
          payer,
        );
      }
    }
  for (const selected of months)
    for (const actor of ["alan", "partner"]) {
      const lines = statementLines(setup, actor, selected);
      const previous = months[months.indexOf(selected) - 1];
      if (previous)
        assert.equal(
          lines.carried,
          setup.view(actor, previous).sharedStatement.balance,
        );
    }
});

void test("a personal category can belong to only one shared category", () => {
  const setup = household();
  assert.throws(
    () =>
      setup.run({
        type: "shared.create",
        sharedCategoryId: "shared-rent-again",
        participants: ["alan", "partner"],
        weights: { alan: 1, partner: 1 },
        categoryIds: { alan: "rent", partner: "partner-rent-again" },
      }),
    /already shared/,
  );
  assert.throws(
    () =>
      setup.run(
        {
          type: "shared.create",
          sharedCategoryId: "partner-side-again",
          participants: ["alan", "partner"],
          weights: { alan: 1, partner: 1 },
          categoryIds: { alan: "alan-new", partner: "partner-rent" },
        },
        "partner",
      ),
    /already shared/,
  );
});

void test("cash reimbursements do not fund envelopes until received and then return to Ready to Assign without earnings", () => {
  const setup = fixture(100_000);
  setup.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "family",
    accountId: "checking",
    date,
    amount: -10_000,
    payee: "Family dinner",
    categoryId: "food",
  });
  setup.run({
    type: "reimbursement.expect",
    reimbursementId: "family-claim",
    transactionId: "family",
    name: "Family",
    amount: 5000,
    kind: "cash",
  });
  assert.equal(setup.view().readyToAssign, 90_000);
  setup.run({
    type: "reimbursement.receive",
    reimbursementId: "family-claim",
    accountId: "checking",
    date: "2026-10-20",
    amount: 5000,
  });
  assert.equal(setup.view().readyToAssign, 95_000);
  assert.equal(
    setup.view().categories.find((category) => category.id === "food")
      ?.available,
    0,
  );
  assert.equal(setup.view().earnings, 0);
  assert.equal(setup.view().reimbursements[0]?.outstanding, 0);
  assert.throws(
    () =>
      setup.run({
        type: "reimbursement.receive",
        reimbursementId: "family-claim",
        accountId: "checking",
        date,
        amount: 1,
      }),
    /exceeds/,
  );
});

void test("expected card benefits do nothing; posted credits reduce debt and release only excess existing reserve", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: -10_000,
  });
  setup.run({ type: "assign", categoryId: "food", month, amount: 20_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "benefit-purchase",
    accountId: "card",
    date,
    amount: -20_000,
    payee: "Benefit merchant",
    categoryId: "food",
  });
  setup.run({
    type: "reimbursement.expect",
    reimbursementId: "benefit",
    transactionId: "benefit-purchase",
    name: "Card benefit",
    amount: 15_000,
    kind: "statement-credit",
  });
  setup.run({
    type: "card.credit",
    accountId: "card",
    date,
    amount: 15_000,
    reimbursementId: "benefit",
    posted: false,
  });
  assert.equal(setup.view().readyToAssign, 80_000);
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.balance,
    -30_000,
  );
  setup.run({
    type: "card.credit",
    accountId: "card",
    date,
    amount: 15_000,
    reimbursementId: "benefit",
    posted: true,
  });
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.balance,
    -15_000,
  );
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.reserve,
    15_000,
  );
  assert.equal(
    setup.view().readyToAssign,
    85_000,
    "Only $50 of the $150 credit was excess funded reserve",
  );
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")
      ?.creditsReleased,
    -5000,
  );
  assert.equal(setup.view().cash, 100_000);
});

void test("$500 lender-confirmed payment with $80 interest reduces principal by $420 and cash by $500", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "loan.add",
    loanId: "student",
    categoryId: "student-payment",
    name: "Student loan",
    principal: 1_000_000,
    annualRateBps: 600,
    minimumPayment: 50_000,
    variable: true,
    effectiveDate: "2026-10-01",
  });
  setup.run({
    type: "assign",
    categoryId: "student-payment",
    month,
    amount: 50_000,
  });
  const before = setup.view();
  setup.run({
    type: "loan.payment",
    loanId: "student",
    accountId: "checking",
    date,
    principal: 42_000,
    interest: 8000,
  });
  assert.equal(setup.view().cash, before.cash - 50_000);
  assert.equal(setup.view().loans[0]?.balance, 958_000);
  assert.equal(setup.view().loans[0]?.funded, 0);
  assert.equal(setup.view().readyToAssign, 50_000);
  assert.equal(setup.view().personalSpending, 8000);
  assert.equal(setup.view().loans[0]?.payments[0]?.interest, 8000);
});

void test("loan forecasts and extra payment previews preserve actual balances and retain variable-rate history", () => {
  const setup = fixture();
  setup.run({
    type: "loan.add",
    loanId: "student",
    categoryId: "student-payment",
    name: "Student loan",
    principal: 1_000_000,
    annualRateBps: 600,
    minimumPayment: 50_000,
    variable: true,
    effectiveDate: "2026-10-01",
  });
  const loan = setup.view().loans[0]!;
  const before = structuredClone(setup.book);
  const extra = forecastLoan(loan, month, 100_000);
  assert.ok(extra.months! < loan.forecast.months!);
  assert.deepEqual(setup.book, before);
  setup.run({
    type: "loan.rate",
    loanId: "student",
    annualRateBps: 900,
    effectiveDate: "2026-11-01",
  });
  assert.equal(setup.view().loans[0]?.forecast.rateBps, 600);
  assert.equal(setup.view("alan", "2026-11").loans[0]?.forecast.rateBps, 900);
  assert.equal(setup.view().loans[0]?.rates.length, 2);
});

void test("monthly contribution and refill targets differ only in carried funding and never assign cash", () => {
  const setup = fixture();
  setup.run({ type: "assign", categoryId: "food", month, amount: 5000 });
  setup.run({
    type: "target.set",
    categoryId: "food",
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: 10_000,
      startMonth: month,
    },
  });
  const before = setup.view("alan", "2026-11").readyToAssign;
  assert.equal(
    setup.view("alan", "2026-11").categories[0]?.targetProgress?.needed,
    10_000,
  );
  setup.run({
    type: "target.set",
    categoryId: "food",
    target: {
      cadence: "monthly",
      behavior: "refill",
      amount: 10_000,
      startMonth: month,
    },
  });
  assert.equal(
    setup.view("alan", "2026-11").categories[0]?.targetProgress?.needed,
    5000,
  );
  assert.equal(
    projectBook(setup.book, "alan", "2026-11", month).categories[0]
      ?.targetProgress?.needed,
    10_000,
    "A future refill month does not assume current leftovers survive",
  );
  assert.equal(setup.view("alan", "2026-11").readyToAssign, before);
});

void test("monthly targets may name a due day of the month without changing funding", () => {
  const setup = fixture();
  setup.run({
    type: "target.set",
    categoryId: "food",
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: 30_000,
      startMonth: month,
      monthDay: 15,
    },
  });
  assert.equal(setup.view().categories[0]?.targetProgress?.needed, 30_000);
  assert.throws(
    () =>
      setup.run({
        type: "target.set",
        categoryId: "food",
        target: {
          cadence: "yearly",
          behavior: "contribution",
          amount: 30_000,
          startMonth: month,
          dueDate: "2026-12-31",
          monthDay: 15,
        },
      }),
    /day of the month/,
  );
});

void test("available breaks down into left over, assigned, cash, credit, and partner settlement", () => {
  const setup = fixture();
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  setup.run({ type: "category.add", categoryId: "fun", name: "Fun" });
  setup.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "october-food",
    accountId: "checking",
    date,
    amount: -4000,
    payee: "Market",
    categoryId: "food",
  });
  const next = "2026-11";
  setup.run({ type: "assign", categoryId: "food", month: next, amount: 2000 });
  for (const [transactionId, accountId, amount, categoryId] of [
    ["november-cash", "checking", -3000, "food"],
    ["november-card", "card", -9000, "food"],
    ["fun-cash", "checking", -2500, "fun"],
  ] as const)
    setup.run({
      type: "transaction.upsert",
      transactionId,
      accountId,
      date: "2026-11-05",
      amount,
      payee: "Store",
      categoryId,
    });
  const categories = projectBook(setup.book, "alan", next).categories;
  const food = categories.find((category) => category.id === "food")!;
  assert.deepEqual(
    {
      opening: food.opening,
      assigned: food.assigned,
      cashActivity: food.cashActivity,
      creditActivity: food.creditActivity,
      settlementActivity: food.settlementActivity,
      available: food.available,
      cashOverspending: food.cashOverspending,
    },
    {
      opening: 6000,
      assigned: 2000,
      cashActivity: -3000,
      creditActivity: -9000,
      settlementActivity: 0,
      available: -4000,
      cashOverspending: 0,
    },
    "Card spending beyond the balance is credit overspending",
  );
  const fun = categories.find((category) => category.id === "fun")!;
  assert.equal(fun.available, -2500);
  assert.equal(fun.cashOverspending, 2500);
  assert.equal(fun.creditActivity, 0);
  for (const category of categories.filter((item) => !item.pairedAccountId))
    assert.equal(
      category.opening +
        category.assigned +
        category.cashActivity +
        category.creditActivity +
        category.settlementActivity,
      category.available,
    );
});

void test("cost to be me totals this month's target asks and keeps expected income per month", () => {
  const setup = fixture();
  setup.run({ type: "category.add", categoryId: "rent", name: "Rent" });
  setup.run({ type: "category.add", categoryId: "fun", name: "Fun" });
  setup.run({
    type: "target.set",
    categoryId: "rent",
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: 150_000,
      startMonth: month,
    },
  });
  setup.run({
    type: "target.set",
    categoryId: "food",
    target: {
      cadence: "monthly",
      behavior: "refill",
      amount: 40_000,
      startMonth: month,
    },
  });
  setup.run({ type: "assign", categoryId: "rent", month, amount: 100_000 });
  setup.run({ type: "assign", categoryId: "fun", month, amount: 5000 });
  assert.equal(
    setup.view().costToBeMe,
    190_000,
    "Assigned money still counts; untargeted categories do not",
  );
  assert.equal(setup.view().expectedIncome, null);
  setup.run({
    type: "income.expect",
    month,
    amount: 600_000,
  });
  assert.equal(setup.view().expectedIncome, 600_000);
  assert.equal(setup.view("alan", "2026-11").expectedIncome, null);
  assert.equal(setup.view().cash, 500_000, "Expected income is not cash");
  setup.run({ type: "income.expect", month, amount: null });
  assert.equal(setup.view().expectedIncome, null);
  assert.throws(
    () =>
      execute(
        setup.book,
        "alan",
        {
          id: "agent-income",
          type: "income.expect",
          month,
          amount: 1,
        },
        "agent",
      ),
    /user action/,
  );
  assert.throws(
    () => setup.run({ type: "income.expect", month: "2026-09", amount: 1 }),
    /budget start/,
  );
});

void test("card balance and payment reserve break down into the month's movements", () => {
  const setup = fixture();
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: -10_000,
  });
  setup.run({ type: "assign", categoryId: "food", month, amount: 20_000 });
  setup.run({ type: "assign", categoryId: "card:card", month, amount: 5000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "groceries",
    accountId: "card",
    date,
    amount: -12_000,
    payee: "Market",
    categoryId: "food",
  });
  setup.run({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "card",
    date: "2026-10-20",
    amount: 15_000,
  });
  const card = setup.view().accounts.find((account) => account.id === "card")!;
  assert.deepEqual(
    {
      priorBalance: card.priorBalance,
      outflows: card.outflows,
      inflows: card.inflows,
      balance: card.balance,
      fundedSpending: card.fundedSpending,
      paymentsMade: card.paymentsMade,
      creditsReleased: card.creditsReleased,
      reserve: card.reserve,
    },
    {
      priorBalance: -10_000,
      outflows: -12_000,
      inflows: 15_000,
      balance: -7000,
      fundedSpending: 12_000,
      paymentsMade: -15_000,
      creditsReleased: 0,
      reserve: 2000,
    },
  );
  const next = projectBook(setup.book, "alan", "2026-11", month);
  const carried = next.accounts.find((account) => account.id === "card")!;
  const category = next.categories.find((item) => item.id === "card:card")!;
  assert.equal(carried.priorBalance, -7000);
  assert.equal(category.opening, 2000);
  assert.equal(
    category.opening +
      category.assigned +
      carried.fundedSpending +
      carried.paymentsMade +
      carried.creditsReleased,
    category.available,
  );
});

void test("weekly totals count actual selected weekdays and snooze lasts only the current month", () => {
  const setup = fixture();
  setup.run({
    type: "target.set",
    categoryId: "food",
    target: {
      cadence: "weekly",
      behavior: "contribution",
      amount: 10_000,
      startMonth: month,
      weekday: 5,
    },
  });
  assert.equal(setup.view().categories[0]?.targetProgress?.total, 50_000);
  setup.run({
    type: "target.snooze",
    categoryId: "food",
    month,
    currentMonth: month,
    snoozed: true,
  });
  assert.equal(setup.view().categories[0]?.targetProgress?.needed, 0);
  assert.equal(
    setup.view("alan", "2026-11").categories[0]?.targetProgress?.needed,
    40_000,
  );
  assert.throws(
    () =>
      setup.run({
        type: "target.snooze",
        categoryId: "food",
        month: "2026-11",
        currentMonth: month,
        snoozed: true,
      }),
    /current month/,
  );
});

void test("yearly/custom goals distribute remaining contributions, count spending, repeat, and balance goals replace spending", () => {
  const setup = fixture();
  setup.run({
    type: "target.set",
    categoryId: "food",
    target: {
      cadence: "yearly",
      behavior: "contribution",
      amount: 120_000,
      startMonth: month,
      dueDate: "2026-12-31",
    },
  });
  assert.equal(setup.view().categories[0]?.targetProgress?.needed, 40_000);
  setup.run({ type: "assign", categoryId: "food", month, amount: 40_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "annual-part",
    accountId: "checking",
    date,
    amount: -40_000,
    payee: "Annual expense part",
    categoryId: "food",
  });
  assert.equal(
    setup.view("alan", "2026-11").categories[0]?.targetProgress?.needed,
    40_000,
  );
  assert.equal(
    setup.view("alan", "2027-01").categories[0]?.targetProgress?.needed,
    10_000,
  );
  setup.run({
    type: "target.set",
    categoryId: "food",
    target: {
      cadence: "custom",
      behavior: "balance",
      amount: 120_000,
      startMonth: month,
      dueDate: "2026-12-31",
    },
  });
  assert.equal(
    setup.view("alan", "2026-11").categories[0]?.targetProgress?.needed,
    60_000,
  );
  setup.run({
    type: "target.set",
    categoryId: "food",
    target: {
      cadence: "custom",
      behavior: "contribution",
      amount: 90_000,
      startMonth: month,
      dueDate: "2026-12-31",
      repeatEvery: 3,
      repeatUnit: "months",
    },
  });
  assert.equal(
    setup.view("alan", "2027-01").categories[0]?.targetProgress?.needed,
    30_000,
  );
});

void test("card targets are paired, cannot snooze, and existing debt can be funded directly", () => {
  const setup = fixture();
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: -60_000,
  });
  setup.run({
    type: "target.set",
    categoryId: "card:card",
    target: {
      cadence: "card-payoff",
      behavior: "contribution",
      amount: 0,
      startMonth: month,
      dueDate: "2026-12-31",
    },
  });
  assert.equal(
    setup.view().categories.find((category) => category.id === "card:card")
      ?.targetProgress?.needed,
    20_000,
  );
  setup.run({ type: "assign", categoryId: "card:card", month, amount: 20_000 });
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.reserve,
    20_000,
  );
  assert.throws(
    () =>
      setup.run({
        type: "target.snooze",
        categoryId: "card:card",
        month,
        currentMonth: month,
        snoozed: true,
      }),
    /cannot be snoozed/,
  );
});

void test("agent overspending coverage requires the user's exact enabled standing rule", () => {
  const setup = fixture();
  setup.run({ type: "category.add", categoryId: "dining", name: "Dining" });
  setup.run({ type: "assign", categoryId: "dining", month, amount: 5000 });
  assert.throws(
    () =>
      setup.run(
        {
          type: "cover",
          fromCategoryId: "dining",
          toCategoryId: "food",
          month,
          amount: 1000,
        },
        "alan",
        "agent",
      ),
    /explicit standing rule/,
  );
  setup.run({
    type: "rule.set",
    ruleId: "grocery-rule",
    fromCategoryId: "dining",
    toCategoryId: "food",
    enabled: true,
  });
  assert.throws(
    () =>
      setup.run(
        {
          type: "cover",
          fromCategoryId: "dining",
          toCategoryId: "food",
          month,
          amount: 1000,
          ruleId: "grocery-rule",
        },
        "alan",
        "agent",
      ),
    /existing overspending/,
  );
  setup.run({
    type: "transaction.upsert",
    transactionId: "overspent-food",
    accountId: "checking",
    date,
    amount: -1000,
    payee: "Groceries",
    categoryId: "food",
  });
  setup.run(
    {
      type: "cover",
      fromCategoryId: "dining",
      toCategoryId: "food",
      month,
      amount: 1000,
      ruleId: "grocery-rule",
    },
    "alan",
    "agent",
  );
  assert.equal(
    setup.view().categories.find((category) => category.id === "food")
      ?.available,
    0,
  );
  assert.equal(
    setup.view().categories.find((category) => category.id === "dining")
      ?.available,
    4000,
  );
});

void test("joining preserves an existing private budget, validates JSON, and refuses a third household member", () => {
  const target = createBook("alan", "Alan", month);
  const source = createBook("partner", "Partner", month);
  const merged = mergeBooks(target, source);
  assert.equal(Object.keys(merged.budgets).length, 2);
  assert.equal(Object.keys(target.budgets).length, 1);
  assert.equal(
    bookSchema.safeParse(JSON.parse(JSON.stringify(merged))).success,
    true,
  );
  assert.equal(
    bookSchema.safeParse({ version: 1, budgets: {} }).success,
    false,
  );
  assert.throws(
    () => addMember(merged, "third", "Third", month),
    /two members/,
  );
});

void test("cash assigned in a future month cannot be assigned a second time in the current month", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "assign",
    categoryId: "food",
    month: "2026-11",
    amount: 100_000,
  });
  assert.throws(
    () =>
      setup.run({ type: "assign", categoryId: "food", month, amount: 100_000 }),
    /already assigned in a future month/,
  );
  assert.equal(setup.view("alan", "2026-11").readyToAssign, 0);
});

void test("a pending inbound deposit is not received cash and cannot fund a category", () => {
  const setup = fixture(0);
  setup.run({
    type: "transaction.upsert",
    transactionId: "deposit",
    accountId: "checking",
    date,
    amount: 10_000,
    payee: "Pending deposit",
    status: "pending",
  });
  assert.equal(setup.view().readyToAssign, 0);
  assert.equal(setup.view().earnings, 0);
  assert.throws(
    () => setup.run({ type: "assign", categoryId: "food", month, amount: 1 }),
    /existing Ready/,
  );
  setup.run({
    type: "transaction.upsert",
    transactionId: "deposit",
    accountId: "checking",
    date,
    amount: 10_000,
    payee: "Posted deposit",
    status: "posted",
  });
  assert.equal(setup.view().readyToAssign, 10_000);
});

void test("cash spending after a funded card payment becomes cash overspending without a negative reserve", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  setup.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "card-first",
    accountId: "card",
    date: "2026-10-01",
    amount: -10_000,
    payee: "Card food",
    categoryId: "food",
  });
  setup.run({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "card",
    date: "2026-10-02",
    amount: 10_000,
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "cash-after",
    accountId: "checking",
    date: "2026-10-03",
    amount: -10_000,
    payee: "Cash food",
    categoryId: "food",
  });
  const card = setup.view().accounts.find((account) => account.id === "card")!;
  assert.equal(card.balance, 0);
  assert.equal(card.reserve, 0);
  assert.equal(card.shortfall, 0);
  assert.equal(setup.view().readyToAssign, 90_000);
  assert.equal(setup.view("alan", "2026-11").readyToAssign, 80_000);
});

void test("a later charge on another card cannot take cash already consumed by a recorded card payment", () => {
  const setup = fixture(100_000);
  for (const accountId of ["a-card", "b-card"])
    setup.run({
      type: "account.add",
      accountId,
      name: accountId,
      kind: "credit",
      openingBalance: 0,
    });
  setup.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "b-first",
    accountId: "b-card",
    date: "2026-10-01",
    amount: -10_000,
    payee: "First card food",
    categoryId: "food",
  });
  setup.run({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "b-card",
    date: "2026-10-02",
    amount: 10_000,
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "a-after",
    accountId: "a-card",
    date: "2026-10-03",
    amount: -10_000,
    payee: "Later card food",
    categoryId: "food",
  });
  assert.equal(
    setup.view().accounts.find((account) => account.id === "b-card")?.reserve,
    0,
  );
  assert.equal(
    setup.view().accounts.find((account) => account.id === "a-card")?.reserve,
    0,
  );
  assert.equal(
    setup.view().accounts.find((account) => account.id === "a-card")?.shortfall,
    10_000,
  );
  assert.equal(setup.view().readyToAssign, 90_000);
});

void test("card refunds can restore only existing reserve and cannot create envelope cash from debt", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  setup.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "purchase",
    accountId: "card",
    date,
    amount: -10_000,
    payee: "Store",
    categoryId: "food",
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "refund",
    accountId: "card",
    date: "2026-11-01",
    amount: 5000,
    payee: "Store refund",
    categoryId: "food",
  });
  const november = setup.view("alan", "2026-11");
  assert.equal(
    november.categories.find((category) => category.id === "food")?.available,
    5000,
  );
  assert.equal(
    november.accounts.find((account) => account.id === "card")?.reserve,
    5000,
  );
  assert.equal(november.readyToAssign, 90_000);
  assert.throws(
    () =>
      setup.run({
        type: "transaction.upsert",
        transactionId: "unbacked",
        accountId: "card",
        date: "2026-11-02",
        amount: 10_000,
        payee: "Unmatched refund",
        categoryId: "food",
      }),
    /Positive card balances/,
  );
  const unfunded = fixture(0);
  unfunded.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: -10_000,
  });
  unfunded.run({
    type: "transaction.upsert",
    transactionId: "refund",
    accountId: "card",
    date,
    amount: 5000,
    payee: "Unfunded refund",
    categoryId: "food",
  });
  assert.equal(unfunded.view().categories[0]?.available, 0);
  assert.equal(unfunded.view().readyToAssign, 0);
});

void test("a balance goal asks to replace funds spent during its due month", () => {
  const setup = fixture();
  setup.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  setup.run({
    type: "target.set",
    categoryId: "food",
    target: {
      cadence: "custom",
      behavior: "balance",
      amount: 10_000,
      startMonth: month,
      dueDate: "2026-11-30",
    },
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "spend-due-month",
    accountId: "checking",
    date: "2026-11-01",
    amount: -10_000,
    payee: "Spend saved money",
    categoryId: "food",
  });
  assert.equal(
    setup.view("alan", "2026-11").categories[0]?.targetProgress?.needed,
    10_000,
  );
});

void test("an unfunded net offset never releases invented cash", () => {
  const setup = household();
  setup.run({
    type: "opening.add",
    obligationId: "owed-rent",
    sharedCategoryId: "shared-rent",
    debtorId: "alan",
    creditorId: "partner",
    amount: 100_000,
  });
  setup.run({
    type: "opening.add",
    obligationId: "owed-utilities",
    sharedCategoryId: "shared-utilities",
    debtorId: "partner",
    creditorId: "alan",
    amount: 10_000,
  });
  const before = setup.view().readyToAssign;
  setup.run({
    type: "settlement.record",
    settlementId: "unfunded",
    otherUserId: "partner",
    date,
    accountId: "checking",
    amount: 90_000,
  });
  assert.equal(
    setup.view().readyToAssign,
    before,
    "Unfunded offset has no envelope cash to release",
  );
  assert.equal(setup.view("alan", "2026-11").readyToAssign, before - 90_000);
});

void test("card refund cash moves between categories independently of category insertion order", () => {
  for (const reverse of [false, true]) {
    const setup = fixture(100_000);
    if (reverse) setup.book.budgets.alan!.categories = [];
    setup.run({ type: "category.add", categoryId: "fun", name: "Fun" });
    if (reverse)
      setup.run({ type: "category.add", categoryId: "food", name: "Food" });
    setup.run({
      type: "account.add",
      accountId: "card",
      name: "Card",
      kind: "credit",
      openingBalance: 0,
    });
    setup.run({ type: "assign", categoryId: "fun", month, amount: 10_000 });
    setup.run({
      type: "transaction.upsert",
      transactionId: "fun-purchase",
      accountId: "card",
      date: "2026-10-01",
      amount: -10_000,
      payee: "Store",
      categoryId: "fun",
    });
    setup.run({
      type: "transaction.upsert",
      transactionId: "refund-to-food",
      accountId: "card",
      date: "2026-10-02",
      amount: 5000,
      payee: "Refund",
      categoryId: "food",
    });
    assert.equal(
      setup.view().categories.find((category) => category.id === "food")
        ?.available,
      5000,
    );
    assert.equal(
      setup.view().accounts.find((account) => account.id === "card")?.reserve,
      5000,
    );
    assert.equal(setup.view().readyToAssign, 90_000);
  }
});

void test("refund-backed cash can fund a purchase on a different card without duplication", () => {
  const setup = fixture(100_000);
  for (const accountId of ["a-card", "b-card"])
    setup.run({
      type: "account.add",
      accountId,
      name: accountId,
      kind: "credit",
      openingBalance: 0,
    });
  setup.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "original",
    accountId: "a-card",
    date,
    amount: -10_000,
    payee: "Original",
    categoryId: "food",
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "refund",
    accountId: "a-card",
    date: "2026-11-01",
    amount: 10_000,
    payee: "Refund",
    categoryId: "food",
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "replacement",
    accountId: "b-card",
    date: "2026-11-02",
    amount: -10_000,
    payee: "Replacement",
    categoryId: "food",
  });
  const view = setup.view("alan", "2026-11");
  assert.equal(
    view.accounts.find((account) => account.id === "a-card")?.reserve,
    0,
  );
  assert.equal(
    view.accounts.find((account) => account.id === "b-card")?.reserve,
    10_000,
  );
  assert.equal(
    view.categories.find((category) => category.id === "food")?.available,
    0,
  );
  assert.equal(view.readyToAssign, 90_000);
});

void test("funding a payoff target meets this month without changing the month's original requirement", () => {
  const setup = fixture();
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: -120_000,
  });
  setup.run({
    type: "target.set",
    categoryId: "card:card",
    target: {
      cadence: "card-payoff",
      behavior: "contribution",
      amount: 0,
      startMonth: month,
      dueDate: "2027-09-30",
    },
  });
  assert.equal(
    setup.view().categories.find((category) => category.id === "card:card")
      ?.targetProgress?.needed,
    10_000,
  );
  setup.run({ type: "assign", categoryId: "card:card", month, amount: 10_000 });
  assert.equal(
    setup.view().categories.find((category) => category.id === "card:card")
      ?.targetProgress?.needed,
    0,
  );
  setup.run({ type: "assign", categoryId: "food", month, amount: 5000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "funded-new-charge",
    accountId: "card",
    date,
    amount: -5000,
    payee: "New charge",
    categoryId: "food",
  });
  assert.equal(
    setup.view().categories.find((category) => category.id === "card:card")
      ?.targetProgress?.needed,
    0,
  );
});

void test("paired loan payoff targets calculate a monthly payment and the forecast follows the chosen plan", () => {
  const setup = fixture();
  setup.run({
    type: "loan.add",
    loanId: "loan",
    categoryId: "loan-payment",
    name: "Loan",
    principal: 120_000,
    annualRateBps: 0,
    minimumPayment: 5000,
    variable: false,
    effectiveDate: "2026-10-01",
  });
  setup.run({
    type: "target.set",
    categoryId: "loan-payment",
    target: {
      cadence: "loan",
      behavior: "contribution",
      amount: 0,
      startMonth: month,
      dueDate: "2027-09-30",
    },
  });
  assert.equal(
    setup.view().categories.find((category) => category.id === "loan-payment")
      ?.targetProgress?.needed,
    10_000,
  );
  assert.equal(setup.view().loans[0]?.forecast.payment, 10_000);
  setup.run({
    type: "assign",
    categoryId: "loan-payment",
    month,
    amount: 10_000,
  });
  assert.equal(
    setup.view().categories.find((category) => category.id === "loan-payment")
      ?.targetProgress?.needed,
    0,
  );
});

void test("cash, reserves, and reported expenses conserve cents across varied funded purchase and payment sequences", () => {
  for (let seed = 1; seed <= 12; seed++) {
    const setup = fixture(500_000);
    let randomState = seed;
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState;
    };
    for (const accountId of ["a-card", "b-card"])
      setup.run({
        type: "account.add",
        accountId,
        name: accountId,
        kind: "credit",
        openingBalance: 0,
      });
    setup.run({ type: "category.add", categoryId: "travel", name: "Travel" });
    setup.run({ type: "assign", categoryId: "food", month, amount: 100_000 });
    setup.run({ type: "assign", categoryId: "travel", month, amount: 100_000 });
    let paid = 0;
    for (let step = 0; step < 35; step++) {
      const categoryId = random() % 2 ? "food" : "travel";
      const accountId = ["checking", "a-card", "b-card"][random() % 3]!;
      const amount = Math.min(
        100 + (random() % 2000),
        Math.max(
          0,
          setup
            .view()
            .categories.find((category) => category.id === categoryId)!
            .available,
        ),
      );
      if (amount) {
        setup.run({
          type: "transaction.upsert",
          transactionId: `seed-${seed}-${step}`,
          accountId,
          date,
          amount: -amount,
          payee: "Purchase",
          categoryId,
        });
        paid += amount;
      }
      if (random() % 3 === 0) {
        const card = setup
          .view()
          .accounts.find((account) => account.id === "b-card")!;
        if (card.reserve > 0)
          setup.run({
            type: "card.payment",
            cashAccountId: "checking",
            cardAccountId: "b-card",
            date,
            amount: card.reserve,
          });
      }
      const view = setup.view();
      assert.equal(view.readyToAssign, 300_000);
      assert.equal(view.personalSpending, paid);
      assert.equal(view.amountPaid, paid);
      assert.equal(
        view.cash,
        view.readyToAssign +
          view.categories.reduce(
            (total, category) => total + category.available,
            0,
          ),
      );
      for (const account of view.accounts.filter(
        (item) => item.kind === "credit",
      )) {
        assert.ok(account.reserve >= 0);
        assert.equal(account.reserve, Math.max(0, -account.balance));
        assert.equal(account.shortfall, 0);
      }
    }
  }
});

void test("account activity cannot predate its confirmed opening balance", () => {
  const setup = fixture();
  setup.run({
    type: "account.add",
    accountId: "later",
    name: "Later bank",
    kind: "cash",
    openingBalance: 1000,
    date: "2026-10-17",
  });
  assert.throws(
    () =>
      setup.run({
        type: "transaction.upsert",
        transactionId: "earlier",
        accountId: "later",
        date: "2026-10-01",
        amount: -100,
        payee: "Earlier",
        categoryId: "food",
      }),
    /confirmed opening/,
  );
  setup.run({
    type: "account.add",
    accountId: "later-card",
    name: "Later card",
    kind: "credit",
    openingBalance: -1000,
    date: "2026-10-17",
  });
  setup.run({
    type: "assign",
    categoryId: "card:later-card",
    month,
    amount: 1000,
  });
  assert.throws(
    () =>
      setup.run({
        type: "card.payment",
        cashAccountId: "checking",
        cardAccountId: "later-card",
        date: "2026-10-16",
        amount: 1000,
      }),
    /confirmed opening/,
  );
});

void test("derived identifiers remain valid persisted data at maximum public ID length", () => {
  const setup = fixture();
  const accountId = "a".repeat(160);
  setup.run({
    type: "account.add",
    accountId,
    name: "Long ID card",
    kind: "credit",
    openingBalance: -1000,
  });
  assert.equal(bookSchema.safeParse(setup.book).success, true);
});

void test("an agent cannot approve its own category suggestion and cannot recategorize dedicated payments", () => {
  const setup = fixture();
  setup.run(
    {
      type: "transaction.upsert",
      transactionId: "suggestion",
      accountId: "checking",
      date,
      amount: -100,
      payee: "Store",
      categoryId: "food",
    },
    "alan",
    "agent",
  );
  assert.equal(setup.view().budget.transactions[0]?.reviewed, false);
  assert.throws(
    () =>
      setup.run(
        { type: "transaction.approve", transactionIds: ["suggestion"] },
        "alan",
        "agent",
      ),
    /user action/,
  );
  setup.run({ type: "transaction.approve", transactionIds: ["suggestion"] });
  assert.equal(setup.view().budget.transactions[0]?.reviewed, true);
  setup.run({
    type: "loan.add",
    loanId: "loan",
    categoryId: "loan-payment",
    name: "Loan",
    principal: 1000,
    annualRateBps: 0,
    minimumPayment: 100,
    variable: false,
    effectiveDate: "2026-10-01",
  });
  setup.run({
    type: "loan.payment",
    loanId: "loan",
    accountId: "checking",
    date,
    principal: 100,
    interest: 0,
  });
  const paymentId = setup
    .view()
    .budget.transactions.find(
      (transaction) => transaction.kind === "loan-payment",
    )!.id;
  assert.throws(
    () =>
      setup.run({
        type: "transaction.categorize",
        transactionId: paymentId,
        categoryId: "food",
      }),
    /dedicated operation/,
  );
  assert.throws(
    () =>
      execute(setup.book, "toString", {
        id: "access",
        type: "category.add",
        categoryId: "bad",
        name: "Bad",
      }),
    /access denied/,
  );
});

void test("a partial net repayment settles only recorded cash and mutual offsets while the remainder persists", () => {
  const setup = household();
  setup.run({
    type: "opening.add",
    obligationId: "rent-before",
    sharedCategoryId: "shared-rent",
    debtorId: "alan",
    creditorId: "partner",
    amount: 100_000,
  });
  setup.run({
    type: "opening.add",
    obligationId: "utility-before",
    sharedCategoryId: "shared-utilities",
    debtorId: "partner",
    creditorId: "alan",
    amount: 10_000,
  });
  setup.run({ type: "assign", categoryId: "rent", month, amount: 100_000 });
  const before = setup.view();
  setup.run({
    type: "settlement.record",
    settlementId: "partial",
    otherUserId: "partner",
    date,
    accountId: "checking",
    amount: 40_000,
  });
  assert.equal(setup.view().settlement.net, 50_000);
  assert.equal(setup.view("alan", "2026-11").settlement.net, 50_000);
  assert.equal(setup.view().cash, before.cash - 40_000);
  assert.equal(setup.view().readyToAssign, before.readyToAssign + 10_000);
  assert.equal(
    setup.view().categories.find((category) => category.id === "rent")
      ?.reserved,
    50_000,
  );
  assert.throws(
    () =>
      setup.run({
        type: "settlement.record",
        settlementId: "overpay",
        otherUserId: "partner",
        date,
        accountId: "checking",
        amount: 50_001,
      }),
    /exceeds/,
  );
});

void test("a refund cannot release reserve already consumed by a recorded card payment", () => {
  const setup = fixture(100_000);
  setup.run({ type: "category.add", categoryId: "fun", name: "Fun" });
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  setup.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "original",
    accountId: "card",
    date,
    amount: -10_000,
    payee: "Original",
    categoryId: "food",
  });
  setup.run({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "card",
    date: "2026-11-01",
    amount: 10_000,
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "new",
    accountId: "card",
    date: "2026-11-03",
    amount: -5000,
    payee: "New charge",
    categoryId: "fun",
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "credit",
    accountId: "card",
    date: "2026-11-02",
    amount: 5000,
    payee: "Unfunded credit",
    categoryId: "food",
  });
  assert.equal(setup.view("alan", "2026-11").readyToAssign, 90_000);
  assert.equal(setup.view("alan", "2026-12").readyToAssign, 90_000);
  assert.equal(
    setup
      .view("alan", "2026-11")
      .categories.find((category) => category.id === "food")?.available,
    0,
  );
});

void test("backdated card payments and credits cannot use purchases recorded later in the month", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  setup.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "later-purchase",
    accountId: "card",
    date: "2026-10-20",
    amount: -10_000,
    payee: "Market",
    categoryId: "food",
  });
  const before = structuredClone(setup.book);
  assert.throws(
    () =>
      setup.run({
        type: "card.payment",
        cashAccountId: "checking",
        cardAccountId: "card",
        date: "2026-10-05",
        amount: 10_000,
      }),
    /reserve or card debt/,
  );
  assert.throws(
    () =>
      setup.run({
        type: "card.credit",
        accountId: "card",
        date: "2026-10-05",
        amount: 10_000,
      }),
    /exceeds card debt/,
  );
  assert.deepEqual(setup.book, before);
  setup.run({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "card",
    date: "2026-10-21",
    amount: 10_000,
  });
  assert.equal(setup.view().cash, 90_000);
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.balance,
    0,
  );
});

void test("a backdated card payment cannot spend a later deposit used to fund its monthly reserve", () => {
  const setup = fixture(0);
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: -10_000,
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "later-deposit",
    accountId: "checking",
    date: "2026-10-20",
    amount: 10_000,
    payee: "Received cash",
  });
  setup.run({ type: "assign", categoryId: "card:card", month, amount: 10_000 });
  assert.throws(
    () =>
      setup.run({
        type: "card.payment",
        cashAccountId: "checking",
        cardAccountId: "card",
        date: "2026-10-05",
        amount: 10_000,
      }),
    /cash already received/,
  );
  setup.run({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "card",
    date: "2026-10-20",
    amount: 10_000,
  });
  assert.equal(setup.view().cash, 0);
  assert.equal(setup.view().readyToAssign, 0);
});

void test("reimbursement receipts and linked statement credits cannot predate their expense", () => {
  for (const kind of ["cash", "statement-credit"] as const) {
    const setup = fixture(100_000);
    const accountId = kind === "cash" ? "checking" : "card";
    if (kind === "statement-credit")
      setup.run({
        type: "account.add",
        accountId,
        name: "Card",
        kind: "credit",
        openingBalance: -10_000,
      });
    setup.run({
      type: "transaction.upsert",
      transactionId: "expense",
      accountId,
      date: "2026-10-20",
      amount: -10_000,
      payee: "Travel",
      categoryId: "food",
    });
    setup.run({
      type: "reimbursement.expect",
      reimbursementId: "claim",
      transactionId: "expense",
      name: "Travel reimbursement",
      amount: 10_000,
      kind,
    });
    const receipt =
      kind === "cash"
        ? {
            type: "reimbursement.receive" as const,
            reimbursementId: "claim",
            accountId,
            amount: 10_000,
          }
        : {
            type: "card.credit" as const,
            reimbursementId: "claim",
            accountId,
            amount: 10_000,
          };
    assert.throws(
      () => setup.run({ ...receipt, date: "2026-10-05" }),
      /predates the reimbursed expense/,
    );
    setup.run({ ...receipt, date: "2026-10-21" });
    assert.throws(
      () =>
        setup.run({
          type: "transaction.upsert",
          transactionId: "expense",
          accountId,
          date: "2026-10-22",
          amount: -10_000,
          payee: "Travel",
          categoryId: "food",
        }),
      /after its recorded reimbursement/,
    );
    assert.equal(setup.view().reimbursements[0]?.outstanding, 0);
  }
});

void test("a settlement receipt cannot create cash before the partner's recorded payment", () => {
  const setup = household();
  setup.run({
    type: "opening.add",
    sharedCategoryId: "shared-rent",
    obligationId: "opening",
    debtorId: "alan",
    creditorId: "partner",
    amount: 10_000,
  });
  setup.run({
    type: "settlement.record",
    settlementId: "payment",
    otherUserId: "partner",
    accountId: "checking",
    date: "2026-10-20",
    amount: 10_000,
  });
  assert.throws(
    () =>
      setup.run(
        {
          type: "settlement.receive",
          settlementId: "payment",
          accountId: "partner-cash",
          date: "2026-10-05",
        },
        "partner",
      ),
    /predates the recorded settlement/,
  );
  setup.run(
    {
      type: "settlement.receive",
      settlementId: "payment",
      accountId: "partner-cash",
      date: "2026-10-21",
    },
    "partner",
  );
  assert.equal(setup.view("partner").cash, 510_000);
  assert.equal(setup.view("partner").earnings, 0);
});

void test("backdating a credit or payment preserves later recorded card payments", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: -10_000,
  });
  setup.run({ type: "assign", categoryId: "card:card", month, amount: 10_000 });
  setup.run({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "card",
    date: "2026-10-20",
    amount: 10_000,
  });
  assert.throws(
    () =>
      setup.run({
        type: "card.credit",
        accountId: "card",
        date: "2026-10-05",
        amount: 10_000,
      }),
    /exceeds card debt/,
  );
  assert.throws(
    () =>
      setup.run({
        type: "card.payment",
        cashAccountId: "checking",
        cardAccountId: "card",
        date: "2026-10-05",
        amount: 10_000,
      }),
    /reserve or card debt/,
  );
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.balance,
    0,
  );
  assert.equal(setup.view().cash, 90_000);
});

void test("correcting a shared expense cannot move it after an existing settlement", () => {
  const setup = household();
  setup.run(
    {
      type: "transaction.upsert",
      transactionId: "shared-expense",
      accountId: "partner-cash",
      categoryId: "partner-rent",
      sharedCategoryId: "shared-rent",
      date: "2026-10-10",
      amount: -10_000,
      payee: "Rent",
    },
    "partner",
  );
  setup.run({
    type: "settlement.record",
    settlementId: "paid",
    otherUserId: "partner",
    accountId: "checking",
    date: "2026-10-20",
    amount: 5000,
  });
  assert.throws(
    () =>
      setup.run(
        {
          type: "transaction.upsert",
          transactionId: "shared-expense",
          accountId: "partner-cash",
          categoryId: "partner-rent",
          sharedCategoryId: "shared-rent",
          date: "2026-10-21",
          amount: -10_000,
          payee: "Rent",
        },
        "partner",
      ),
    /after its recorded settlement/,
  );
  assert.equal(setup.view().settlement.net, 0);
});

void test("earlier card corrections cannot invalidate a confirmed payment in a later month", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  setup.run({ type: "assign", categoryId: "food", month, amount: 10_000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "expense",
    accountId: "card",
    categoryId: "food",
    date: "2026-10-10",
    amount: -10_000,
    payee: "Market",
  });
  setup.run({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "card",
    date: "2026-11-05",
    amount: 10_000,
  });
  const before = structuredClone(setup.book);
  const corrections: WithoutId<Command>[] = [
    {
      type: "card.credit",
      accountId: "card",
      date: "2026-10-15",
      amount: 10_000,
    },
    {
      type: "card.payment",
      cashAccountId: "checking",
      cardAccountId: "card",
      date: "2026-10-15",
      amount: 10_000,
    },
    { type: "transaction.remove", transactionId: "expense" },
    {
      type: "transaction.upsert",
      transactionId: "expense",
      accountId: "card",
      categoryId: "food",
      date: "2026-10-10",
      amount: -9000,
      payee: "Corrected market charge",
    },
  ];
  for (const correction of corrections) {
    assert.throws(
      () => setup.run(correction),
      /investigate recorded credits and payments/,
    );
    assert.deepEqual(setup.book, before);
  }
  const nextMonth = setup.view("alan", "2026-11");
  assert.equal(
    nextMonth.accounts.find((account) => account.id === "card")?.balance,
    0,
  );
  assert.equal(nextMonth.cash, 90_000);
  assert.equal(nextMonth.readyToAssign, 90_000);
});
