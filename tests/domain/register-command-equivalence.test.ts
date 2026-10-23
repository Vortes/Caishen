import assert from "node:assert/strict";
import test from "node:test";
import {
  createBook,
  execute,
  executeWithChanges,
  projectBook,
  type Command,
} from "../../src/domain/engine";
import { bookToRows, type WireRow } from "../../src/domain/rows";

function fixture() {
  let book = createBook("a", "A", "2026-10");
  const commands: Command[] = [
    {
      type: "account.add",
      id: "cash",
      accountId: "cash",
      name: "Checking",
      kind: "cash",
      openingBalance: 100_000,
    },
    {
      type: "account.add",
      id: "other",
      accountId: "other",
      name: "Savings",
      kind: "cash",
      openingBalance: 0,
    },
    {
      type: "account.add",
      id: "card",
      accountId: "card",
      name: "Visa",
      kind: "credit",
      openingBalance: -20_000,
    },
    {
      type: "loan.add",
      id: "loan",
      loanId: "loan",
      categoryId: "loan-category",
      name: "Car",
      principal: 100_000,
      annualRateBps: 500,
      minimumPayment: 5000,
      variable: false,
      effectiveDate: "2026-10-01",
    },
  ];
  for (const command of commands) book = execute(book, "a", command);
  return book;
}
const base = {
  id: "proof",
  accountId: "cash",
  transactionId: "proof",
  date: "2026-10-10",
  amount: -5000,
  payee: "Payment",
  status: "posted",
} as const;
for (const [name, fields] of [
  ["transfer", { transferAccountId: "other" }],
  ["card payment", { transferAccountId: "card" }],
  [
    "loan payment",
    { loanId: "loan", interest: 1000, categoryId: "loan-category" },
  ],
] as const) {
  void test(`merge proof: register ${name} saves produce identical rows and change sets through upsert`, () => {
    const book = fixture();
    const saved = executeWithChanges(book, "a", {
      ...base,
      ...fields,
      type: "transaction.save",
    });
    const upserted = executeWithChanges(book, "a", {
      ...base,
      ...fields,
      type: "transaction.upsert",
    });
    assert.deepEqual(bookToRows(upserted.book), bookToRows(saved.book));
    assert.deepEqual(upserted.changeSet, saved.changeSet);
  });
}

// Dedicated payments used different generated transaction IDs and stored payee
// labels. Compare every row/change after explicitly discarding only those labels
// and mapping the dedicated card leg ID to the register's counterpart ID.
function accountingRows(rows: WireRow[]) {
  return rows.map((row) => {
    const mapped = JSON.parse(
      JSON.stringify(row).replaceAll("proof:card", "proof:counterpart"),
    ) as WireRow;
    if (mapped.data && "payee" in mapped.data) {
      const { payee: _payee, ...data } = mapped.data;
      return { ...mapped, data };
    }
    return mapped;
  });
}
for (const [name, original, replacement] of [
  [
    "dedicated loan payment",
    {
      type: "loan.payment",
      id: "proof",
      accountId: "cash",
      loanId: "loan",
      date: base.date,
      principal: 4000,
      interest: 1000,
    },
    {
      ...base,
      type: "transaction.upsert",
      transactionId: "proof:payment",
      loanId: "loan",
      interest: 1000,
      categoryId: "loan-category",
    },
  ],
  [
    "dedicated card payment",
    {
      type: "card.payment",
      id: "proof",
      cashAccountId: "cash",
      cardAccountId: "card",
      date: base.date,
      amount: 5000,
    },
    {
      ...base,
      type: "transaction.upsert",
      transactionId: "proof:cash",
      transferAccountId: "card",
    },
  ],
  [
    "dedicated statement credit",
    {
      type: "card.credit",
      id: "proof",
      accountId: "card",
      date: base.date,
      amount: 5000,
    },
    {
      ...base,
      type: "transaction.upsert",
      transactionId: "proof:credit",
      accountId: "card",
      amount: 5000,
      payee: "Posted statement credit",
    },
  ],
] satisfies [string, Command, Command][]) {
  void test(`merge proof: ${name} and upsert produce equal accounting rows, changes and balances`, () => {
    const book = fixture();
    const saved = executeWithChanges(book, "a", original);
    const upserted = executeWithChanges(book, "a", replacement);
    assert.deepEqual(
      accountingRows(bookToRows(upserted.book)),
      accountingRows(bookToRows(saved.book)),
    );
    assert.deepEqual(
      accountingRows(upserted.changeSet.after),
      accountingRows(saved.changeSet.after),
    );
    assert.deepEqual(
      accountingRows(upserted.changeSet.before),
      accountingRows(saved.changeSet.before),
    );
    const totals = (state: typeof book) =>
      projectBook(state, "a", "2026-10").accounts.map(({ id, balance }) => ({
        id,
        balance,
      }));
    assert.deepEqual(totals(upserted.book), totals(saved.book));
  });
}
