import assert from "node:assert/strict";
import test from "node:test";
import {
  addMember,
  createBook,
  execute,
  withCounterpartyAccounts,
} from "../../src/domain/engine";
import {
  classifyRegisterEntry,
  directEntryAccounts,
} from "../../src/domain/register-entry";
import { buildCommandCorpus } from "./fixtures/command-corpus";

void test("register entries name every transaction shape and its register edit capability", () => {
  const { steps, book } = buildCommandCorpus();
  const refunded = execute(book, "alex", {
    type: "transaction.upsert",
    id: "refund-shape",
    transactionId: "refund-shape",
    accountId: "checking",
    date: "2026-01-10",
    amount: 100,
    payee: "Refund",
    categoryId: "food",
  });
  const budgets = [
    ...steps.flatMap(({ after }) => Object.values(after.budgets)),
    ...Object.values(refunded.budgets),
  ];
  const seen = new Set<string>();
  {
    for (const budget of budgets) {
      for (const transaction of budget.transactions.filter(
        (item) => !item.removed,
      )) {
        const entry = classifyRegisterEntry(budget, transaction);
        assert.equal(entry.origin, "transaction");
        if (entry.origin !== "transaction") continue;
        seen.add(entry.shape.kind);
        assert.equal(entry.shape.kind, transaction.kind);
        if (entry.capabilities.edit.ok)
          assert.equal(entry.capabilities.edit.command, "transaction.upsert");
      }
    }
  }
  assert.deepEqual([...seen].sort(), [
    "adjustment",
    "card-payment",
    "income",
    "loan-payment",
    "purchase",
    "refund",
    "reimbursement",
    "statement-credit",
    "transfer",
  ]);
});

void test("F3: direct entry accounts include cash, credit and tracking but exclude both counterparties", () => {
  let book = withCounterpartyAccounts(
    addMember(createBook("a", "A", "2026-10"), "b", "B", "2026-10"),
  );
  for (const kind of ["cash", "credit", "tracking"] as const)
    book = execute(book, "a", {
      type: "account.add",
      id: kind,
      accountId: kind,
      name: kind,
      kind,
      openingBalance: 0,
    });
  const budget = book.budgets.a!;
  assert.deepEqual(
    directEntryAccounts(budget.accounts).map((account) => account.kind),
    ["cash", "credit", "tracking"],
  );
});

void test("F3: an existing counterparty entry cannot be edited as a direct transaction", () => {
  const book = withCounterpartyAccounts(createBook("a", "A", "2026-10"));
  const budget = book.budgets.a!;
  const entry = classifyRegisterEntry(budget, {
    id: "direct",
    accountId: "counterparty:reimbursements",
    date: "2026-10-10",
    amount: -100,
    payee: "Sam",
    status: "posted",
    expenseMonth: "2026-10",
    kind: "purchase",
    revision: 1,
    reviewed: false,
    history: [],
  });
  assert.deepEqual(entry.capabilities.edit, {
    ok: false,
    reason:
      "Entries on Partner and Reimbursements come from shares and settlements, not from the register",
  });
});

void test("register classification supplies category and split field rules for prospective entries", () => {
  let book = createBook("a", "A", "2026-10");
  for (const kind of ["cash", "tracking"] as const)
    book = execute(book, "a", {
      type: "account.add",
      id: kind,
      accountId: kind,
      name: kind,
      kind,
      openingBalance: 0,
    });
  const budget = book.budgets.a!;
  const input = {
    id: "draft",
    accountId: "cash",
    date: "2026-10-10",
    amount: -100,
    payee: "Draft",
    status: "posted" as const,
  };
  const entry = classifyRegisterEntry(budget, input);
  assert.equal(entry.origin, "transaction");
  if (entry.origin !== "transaction") return;
  assert.equal(entry.fields.category, "purpose");
  assert.equal(entry.fields.split, true);
  const transfer = classifyRegisterEntry(budget, {
    ...input,
    transferAccountId: "tracking",
  });
  assert.equal(transfer.origin, "transaction");
  if (transfer.origin !== "transaction") return;
  assert.equal(transfer.fields.category, "boundary");
  assert.equal(transfer.fields.split, false);
});
