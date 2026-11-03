import assert from "node:assert/strict";
import test from "node:test";
import { addMember, createBook, execute } from "../../src/domain/engine";
import {
  classifyRegisterEntry,
  directEntryAccounts,
} from "../../src/domain/register-entry";
import { buildCommandCorpus } from "./fixtures/command-corpus";
import { withPeople } from "../../src/domain/people";
import { personId, withPerson } from "./fixtures/people";

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
  let book = withPeople(
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
  const book = withPerson(
    withPeople(createBook("a", "A", "2026-10")),
    "a",
    "Sam",
  );
  const budget = book.budgets.a!;
  const entry = classifyRegisterEntry(budget, {
    id: "direct",
    accountId: personId("Sam"),
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
      "Entries on a person's account come from shares, repayments, and settlements, not from the register",
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

void test("balance adjustments are register-editable with a fixed category on cash, credit and tracking accounts", () => {
  for (const kind of ["cash", "credit", "tracking"] as const) {
    let book = execute(createBook("a", "A", "2026-10"), "a", {
      type: "account.add",
      id: "account",
      accountId: kind,
      name: kind,
      kind,
      openingBalance: 0,
      date: "2026-10-01",
    });
    book = execute(book, "a", {
      type: "account.reconcile",
      id: "reconcile",
      accountId: kind,
      date: "2026-10-10",
      balance: kind === "cash" ? 1000 : -1000,
      adjustmentId: "adjustment",
    });
    const budget = book.budgets.a!;
    const adjustment = budget.transactions.find(
      (item) => item.id === "adjustment",
    )!;
    const entry = classifyRegisterEntry(budget, adjustment);
    assert.deepEqual(entry.capabilities.edit, {
      ok: true,
      command: "transaction.upsert",
    });
    assert.equal(entry.capabilities.categorize.ok, false);
    assert.equal(entry.fields.category, kind === "cash" ? "purpose" : "none");
    assert.equal(entry.fields.needsCategory, false);
    assert.equal(entry.fields.split, false);
    assert.deepEqual(entry.capabilities.share, { mode: "none" });
  }
});

void test("removal is available only for active purchases, refunds, income and balance adjustments", () => {
  const { steps } = buildCommandCorpus();
  const removable = new Set(["purchase", "refund", "income", "adjustment"]);
  for (const { after } of steps) {
    for (const budget of Object.values(after.budgets)) {
      for (const transaction of budget.transactions) {
        const entry = classifyRegisterEntry(budget, transaction);
        assert.equal(
          entry.capabilities.remove?.ok,
          !transaction.removed && removable.has(transaction.kind),
          `${transaction.kind}: ${transaction.payee}`,
        );
        const confirmed = classifyRegisterEntry(budget, {
          ...transaction,
          reviewed: true,
          reconciled: true,
        });
        assert.equal(
          confirmed.capabilities.remove?.ok,
          !transaction.removed && removable.has(transaction.kind),
        );
        const removed = classifyRegisterEntry(budget, {
          ...transaction,
          removed: true,
        });
        assert.equal(removed.capabilities.remove?.ok, false);
      }
    }
  }
  const budget = steps.at(-1)!.after.budgets.alex!;
  const imported = classifyRegisterEntry(budget, {
    eligibility: "eligible",
    accountId: "checking",
    removed: false,
    quarantined: false,
    amount: -100,
    pending: false,
  });
  assert.equal(imported.capabilities.remove?.ok, false);
});
