import assert from "node:assert/strict";
import test from "node:test";
import {
  addMember,
  bookSchema,
  closePartnerLedger,
  commandSchema,
  createBook,
  execute,
  forecastLoan,
  mergeBooks,
  projectBook,
  withCounterpartyAccounts,
  type Book,
  type Command,
  type CommandSource,
} from "../../src/domain/engine";

const month = "2026-10";
const date = "2026-10-10";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;
function fixture(cash = 500_000, startMonth = month) {
  let book = createBook("alan", "Alan", startMonth);
  let sequence = 0;
  const run = (
    command: WithoutId<Command>,
    actor = "alan",
    source: CommandSource = "user",
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

void test("assignments cannot exceed received cash", () => {
  const setup = fixture(100_000);
  const next = execute(setup.book, "alan", {
    id: "assign-first",
    type: "assign",
    categoryId: "food",
    month,
    amount: 60_000,
  });
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
});

void test("assigning cash leaves the input budget unchanged", () => {
  const setup = fixture(100_000);
  const before = structuredClone(setup.book);
  const next = execute(setup.book, "alan", {
    id: "assign",
    type: "assign",
    categoryId: "food",
    month,
    amount: 60_000,
  });
  assert.equal(projectBook(next, "alan", month).readyToAssign, 40_000);
  assert.deepEqual(setup.book, before);
});

void test("an agent cannot assign the user's cash", () => {
  const setup = fixture(100_000);
  assert.throws(
    () =>
      execute(
        setup.book,
        "alan",
        { id: "ai", type: "assign", categoryId: "food", month, amount: 1 },
        "agent",
      ),
    /user action/,
  );
});

void test("an outsider cannot add a category to another person's budget", () => {
  const setup = fixture();
  assert.throws(
    () =>
      execute(setup.book, "intruder", {
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

void test("a retry is recognized by the command as submitted, not the form the server prepared from it", () => {
  const setup = fixture();
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
  const submitted: Command = {
    id: "snooze",
    type: "target.snooze",
    categoryId: "food",
    month,
    currentMonth: month,
    snoozed: true,
  };
  const first = execute(setup.book, "alan", submitted, "user", submitted);
  // Retried after midnight, the server prepares it with the new current month.
  const retried = { ...submitted, currentMonth: "2026-11" };
  assert.deepEqual(execute(first, "alan", retried, "user", submitted), first);
  assert.throws(
    () =>
      execute(first, "alan", retried, "user", { ...submitted, snoozed: false }),
    /different data/,
  );
});

void test("retries match regardless of key order and still recognize fingerprints saved before submitted-input fingerprints", () => {
  const setup = fixture();
  const command: Command = {
    id: "legacy",
    type: "transaction.upsert",
    transactionId: "groceries",
    accountId: "checking",
    date,
    amount: -1200,
    payee: "Market",
    categoryId: "food",
  };
  const first = execute(setup.book, "alan", command);
  const reordered = Object.fromEntries(
    Object.entries(command).reverse(),
  ) as Command;
  assert.deepEqual(execute(first, "alan", reordered), first);
  // Books saved by earlier releases hold the validated command's JSON.
  const legacy: Book = structuredClone(first);
  legacy.audit.at(-1)!.fingerprint = JSON.stringify(
    commandSchema.parse(command),
  );
  assert.deepEqual(execute(legacy, "alan", command), legacy);
  assert.throws(
    () => execute(legacy, "alan", { ...command, amount: -1300 }),
    /different data/,
  );
});

void test("bank-provider commands are audited as provider changes and limited like other automated changes", () => {
  const setup = fixture();
  const book = execute(
    setup.book,
    "alan",
    {
      id: "bank-update",
      type: "transaction.upsert",
      transactionId: "bank-coffee",
      accountId: "checking",
      date,
      amount: -450,
      payee: "Coffee shop",
      status: "pending",
    },
    "provider",
  );
  assert.equal(book.audit.at(-1)!.source, "provider");
  assert.deepEqual(bookSchema.parse(structuredClone(book)), book);
  assert.equal(
    book.budgets.alan!.transactions.find((item) => item.id === "bank-coffee")!
      .reviewed,
    false,
  );
  assert.throws(
    () =>
      execute(
        book,
        "alan",
        {
          id: "bank-assign",
          type: "assign",
          categoryId: "food",
          month,
          amount: 100,
        },
        "provider",
      ),
    /requires a user action/,
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
    type: "transaction.upsert",
    transactionId: `register-payment-1:2026-10-11`,
    date: "2026-10-11",
    accountId: "checking",
    transferAccountId: "amex",
    amount: -12_000,
    payee: "Credit card payment",
    status: "posted",
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
  const readyToAssign = setup.view().readyToAssign;
  const nextReadyToAssign = setup.view("alan", "2026-11").readyToAssign;
  setup.run({
    type: "transaction.upsert",
    transactionId: `register-payment-2:${date}`,
    date,
    accountId: "checking",
    transferAccountId: "card",
    amount: -8000,
    payee: "Credit card payment",
    status: "posted",
  });
  const view = setup.view();
  const card = view.accounts.find((account) => account.id === "card");
  const payment = view.categories.find(
    (category) => category.pairedAccountId === "card",
  );
  assert.equal(card?.balance, 0);
  assert.equal(payment?.available, -3000);
  assert.equal(payment?.cashOverspending, 3000);
  assert.equal(card?.shortfall, 0);
  assert.equal(view.readyToAssign, readyToAssign);
  const next = setup.view("alan", "2026-11");
  assert.equal(next.readyToAssign, nextReadyToAssign - 3000);
  assert.equal(
    next.categories.find((category) => category.pairedAccountId === "card")
      ?.available,
    0,
  );
});

void test("an overpayment creates assignable card credit and a payment category shortfall", () => {
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
    amount: -5000,
    payee: "Food",
    categoryId: "food",
  });
  const payment = {
    type: "transaction.upsert",
    transactionId: `register-payment-3:${date}`,
    date,
    accountId: "checking",
    transferAccountId: "card",
    payee: "Credit card payment",
    status: "posted",
  } as const;
  setup.run({ ...payment, amount: -6000 });
  const view = setup.view();
  assert.equal(
    view.accounts.find((account) => account.id === "card")?.balance,
    1000,
  );
  assert.equal(
    view.accounts.find((account) => account.id === "card")?.reserve,
    -1000,
  );
  assert.equal(
    view.categories.find((category) => category.id === "card:card")
      ?.cashOverspending,
    1000,
  );
  assert.equal(view.readyToAssign, 96_000);
  assert.equal(setup.view("alan", "2026-11").readyToAssign, 95_000);
  setup.run({ type: "assign", categoryId: "card:card", month, amount: 1000 });
  assert.equal(setup.view().readyToAssign, 95_000);
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.reserve,
    0,
  );
});

void test("paying a card beyond its reserve leaves credit-overspent categories credit-overspent", () => {
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
  setup.run({
    type: "transaction.upsert",
    transactionId: `register-payment-4:${date}`,
    date,
    accountId: "checking",
    transferAccountId: "card",
    amount: -8000,
    payee: "Credit card payment",
    status: "posted",
  });
  const view = setup.view();
  const food = view.categories.find((category) => category.id === "food");
  assert.equal(food?.available, -3000);
  assert.equal(food?.cashOverspending, 0);
  assert.equal(
    view.categories.find((category) => category.pairedAccountId === "card")
      ?.cashOverspending,
    3000,
  );
});

void test("paying a card beyond its reserve makes a paired envelope's card share cash-backed", () => {
  const setup = fixture(100_000);
  setup.book = withCounterpartyAccounts(setup.book);
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "noodles",
    accountId: "card",
    date,
    amount: -2000,
    payee: "Noodles Plus",
    counterpartyShare: {
      accountId: "counterparty:reimbursements",
      counterpartyName: "Mom",
      amount: 2000,
    },
    recordedAt: "2026-10-10T12:00:00Z",
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: `register-payment-5:${date}`,
    date,
    accountId: "checking",
    transferAccountId: "card",
    amount: -2000,
    payee: "Credit card payment",
    status: "posted",
  });
  const view = setup.view();
  assert.equal(
    view.categories.find(
      (category) =>
        category.counterpartyAccountId === "counterparty:reimbursements",
    )?.cashOverspending,
    2000,
  );
  assert.equal(
    view.categories.find((category) => category.pairedAccountId === "card")
      ?.cashOverspending,
    0,
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
  assert.equal(
    setup.view().budget.transactions.filter((t) => t.id === "restaurant")
      .length,
    1,
  );
  assert.equal(
    setup.view().budget.transactions.find((t) => t.id === "restaurant")
      ?.categoryId,
    "food",
  );
  assert.deepEqual(
    setup
      .view()
      .budget.transactions.find((t) => t.id === "restaurant")
      ?.history.map((item) => item.amount),
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
    setup
      .view()
      .budget.transactions.find((t) => t.id === "first")
      ?.history.at(-1)?.reason,
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
  return setup;
}

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

void test("expected card benefits do nothing; posted credits leave surplus reserve for the user to move", () => {
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
    type: "transaction.upsert",
    transactionId: `register-payment-6:${date}`,
    date,
    accountId: "card",
    amount: 15_000,
    payee: "Posted statement credit",
    status: false ? "posted" : "pending",
  });
  assert.equal(setup.view().readyToAssign, 80_000);
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.balance,
    -30_000,
  );
  setup.run({
    type: "transaction.upsert",
    transactionId: `register-payment-7:${date}`,
    date,
    accountId: "card",
    amount: 15_000,
    payee: "Posted statement credit",
    status: true ? "posted" : "pending",
  });
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.balance,
    -15_000,
  );
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.reserve,
    20_000,
  );
  assert.equal(
    setup.view().readyToAssign,
    80_000,
    "A statement credit does not reassign the payment reserve",
  );
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")
      ?.creditsReleased,
    0,
  );
  assert.equal(setup.view().cash, 100_000);
  setup.run({ type: "assign", categoryId: "card:card", month, amount: -5000 });
  assert.equal(setup.view().readyToAssign, 85_000);
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.reserve,
    15_000,
  );
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
    type: "transaction.upsert",
    transactionId: `register-payment-8:${date}:student`,
    loanId: "student",
    date,
    interest: 8000,
    accountId: "checking",
    amount: -(42_000 + 8000),
    payee: "Loan payment",
    status: "posted",
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

void test("available breaks down into left over, assigned, cash, and credit", () => {
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
      available: food.available,
      cashOverspending: food.cashOverspending,
    },
    {
      opening: 6000,
      assigned: 2000,
      cashActivity: -3000,
      creditActivity: -9000,
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
        category.creditActivity,
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
  const setup = fixture(500_000, "2026-09");
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    date: "2026-09-01",
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
    type: "transaction.upsert",
    transactionId: `register-payment-9:2026-10-20`,
    date: "2026-10-20",
    accountId: "checking",
    transferAccountId: "card",
    amount: -15_000,
    payee: "Credit card payment",
    status: "posted",
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
  const setup = fixture(500_000, "2026-09");
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    date: "2026-09-01",
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

void test("only the user covers overspending", () => {
  const setup = fixture();
  setup.run({ type: "category.add", categoryId: "dining", name: "Dining" });
  setup.run({ type: "assign", categoryId: "dining", month, amount: 5000 });
  setup.run({
    type: "transaction.upsert",
    transactionId: "overspent-food",
    accountId: "checking",
    date,
    amount: -1000,
    payee: "Groceries",
    categoryId: "food",
  });
  const cover = {
    type: "cover",
    fromCategoryId: "dining",
    toCategoryId: "food",
    month,
    amount: 1000,
  } as const;
  for (const source of ["agent", "provider"] as const)
    assert.throws(
      () => setup.run(cover, "alan", source),
      /requires a user action/,
    );
  setup.run(cover);
  assert.equal(
    setup.view().categories.find((category) => category.id === "food")
      ?.available,
    0,
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

void test("cash spending after a funded card payment becomes cash overspending in the card payment category", () => {
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
    type: "transaction.upsert",
    transactionId: `register-payment-10:2026-10-02`,
    date: "2026-10-02",
    accountId: "checking",
    transferAccountId: "card",
    amount: -10_000,
    payee: "Credit card payment",
    status: "posted",
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
  assert.equal(card.reserve, -10_000);
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
    type: "transaction.upsert",
    transactionId: `register-payment-11:2026-10-02`,
    date: "2026-10-02",
    accountId: "checking",
    transferAccountId: "b-card",
    amount: -10_000,
    payee: "Credit card payment",
    status: "posted",
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

void test("card refunds restore existing reserve and positive credit without creating envelope cash from debt", () => {
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
  setup.run({
    type: "transaction.upsert",
    transactionId: "over-refund",
    accountId: "card",
    date: "2026-11-02",
    amount: 10_000,
    payee: "Additional refund",
    categoryId: "food",
  });
  const refunded = setup.view("alan", "2026-11");
  assert.equal(
    refunded.accounts.find((account) => account.id === "card")?.balance,
    5000,
  );
  assert.equal(
    refunded.categories.find((category) => category.id === "food")?.available,
    15_000,
  );
  assert.equal(refunded.readyToAssign, 90_000);
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
            type: "transaction.upsert",
            transactionId: `reserve-payment:${seed}:${step}`,
            date,
            accountId: "checking",
            transferAccountId: "b-card",
            amount: -card.reserve,
            payee: "Credit card payment",
            status: "posted",
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

void test("purchases and card payments can predate their accounts and count once", () => {
  const setup = fixture();
  setup.run({ type: "assign", categoryId: "food", month, amount: 200 });
  for (const [accountId, kind, openingBalance] of [
    ["later", "cash", 1000],
    ["later-card", "credit", -1000],
    ["later-tracking", "tracking", 1000],
  ] as const) {
    setup.run({
      type: "account.add",
      accountId,
      name: accountId,
      kind,
      openingBalance,
      date: "2026-10-17",
    });
    setup.run({
      type: "transaction.upsert",
      transactionId: `earlier-${accountId}`,
      accountId,
      date: "2026-10-01",
      amount: -100,
      payee: "Earlier purchase",
      ...(kind === "tracking" ? {} : { categoryId: "food" }),
    });
  }
  setup.run({
    type: "assign",
    categoryId: "card:later-card",
    month,
    amount: 1000,
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "earlier-card-payment",
    date: "2026-10-16",
    accountId: "checking",
    transferAccountId: "later-card",
    amount: -1000,
    payee: "Credit card payment",
    status: "posted",
  });
  const view = setup.view();
  assert.equal(view.accounts.find((item) => item.id === "later")!.balance, 900);
  assert.equal(
    view.accounts.find((item) => item.id === "later-card")!.balance,
    -100,
  );
  assert.equal(
    view.accounts.find((item) => item.id === "later-tracking")!.balance,
    900,
  );
  assert.equal(
    view.accounts.find((item) => item.id === "checking")!.balance,
    499_000,
  );
  assert.equal(view.cash, 499_900);
  assert.equal(view.readyToAssign, 499_800);
  assert.equal(
    view.categories.find((item) => item.id === "food")!.activity,
    -200,
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
  assert.equal(
    setup.view().budget.transactions.find((t) => t.id === "suggestion")
      ?.reviewed,
    false,
  );
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
  assert.equal(
    setup.view().budget.transactions.find((t) => t.id === "suggestion")
      ?.reviewed,
    true,
  );
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
    type: "transaction.upsert",
    transactionId: `register-payment-13:${date}:loan`,
    loanId: "loan",
    date,
    interest: 0,
    accountId: "checking",
    amount: -(100 + 0),
    payee: "Loan payment",
    status: "posted",
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

void test("a refund after payment restores its category and later spending uses that positive credit", () => {
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
    type: "transaction.upsert",
    transactionId: `register-payment-14:2026-11-01`,
    date: "2026-11-01",
    accountId: "checking",
    transferAccountId: "card",
    amount: -10_000,
    payee: "Credit card payment",
    status: "posted",
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
  assert.equal(setup.view("alan", "2026-12").readyToAssign, 85_000);
  assert.equal(
    setup
      .view("alan", "2026-11")
      .categories.find((category) => category.id === "food")?.available,
    5000,
  );
});

void test("backdated card payments and credits make later purchases spend positive credit first", () => {
  for (const kind of ["payment", "credit"] as const) {
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
    if (kind === "payment") {
      setup.run({
        type: "transaction.upsert",
        transactionId: "backdated-payment",
        accountId: "checking",
        transferAccountId: "card",
        date: "2026-10-05",
        amount: -10_000,
        payee: "Credit card payment",
        status: "posted",
      });
    } else {
      setup.run({
        type: "transaction.upsert",
        transactionId: "backdated-credit",
        accountId: "card",
        date: "2026-10-05",
        amount: 10_000,
        payee: "Posted statement credit",
        status: "posted",
      });
    }
    const card = setup
      .view()
      .accounts.find((account) => account.id === "card")!;
    assert.equal(card.balance, 0);
    assert.equal(card.fundedSpending, 0);
    assert.equal(card.reserve, kind === "payment" ? -10_000 : 0);
    assert.equal(setup.view().readyToAssign, 100_000);
    assert.equal(
      setup.view("alan", "2026-11").readyToAssign,
      kind === "payment" ? 90_000 : 100_000,
    );
  }
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
        type: "transaction.upsert",
        transactionId: `register-payment-18:2026-10-05`,
        date: "2026-10-05",
        accountId: "checking",
        transferAccountId: "card",
        amount: -10_000,
        payee: "Credit card payment",
        status: "posted",
      }),
    /cash already received/,
  );
  setup.run({
    type: "transaction.upsert",
    transactionId: `register-payment-19:2026-10-20`,
    date: "2026-10-20",
    accountId: "checking",
    transferAccountId: "card",
    amount: -10_000,
    payee: "Credit card payment",
    status: "posted",
  });
  assert.equal(setup.view().cash, 0);
  assert.equal(setup.view().readyToAssign, 0);
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
    type: "transaction.upsert",
    transactionId: `register-payment-20:2026-10-20`,
    date: "2026-10-20",
    accountId: "checking",
    transferAccountId: "card",
    amount: -10_000,
    payee: "Credit card payment",
    status: "posted",
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "backdated-credit",
    accountId: "card",
    date: "2026-10-05",
    amount: 10_000,
    payee: "Posted statement credit",
    status: "posted",
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "backdated-payment",
    accountId: "checking",
    transferAccountId: "card",
    date: "2026-10-05",
    amount: -10_000,
    payee: "Credit card payment",
    status: "posted",
  });
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.balance,
    20_000,
  );
  assert.equal(
    setup.view().accounts.find((account) => account.id === "card")?.reserve,
    -10_000,
  );
  assert.equal(setup.view().cash, 80_000);
  assert.equal(setup.view().readyToAssign, 110_000);
});

void test("earlier card corrections preserve a confirmed payment and replay resulting positive balances", () => {
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
    type: "transaction.upsert",
    transactionId: `register-payment-23:2026-11-05`,
    date: "2026-11-05",
    accountId: "checking",
    transferAccountId: "card",
    amount: -10_000,
    payee: "Credit card payment",
    status: "posted",
  });
  const before = structuredClone(setup.book);
  const corrections: WithoutId<Command>[] = [
    {
      type: "transaction.upsert",
      transactionId: `register-payment-24:2026-10-15`,
      date: "2026-10-15",
      accountId: "card",
      amount: 10_000,
      payee: "Posted statement credit",
      status: "posted",
    },
    {
      type: "transaction.upsert",
      transactionId: `register-payment-25:2026-10-15`,
      date: "2026-10-15",
      accountId: "checking",
      transferAccountId: "card",
      amount: -10_000,
      payee: "Credit card payment",
      status: "posted",
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
  for (const [index, correction] of corrections.entries()) {
    setup.book = structuredClone(before);
    setup.run(correction);
    const nextMonth = setup.view("alan", "2026-11");
    assert.equal(
      nextMonth.accounts.find((account) => account.id === "card")?.balance,
      index === 3 ? 1000 : 10_000,
    );
    assert.equal(nextMonth.cash, index === 1 ? 80_000 : 90_000);
    assert.equal(
      nextMonth.budget.transactions.find(
        (transaction) =>
          transaction.date === "2026-11-05" && transaction.accountId === "card",
      )?.amount,
      10_000,
    );
  }
});

void test("a category group exists before its first category and keeps its name unique", () => {
  const setup = fixture();
  setup.run({ type: "group.add", name: "  Bills " });
  assert.deepEqual(setup.view().budget.groups, ["Bills"]);
  assert.equal(
    setup.view().categories.some((category) => category.group === "Bills"),
    false,
  );
  // Names compare without case, against stored groups and the groups that
  // older budgets know only through their categories.
  assert.throws(
    () => setup.run({ type: "group.add", name: "bills" }),
    /Category group already exists/,
  );
  assert.throws(
    () => setup.run({ type: "group.add", name: "EVERYDAY" }),
    /Category group already exists/,
  );
  setup.run({
    type: "category.add",
    categoryId: "power",
    name: "Power",
    group: "Bills",
  });
  assert.equal(
    setup.view().categories.find((category) => category.id === "power")?.group,
    "Bills",
  );
  // Newest first.
  setup.run({ type: "group.add", name: "Pets" });
  assert.deepEqual(setup.view().budget.groups, ["Pets", "Bills"]);
  assert.equal(bookSchema.parse(setup.book).budgets.alan?.groups?.length, 2);
});

void test("an agent cannot add a category group", () => {
  const setup = fixture();
  assert.throws(
    () => setup.run({ type: "group.add", name: "Bills" }, "alan", "agent"),
    /requires a user action/,
  );
});

void test("direct register entries on either counterparty account use the account picker's refusal", () => {
  const book = withCounterpartyAccounts(
    addMember(fixture().book, "anna", "Anna", month),
  );
  for (const accountId of [
    "counterparty:partner",
    "counterparty:reimbursements",
  ])
    assert.throws(
      () =>
        execute(book, "alan", {
          type: "transaction.upsert",
          id: "direct",
          transactionId: "direct",
          accountId,
          date,
          amount: -1000,
          payee: "Direct entry",
        }),
      {
        message:
          "Entries on Partner and Reimbursements come from shares and settlements, not from the register",
      },
    );
});

void test("F5: register upsert loan payments cannot predate the first confirmed rate", () => {
  const setup = fixture();
  setup.run({
    type: "loan.add",
    loanId: "car",
    categoryId: "loan-category",
    name: "Car",
    principal: 100_000,
    annualRateBps: 500,
    minimumPayment: 5000,
    variable: false,
    effectiveDate: "2026-10-15",
  });
  assert.throws(
    () =>
      setup.run({
        type: "transaction.upsert",
        transactionId: "payment",
        accountId: "checking",
        date: "2026-10-10",
        amount: -5000,
        payee: "Car payment",
        loanId: "car",
        interest: 1000,
        categoryId: "loan-category",
      }),
    { message: "Payment predates the loan" },
  );
});

void test("F5: the command schema rejects all four retired register payment commands", () => {
  const retired = [
    ["transaction", "save"],
    ["loan", "payment"],
    ["card", "payment"],
    ["card", "credit"],
  ];
  for (const parts of retired) {
    const input = {
      type: parts.join("."),
      id: "retired",
      transactionId: "old",
      accountId: "checking",
      cashAccountId: "checking",
      cardAccountId: "card",
      loanId: "loan",
      date,
      amount: 1000,
      principal: 1000,
      interest: 0,
      payee: "Old payment",
    };
    assert.equal(
      commandSchema.safeParse(input).success,
      false,
      parts.join("."),
    );
  }
});

void test("editing and deleting a reviewed reconciliation adjustment changes balances by its difference", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "account.reconcile",
    accountId: "checking",
    date,
    balance: 110_000,
    adjustmentId: "adjustment",
  });
  const adjustment = setup
    .view()
    .budget.transactions.find((item) => item.id === "adjustment")!;
  assert.equal(adjustment.reviewed, true);
  assert.equal(
    setup.view().accounts.find((item) => item.id === "checking")!.balance,
    110_000,
  );
  assert.equal(setup.view().readyToAssign, 110_000);
  setup.run({
    type: "transaction.upsert",
    transactionId: "adjustment",
    accountId: "checking",
    date: "2026-10-05",
    amount: -5000,
    payee: "Corrected balance",
    status: "posted",
  });
  const edited = setup
    .view()
    .budget.transactions.find((item) => item.id === "adjustment")!;
  assert.equal(edited.kind, "adjustment");
  assert.equal(edited.date, "2026-10-05");
  assert.equal(edited.payee, "Corrected balance");
  assert.equal(
    setup.view().accounts.find((item) => item.id === "checking")!.balance,
    95_000,
  );
  assert.equal(setup.view().readyToAssign, 95_000);
  setup.run({ type: "transaction.remove", transactionId: "adjustment" });
  assert.equal(
    setup.view().accounts.find((item) => item.id === "checking")!.balance,
    100_000,
  );
  assert.equal(setup.view().readyToAssign, 100_000);
});

void test("a balance adjustment cannot become categorized spending or a payment through an edit", () => {
  const setup = fixture(100_000);
  setup.run({
    type: "account.add",
    accountId: "savings",
    name: "Savings",
    kind: "cash",
    openingBalance: 0,
  });
  setup.run({
    type: "account.reconcile",
    accountId: "checking",
    date,
    balance: 110_000,
    adjustmentId: "adjustment",
  });
  const edit = {
    type: "transaction.upsert" as const,
    transactionId: "adjustment",
    accountId: "checking",
    date,
    amount: 10_000,
    payee: "A new name",
    status: "posted" as const,
    revision: 2,
  };
  for (const change of [
    { categoryId: "food" },
    { transferAccountId: "savings" },
    {
      lines: [
        { lineId: "one", categoryId: "food", amount: 5000 },
        { lineId: "two", categoryId: "food", amount: 5000 },
      ],
    },
  ])
    assert.throws(
      () => setup.run({ ...edit, ...change }),
      /balance adjustment/i,
    );
});

void test("a positive card Starting Balance funds same-day spending as cash", () => {
  const setup = fixture(10_000);
  setup.run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 10_000,
    date,
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "same-day-purchase",
    accountId: "card",
    date,
    amount: -2000,
    payee: "Market",
    categoryId: "food",
  });
  const view = setup.view();
  assert.equal(
    view.accounts.find((account) => account.id === "card")!.balance,
    8000,
  );
  assert.equal(
    view.categories.find((category) => category.id === "food")!
      .cashOverspending,
    2000,
  );
  assert.equal(view.readyToAssign, 20_000);
});

void test("accounts record Starting Balances once, and their adjustments can move earlier, change and be removed", () => {
  let book = withCounterpartyAccounts(
    addMember(
      createBook("alan", "Alan", "2026-09"),
      "partner",
      "Partner",
      "2026-09",
    ),
  );
  const run = (command: Command) => {
    book = execute(book, "alan", command);
    return projectBook(book, "alan", "2026-10");
  };
  for (const [accountId, kind, openingBalance] of [
    ["cash", "cash", 100_000],
    ["card", "credit", -50_000],
    ["tracking", "tracking", 25_000],
    ["empty", "cash", 0],
  ] as const) {
    run({
      type: "account.add",
      id: `add-${accountId}`,
      accountId,
      name: accountId,
      kind,
      openingBalance,
      date: "2026-10-10",
    });
  }
  const view = projectBook(book, "alan", "2026-10");
  assert.deepEqual(
    view.budget.transactions.map(
      ({
        accountId,
        date,
        payee,
        amount,
        kind,
        status,
        reviewed,
        reconciled,
      }) => ({
        accountId,
        date,
        payee,
        amount,
        kind,
        status,
        reviewed,
        reconciled,
      }),
    ),
    [
      {
        accountId: "cash",
        date: "2026-10-10",
        payee: "Starting Balance",
        amount: 100_000,
        kind: "adjustment",
        status: "posted",
        reviewed: true,
        reconciled: undefined,
      },
      {
        accountId: "card",
        date: "2026-10-10",
        payee: "Starting Balance",
        amount: -50_000,
        kind: "adjustment",
        status: "posted",
        reviewed: true,
        reconciled: undefined,
      },
      {
        accountId: "tracking",
        date: "2026-10-10",
        payee: "Starting Balance",
        amount: 25_000,
        kind: "adjustment",
        status: "posted",
        reviewed: true,
        reconciled: undefined,
      },
      {
        accountId: "empty",
        date: "2026-10-10",
        payee: "Starting Balance",
        amount: 0,
        kind: "adjustment",
        status: "posted",
        reviewed: true,
        reconciled: undefined,
      },
    ],
  );
  assert.equal(view.readyToAssign, 100_000);
  assert.equal(
    view.categories.every((c) => c.activity === 0 && c.available === 0),
    true,
  );
  assert.deepEqual(
    view.accounts
      .filter((a) => ["cash", "card"].includes(a.id))
      .map(({ id, priorBalance, inflows, outflows, balance }) => ({
        id,
        priorBalance,
        inflows,
        outflows,
        balance,
      })),
    [
      {
        id: "cash",
        priorBalance: 0,
        inflows: 100_000,
        outflows: 0,
        balance: 100_000,
      },
      {
        id: "card",
        priorBalance: 0,
        inflows: 0,
        outflows: -50_000,
        balance: -50_000,
      },
    ],
  );
  assert.equal(view.accounts.find((a) => a.id === "card")!.cleared, -50_000);
  assert.equal(view.accounts.find((a) => a.id === "empty")!.balance, 0);
  assert.equal(projectBook(book, "alan", "2026-09").readyToAssign, 0);
  assert.equal(projectBook(book, "alan", "2026-11").readyToAssign, 100_000);
  assert.equal(
    "openingBalance" in view.budget.accounts.find((a) => a.id === "cash")!,
    false,
  );
  for (const [accountId, amount, ready] of [
    ["cash", 120_000, 120_000],
    ["card", -60_000, 120_000],
  ] as const) {
    const starting = book.budgets.alan!.transactions.find(
      (t) => t.accountId === accountId,
    )!;
    const edited = run({
      type: "transaction.upsert",
      id: `edit-${accountId}`,
      transactionId: starting.id,
      accountId,
      date: "2026-09-15",
      payee: "Corrected balance",
      amount,
      status: "posted",
    });
    assert.equal(
      edited.accounts.find((a) => a.id === accountId)!.balance,
      amount,
    );
    assert.equal(
      projectBook(book, "alan", "2026-09").accounts.find(
        (a) => a.id === accountId,
      )!.cleared,
      amount,
    );
    assert.equal(edited.readyToAssign, ready);
    assert.equal(
      edited.categories.every((c) => c.activity === 0 && c.available === 0),
      true,
    );
  }
  for (const accountId of ["cash", "card"]) {
    const starting = book.budgets.alan!.transactions.find(
      (t) => t.accountId === accountId,
    )!;
    const removed = run({
      type: "transaction.remove",
      id: `remove-${accountId}`,
      transactionId: starting.id,
    });
    assert.equal(removed.accounts.find((a) => a.id === accountId)!.balance, 0);
    assert.equal(removed.readyToAssign, 0);
  }
  book = closePartnerLedger(book, "alan", {
    id: "former-partner",
    name: "Former partner",
    at: "2026-10-31T12:00:00.000Z",
    by: "alan",
  });
  const counterpartyIds = new Set(
    book.budgets
      .alan!.accounts.filter(
        (a) => !["cash", "credit", "tracking"].includes(a.kind),
      )
      .map((a) => a.id),
  );
  assert.equal(
    book.budgets.alan!.accounts.some((a) => a.kind === "former-partner"),
    true,
  );
  assert.equal(
    book.budgets.alan!.transactions.some((t) =>
      counterpartyIds.has(t.accountId),
    ),
    false,
  );
});

void test("a Starting Balance stays editable and removable at the maximum account ID length", () => {
  const accountId = "a".repeat(160);
  let book = execute(createBook("owner", "Budget", month), "owner", {
    type: "account.add",
    id: "add-long-account",
    accountId,
    name: "Long account",
    kind: "cash",
    openingBalance: 1000,
  });
  const transactionId = book.budgets.owner!.transactions[0]!.id;
  book = execute(book, "owner", {
    type: "transaction.upsert",
    id: "edit-long-account",
    transactionId,
    accountId,
    date: "2026-10-01",
    payee: "Corrected balance",
    amount: 2000,
    status: "posted",
  });
  assert.equal(projectBook(book, "owner", month).readyToAssign, 2000);
  book = execute(book, "owner", {
    type: "transaction.remove",
    id: "remove-long-account",
    transactionId,
  });
  assert.equal(projectBook(book, "owner", month).readyToAssign, 0);
});
