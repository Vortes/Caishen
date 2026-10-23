import assert from "node:assert/strict";
import test from "node:test";
import {
  createBook,
  execute,
  projectBook,
  bookSchema,
  type Command,
  type Book,
} from "../../src/domain/engine";
import {
  READY_TO_ASSIGN,
  transferCounterparts,
} from "../../src/domain/transfers";
import {
  createTransactionDraft,
  buildTransactionDraftCommand,
  type TransactionDraft,
} from "../../src/components/transactions/transaction-draft";
import {
  applyChangeSet,
  executeRevert,
  toRowSet,
} from "../../src/domain/change-sets";
import { bookToRows, diffRows, type ChangeSet } from "../../src/domain/rows";

// Undo as a revert of what changed from one book to the next (ADR 0006).
function undo(before: Book, after: Book, id: string) {
  const rows = toRowSet(bookToRows(after));
  const target: ChangeSet = {
    operationId: `edit-${id}`,
    revision: 1,
    ...diffRows(bookToRows(before), bookToRows(after)),
  };
  const reverted = executeRevert(
    rows,
    { type: "revert", id, targetOperationId: target.operationId },
    target,
  );
  return {
    book: reverted.book as Book,
    redo: () =>
      executeRevert(
        applyChangeSet(rows, reverted.changeSet),
        { type: "revert", id: `redo-${id}`, targetOperationId: id },
        reverted.changeSet,
      ).book as Book,
  };
}

const month = "2026-10";
const date = `${month}-10`;
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

void test("a balance transfer carries existing payment reserves with the debt", () => {
  const f = fixture();
  const before = f.view().readyToAssign;
  f.save({ accountId: "amex", transferAccountId: "visa", outflow: "50" });
  assert.equal(
    f.view().accounts.find((item) => item.id === "visa")!.reserve,
    15000,
  );
  assert.equal(
    f.view().accounts.find((item) => item.id === "amex")!.reserve,
    15000,
  );
  assert.equal(f.view().readyToAssign, before);
});
function fixture() {
  let book = createBook("owner", "Budget", month);
  let sequence = 0;
  const run = (command: WithoutId<Command>) => {
    book = execute(book, "owner", { ...command, id: `op-${++sequence}` });
    return book;
  };
  for (const [id, name, kind, balance] of [
    ["checking", "Checking", "cash", 200_000],
    ["savings", "Savings", "cash", 50_000],
    ["visa", "Visa", "credit", -20_000],
    ["amex", "Amex", "credit", -10_000],
    ["brokerage", "Brokerage", "tracking", 2_000_000],
    ["retirement", "Retirement", "tracking", 1_000_000],
  ] as const)
    run({
      type: "account.add",
      accountId: id,
      name,
      kind,
      openingBalance: balance,
    });
  run({ type: "category.add", categoryId: "investing", name: "Investing" });
  run({ type: "assign", categoryId: "investing", month, amount: 50_000 });
  run({ type: "assign", categoryId: "card:visa", month, amount: 20_000 });
  run({ type: "assign", categoryId: "card:amex", month, amount: 10_000 });
  run({
    type: "loan.add",
    loanId: "loan",
    categoryId: "loan-category",
    name: "Student loan",
    principal: 100_000,
    annualRateBps: 500,
    minimumPayment: 5_000,
    variable: false,
    effectiveDate: `${month}-01`,
  });
  const view = () => projectBook(book, "owner", month);
  const transaction = (id: string) =>
    view().budget.transactions.find((item) => item.id === id)!;
  const save = (changes: Partial<TransactionDraft>, id?: string) => {
    const before = id ? transaction(id) : undefined;
    const draft = {
      ...createTransactionDraft(view(), month, before, "checking"),
      date,
      payee: "Transfer",
      outflow: "50.00",
      ...changes,
    };
    const command = buildTransactionDraftCommand({
      draft,
      view: view(),
      transaction: before,
      operationId: `save-${++sequence}`,
      entityId: `tx-${sequence}`,
    });
    book = execute(book, "owner", command);
    return transaction(command.transactionId);
  };
  return {
    run,
    view,
    save,
    transaction,
    get book() {
      return book;
    },
  };
}

void test("cash transfers conserve budget money and edit either side with one history step", () => {
  const f = fixture();
  const before = f.view();
  const sent = f.save({ transferAccountId: "savings" });
  const received = transferCounterparts(f.view().budget, sent)[0]!;
  assert.equal(sent.payee, "Transfer to Savings");
  assert.equal(received.payee, "Transfer from Checking");
  assert.equal(f.view().cash, before.cash);
  assert.equal(f.view().readyToAssign, before.readyToAssign);
  assert.equal(f.view().personalSpending, 0);
  const original = f.book;
  f.save({ outflow: "", inflow: "75.01", date: `${month}-11` }, received.id);
  assert.equal(f.transaction(sent.id).amount, -7501);
  assert.equal(f.transaction(sent.id).date, `${month}-11`);
  assert.equal(f.transaction(sent.id).revision, 2);
  const undone = undo(original, f.book, "undo-transfer");
  assert.equal(
    undone.book.budgets.owner!.transactions.find((item) => item.id === sent.id)!
      .amount,
    -5000,
  );
  const redone = { book: undone.redo() };
  assert.equal(
    redone.book.budgets.owner!.transactions.find(
      (item) => item.id === received.id,
    )!.amount,
    7501,
  );
  assert.doesNotThrow(() => bookSchema.parse(redone.book));
});

void test("legacy card payment edits preserve both IDs and consume reserve without new spending", () => {
  const f = fixture();
  f.run({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "visa",
    date,
    amount: 5000,
  });
  const original = f
    .view()
    .budget.transactions.find((item) => item.accountId === "visa")!;
  const sent = transferCounterparts(f.view().budget, original)[0]!;
  f.save({ inflow: "65.00", outflow: "" }, original.id);
  assert.equal(f.transaction(sent.id).amount, -6500);
  assert.equal(f.transaction(original.id).payee, "Payment from Checking");
  assert.equal(
    f.view().accounts.find((item) => item.id === "visa")!.reserve,
    13500,
  );
  assert.equal(f.view().personalSpending, 0);
  const before = f.book;
  assert.throws(
    () => f.save({ inflow: "201.00", outflow: "" }, original.id),
    /reserve or card debt/,
  );
  assert.deepEqual(f.book, before);
});

void test("import conversion preserves bank identity and approval propagates to both transfer entries", () => {
  const f = fixture();
  f.run({
    type: "transaction.upsert",
    transactionId: "import",
    accountId: "checking",
    date,
    amount: -5000,
    payee: "ONLINE TRANSFER",
    providerId: "bank-42",
    reviewed: false,
  });
  const sent = f.save({ transferAccountId: "savings" }, "import");
  const received = transferCounterparts(f.view().budget, sent)[0]!;
  assert.equal(sent.providerId, "bank-42");
  assert.equal(sent.reviewed, false);
  assert.equal(received.reviewed, false);
  const command: Command = {
    type: "transaction.approve",
    id: "approve",
    transactionIds: [received.id],
  };
  f.run(command);
  assert.equal(f.transaction(sent.id).reviewed, true);
  f.save(
    { transferAccountId: "", payee: "Merchant", categoryId: "investing" },
    sent.id,
  );
  assert.equal(f.transaction(sent.id).kind, "purchase");
  assert.equal(f.transaction(sent.id).providerId, "bank-42");
  assert.equal(f.transaction(received.id).removed, true);
  assert.equal(f.view().personalSpending, 5000);
});

void test("changing destination retires the old counterpart and stale saves cannot rewrite a pair", () => {
  const f = fixture();
  const original = f.save({ transferAccountId: "savings" });
  const other = transferCounterparts(f.view().budget, original)[0]!;
  const draft = createTransactionDraft(f.view(), month, other);
  f.save({ transferAccountId: "visa" }, original.id);
  assert.equal(f.transaction(other.id).removed, true);
  assert.equal(f.transaction(original.id).kind, "card-payment");
  assert.throws(
    () =>
      execute(
        f.book,
        "owner",
        buildTransactionDraftCommand({
          draft,
          view: f.view(),
          transaction: other,
          operationId: "stale",
          entityId: "unused",
        }),
      ),
    /removed/,
  );
  assert.equal(
    f.view().budget.transactions.filter((item) => !item.removed).length,
    2,
  );
});

void test("tracking assets and activity never enter budget cash or spending", () => {
  const f = fixture();
  assert.equal(f.view().cash, 250_000);
  assert.equal(f.view().readyToAssign, 170_000);
  f.save({
    accountId: "brokerage",
    transferAccountId: "retirement",
    outflow: "1000",
  });
  assert.equal(f.view().cash, 250_000);
  assert.equal(f.view().readyToAssign, 170_000);
  f.save({
    accountId: "brokerage",
    payee: "Dividend",
    outflow: "",
    inflow: "25",
  });
  assert.equal(f.view().earnings, 0);
  f.save({ accountId: "brokerage", payee: "Trade fee", outflow: "5" });
  assert.equal(f.view().personalSpending, 0);
});

void test("brokerage transfers require a category and spend it once, even when edited from tracking", () => {
  const f = fixture();
  assert.throws(() => f.save({ transferAccountId: "brokerage" }), /category/);
  const sent = f.save({
    transferAccountId: "brokerage",
    categoryId: "investing",
  });
  const received = transferCounterparts(f.view().budget, sent)[0]!;
  assert.equal(
    f.view().categories.find((item) => item.id === "investing")!.available,
    45_000,
  );
  assert.equal(f.view().personalSpending, 5000);
  assert.equal(f.view().readyToAssign, 170_000);
  f.save({ outflow: "", inflow: "60.00" }, received.id);
  assert.equal(
    f.view().categories.find((item) => item.id === "investing")!.available,
    44_000,
  );
  assert.equal(f.view().personalSpending, 6000);
  assert.equal(f.view().amountPaid, 6000);
  const deposit = f.save({
    accountId: "brokerage",
    transferAccountId: "checking",
    outflow: "20",
    categoryId: READY_TO_ASSIGN,
  });
  assert.equal(f.view().readyToAssign, 172_000);
  const draft = createTransactionDraft(f.view(), month, deposit);
  assert.equal(draft.categoryId, READY_TO_ASSIGN);

  const refund = f.save({
    transferAccountId: "brokerage",
    categoryId: "investing",
    outflow: "",
    inflow: "10",
  });
  const retired = transferCounterparts(f.view().budget, refund)[0]!;
  f.save(
    {
      transferAccountId: "",
      payee: "Other income",
      categoryId: READY_TO_ASSIGN,
      outflow: "",
      inflow: "10",
    },
    refund.id,
  );
  assert.equal(f.transaction(refund.id).kind, "income");
  assert.equal(f.transaction(refund.id).categoryId, undefined);
  assert.equal(f.transaction(retired.id).removed, true);
  assert.equal(f.view().readyToAssign, 173_000);
});

void test("loan edits change confirmed principal and interest, and conversion restores the loan", () => {
  const f = fixture();
  f.run({
    type: "loan.payment",
    loanId: "loan",
    accountId: "checking",
    date,
    principal: 4000,
    interest: 1000,
  });
  const original = f
    .view()
    .budget.transactions.find((item) => item.kind === "loan-payment")!;
  f.save({ outflow: "70", interest: "12" }, original.id);
  const loan = f.view().budget.loans[0]!;
  assert.equal(loan.payments.length, 1);
  assert.equal(loan.payments[0]!.principal, 5800);
  assert.equal(loan.payments[0]!.interest, 1200);
  assert.equal(f.view().personalSpending, 1200);
  f.save(
    { loanId: "", transferAccountId: "savings", categoryId: "", interest: "" },
    original.id,
  );
  assert.equal(f.view().budget.loans[0]!.payments.length, 0);
  assert.equal(f.view().personalSpending, 0);
});

void test("self transfers, foreign accounts, and overdrawing confirmed loan principal are refused atomically", () => {
  const f = fixture();
  const before = f.book;
  assert.throws(
    () => f.save({ transferAccountId: "checking" }),
    /different account/,
  );
  assert.throws(
    () => f.save({ transferAccountId: "foreign" }),
    /different account/,
  );
  assert.throws(
    () =>
      f.save({
        loanId: "loan",
        categoryId: "loan-category",
        outflow: "1001",
        interest: "0",
      }),
    /remaining loan balance/,
  );
  assert.deepEqual(f.book, before);
});

void test("rejecting an imported transfer removes both sides and undo restores the pair", () => {
  const f = fixture();
  f.run({
    type: "transaction.upsert",
    transactionId: "import",
    accountId: "checking",
    date,
    amount: -5000,
    payee: "Imported transfer",
    providerId: "bank-42",
    reviewed: false,
  });
  const sent = f.save({ transferAccountId: "savings" }, "import");
  const received = transferCounterparts(f.view().budget, sent)[0]!;
  const before = f.book;
  f.run({ type: "transaction.reject", transactionIds: [received.id, sent.id] });
  assert.equal(f.transaction(sent.id).removed, true);
  assert.equal(f.transaction(received.id).removed, true);
  assert.equal(f.transaction(sent.id).providerId, "bank-42");
  assert.equal(f.transaction(sent.id).revision, sent.revision + 1);
  assert.equal(
    f.view().accounts.find((item) => item.id === "checking")!.balance,
    200_000,
  );
  assert.equal(
    f.view().accounts.find((item) => item.id === "savings")!.balance,
    50_000,
  );
  const restored = undo(before, f.book, "undo-reject");
  const pair = restored.book.budgets.owner!.transactions.filter(
    (item) => item.linkedId === sent.linkedId,
  );
  assert.equal(pair.length, 2);
  assert.ok(pair.every((item) => !item.removed && !item.reviewed));
  assert.equal(
    projectBook(restored.book, "owner", month).accounts.find(
      (item) => item.id === "checking",
    )!.balance,
    195_000,
  );
});

void test("rejection refuses approved selections, foreign IDs and agent decisions without partial changes", () => {
  const f = fixture();
  f.run({
    type: "transaction.upsert",
    transactionId: "import",
    accountId: "checking",
    date,
    amount: -5000,
    payee: "Unreviewed",
    reviewed: false,
  });
  const approved = f.save({ payee: "Reviewed", categoryId: "investing" });
  const before = f.book;
  assert.throws(
    () =>
      f.run({
        type: "transaction.reject",
        transactionIds: ["import", approved.id],
      }),
    /Only unapproved/,
  );
  assert.throws(
    () =>
      f.run({
        type: "transaction.reject",
        transactionIds: ["import", "foreign"],
      }),
    /Transaction access denied/,
  );
  assert.throws(
    () =>
      execute(
        f.book,
        "owner",
        {
          type: "transaction.reject",
          id: "agent-reject",
          transactionIds: ["import"],
        },
        "agent",
      ),
    /user action/,
  );
  assert.deepEqual(f.book, before);
});

void test("rejecting converted payments restores card reserves and loan principal", () => {
  for (const destination of ["visa", "loan"]) {
    const f = fixture();
    f.run({
      type: "transaction.upsert",
      transactionId: "import",
      accountId: "checking",
      date,
      amount: -5000,
      payee: "Unreviewed payment",
      reviewed: false,
    });
    f.save(
      destination === "visa"
        ? { transferAccountId: "visa" }
        : { loanId: "loan", categoryId: "loan-category", interest: "10" },
      "import",
    );
    f.run({ type: "transaction.reject", transactionIds: ["import"] });
    assert.equal(
      f.view().accounts.find((item) => item.id === "visa")!.reserve,
      20_000,
    );
    assert.equal(f.view().budget.loans[0]!.payments.length, 0);
    assert.equal(
      f.view().accounts.find((item) => item.id === "checking")!.balance,
      200_000,
    );
    assert.equal(f.view().personalSpending, 0);
  }
});

void test("bulk categorization updates both brokerage sides once and rolls back invalid selections", () => {
  const f = fixture();
  f.run({ type: "category.add", categoryId: "other", name: "Other" });
  const sent = f.save({
    transferAccountId: "brokerage",
    categoryId: "investing",
  });
  const received = transferCounterparts(f.view().budget, sent)[0]!;
  const purchase = f.save({
    payee: "Merchant",
    categoryId: "investing",
    outflow: "20",
  });
  f.run({
    type: "transaction.categorize.batch",
    transactionIds: [sent.id, received.id, purchase.id],
    categoryId: "other",
  });
  assert.equal(f.transaction(sent.id).categoryId, "other");
  assert.equal(f.transaction(received.id).categoryId, "other");
  assert.equal(f.transaction(sent.id).revision, sent.revision + 1);
  assert.equal(f.transaction(received.id).revision, received.revision + 1);
  assert.equal(f.view().personalSpending, 7000);
  assert.equal(
    f.view().categories.find((item) => item.id === "other")!.activity,
    -7000,
  );
  const internal = f.save({ transferAccountId: "savings" });
  const before = f.book;
  assert.throws(
    () =>
      f.run({
        type: "transaction.categorize.batch",
        transactionIds: [purchase.id, internal.id],
        categoryId: "investing",
      }),
    /does not use a category/,
  );
  assert.deepEqual(f.book, before);
});
