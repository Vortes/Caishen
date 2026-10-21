import { expect, type Page } from "@playwright/test";
import type { TestBudget } from "./shell-fixture";
import { monthLabelPattern, monthNavigation } from "./calendar";

export const available = (page: Page, category: string) =>
  page.getByRole("button", { name: new RegExp(`available in ${category}\\.`) });
export const transactionRow = (page: Page, payee: string) =>
  page
    .getByRole("group", { name: "Transactions", exact: true })
    .getByRole("button", { name: new RegExp(payee) });

export const assigned = (page: Page, category: string) =>
  page.getByRole("button", {
    name: new RegExp(`assigned to ${category}\\. Edit assigned amount$`),
  });
export const readyToAssign = (page: Page) =>
  page
    .getByRole("complementary", { name: "Details", exact: true })
    .locator("section")
    .filter({ has: page.getByText("Ready to Assign", { exact: true }) })
    .locator("strong");
export const notifications = (page: Page) =>
  page.getByRole("region", { name: "Notifications" });
export const transactions = (page: Page) =>
  page
    .getByRole("group", { name: "Transactions", exact: true })
    .locator("[data-transaction-row]");
export const accountBalance = (page: Page) =>
  page
    .locator("dl > div")
    .filter({ has: page.getByText("Working balance", { exact: true }) })
    .locator("dd");

export async function fillPurchase(
  page: Page,
  budget: TestBudget,
  payee: string,
  outflow: string,
) {
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const form = page.getByRole("form", { name: "New transaction", exact: true });
  await page
    .getByRole("dialog", { name: "Date calendar", exact: true })
    .press("Escape");
  // Type the captured date; a calendar opened after midnight may show a
  // different month from the one in which this journey began.
  await form
    .getByRole("combobox", { name: "Date", exact: true })
    .fill(budget.date);
  await form.getByLabel("Payee", { exact: true }).fill(payee);
  const category = form.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  await category.fill(budget.category);
  await category.press("Enter");
  await form.getByLabel("Outflow", { exact: true }).fill(outflow);
  return form;
}

export async function saved(page: Page) {
  // Enabled only after the mutation succeeds and the fresh budget arrives.
  await expect(
    notifications(page).getByRole("button", { name: "Undo", exact: true }),
  ).toBeEnabled();
}

export async function editAssigned(page: Page, category: string) {
  await expect(assigned(page, category)).not.toHaveAttribute("aria-disabled");
  await assigned(page, category).click();
  return page.getByRole("textbox", { name: `Assigned amount for ${category}` });
}

export async function showMonth(page: Page, month: string) {
  const picker = page.getByRole("button", { name: monthLabelPattern });
  await expect(picker).toBeVisible();
  const navigation = monthNavigation((await picker.innerText()).trim(), month);
  for (let step = 0; step < navigation.steps; step++) {
    const previous = await picker.innerText();
    await page
      .getByRole("button", { name: navigation.direction, exact: true })
      .click();
    await expect(picker).not.toHaveText(previous);
    await expect(
      page.getByRole("status").filter({ hasText: /^Loading / }),
    ).toHaveCount(0);
  }
  await expect(picker).toHaveText(navigation.label);
  await expect(
    page.getByRole("status").filter({ hasText: /^Loading / }),
  ).toHaveCount(0);
}

export async function reloadBudget(page: Page, budget: TestBudget) {
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Plan", exact: true }),
  ).toBeVisible();
  await showMonth(page, budget.month);
}

export async function openRegister(page: Page, account: string) {
  await expect(
    page.getByRole("heading", { name: "Plan", exact: true }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", {
    name: "Budget navigation",
  });
  if (!(await navigation.isVisible()))
    await page
      .getByRole("button", { name: "Show sidebar", exact: true })
      .first()
      .click();
  await navigation
    .getByRole("button", { name: new RegExp(`^${account}`) })
    .click();
  await expect(
    page.getByRole("heading", { name: account, exact: true }),
  ).toBeVisible();
}
