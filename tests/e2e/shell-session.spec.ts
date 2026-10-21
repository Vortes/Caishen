import { expect, test, shellPath } from "./shell-fixture";
import {
  reloadBudget,
  available,
  openRegister,
  transactionRow,
} from "./shell-controls";

test("switching users in the same browser replaces the private budget and transactions", async ({
  page,
  budgets,
}) => {
  const alice = await budgets.create({
    name: "Alice private budget",
    category: "Alice groceries",
    account: "Alice checking",
    purchase: { payee: "Alice private merchant", amount: 2_500 },
  });
  const bob = await budgets.create({
    name: "Bob private budget",
    category: "Bob groceries",
    account: "Bob checking",
    cash: 200_000,
    purchase: { payee: "Bob private merchant", amount: 1_000 },
  });

  await page.goto(shellPath);
  await expect(
    page.getByText("Sign in to see your budget here."),
  ).toBeVisible();
  await budgets.signIn(page, alice);
  await expect(page.getByText(alice.name, { exact: true })).toBeVisible();
  await expect(available(page, alice.category)).toHaveText("$175.00");
  await openRegister(page, alice.account);
  await expect(transactionRow(page, "Alice private merchant")).toBeVisible();

  // Keep the same page and browser storage: clearing either would hide leaks.
  await budgets.signOut(page);
  await expect(
    page.getByText("Sign in to see your budget here."),
  ).toBeVisible();
  await expect(page.getByText(alice.name, { exact: true })).toHaveCount(0);
  await budgets.signIn(page, bob);
  await expect(page.getByText(bob.name, { exact: true })).toBeVisible();
  await expect(available(page, bob.category)).toHaveText("$190.00");
  await expect(page.getByText(/Alice/)).toHaveCount(0);
  await openRegister(page, bob.account);
  await expect(transactionRow(page, "Bob private merchant")).toBeVisible();
  await expect(transactionRow(page, "Alice private merchant")).toHaveCount(0);

  await reloadBudget(page, bob);
  await expect(page.getByText(bob.name, { exact: true })).toBeVisible();
  await expect(available(page, bob.category)).toHaveText("$190.00");
  await expect(page.getByText(/Alice/)).toHaveCount(0);
  await openRegister(page, bob.account);
  await expect(transactionRow(page, "Bob private merchant")).toHaveCount(1);
  await expect(transactionRow(page, "Alice private merchant")).toHaveCount(0);
});
