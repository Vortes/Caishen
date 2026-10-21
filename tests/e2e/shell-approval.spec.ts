import { expect, test, shellPath } from "./shell-fixture";
import {
  reloadBudget,
  openRegister,
  saved,
  transactionRow,
  transactions,
} from "./shell-controls";

test("approving a recorded purchase persists its review status after reload", async ({
  page,
  budgets,
}) => {
  const budget = await budgets.create({
    purchase: { payee: "Review market", amount: 2_500, reviewed: false },
  });
  await page.goto(shellPath);
  await budgets.signIn(page, budget);
  await openRegister(page, budget.account);
  const filter = page.getByRole("button", { name: /^To review/ });
  await expect(filter).toHaveText(/To review\s*1$/);
  await expect(transactionRow(page, "Review market")).toContainText(
    "Needs review",
  );
  await transactionRow(page, "Review market").click();
  await page
    .getByRole("toolbar", { name: "Selected transactions" })
    .getByRole("button", { name: "Approve (1)", exact: true })
    .click();
  await saved(page);

  await reloadBudget(page, budget);
  await openRegister(page, budget.account);
  await expect(transactions(page)).toHaveCount(1);
  await expect(transactionRow(page, "Review market")).not.toContainText(
    "Needs review",
  );
  await expect(filter).toHaveText(/To review\s*0$/);
  await filter.click();
  await expect(
    page.getByText("Everything here is reviewed.", { exact: true }),
  ).toBeVisible();
});
