import { expect, test, shellPath } from "./shell-fixture";
import {
  accountBalance,
  openRegister,
  readyToAssign,
  reloadBudget,
  transactionRow,
} from "./shell-controls";

test("confirming a matching cleared balance locks the account's cleared transactions", async ({
  page,
  budgets,
}) => {
  const budget = await budgets.create({
    purchase: { payee: "Corner market", amount: 2_500 },
  });
  await page.goto(shellPath);
  await budgets.signIn(page, budget);
  await openRegister(page, budget.account);
  await expect(page.getByText("Never reconciled")).toBeVisible();

  await page.getByRole("button", { name: "Reconcile", exact: true }).click();
  const flow = page.getByRole("dialog", {
    name: `Reconcile ${budget.account}`,
  });
  await expect(flow).toContainText("$975.00Cleared in Caishen");
  await flow.getByRole("button", { name: "Yes, it matches" }).click();
  await expect(flow).toHaveCount(0);

  await reloadBudget(page, budget);
  await openRegister(page, budget.account);
  await expect(page.getByText("Reconciled today")).toBeVisible();
  await expect(
    transactionRow(page, "Corner market").getByLabel("Reconciled"),
  ).toBeVisible();
  await expect(accountBalance(page)).toHaveText("$975.00");
});

test("a bank balance that doesn't match finishes with an adjustment from Ready to Assign", async ({
  page,
  budgets,
}) => {
  const budget = await budgets.create({
    purchase: { payee: "Corner market", amount: 2_500 },
  });
  await page.goto(shellPath);
  await budgets.signIn(page, budget);
  await expect(readyToAssign(page)).toContainText("$800.00");
  await openRegister(page, budget.account);

  await page.getByRole("button", { name: "Reconcile", exact: true }).click();
  const flow = page.getByRole("dialog", {
    name: `Reconcile ${budget.account}`,
  });
  await flow.getByRole("button", { name: "No, enter bank balance" }).click();
  await flow.getByLabel("Current balance at your bank").fill("970.00");
  await flow.getByRole("button", { name: "Next", exact: true }).click();
  await expect(flow).toContainText("Off by -$5.00.");
  await flow
    .getByRole("button", { name: "Create adjustment & finish" })
    .click();
  await expect(flow).toHaveCount(0);

  await reloadBudget(page, budget);
  await expect(readyToAssign(page)).toContainText("$795.00");
  await openRegister(page, budget.account);
  const adjustment = transactionRow(page, "Reconciliation balance adjustment");
  await expect(adjustment).toContainText("$5.00");
  await expect(adjustment.getByLabel("Reconciled")).toBeVisible();
  await expect(
    transactionRow(page, "Corner market").getByLabel("Reconciled"),
  ).toBeVisible();
  await expect(accountBalance(page)).toHaveText("$970.00");
});
