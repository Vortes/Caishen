import { expect, test } from "./shell-fixture";
import {
  reloadBudget,
  accountBalance,
  available,
  fillPurchase,
  openRegister,
  transactionRow,
  transactions,
} from "./shell-controls";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("a purchase created on a phone persists exactly once with account and category balances", async ({
  page,
  budget,
}) => {
  await openRegister(page, budget.account);
  const form = await fillPurchase(page, budget, "Phone market", "12.50");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);

  await reloadBudget(page, budget);
  await expect(available(page, budget.category)).toHaveText("$187.50");
  await openRegister(page, budget.account);
  await expect(transactions(page)).toHaveCount(1);
  await expect(transactionRow(page, "Phone market")).toContainText("$12.50");
  await expect(accountBalance(page)).toHaveText("$987.50");
});
