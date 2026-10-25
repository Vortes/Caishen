import assert from "node:assert/strict";
import test from "node:test";
import {
  toShellData,
  type ShellSource,
} from "../../src/components/app-shell/model";
import { viewOf } from "../../src/components/app-shell/plan-view";
import {
  createBook,
  execute,
  projectBook,
  type Command,
} from "../../src/domain/engine";

const month = "2026-10";
type Input = Command extends infer T
  ? T extends Command
    ? Omit<T, "id">
    : never
  : never;
function setup(cardBalance = 0, startMonth = month) {
  let book = createBook("owner", "Projection budget", startMonth);
  let operation = 0;
  const run = (command: Input) => {
    book = execute(book, "owner", { ...command, id: `command-${++operation}` });
  };
  run({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
    date: "2026-10-01",
  });
  run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: cardBalance,
    date: "2026-10-01",
  });
  for (const name of ["Gifts", "Dining", "Household", "Phone"])
    run({ type: "category.add", categoryId: name, name });
  const data = (
    viewMonth = month,
    activeMonth = month,
    imports: ShellSource["imports"] = [],
  ) =>
    toShellData(
      {
        view: projectBook(book, "owner", viewMonth, month),
        connections: [],
        imports,
      },
      activeMonth,
    );
  return { run, data };
}

function bankImport(
  patch: Partial<ShellSource["imports"][number]> = {},
): ShellSource["imports"][number] {
  return {
    connectionId: "connection",
    logicalId: "import",
    fingerprint: "a".repeat(64),
    providerAccountId: "provider-checking",
    accountId: "checking",
    transactionId: undefined,
    categoryId: null,
    date: "2026-10-20",
    payee: "New merchant",
    amount: -2_000,
    pending: false,
    removed: false,
    needsMatchReview: false,
    error: null,
    history: [
      {
        kind: "added",
        before: null,
        after: {
          provider: "plaid",
          providerTransactionId: "provider-purchase",
          providerAccountId: "provider-checking",
          pendingTransactionId: null,
          amountCents: 2_000,
          currency: "USD",
          date: "2026-10-20",
          authorizedDate: null,
          name: "New merchant",
          merchantName: null,
          pending: false,
        },
      },
    ],
    reviewEvidence: [],
    quarantined: false,
    eligibility: "eligible",
    ...patch,
  };
}

void test("account openings are visible separately from spending and never fund existing card debt", () => {
  const { data } = setup(-120_000);
  const shell = data();
  assert.deepEqual(shell.openingBalances, [
    {
      source: "opening",
      id: "opening:checking",
      accountId: "checking",
      date: "2026-10-01",
      payee: "Starting Balance",
      amount: 100_000,
    },
    {
      source: "opening",
      id: "opening:card",
      accountId: "card",
      date: "2026-10-01",
      payee: "Starting Balance",
      amount: -120_000,
    },
  ]);
  assert.deepEqual(shell.transactions, []);
  assert.equal(shell.readyToAssign, 100_000);
  assert.equal(
    shell.accounts.find(({ id }) => id === "checking")!.cleared,
    100_000,
  );
  assert.equal(
    shell.accounts.find(({ id }) => id === "card")!.cleared,
    -120_000,
  );
  assert.equal(
    shell.categories.find((category) => category.pays?.id === "card")!
      .available,
    0,
  );
  assert.equal(
    setup()
      .data()
      .openingBalances.find(({ accountId }) => accountId === "card")!.amount,
    0,
  );
});

void test("a bank purchase counts toward account balances while it waits for review", () => {
  const { data } = setup();
  const shell = data(month, month, [bankImport()]);
  const checking = shell.accounts.find(({ id }) => id === "checking")!;
  assert.equal(checking.balance, 98_000);
  assert.equal(checking.cleared, 98_000);
  assert.equal(shell.transactions[0]!.needsReview, true);
  assert.equal(shell.transactions[0]!.source, "bank");
});

void test("card balances include unreviewed posted payments while untouched pending imports wait outside balances", () => {
  const { data } = setup(-300_000);
  const shell = data(month, month, [
    bankImport({ logicalId: "payment", accountId: "card", amount: 200_000 }),
    bankImport({
      logicalId: "pending-purchase",
      accountId: "card",
      pending: true,
    }),
    bankImport({
      logicalId: "pending-credit",
      accountId: "card",
      amount: 1_000,
      pending: true,
    }),
  ]);
  const card = shell.accounts.find(({ id }) => id === "card")!;
  assert.equal(card.balance, -100_000);
  assert.equal(card.cleared, -100_000);
  assert.equal(card.uncleared, 0);
});

void test("already recorded activity and uncertain matches never count twice before the inbox refreshes", () => {
  for (const providerId of [undefined, "provider-purchase"]) {
    const { run, data } = setup();
    run({
      type: "transaction.upsert",
      transactionId: "recorded",
      accountId: "checking",
      date: "2026-10-20",
      amount: -2_000,
      payee: "New merchant",
      status: "posted",
      providerId,
    });
    const imported = bankImport();
    assert.equal(
      data(month, month, [imported]).accounts.find(
        ({ id }) => id === "checking",
      )!.balance,
      98_000,
    );
  }
  const { data } = setup();
  const possiblePartnerMatch = bankImport({
    partnerMatches: [
      {
        entryId: "recorded-purchase",
        date: "2026-10-20",
        payee: "New merchant",
        amount: 2_000,
        share: 1_000,
        payeesAlike: true,
      },
    ],
  });
  assert.equal(
    data(month, month, [possiblePartnerMatch]).accounts.find(
      ({ id }) => id === "checking",
    )!.balance,
    100_000,
  );
});

void test("each account signals its own review work, while untouched pending imports have no review dot", () => {
  const { run, data } = setup();
  const pending = bankImport({ pending: true, accountId: "card" });
  let shell = data(month, month, [bankImport(), pending]);
  assert.equal(
    shell.accounts.find(({ id }) => id === "checking")!.toReview,
    true,
  );
  assert.equal(shell.accounts.find(({ id }) => id === "card")!.toReview, false);
  run({
    type: "transaction.upsert",
    transactionId: "card-purchase",
    accountId: "card",
    date: "2026-10-20",
    amount: -3_000,
    payee: "Market",
    status: "posted",
    categoryId: "Dining",
    reviewed: false,
  });
  shell = data(month, month, [pending]);
  assert.equal(
    shell.accounts.find(({ id }) => id === "checking")!.toReview,
    false,
  );
  assert.equal(shell.accounts.find(({ id }) => id === "card")!.toReview, true);
  run({ type: "transaction.approve", transactionIds: ["card-purchase"] });
  shell = data(month, month, [pending]);
  assert.equal(shell.accounts.find(({ id }) => id === "card")!.toReview, false);
});

void test("only untouched bank pending imports belong in the pending section, and entered purchases count once", () => {
  const { run, data } = setup();
  const pending = bankImport({ pending: true });
  const before = data(month, month, [pending]);
  assert.equal(before.transactions[0]!.pendingImport, true);
  assert.equal(before.accounts[0]!.balance, 100_000);
  run({
    type: "transaction.upsert",
    transactionId: "entered-pending",
    accountId: "checking",
    date: "2026-10-20",
    amount: -2_000,
    payee: "New merchant",
    status: "pending",
    categoryId: "Dining",
    providerId: "provider-purchase",
  });
  const after = data();
  assert.equal(Boolean(after.transactions[0]!.pendingImport), false);
  assert.equal(after.accounts[0]!.balance, 98_000);
  assert.equal(after.accounts[0]!.uncleared, -2_000);
  const changed = data(month, month, [
    bankImport({
      pending: true,
      transactionId: "entered-pending",
      error: "Bank changed this purchase",
    }),
  ]);
  assert.equal(
    Boolean(
      changed.transactions.find(({ source }) => source === "bank")!
        .pendingImport,
    ),
    false,
  );
});

void test("an entered purchase missing its category keeps its account review dot even after approval", () => {
  const { run, data } = setup();
  run({
    type: "transaction.upsert",
    transactionId: "uncategorized",
    accountId: "checking",
    date: "2026-10-20",
    amount: -2_000,
    payee: "New merchant",
    status: "pending",
    reviewed: true,
  });
  const shell = data();
  assert.equal(
    shell.accounts.find(({ id }) => id === "checking")!.toReview,
    true,
  );
  assert.equal(shell.transactions[0]!.needsReview, true);
});

void test("import balances respect the selected month while cleared balances include current activity", (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-23T12:00:00Z"),
  });
  const { data } = setup(0, "2026-09");
  const past = data("2026-09", month, [bankImport()]).accounts.find(
    ({ id }) => id === "checking",
  )!;
  assert.equal(past.balance, 0);
  assert.equal(past.cleared, 98_000);
  const futureImport = bankImport({ date: "2026-11-01" });
  assert.equal(
    data("2026-11", month, [futureImport]).accounts.find(
      ({ id }) => id === "checking",
    )!.balance,
    100_000,
  );
});

void test("a positive payment reserve below the working balance is underfunded", () => {
  const { run, data } = setup(-552_290);
  run({ type: "assign", categoryId: "card:card", month, amount: 11_042 });
  const payment = data().categories.find(
    (category) => category.id === "card:card",
  )!;
  assert.equal(payment.funding, "underfunded");
});

void test("a zero payment reserve is underfunded while the card has debt", () => {
  const { data } = setup(-1_385);
  const payment = data().categories.find(
    (category) => category.id === "card:card",
  )!;
  assert.equal(payment.funding, "underfunded");
});

void test("the payment shortfall explains how much cash is needed to pay in full", () => {
  const { run, data } = setup(-552_290);
  run({ type: "assign", categoryId: "card:card", month, amount: 11_042 });
  const payment = data().categories.find(
    (category) => category.id === "card:card",
  )!;
  assert.equal(payment.status, "$5,412.48 more needed to pay in full");
});

for (const [period, viewMonth, activeMonth] of [
  ["past", "2026-10", "2026-11"],
  ["future", "2026-11", "2026-10"],
] as const) {
  void test(`the implicit full-balance warning does not apply to a ${period} month`, () => {
    const { run, data } = setup(-552_290);
    run({ type: "assign", categoryId: "card:card", month, amount: 11_042 });
    const payment = data(viewMonth, activeMonth).categories.find(
      (category) => category.id === "card:card",
    )!;
    assert.equal(payment.funding, "funded");
  });
}

void test("a funded monthly payment target replaces the full-balance funding requirement", () => {
  const { run, data } = setup(-30_000);
  run({
    type: "target.set",
    categoryId: "card:card",
    target: {
      cadence: "card-monthly",
      behavior: "contribution",
      amount: 5_000,
      startMonth: month,
      snoozedMonths: [],
    },
  });
  run({ type: "assign", categoryId: "card:card", month, amount: 5_000 });
  const payment = data().categories.find(
    (category) => category.id === "card:card",
  )!;
  assert.equal(payment.funding, "funded");
});

for (const [description, balance, reserve, expectedFunding] of [
  ["a debt-free card", 0, 0, "empty"],
  ["a fully reserved card", -30_000, 30_000, "funded"],
] as const) {
  void test(`${description} has no payment funding warning`, () => {
    const { run, data } = setup(balance);
    if (reserve > 0)
      run({ type: "assign", categoryId: "card:card", month, amount: reserve });
    const payment = data().categories.find(
      (category) => category.id === "card:card",
    )!;
    assert.equal(payment.funding, expectedFunding);
  });
}

void test("funded card purchases move cash into the payment reserve", () => {
  const { run, data } = setup();
  run({ type: "assign", categoryId: "Gifts", month, amount: 5_000 });
  run({
    type: "transaction.upsert",
    transactionId: "purchase",
    accountId: "card",
    categoryId: "Gifts",
    amount: -5_000,
    date: "2026-10-02",
    payee: "Store",
  });
  const payment = data().categories.find(
    (category) => category.id === "card:card",
  )!;
  assert.equal(payment.available, 5_000);
});

void test("a card payment consumes cash from the payment reserve", () => {
  const { run, data } = setup(-5_000);
  run({ type: "assign", categoryId: "card:card", month, amount: 5_000 });
  run({
    type: "transaction.upsert",
    transactionId: `register-payment-1:2026-10-03`,
    date: "2026-10-03",
    accountId: "checking",
    transferAccountId: "card",
    amount: -2_000,
    payee: "Credit card payment",
    status: "posted",
  });
  const payment = data().categories.find(
    (category) => category.id === "card:card",
  )!;
  assert.equal(payment.available, 3_000);
});

void test("paying the card does not count the purchase as a second expense", () => {
  const { run, data } = setup();
  run({ type: "assign", categoryId: "Gifts", month, amount: 5_000 });
  run({
    type: "transaction.upsert",
    transactionId: "purchase",
    accountId: "card",
    categoryId: "Gifts",
    amount: -5_000,
    date: "2026-10-02",
    payee: "Store",
  });
  run({
    type: "transaction.upsert",
    transactionId: `register-payment-2:2026-10-03`,
    date: "2026-10-03",
    accountId: "checking",
    transferAccountId: "card",
    amount: -2_000,
    payee: "Credit card payment",
    status: "posted",
  });
  const spendingActivity = data()
    .categories.filter((category) => !category.pays)
    .reduce((total, category) => total + category.activity, 0);
  assert.equal(spendingActivity, -5_000);
});

void test("focused views include cash and credit overspending, unfunded targets, and available money", () => {
  const { run, data } = setup();
  run({ type: "assign", categoryId: "Gifts", month, amount: 10_000 });
  run({
    type: "target.set",
    categoryId: "Phone",
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: 6_500,
      startMonth: month,
      snoozedMonths: [],
    },
  });
  for (const [categoryId, accountId] of [
    ["Dining", "checking"],
    ["Household", "card"],
  ] as const)
    run({
      type: "transaction.upsert",
      transactionId: categoryId,
      accountId,
      categoryId,
      amount: -500,
      date: "2026-10-02",
      payee: categoryId,
    });
  const matches = (id: Parameters<typeof viewOf>[0]) =>
    data()
      .categories.filter(viewOf(id).matches)
      .map(({ name }) => name);
  assert.deepEqual(matches("overspent"), ["Dining", "Household"]);
  assert.deepEqual(matches("underfunded"), [
    "Card payment",
    "Dining",
    "Household",
    "Phone",
  ]);
  assert.deepEqual(matches("available"), ["Gifts"]);
  assert.deepEqual(matches("overfunded"), []);
  run({ type: "assign", categoryId: "Phone", month, amount: 7_000 });
  assert.deepEqual(matches("overfunded"), ["Phone"]);
  run({
    type: "target.snooze",
    categoryId: "Phone",
    month,
    currentMonth: month,
    snoozed: true,
  });
  assert.deepEqual(matches("snoozed"), ["Phone"]);
});

void test("the register excludes pending inflows from its uncleared balance and preserves review labels", () => {
  const { run, data } = setup();
  run({ type: "assign", categoryId: "Gifts", month, amount: 20_000 });
  for (const [transactionId, amount, status, reviewed] of [
    ["posted", -2_500, "posted", true],
    ["pending", -1_000, "pending", false],
    ["refund", 500, "pending", true],
  ] as const)
    run({
      type: "transaction.upsert",
      transactionId,
      accountId: "checking",
      categoryId: "Gifts",
      amount,
      status,
      reviewed,
      date: "2026-10-02",
      payee: transactionId,
    });
  const shell = data();
  const checking = shell.accounts.find(({ id }) => id === "checking")!;
  assert.equal(checking.balance, 96_500);
  assert.equal(checking.uncleared, -1_000);
  assert.deepEqual(
    Object.fromEntries(
      shell.transactions.map(({ id, needsReview }) => [id, needsReview]),
    ),
    { posted: false, pending: true, refund: false },
  );
});

void test("changed opening history explains the domain refusal in its register row", () => {
  let book = createBook("owner", "Imports", month);
  book = execute(book, "owner", {
    type: "account.add",
    id: "cash",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  for (const pending of [false, true]) {
    const shell = toShellData(
      {
        view: projectBook(book, "owner", month),
        connections: [],
        imports: [
          {
            eligibility: "opening_snapshot_changed",
            connectionId: "bank",
            logicalId: "opening",
            fingerprint: "a".repeat(64),
            providerAccountId: "provider",
            accountId: "checking",
            date: "2026-10-10",
            payee: "Opening history",
            amount: -2500,
            pending,
            removed: false,
            needsMatchReview: false,
            error: null,
            history: [],
            reviewEvidence: [],
            quarantined: false,
            categoryName: null,
            categoryId: undefined,
            transactionId: undefined,
          },
        ],
      },
      month,
    );
    assert.equal(
      shell.accounts.find((account) => account.id === "checking")!.balance,
      100_000,
    );
    assert.equal(shell.transactions[0]!.actions.edit, null);
    assert.equal(shell.transactions[0]!.needsReview, true);
    assert.equal(
      shell.transactions[0]!.reviewReason,
      "This activity may already be included in this account's opening balance. Investigate the bank's changes or uncertain matches before recording an adjustment; importing it could count it twice.",
    );
  }
});
