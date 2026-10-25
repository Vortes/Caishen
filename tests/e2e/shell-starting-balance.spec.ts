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

test("a cash opening stays read-only and counts once after a purchase and reload", async ({
  page,
  budget,
}) => {
  await expect(readyToAssign(page)).toHaveText("$700.00");
  await openRegister(page, budget.account);
  const opening = page.getByRole("group", {
    name: `Starting Balance for ${budget.account}`,
    exact: true,
  });
  await expect(opening).toContainText("$1,000.00");
  await expect(opening.getByLabel("Cleared", { exact: true })).toBeVisible();
  await expect(opening.getByRole("button")).toHaveCount(0);
  await expect(opening.getByRole("checkbox")).toHaveCount(0);
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
  await expect(transactions(page)).toHaveCount(1);
  await page.getByRole("checkbox", { name: "Select all", exact: true }).click();
  await expect(
    page.getByRole("toolbar", { name: "Selected transactions" }),
  ).toContainText("1 transaction");
  await page.getByRole("checkbox", { name: "Select all", exact: true }).click();
  await page.getByRole("button", { name: /^To review/ }).click();
  await expect(opening).toHaveCount(0);
  await expect(
    page.getByText("Everything here is reviewed.", { exact: true }),
  ).toBeVisible();
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
  const card = page.getByRole("group", {
    name: "Starting Balance for Travel card",
    exact: true,
  });
  await expect(card).toContainText("$1,200.00");
  await expect(accountBalance(page)).toHaveText("-$1,200.00");
  await expect(
    page.getByRole("group", {
      name: "Starting Balance for Checking",
      exact: true,
    }),
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
  await page.goto(`/app?account=all&month=${budget.month}`);
  const openings = page.getByRole("group", { name: /^Starting Balance for/ });
  await expect(openings).toHaveCount(3);
  await expect(
    page.getByRole("group", {
      name: "Starting Balance for Savings",
      exact: true,
    }),
  ).toContainText("$0.00");
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

test("compact all-account openings keep their account names visible", async ({
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
  await page.goto(`/app?account=all&month=${budget.month}`);
  for (const name of ["Checking", "Travel card"])
    await expect(
      page
        .getByRole("group", {
          name: `Starting Balance for ${name}`,
          exact: true,
        })
        .getByText(name, { exact: true }),
    ).toBeVisible();
});

test("compact positive openings retain the register's positive money treatment", async ({
  page,
  budget,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app?account=checking&month=${budget.month}`);
  const amount = page
    .getByRole("group", {
      name: `Starting Balance for ${budget.account}`,
      exact: true,
    })
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
