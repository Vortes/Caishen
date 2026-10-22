import assert from "node:assert/strict";
import test from "node:test";
import {
  addMember,
  createBook,
  execute,
  projectBook,
  withCounterpartyAccounts,
  type Book,
  type Command,
} from "../../src/domain/engine";

const month = "2026-10";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

// A personal budget with $1,000 in checking and its counterparty accounts.
function solo() {
  let book = withCounterpartyAccounts(createBook("alan", "Alan", month));
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
      .filter((account) => ["partner", "reimbursements"].includes(account.kind))
      .map(({ kind, balance }) => ({ kind, balance })),
    envelopes: view.categories
      .filter((category) => category.counterpartyAccountId)
      .map(({ name, group, counterpartyAccountId }) => ({
        name,
        group,
        pairedKind: view.accounts.find(
          (account) => account.id === counterpartyAccountId,
        )?.kind,
      })),
  };
};

void test("a personal budget has a reimbursements account and its paired envelope in People", () => {
  const book = withCounterpartyAccounts(createBook("alan", "Alan", month));

  assert.deepEqual(people(book, "alan"), {
    accounts: [{ kind: "reimbursements", balance: 0 }],
    envelopes: [
      { name: "Reimbursements", group: "People", pairedKind: "reimbursements" },
    ],
  });
});

void test("partners each get a partner account and envelope, and adding them again changes nothing", () => {
  const book = withCounterpartyAccounts(
    addMember(createBook("alan", "Alan", month), "anna", "Anna", month),
  );

  for (const userId of ["alan", "anna"])
    assert.deepEqual(people(book, userId), {
      accounts: [
        { kind: "reimbursements", balance: 0 },
        { kind: "partner", balance: 0 },
      ],
      envelopes: [
        {
          name: "Reimbursements",
          group: "People",
          pairedKind: "reimbursements",
        },
        { name: "Partner", group: "People", pairedKind: "partner" },
      ],
    });
  assert.deepEqual(withCounterpartyAccounts(book), book);
});

void test("a float assigned to the Reimbursements envelope comes out of Ready to Assign and stays available", () => {
  const budget = solo();
  assert.equal(budget.view().readyToAssign, 100_000);

  budget.run({
    type: "assign.set",
    categoryId: "envelope:reimbursements",
    month,
    amount: 20_000,
  });

  const envelope = (view: ReturnType<typeof budget.view>) =>
    view.categories.find((item) => item.id === "envelope:reimbursements")!;
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
    () => budget.run({ ...purchase, categoryId: "envelope:reimbursements" }),
    /paired envelope/,
  );
  budget.run(purchase);
  assert.throws(
    () =>
      budget.run({
        type: "transaction.categorize",
        transactionId: "lunch",
        categoryId: "envelope:reimbursements",
      }),
    /paired envelope/,
  );
  assert.throws(
    () =>
      budget.run({
        type: "transaction.categorize.batch",
        transactionIds: ["lunch"],
        categoryId: "envelope:reimbursements",
      }),
    /paired envelope/,
  );
});

void test("nothing is recorded on a counterparty account directly", () => {
  const budget = solo();
  const entry = /come from shares and settlements/;

  assert.throws(
    () =>
      budget.run({
        type: "transaction.upsert",
        transactionId: "owed",
        accountId: "counterparty:reimbursements",
        date: "2026-10-05",
        amount: 4_000,
        payee: "Sam",
      }),
    entry,
  );
  assert.throws(
    () =>
      budget.run({
        type: "transaction.save",
        transactionId: "repaid",
        accountId: "checking",
        transferAccountId: "counterparty:reimbursements",
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
        accountId: "counterparty:reimbursements",
        date: "2026-10-05",
        balance: 4_000,
        adjustmentId: "adjust",
      }),
    entry,
  );
  assert.equal(budget.view().readyToAssign, 100_000);
});
