import { expect, test, shellPath } from "./shell-fixture";
import {
  accountBalance,
  fillPurchase,
  openRegister,
  readyToAssign,
  reloadBudget,
  saved,
  showMonth,
  transactions,
} from "./shell-controls";

test("a cash Starting Balance can be edited and counts once after a purchase and reload", async ({
  page,
  budget,
}) => {
  await expect(readyToAssign(page)).toHaveText("$700.00");
  await openRegister(page, budget.account);
  const opening = transactions(page).filter({ hasText: "Starting Balance" });
  await expect(opening).toContainText("$1,000.00");
  await expect(opening.getByLabel("Cleared", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "Select Starting Balance",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(opening).toContainText("Inflow: Ready to Assign");
  await expect(accountBalance(page)).toHaveText("$1,000.00");

  const form = await fillPurchase(page, budget, "Opening balance market", "30");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  await saved(page);
  await reloadBudget(page, budget);
  await expect(readyToAssign(page)).toHaveText("$700.00");
  await openRegister(page, budget.account);
  await expect(opening).toHaveCount(1);
  await expect(accountBalance(page)).toHaveText("$970.00");
  await expect(transactions(page)).toHaveCount(2);
  await page.getByRole("checkbox", { name: "Select all", exact: true }).click();
  await expect(
    page.getByRole("toolbar", { name: "Selected transactions" }),
  ).toContainText("2 transactions");
  await page.getByRole("checkbox", { name: "Select all", exact: true }).click();
  await page.getByRole("button", { name: /^To review/ }).click();
  await expect(opening).toHaveCount(0);
  await expect(
    page.getByText("Everything here is reviewed.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^To review/ }).click();
  await opening.getByText("Starting Balance", { exact: true }).dblclick();
  const editor = page.getByRole("form", {
    name: "Edit transaction",
    exact: true,
  });
  await expect(editor.getByLabel("Category", { exact: true })).toBeDisabled();
  await editor.getByLabel("Inflow", { exact: true }).fill("1200");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await saved(page);
  await reloadBudget(page, budget);
  await expect(readyToAssign(page)).toHaveText("$900.00");
  await openRegister(page, budget.account);
  await expect(opening).toHaveCount(1);
  await expect(accountBalance(page)).toHaveText("$1,170.00");
});

test("card debt and zero openings follow account, month, and search filters", async ({
  page,
  budgets,
}) => {
  const budget = await budgets.create({
    additionalAccounts: [
      {
        id: "card",
        name: "Travel card",
        kind: "credit",
        openingBalance: -120_000,
      },
      { id: "savings", name: "Savings", kind: "cash", openingBalance: 0 },
    ],
  });
  await page.goto(shellPath);
  await budgets.signIn(page, budget);
  await expect(readyToAssign(page)).toHaveText("$700.00");
  await openRegister(page, "Travel card");
  const card = transactions(page)
    .filter({ hasText: "Starting Balance" })
    .filter({ hasText: "Category not needed" });
  await expect(card).toContainText("$1,200.00");
  await expect(accountBalance(page)).toHaveText("-$1,200.00");
  await expect(
    transactions(page)
      .filter({ hasText: "Starting Balance" })
      .filter({ hasText: "Inflow: Ready to Assign" }),
  ).toHaveCount(0);
  const purchase = await fillPurchase(page, budget, "Card market", "30");
  await purchase.getByRole("button", { name: "Save", exact: true }).click();
  await expect(purchase).toHaveCount(0);
  await saved(page);
  await reloadBudget(page, budget);
  await expect(readyToAssign(page)).toHaveText("$700.00");
  await openRegister(page, "Travel card");
  await expect(card).toContainText("$1,200.00");
  await expect(accountBalance(page)).toHaveText("-$1,230.00");
  await page.goto(`/app/accounts?month=${budget.month}`);
  const openings = transactions(page).filter({ hasText: "Starting Balance" });
  await expect(openings).toHaveCount(3);
  await expect(openings.filter({ hasText: "Savings" })).toContainText("$0.00");
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(openings).toHaveCount(0);
  const search = page.getByPlaceholder("Search all accounts");
  await search.fill("Starting Balance");
  await expect(openings).toHaveCount(3);
  await search.fill("Travel card");
  await expect(openings).toHaveCount(1);
  await expect(card).toBeVisible();
  await search.fill("no-such-merchant");
  await expect(openings).toHaveCount(0);
  await search.clear();
  await showMonth(page, budget.month);
  await expect(openings).toHaveCount(3);
});

test("compact all-account Starting Balances use ordinary adjustment rows", async ({
  page,
  budgets,
}) => {
  const budget = await budgets.create({
    additionalAccounts: [
      {
        id: "card",
        name: "Travel card",
        kind: "credit",
        openingBalance: -100_000,
      },
    ],
  });
  await page.goto(shellPath);
  await budgets.signIn(page, budget);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/accounts?month=${budget.month}`);
  const openings = transactions(page).filter({ hasText: "Starting Balance" });
  await expect(openings).toHaveCount(2);
  await expect(
    openings.filter({ hasText: "Inflow: Ready to Assign" }),
  ).toBeVisible();
  await expect(
    openings.filter({ hasText: "Category not needed" }),
  ).toBeVisible();
});

test("compact positive openings retain the register's positive money treatment", async ({
  page,
  budget,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/accounts/checking?month=${budget.month}`);
  const amount = transactions(page)
    .filter({ hasText: "Starting Balance" })
    .getByText("$1,000.00", { exact: true });
  await expect(amount).toBeVisible();
  const positiveColor = await amount.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--money-positive)";
    el.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(amount).toHaveCSS("color", positiveColor);
});
