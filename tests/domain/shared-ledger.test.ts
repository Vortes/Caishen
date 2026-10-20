import assert from "node:assert/strict";
import test from "node:test";
import {
  addMember,
  createBook,
  execute,
  previewBudgetProjection,
  projectBook,
  type Book,
  type BudgetProjection,
  type Command,
} from "../../src/domain/engine";

const startMonth = "2026-09";
const currentMonth = "2026-11";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

function household() {
  let book = addMember(
    createBook("alan", "Alan", startMonth),
    "partner",
    "Partner",
    startMonth,
  );
  let sequence = 0;
  const run = (command: WithoutId<Command>, actor = "alan") => {
    book = execute(book, actor, { ...command, id: `setup-${++sequence}` });
    return book;
  };
  run({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 1_000_000,
  });
  run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  for (const categoryId of ["food", "savings", "rent", "utilities"])
    run({ type: "category.add", categoryId, name: categoryId });
  run(
    {
      type: "account.add",
      accountId: "PRIVATE_PARTNER_ACCOUNT_ID",
      name: "PRIVATE_PARTNER_ACCOUNT_NAME",
      kind: "cash",
      openingBalance: 59_876_543,
    },
    "partner",
  );
  run(
    {
      type: "category.add",
      categoryId: "PRIVATE_PARTNER_CATEGORY_ID",
      name: "PRIVATE_PARTNER_CATEGORY_NAME",
      group: "PRIVATE_PARTNER_GROUP",
    },
    "partner",
  );
  run(
    {
      type: "settings.update",
      timezone: "Pacific/Marquesas",
      emailEnabled: false,
      emailHour: 23,
    },
    "partner",
  );
  run(
    {
      type: "income.expect",
      month: "2026-12",
      amount: 12_345_679,
    },
    "partner",
  );
  run(
    {
      type: "loan.add",
      loanId: "PRIVATE_PARTNER_LOAN_ID",
      categoryId: "PRIVATE_PARTNER_LOAN_CATEGORY",
      name: "PRIVATE_PARTNER_LOAN_NAME",
      principal: 987_654,
      minimumPayment: 12_345,
      annualRateBps: 877,
      effectiveDate: "2026-09-01",
      variable: true,
    },
    "partner",
  );
  run(
    {
      type: "transaction.upsert",
      transactionId: "PRIVATE_PARTNER_TRANSACTION_ID",
      accountId: "PRIVATE_PARTNER_ACCOUNT_ID",
      categoryId: "PRIVATE_PARTNER_CATEGORY_ID",
      date: "2026-09-02",
      payee: "PRIVATE_PARTNER_PAYEE",
      providerId: "PRIVATE_PARTNER_PROVIDER_ID",
      amount: -43_217,
      reviewed: false,
    },
    "partner",
  );
  run(
    {
      type: "assign",
      categoryId: "PRIVATE_PARTNER_CATEGORY_ID",
      month: startMonth,
      amount: 54_321,
    },
    "partner",
  );
  for (const categoryId of ["rent", "utilities", "unused"])
    run({
      type: "shared.create",
      sharedCategoryId: `shared-${categoryId}`,
      participants: ["alan", "partner"],
      weights: { alan: 1, partner: 1 },
      categoryIds: {
        alan: categoryId === "unused" ? "savings" : categoryId,
        partner: `partner-${categoryId}`,
      },
    });
  run({
    type: "assign.batch",
    month: startMonth,
    changes: [
      { categoryId: "food", amount: 40_000 },
      { categoryId: "savings", amount: 100_000 },
      { categoryId: "rent", amount: 100_000 },
      { categoryId: "utilities", amount: 40_000 },
    ],
  });
  return {
    run,
    get book() {
      return book;
    },
  };
}

function historyFixture() {
  const setup = household();
  setup.run({
    type: "opening.add",
    obligationId: "opening-rent",
    sharedCategoryId: "shared-rent",
    debtorId: "alan",
    creditorId: "partner",
    amount: 12_000,
  });
  setup.run({
    type: "opening.add",
    obligationId: "opening-utilities",
    sharedCategoryId: "shared-utilities",
    debtorId: "partner",
    creditorId: "alan",
    amount: 2_000,
  });
  setup.run(
    {
      type: "transaction.upsert",
      transactionId: "partner-rent-september",
      accountId: "PRIVATE_PARTNER_ACCOUNT_ID",
      categoryId: "partner-rent",
      sharedCategoryId: "shared-rent",
      date: "2026-09-03",
      amount: -100_000,
      payee: "Shared September rent",
      providerId: "PRIVATE_PARTNER_SHARED_PROVIDER_ID",
      reviewed: false,
    },
    "partner",
  );
  setup.run({
    type: "transaction.upsert",
    transactionId: "alan-utilities-september",
    accountId: "checking",
    categoryId: "utilities",
    sharedCategoryId: "shared-utilities",
    date: "2026-09-04",
    amount: -20_000,
    payee: "Shared utilities",
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "alan-food-card",
    accountId: "card",
    categoryId: "food",
    date: "2026-09-05",
    amount: -12_000,
    payee: "Groceries",
  });
  setup.run({
    type: "settlement.record",
    settlementId: "partial-september",
    otherUserId: "partner",
    accountId: "checking",
    date: "2026-09-20",
    amount: 30_000,
  });
  setup.run(
    {
      type: "settlement.receive",
      settlementId: "partial-september",
      accountId: "PRIVATE_PARTNER_ACCOUNT_ID",
      date: "2026-10-02",
    },
    "partner",
  );
  setup.run(
    {
      type: "transaction.upsert",
      transactionId: "partner-october-payment",
      accountId: "PRIVATE_PARTNER_ACCOUNT_ID",
      categoryId: "partner-rent",
      sharedCategoryId: "shared-rent",
      date: "2026-10-03",
      expenseMonth: startMonth,
      amount: -40_000,
      payee: "Shared rent paid later",
      shares: { alan: 15_000, partner: 25_000 },
    },
    "partner",
  );
  setup.run({
    type: "transaction.upsert",
    transactionId: "alan-october-utilities",
    accountId: "checking",
    categoryId: "utilities",
    sharedCategoryId: "shared-utilities",
    date: "2026-10-05",
    expenseMonth: currentMonth,
    amount: -10_000,
    payee: "Shared October utilities",
    reviewed: false,
  });
  setup.run({
    type: "loan.add",
    loanId: "personal-loan",
    categoryId: "loan-payment",
    name: "Personal loan",
    principal: 200_000,
    minimumPayment: 5_000,
    annualRateBps: 600,
    effectiveDate: "2026-09-01",
    variable: true,
  });
  setup.run({
    type: "assign",
    categoryId: "loan-payment",
    month: "2026-10",
    amount: 7_000,
  });
  setup.run({
    type: "reimbursement.expect",
    reimbursementId: "card-benefit",
    transactionId: "alan-food-card",
    name: "Card grocery benefit",
    kind: "statement-credit",
    amount: 3_000,
  });
  setup.run({
    type: "assign",
    categoryId: "rent",
    month: currentMonth,
    amount: 30_000,
  });
  return setup;
}

function withoutAudit({ audit: _audit, ...view }: BudgetProjection) {
  return view;
}

function expectParity(
  book: Book,
  command: Command,
  actor = "alan",
  month = "2026-10",
) {
  const originalBook = structuredClone(book);
  const view = projectBook(book, actor, month, currentMonth);
  const originalView = structuredClone(view);
  const actual = previewBudgetProjection(view, command, currentMonth);
  const saved = execute(book, actor, command);
  const expected = projectBook(saved, actor, month, currentMonth);
  assert.deepEqual(withoutAudit(actual), withoutAudit(expected), command.type);
  assert.deepEqual(view, originalView, "preview must not mutate its input");
  assert.deepEqual(
    book,
    originalBook,
    "preview must not mutate the saved Book",
  );
  if (command.type !== "shared.create")
    assert.deepEqual(
      saved.budgets[actor === "alan" ? "partner" : "alan"],
      originalBook.budgets[actor === "alan" ? "partner" : "alan"],
      "an actor-local command must preserve the other personal budget",
    );
  return actual;
}

void test("shared calculation facts disclose only allowed partner activity", () => {
  const setup = historyFixture();
  const view = projectBook(setup.book, "alan", startMonth, currentMonth);
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("PRIVATE_PARTNER_"), false);
  assert.equal(serialized.includes("Pacific/Marquesas"), false);
  for (const amount of [59_876_543, 12_345_679, 987_654, 43_217, 54_321])
    assert.equal(serialized.includes(String(amount)), false, String(amount));
  assert.deepEqual(Object.keys(view.sharedLedger).sort(), [
    "obligations",
    "partnerActivityCategoryIds",
    "partnerPurchases",
    "partnerReceiptDates",
    "settlements",
    "version",
  ]);
  assert.equal(view.sharedLedger.version, 1);
  assert.equal(view.sharedLedger.partnerPurchases.length, 2);
  for (const purchase of view.sharedLedger.partnerPurchases)
    assert.deepEqual(Object.keys(purchase).sort(), [
      "amount",
      "date",
      "expenseMonth",
      "id",
      "payee",
      "payerId",
      "sharedCategoryId",
      "shares",
      "status",
    ]);
  for (const obligation of view.sharedLedger.obligations)
    assert.deepEqual(Object.keys(obligation).sort(), [
      "amount",
      "creditorId",
      "date",
      "debtorId",
      "expenseMonth",
      "id",
      "opening",
      "payee",
      "payerId",
      "sharedCategoryId",
      "transactionId",
    ]);
  for (const settlement of view.sharedLedger.settlements) {
    assert.deepEqual(Object.keys(settlement).sort(), [
      "allocations",
      "amount",
      "date",
      "id",
      "payerId",
      "received",
      "recipientId",
    ]);
    for (const allocation of settlement.allocations)
      assert.deepEqual(Object.keys(allocation).sort(), [
        "amount",
        "kind",
        "obligationId",
      ]);
  }
  assert.equal(
    view.sharedLedger.partnerReceiptDates["partial-september"],
    "2026-10-02",
  );
  assert.ok(serialized.includes("Shared September rent"));
  assert.ok(serialized.includes("Shared rent paid later"));
  assert.equal(view.sharedStatement.repayments[0]?.receivedOn, undefined);
});

void test("unrelated partner activity cannot change the actor projection or grow its shared payload", () => {
  const setup = historyFixture();
  const months = [startMonth, "2026-10", currentMonth];
  const before = months.map((month) =>
    projectBook(setup.book, "alan", month, currentMonth),
  );
  setup.run(
    {
      type: "account.add",
      accountId: "unrelated-partner-account",
      name: "Unrelated partner account",
      kind: "cash",
      openingBalance: 100_000,
    },
    "partner",
  );
  setup.run(
    {
      type: "category.add",
      categoryId: "unrelated-partner-category",
      name: "Unrelated partner category",
    },
    "partner",
  );
  setup.run(
    {
      type: "assign",
      categoryId: "unrelated-partner-category",
      month: startMonth,
      amount: 40_000,
    },
    "partner",
  );
  setup.run(
    {
      type: "transaction.upsert",
      transactionId: "unrelated-partner-income",
      accountId: "unrelated-partner-account",
      date: "2026-09-02",
      amount: 25_000,
      payee: "Unrelated partner employer",
    },
    "partner",
  );
  for (let index = 0; index < 100; index++)
    setup.run(
      {
        type: "transaction.upsert",
        transactionId: `unrelated-partner-purchase-${index}`,
        accountId: "unrelated-partner-account",
        categoryId: "unrelated-partner-category",
        date: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
        amount: -100,
        payee: `Unrelated partner merchant ${index}`,
        providerId: `unrelated-partner-provider-${index}`,
        reviewed: false,
      },
      "partner",
    );
  for (const [index, month] of months.entries()) {
    const after = projectBook(setup.book, "alan", month, currentMonth);
    assert.deepEqual(after, before[index]);
    assert.equal(
      JSON.stringify(after.sharedLedger),
      JSON.stringify(before[index]!.sharedLedger),
      "shared payload content and size must be independent of private partner activity",
    );
  }
});

void test("connected financial previews preserve settlement history, reserve math and rollover", () => {
  const setup = historyFixture();
  const commands: Command[] = [
    {
      type: "assign",
      id: "assign-food",
      categoryId: "food",
      month: "2026-10",
      amount: 8_000,
    },
    {
      type: "assign.batch",
      id: "batch",
      month: "2026-10",
      changes: [
        { categoryId: "food", amount: 2_000 },
        { categoryId: "rent", amount: 7_000 },
      ],
    },
    {
      type: "cover",
      id: "cover",
      fromCategoryId: "savings",
      toCategoryId: "utilities",
      month: "2026-10",
      amount: 1_000,
    },
    {
      type: "transaction.upsert",
      id: "backdated-card",
      transactionId: "backdated-card",
      accountId: "card",
      categoryId: "food",
      date: "2026-09-15",
      expenseMonth: "2026-10",
      amount: -3_000,
      payee: "Backdated groceries",
    },
    {
      type: "transaction.upsert",
      id: "shared-edit",
      transactionId: "alan-october-utilities",
      accountId: "checking",
      categoryId: "utilities",
      sharedCategoryId: "shared-utilities",
      date: "2026-10-05",
      expenseMonth: currentMonth,
      amount: -13_000,
      payee: "Corrected shared utilities",
      shares: { alan: 8_000, partner: 5_000 },
    },
    {
      type: "card.payment",
      id: "pay-card",
      cashAccountId: "checking",
      cardAccountId: "card",
      date: "2026-10-10",
      amount: 5_000,
    },
    {
      type: "card.credit",
      id: "card-benefit-credit",
      reimbursementId: "card-benefit",
      accountId: "card",
      date: "2026-10-10",
      amount: 1_000,
    },
    {
      type: "loan.payment",
      id: "loan-payment",
      loanId: "personal-loan",
      accountId: "checking",
      date: "2026-10-10",
      principal: 2_000,
      interest: 100,
    },
    {
      type: "loan.rate",
      id: "loan-rate",
      loanId: "personal-loan",
      effectiveDate: "2026-10-01",
      annualRateBps: 750,
    },
    {
      type: "transaction.remove",
      id: "remove-own-shared-expense",
      transactionId: "alan-october-utilities",
    },
    {
      type: "transaction.approve",
      id: "approve-own-shared-expense",
      transactionIds: ["alan-october-utilities"],
    },
    {
      type: "target.set",
      id: "target",
      categoryId: "rent",
      target: {
        cadence: "monthly",
        behavior: "refill",
        amount: 75_000,
        startMonth,
        snoozedMonths: [],
      },
    },
  ];
  for (const month of [startMonth, "2026-10", currentMonth, "2026-12"])
    for (const command of commands)
      expectParity(setup.book, command, "alan", month);
});

void test("future assignments constrain connected previews under the same accounting rules", () => {
  const setup = historyFixture();
  const view = projectBook(setup.book, "alan", "2026-10", currentMonth);
  const command: Command = {
    type: "assign",
    id: "overassign-future",
    categoryId: "food",
    month: "2026-10",
    amount: view.readyToAssign,
  };
  assert.throws(() => execute(setup.book, "alan", command), /future month/);
  assert.throws(
    () => previewBudgetProjection(view, command, currentMonth),
    /future month/,
  );
});

void test("both actors preview partial repayments and receipts at their actual cutoff", () => {
  const setup = historyFixture();
  expectParity(setup.book, {
    type: "settlement.record",
    id: "partial-october",
    settlementId: "partial-october",
    otherUserId: "partner",
    accountId: "checking",
    date: "2026-10-20",
    amount: 10_000,
  });
  const unpaid = household();
  unpaid.run({
    type: "opening.add",
    obligationId: "debt",
    sharedCategoryId: "shared-rent",
    debtorId: "alan",
    creditorId: "partner",
    amount: 10_000,
  });
  unpaid.run({
    type: "settlement.record",
    settlementId: "awaiting-receipt",
    otherUserId: "partner",
    accountId: "checking",
    date: "2026-09-25",
    amount: 10_000,
  });
  const receipt: Command = {
    type: "settlement.receive",
    id: "confirm-receipt",
    settlementId: "awaiting-receipt",
    accountId: "PRIVATE_PARTNER_ACCOUNT_ID",
    date: "2026-10-02",
  };
  const september = expectParity(unpaid.book, receipt, "partner", startMonth);
  const october = expectParity(unpaid.book, receipt, "partner", "2026-10");
  assert.equal(september.sharedStatement.repayments[0]?.receivedOn, undefined);
  assert.equal(september.sharedStatement.awaitingYourConfirmation.length, 1);
  assert.equal(october.sharedStatement.awaitingYourConfirmation.length, 0);
  assert.equal(october.earnings, 0);
});

void test("zero-net settlements release mutual category reserves without inventing cash", () => {
  const setup = household();
  for (const [debtorId, creditorId, category] of [
    ["alan", "partner", "rent"],
    ["partner", "alan", "utilities"],
  ] as const)
    setup.run({
      type: "opening.add",
      obligationId: `opening-${category}`,
      sharedCategoryId: `shared-${category}`,
      debtorId,
      creditorId,
      amount: 10_000,
    });
  const before = projectBook(setup.book, "alan", startMonth, currentMonth);
  const after = expectParity(
    setup.book,
    {
      type: "settlement.record",
      id: "zero-net",
      settlementId: "zero-net",
      otherUserId: "partner",
      date: "2026-09-15",
      amount: 0,
    },
    "alan",
    startMonth,
  );
  assert.equal(after.cash, before.cash);
  assert.equal(after.readyToAssign, before.readyToAssign + 10_000);
  assert.equal(after.settlement.net, 0);
});

void test("shared rule changes, opening balances and unused category removal preserve projection parity", () => {
  const setup = historyFixture();
  expectParity(
    setup.book,
    {
      type: "shared.rule",
      id: "change-shares",
      sharedCategoryId: "shared-rent",
      weights: { alan: 3, partner: 1 },
    },
    "alan",
    startMonth,
  );
  expectParity(setup.book, {
    type: "opening.add",
    id: "new-opening",
    obligationId: "new-opening",
    sharedCategoryId: "shared-rent",
    debtorId: "partner",
    creditorId: "alan",
    amount: 7_000,
  });
  expectParity(setup.book, {
    type: "shared.remove",
    id: "remove-unused",
    sharedCategoryId: "shared-unused",
  });
});

void test("sharing a category previews the same actor result for new or existing partner categories", () => {
  for (const existingPartnerCategory of [false, true]) {
    const setup = household();
    if (existingPartnerCategory)
      setup.run(
        {
          type: "category.add",
          categoryId: "partner-food",
          name: "Partner food",
        },
        "partner",
      );
    const predicted = expectParity(setup.book, {
      type: "shared.create",
      id: "share-food",
      sharedCategoryId: "shared-food",
      participants: ["alan", "partner"],
      weights: { alan: 3, partner: 2 },
      categoryIds: { alan: "food", partner: "partner-food" },
    });
    assert.deepEqual(
      predicted.sharedCategories.find(
        (category) => category.id === "shared-food",
      ),
      {
        id: "shared-food",
        name: "food",
        participants: ["alan", "partner"],
        weights: { alan: 3, partner: 2 },
        categoryIds: { alan: "food", partner: "partner-food" },
      },
    );
  }
});

void test("settled shared expenses cannot be reduced or moved past the recorded payment", () => {
  const setup = historyFixture();
  const before = projectBook(setup.book, "partner", "2026-10", currentMonth);
  for (const correction of [
    { amount: -1, date: "2026-09-03" },
    { amount: -100_000, date: "2026-10-03" },
  ]) {
    const command: Command = {
      type: "transaction.upsert",
      id: `invalid-correction-${correction.date}`,
      transactionId: "partner-rent-september",
      accountId: "PRIVATE_PARTNER_ACCOUNT_ID",
      categoryId: "partner-rent",
      sharedCategoryId: "shared-rent",
      payee: "Shared September rent",
      ...correction,
    };
    assert.throws(() => execute(setup.book, "partner", command), /settlement/);
    assert.throws(
      () => previewBudgetProjection(before, command, currentMonth),
      /settlement/,
    );
  }
});

void test("removed partner purchases still prevent deleting their shared category", () => {
  const setup = household();
  setup.run(
    {
      type: "transaction.upsert",
      transactionId: "removed-shared",
      accountId: "PRIVATE_PARTNER_ACCOUNT_ID",
      categoryId: "partner-unused",
      sharedCategoryId: "shared-unused",
      date: "2026-09-03",
      amount: -100,
      payee: "Shared purchase later removed",
    },
    "partner",
  );
  setup.run(
    { type: "transaction.remove", transactionId: "removed-shared" },
    "partner",
  );
  const view = projectBook(setup.book, "alan", startMonth, currentMonth);
  assert.equal(view.sharedLedger.partnerPurchases.length, 0);
  assert.ok(
    view.sharedLedger.partnerActivityCategoryIds.includes("shared-unused"),
  );
  const command: Command = {
    type: "shared.remove",
    id: "remove-recorded",
    sharedCategoryId: "shared-unused",
  };
  assert.throws(
    () => execute(setup.book, "alan", command),
    /recorded activity/,
  );
  assert.throws(
    () => previewBudgetProjection(view, command, currentMonth),
    /recorded activity/,
  );
});

void test("actor membership and access to shared participants are required", () => {
  const setup = household();
  assert.throws(
    () => projectBook(setup.book, "intruder", startMonth),
    /access denied/,
  );
  const view = projectBook(setup.book, "alan", startMonth, currentMonth);
  const command: Command = {
    type: "assign",
    id: "intruder-assignment",
    categoryId: "food",
    month: startMonth,
    amount: 1,
  };
  assert.throws(
    () =>
      previewBudgetProjection(
        {
          ...view,
          budget: { ...view.budget, userId: "intruder" },
        },
        command,
        currentMonth,
      ),
    /access|member/i,
  );
  for (const unauthorized of [
    {
      type: "shared.create",
      id: "outsider-category",
      sharedCategoryId: "outsider-category",
      participants: ["alan", "intruder"],
      weights: { alan: 1, intruder: 1 },
      categoryIds: { alan: "food", intruder: "outsider-food" },
    },
    {
      type: "settlement.record",
      id: "outsider-settlement",
      settlementId: "outsider-settlement",
      otherUserId: "intruder",
      date: "2026-09-20",
      amount: 0,
    },
    {
      type: "opening.add",
      id: "outsider-opening",
      obligationId: "outsider-opening",
      sharedCategoryId: "shared-rent",
      debtorId: "intruder",
      creditorId: "alan",
      amount: 100,
    },
  ] satisfies Command[]) {
    assert.throws(() => execute(setup.book, "alan", unauthorized));
    assert.throws(() =>
      previewBudgetProjection(view, unauthorized, currentMonth),
    );
  }
});

void test("unreceived settlements with object-property IDs remain unconfirmed", () => {
  for (const settlementId of ["constructor", "toString", "__proto__"]) {
    const setup = household();
    setup.run({
      type: "opening.add",
      obligationId: "opening",
      sharedCategoryId: "shared-rent",
      debtorId: "alan",
      creditorId: "partner",
      amount: 1_000,
    });
    setup.run({
      type: "settlement.record",
      settlementId,
      otherUserId: "partner",
      accountId: "checking",
      date: "2026-09-15",
      amount: 1_000,
    });
    const predicted = expectParity(
      setup.book,
      {
        type: "assign",
        id: "assignment-after-payment",
        categoryId: "food",
        month: startMonth,
        amount: 1_000,
      },
      "alan",
      startMonth,
    );
    assert.deepEqual(predicted.sharedLedger.partnerReceiptDates, {});
    assert.equal(
      predicted.sharedStatement.repayments[0]?.receivedOn,
      undefined,
    );
  }
});
