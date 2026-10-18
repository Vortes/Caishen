import test from "node:test";
import assert from "node:assert/strict";
import { parseCategoryImport } from "../../src/server/categories";

void test("YNAB import extracts category names only and excludes synthetic payment/inflow categories", () => {
  assert.deepEqual(
    parseCategoryImport(
      JSON.stringify({
        category_groups: [
          {
            name: "Home",
            categories: [
              {
                name: "Rent",
                balance: 900000,
                budgeted: 200000,
                activity: -10000,
              },
              { name: "Rent" },
              { name: "Old", deleted: true },
            ],
          },
          { name: "Credit Card Payments", categories: [{ name: "Amex" }] },
        ],
        transactions: [{ amount: 1_000_000 }],
      }),
    ),
    [{ name: "Rent", group: "Home" }],
  );
});
void test("CSV import handles quoted commas and deduplicates monthly YNAB exports", () => {
  assert.deepEqual(
    parseCategoryImport(
      'Category Group,Category,Assigned,Activity\nHome,"Rent, utilities",500,100\nHome,"Rent, utilities",600,100',
    ),
    [{ group: "Home", name: "Rent, utilities" }],
  );
});
void test("reject malformed or oversized imports", () => {
  assert.throws(() => parseCategoryImport("Payee,Amount\nStore,100"));
  assert.throws(() => parseCategoryImport("x".repeat(1_000_001)));
});
