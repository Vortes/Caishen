import { expect, test, type Page } from "@playwright/test";

import { currentMonth } from "../../src/components/budget/format";
import type { Command } from "../../src/domain/engine";
import { money, openPrototype } from "./prototype-fixture";

// A checking account's month: payroll and rent cleared, two bank imports
// still waiting for a category, a categorized one waiting for approval, and
// three pending charges, one of them a refund the balance doesn't count yet.
const date = (day: number) =>
  `${currentMonth()}-${String(day).padStart(2, "0")}`;
const commands: Command[] = (
  [
    ["payroll", 2, "TNXI Payroll", 381_023, undefined, "posted", true],
    ["rent", 3, "Mission Rentals", -50_000, "rent", "posted", true],
    ["x", 5, "X Corp.", -400, undefined, "posted", false],
    ["craft", 6, "Interface Craft", -24_900, undefined, "posted", false],
    ["groceries", 7, "Trader Joe's", -6_218, "household", "posted", false],
    ["apple", 8, "Apple Cash", -10_000, "gifts", "pending", true],
    ["coffee", 8, "Blue Bottle", -650, "dining", "pending", true],
    ["refund", 9, "Venmo · Sam", 4_500, undefined, "pending", true],
  ] as const
).map(([id, day, payee, amount, categoryId, status, reviewed]): Command => ({
  type: "transaction.upsert",
  id: `seed-transaction-${id}`,
  transactionId: id,
  accountId: "checking",
  date: date(day),
  payee,
  amount,
  categoryId,
  status,
  reviewed,
}));

// $1,000 opening, minus the fixture's $280.15 dinner, plus the month above.
// The pending refund isn't in the balance until it posts.
const cleared = 100_000 - 28_015 + 381_023 - 50_000 - 400 - 24_900 - 6_218;
const uncleared = -10_000 - 650;

const transactions = (page: Page) =>
  page.getByRole("group", { name: "Transactions" });
const row = (page: Page, payee: string) =>
  transactions(page).getByRole("button", { name: new RegExp(payee) });

async function openChecking(page: Page) {
  await openPrototype(page, { commands });
  await page
    .getByRole("navigation", { name: "Budget navigation" })
    .getByRole("button", { name: /^Checking/ })
    .click();
  await expect(page.getByRole("heading", { name: "Checking" })).toBeVisible();
}

test("an account shows its balances, actions, and no details panel", async ({
  page,
}) => {
  await openChecking(page);
  const balance = (label: string) =>
    page
      .locator("dl > div")
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator("dd");
  await expect(balance("Cleared")).toHaveText(money(cleared));
  await expect(balance("Uncleared")).toHaveText(money(uncleared));
  await expect(balance("Working balance")).toHaveText(
    money(cleared + uncleared),
  );
  for (const name of ["Reconcile", "Add transaction", "File import"])
    await expect(page.getByRole("button", { name })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Details" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /details/ })).toHaveCount(0);

  // All accounts adds up every account; reconciling and importing a file
  // are per account.
  await page
    .getByRole("navigation", { name: "Budget navigation" })
    .getByRole("button", { name: /^All accounts/ })
    .click();
  await expect(balance("Working balance")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reconcile" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "File import" })).toHaveCount(
    0,
  );
});

test("To review narrows the register to what's waiting", async ({ page }) => {
  await openChecking(page);
  const filter = page.getByRole("button", { name: /^To review/ });
  await expect(filter).toHaveText(/To review\s*3$/);
  await filter.click();
  await expect(transactions(page).locator("[data-row]")).toHaveCount(3);
  await expect(row(page, "Interface Craft")).toContainText("Needs category");
  await filter.click();
  await expect(row(page, "Mission Rentals")).toBeVisible();
});

test("pending transactions sit apart from cleared ones", async ({ page }) => {
  await openChecking(page);
  const pending = page.getByRole("group", { name: "Pending transactions" });
  await expect(pending.locator("[data-row]")).toHaveCount(3);
  await expect(pending).toContainText("Apple Cash");
  await expect(
    row(page, "Mission Rentals").getByLabel("Cleared"),
  ).toBeVisible();
  await expect(row(page, "Blue Bottle").getByLabel("Pending")).toBeVisible();

  // The heading collapses its rows.
  await pending.getByRole("button", { name: /^Pending/ }).click();
  await expect(pending.locator("[data-row]")).toHaveCount(0);
  await expect(row(page, "Mission Rentals")).toBeVisible();
});

test("search finds transactions by payee, category, or amount", async ({
  page,
}) => {
  await openChecking(page);
  const search = page.getByRole("searchbox", { name: "Search Checking" });
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.fill("trader");
  await expect(transactions(page).locator("[data-row]")).toHaveCount(1);
  await search.fill("household");
  await expect(row(page, "Trader Joe's")).toBeVisible();
  await search.fill("249");
  await expect(transactions(page).locator("[data-row]")).toHaveCount(1);
  await expect(row(page, "Interface Craft")).toBeVisible();
  await search.fill("nothing like this");
  await expect(page.getByText(/No transactions match/)).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(row(page, "Mission Rentals")).toBeVisible();
});
