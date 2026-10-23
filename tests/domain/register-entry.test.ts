import assert from "node:assert/strict";
import test from "node:test";
import { execute } from "../../src/domain/engine";
import { classifyRegisterEntry } from "../../src/domain/register-entry";
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
