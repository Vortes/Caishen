import assert from "node:assert/strict";
import test from "node:test";
import {
  addMember,
  createBook,
  execute,
  type Book,
  type Command,
} from "../../src/domain/engine";
import { personalSpendingEntries } from "../../src/domain/spending";

const month = "2026-10";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

function household() {
  let book: Book = addMember(
    createBook("alan", "Alan", month),
    "partner",
    "Partner",
    month,
  );
  let sequence = 0;
  const run = (command: WithoutId<Command>, actor = "alan") => {
    book = execute(book, actor, { ...command, id: `op-${++sequence}` }, "user");
  };
  run({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 500_000,
  });
  run(
    {
      type: "account.add",
      accountId: "partner-cash",
      name: "Partner bank",
      kind: "cash",
      openingBalance: 500_000,
    },
    "partner",
  );
  run({ type: "category.add", categoryId: "food", name: "Food" });
  run({ type: "category.add", categoryId: "rent", name: "Rent" });
  run({
    type: "shared.create",
    sharedCategoryId: "shared-rent",
    participants: ["alan", "partner"],
    weights: { alan: 1, partner: 1 },
    categoryIds: { alan: "rent", partner: "partner-rent" },
  });
  return { run, entries: () => personalSpendingEntries(book, "alan") };
}

void test("purchases count in full, and refunds in the same category net against them", () => {
  const setup = household();
  setup.run({
    type: "transaction.upsert",
    transactionId: "groceries",
    accountId: "checking",
    date: "2026-10-04",
    amount: -8_000,
    payee: "Market",
    categoryId: "food",
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "return",
    accountId: "checking",
    date: "2026-10-06",
    amount: 1_500,
    payee: "Market",
    categoryId: "food",
  });
  assert.deepEqual(
    setup.entries().map(({ transactionId, categoryId, accountId, amount }) => ({
      transactionId,
      categoryId,
      accountId,
      amount,
    })),
    [
      {
        transactionId: "groceries",
        categoryId: "food",
        accountId: "checking",
        amount: 8_000,
      },
      {
        transactionId: "return",
        categoryId: "food",
        accountId: "checking",
        amount: -1_500,
      },
    ],
  );
});

void test("shared expenses count only your share, including ones your partner paid", () => {
  const setup = household();
  setup.run(
    {
      type: "transaction.upsert",
      transactionId: "rent",
      accountId: "partner-cash",
      date: "2026-10-01",
      amount: -200_000,
      payee: "Landlord",
      categoryId: "partner-rent",
      sharedCategoryId: "shared-rent",
    },
    "partner",
  );
  const [entry] = setup.entries();
  assert.equal(entry?.amount, 100_000);
  assert.equal(entry?.paidByYou, false);
  assert.equal(entry?.categoryId, "rent");
  assert.equal(entry?.accountId, undefined);
});

void test("only loan interest is spending, and income is not", () => {
  const setup = household();
  setup.run({
    type: "loan.add",
    loanId: "student",
    categoryId: "student-payment",
    name: "Student loan",
    principal: 1_000_000,
    annualRateBps: 600,
    minimumPayment: 50_000,
    variable: false,
    effectiveDate: "2026-10-01",
  });
  setup.run({
    type: "assign",
    categoryId: "student-payment",
    month,
    amount: 50_000,
  });
  setup.run({
    type: "loan.payment",
    loanId: "student",
    accountId: "checking",
    date: "2026-10-15",
    principal: 45_000,
    interest: 5_000,
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "paycheck",
    accountId: "checking",
    date: "2026-10-15",
    amount: 300_000,
    payee: "Employer",
  });
  assert.deepEqual(
    setup.entries().map(({ categoryId, amount }) => ({ categoryId, amount })),
    [{ categoryId: "student-payment", amount: 5_000 }],
  );
});

void test("entries fall in their expense period rather than their payment date", () => {
  const setup = household();
  setup.run({
    type: "transaction.upsert",
    transactionId: "early-rent",
    accountId: "checking",
    date: "2026-10-28",
    amount: -150_000,
    payee: "Landlord",
    categoryId: "rent",
    expenseMonth: "2026-11",
  });
  assert.equal(setup.entries()[0]?.month, "2026-11");
});

void test("removed purchases no longer count as personal spending", () => {
  const setup = household();
  for (const [transactionId, amount] of [
    ["kept", -2_000],
    ["removed", -8_000],
  ] as const)
    setup.run({
      type: "transaction.upsert",
      transactionId,
      accountId: "checking",
      date: "2026-10-04",
      amount,
      payee: "Market",
      categoryId: "food",
    });
  assert.deepEqual(
    setup.entries().map(({ amount }) => amount),
    [2_000, 8_000],
  );
  setup.run({ type: "transaction.remove", transactionId: "removed" });
  assert.deepEqual(
    setup
      .entries()
      .map(({ transactionId, amount }) => ({ transactionId, amount })),
    [{ transactionId: "kept", amount: 2_000 }],
  );
});
