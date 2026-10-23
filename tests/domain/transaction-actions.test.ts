import assert from "node:assert/strict";
import test from "node:test";
import {
  createBook,
  execute,
  projectBook,
  type Command,
} from "../../src/domain/engine";

type Scenario = {
  source: "manual" | "bank";
  status: "pending" | "posted";
};

const scenarios: Scenario[] = [
  { source: "manual", status: "pending" },
  { source: "manual", status: "posted" },
  { source: "bank", status: "pending" },
  { source: "bank", status: "posted" },
];

function purchaseAndRefund({ source, status }: Scenario) {
  let book = createBook("owner", "Row actions", "2026-10");
  const setup: Command[] = [
    {
      type: "account.add",
      id: "account",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      openingBalance: 100_000,
    },
    { type: "category.add", id: "gifts", categoryId: "gifts", name: "Gifts" },
    { type: "category.add", id: "food", categoryId: "food", name: "Food" },
  ];
  for (const command of setup) book = execute(book, "owner", command);
  book = execute(
    book,
    "owner",
    {
      type: "transaction.upsert",
      id: "purchase",
      transactionId: "purchase",
      accountId: "checking",
      date: "2026-10-10",
      payee: "Coffee",
      amount: -2500,
      categoryId: "gifts",
      status,
      reviewed: false,
      ...(source === "bank" ? { providerId: "bank-purchase" } : {}),
    },
    source === "bank" ? "provider" : "user",
  );
  return execute(
    book,
    "owner",
    {
      type: "transaction.upsert",
      id: "refund",
      transactionId: "refund",
      accountId: "checking",
      date: "2026-10-11",
      payee: "Coffee refund",
      amount: 1000,
      refundOfTransactionId: "purchase",
      status,
      reviewed: false,
      ...(source === "bank" ? { providerId: "bank-refund" } : {}),
    },
    source === "bank" ? "provider" : "user",
  );
}

for (const scenario of scenarios) {
  void test(`a ${scenario.status} ${scenario.source} linked refund is categorized through its original purchase`, () => {
    const book = purchaseAndRefund(scenario);
    assert.throws(
      () =>
        execute(book, "owner", {
          type: "transaction.categorize.batch",
          id: "categorize-refund",
          transactionIds: ["refund"],
          categoryId: "food",
        }),
      /Edit the original purchase/,
    );
    const changed = execute(book, "owner", {
      type: "transaction.categorize.batch",
      id: "categorize-purchase",
      transactionIds: ["purchase"],
      categoryId: "food",
    });
    const view = projectBook(changed, "owner", "2026-10");
    assert.deepEqual(
      view.budget.transactions.map(({ id, categoryId, status }) => ({
        id,
        categoryId,
        status,
      })),
      [
        { id: "purchase", categoryId: "food", status: scenario.status },
        { id: "refund", categoryId: "food", status: scenario.status },
      ],
    );
    assert.equal(
      view.accounts.find(({ id }) => id === "checking")!.balance,
      scenario.status === "pending" ? 97_500 : 98_500,
    );
  });
}

for (const scenario of scenarios) {
  void test(`approval can be repeated for ${scenario.status} ${scenario.source} transactions without changing their money`, () => {
    const book = purchaseAndRefund(scenario);
    const approved = execute(book, "owner", {
      type: "transaction.approve",
      id: "approve",
      transactionIds: ["purchase", "refund"],
    });
    const repeated = execute(approved, "owner", {
      type: "transaction.approve",
      id: "approve-again",
      transactionIds: ["purchase", "refund"],
    });
    const view = projectBook(repeated, "owner", "2026-10");
    assert.deepEqual(
      view.budget.transactions.map(({ id, reviewed, amount, status }) => ({
        id,
        reviewed,
        amount,
        status,
      })),
      [
        {
          id: "purchase",
          reviewed: true,
          amount: -2500,
          status: scenario.status,
        },
        { id: "refund", reviewed: true, amount: 1000, status: scenario.status },
      ],
    );
    assert.equal(
      view.accounts.find(({ id }) => id === "checking")!.balance,
      scenario.status === "pending" ? 97_500 : 98_500,
    );
  });
}

for (const scenario of scenarios) {
  void test(`a ${scenario.status} ${scenario.source} purchase is rejected only after its linked refund`, () => {
    const book = purchaseAndRefund(scenario);
    assert.throws(
      () =>
        execute(book, "owner", {
          type: "transaction.reject",
          id: "reject-purchase-first",
          transactionIds: ["purchase"],
        }),
      /Remove linked refunds before rejecting/,
    );
    const withoutRefund = execute(book, "owner", {
      type: "transaction.reject",
      id: "reject-refund",
      transactionIds: ["refund"],
    });
    const remaining = projectBook(withoutRefund, "owner", "2026-10");
    assert.deepEqual(
      remaining.budget.transactions
        .filter((item) => !item.removed)
        .map(({ id }) => id),
      ["purchase"],
    );
    assert.equal(
      remaining.accounts.find(({ id }) => id === "checking")!.balance,
      97_500,
    );
    const rejected = execute(withoutRefund, "owner", {
      type: "transaction.reject",
      id: "reject-purchase",
      transactionIds: ["purchase"],
    });
    const view = projectBook(rejected, "owner", "2026-10");
    assert.equal(
      view.budget.transactions.filter((item) => !item.removed).length,
      0,
    );
    assert.equal(
      view.accounts.find(({ id }) => id === "checking")!.balance,
      100_000,
    );
  });
}

void test("F4: changed opening history is not recordable even without a prose error", async () => {
  const { transactionActions } =
    await import("../../src/components/transactions/transaction-actions");
  const book = purchaseAndRefund({ source: "manual", status: "posted" });
  const item = {
    eligibility: "opening_snapshot_changed" as const,
    connectionId: "bank",
    logicalId: "opening",
    fingerprint: "a".repeat(64),
    providerAccountId: "provider",
    accountId: "checking",
    date: "2026-10-10",
    payee: "Opening history",
    amount: -2500,
    pending: false,
    removed: false,
    needsMatchReview: false,
    error: null,
    history: [],
    reviewEvidence: [],
    quarantined: false,
    categoryName: null,
    categoryId: undefined,
    transactionId: undefined,
  };
  const actions = transactionActions(
    projectBook(book, "owner", "2026-10"),
    item,
  );
  assert.equal(actions.edit, null);
  assert.equal(actions.select, false);
});
