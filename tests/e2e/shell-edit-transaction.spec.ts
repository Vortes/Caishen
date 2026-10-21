import { expect, test, shellPath } from "./shell-fixture";
import {
  reloadBudget,
  accountBalance,
  available,
  openRegister,
  transactionRow,
  transactions,
} from "./shell-controls";

test("editing a purchase corrects the same saved transaction without duplication", async ({
  page,
  budgets,
}) => {
  const budget = await budgets.create({
    purchase: { payee: "Original market", amount: 2_500 },
  });
  await page.goto(shellPath);
  await budgets.signIn(page, budget);
  await openRegister(page, budget.account);
  const original = transactionRow(page, "Original market");
  await expect(original).toHaveAttribute(
    "data-transaction-row",
    budget.purchaseId,
  );
  await original.click();
  await page.keyboard.press("e");
  const form = page.getByRole("form", {
    name: "Edit transaction",
    exact: true,
  });
  await form.getByLabel("Payee", { exact: true }).fill("Corrected market");
  await form.getByLabel("Outflow", { exact: true }).fill("18.75");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);

  await reloadBudget(page, budget);
  await expect(available(page, budget.category)).toHaveText("$181.25");
  await openRegister(page, budget.account);
  await expect(transactions(page)).toHaveCount(1);
  await expect(transactionRow(page, "Original market")).toHaveCount(0);
  const corrected = transactionRow(page, "Corrected market");
  await expect(corrected).toHaveAttribute(
    "data-transaction-row",
    budget.purchaseId,
  );
  await expect(corrected).toContainText("$18.75");
  await expect(accountBalance(page)).toHaveText("$981.25");
});
