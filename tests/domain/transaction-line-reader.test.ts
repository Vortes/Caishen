import assert from "node:assert/strict";
import test from "node:test";
import { bookSchema, execute, executeWithChanges, projectBook } from "../../src/domain/engine";
import { executeRevert, toRowSet } from "../../src/domain/change-sets";
import { bookToRows, rowsToBook } from "../../src/domain/rows";
import { storedLineBook } from "./fixtures/transaction-line-book";
import { personalSpendingEntries } from "../../src/domain/spending";

void test("a stored split survives strict reading and a normalized-row round trip", () => {
  const book = bookSchema.parse(storedLineBook());
  const restored = rowsToBook(bookToRows(book));
  assert.deepStrictEqual(
    restored.budgets.alan!.transactions.find(({ id }) => id === "costco")!
      .lines,
    [
      { id: "food", categoryId: "groceries", amount: -15_000 },
      { id: "paper", categoryId: "household", amount: -5_000 },
    ],
  );
});

void test("stored line amounts count toward their categories' activity", () => {
  const book = bookSchema.parse(storedLineBook());
  const view = projectBook(book, "alan", "2026-10");
  assert.equal(view.categories.find(category => category.id === "groceries")!.activity, -15_000);
  assert.equal(view.categories.find(category => category.id === "household")!.activity, -5_000);
});

void test("personal spending reads each saved line under its own category", () => {
  const entries = personalSpendingEntries(bookSchema.parse(storedLineBook()), "alan");
  assert.deepStrictEqual(entries.map(entry => [entry.categoryId, entry.amount]), [
    ["groceries", 15_000], ["household", 5_000],
  ]);
});

void test("a provider amount update preserves and rescales the saved category lines", () => {
  const updated = execute(bookSchema.parse(storedLineBook()), "alan", {
    type: "transaction.upsert", id: "bank-update", transactionId: "costco",
    accountId: "checking", date: "2026-10-10", payee: "Costco posted", amount: -24_000,
  }, "provider");
  assert.deepStrictEqual(
    updated.budgets.alan!.transactions.find(({ id }) => id === "costco")!.lines,
    [
      { id: "food", categoryId: "groceries", amount: -18_000 },
      { id: "paper", categoryId: "household", amount: -6_000 },
    ],
  );
  assert.equal(
    updated.budgets.alan!.transactions.find(({ id }) => id === "costco")!
      .reviewed,
    false,
  );
});

void test("categorizing a stored split replaces its lines and undo restores them", () => {
  const before = bookSchema.parse(storedLineBook());
  const changed = executeWithChanges(before, "alan", {
    type: "transaction.categorize", id: "categorize", transactionId: "costco", categoryId: "household",
  }, "user");
  assert.equal(
    changed.book.budgets.alan!.transactions.find(({ id }) => id === "costco")!
      .lines,
    undefined,
  );
  const reverted = executeRevert(toRowSet(bookToRows(changed.book)), {
    type: "revert", id: "undo", targetOperationId: "categorize",
  }, changed.changeSet);
  assert.deepStrictEqual(bookToRows(bookSchema.parse(reverted.book)), bookToRows(before));
});

void test("a saved split is already categorized when the user approves it", () => {
  const saved = storedLineBook();
  saved.budgets.alan.transactions.find(({ id }) => id === "costco")!.reviewed =
    false;
  const approved = execute(bookSchema.parse(saved), "alan", {
    type: "transaction.approve", id: "approve", transactionIds: ["costco"],
  }, "user");
  assert.equal(
    approved.budgets.alan!.transactions.find(({ id }) => id === "costco")!
      .reviewed,
    true,
  );
});
