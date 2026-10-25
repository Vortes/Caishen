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
        { kind: "partner", balance: 0 },
        { kind: "reimbursements", balance: 0 },
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
        type: "transaction.upsert",
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
      accountId: "counterparty:reimbursements",
      counterpartyName: "Mom",
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
    view.accounts.find((item) => item.kind === "reimbursements")!.balance,
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
      accountId: "counterparty:reimbursements",
      counterpartyName: "Mom",
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
    counterpartyAccountId: "counterparty:reimbursements",
    cashAccountId: "checking",
    counterpartyName: "Mom",
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
      accountId: "counterparty:reimbursements",
      counterpartyName: "Mom",
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
    view.accounts.find((item) => item.kind === "reimbursements")!.balance,
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
    accountId: "counterparty:reimbursements",
    counterpartyName: "Mom",
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
    budget.view().accounts.find((item) => item.kind === "reimbursements")!
      .balance,
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
          accountId: "counterparty:reimbursements",
          counterpartyName: "Mom",
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
    view.accounts.find((item) => item.kind === "reimbursements")!.balance,
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
      accountId: "counterparty:reimbursements",
      counterpartyName: "Mom",
      amount: 1_154,
    },
  });
  const restored = rowsToBook(bookToRows(budget.book)).budgets.alan!;
  const next = { payee: "NOODLES PLUS", accountId: "checking", amount: -2_000 };
  assert.equal(rememberedCategory(restored, next), undefined);
  assert.deepEqual(rememberedCounterpartyShare(restored, next), {
    accountId: "counterparty:reimbursements",
    counterpartyName: "Mom",
    amount: 2_000,
  });
  assert.equal(
    rememberedCounterpartyShare(restored, { ...next, amount: 2_000 }),
    undefined,
  );
});

void test("a fully shared recorded partner purchase matches its bank import without a payer category", () => {
  let book = withCounterpartyAccounts(
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
    view.accounts.find((item) => item.kind === "partner")!.balance,
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
      accountId: "counterparty:reimbursements",
      counterpartyName: "Mom",
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
    view.accounts.find((item) => item.kind === "reimbursements")!.balance,
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
        accountId: "counterparty:reimbursements",
        counterpartyName: ["Mom", "Dad", "Friend"][index]!,
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
    view.accounts.find((item) => item.kind === "reimbursements")!.balance,
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
      accountId: "counterparty:reimbursements",
      counterpartyName: "Mom",
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
