import { expect, test } from "./shell-fixture";
import {
  reloadBudget,
  accountBalance,
  available,
  fillPurchase,
  openRegister,
  saved,
  transactionRow,
  transactions,
} from "./shell-controls";

test("retrying a purchase whose committed response was lost has exactly one financial effect", async ({
  page,
  budget,
}) => {
  await openRegister(page, budget.account);
  const form = await fillPurchase(page, budget, "Uncertain market", "12.50");
  let attempts = 0;
  let droppedCommittedResponse = false;
  await page.route(/\/api\/trpc\/budget\.execute(?:\?|$)/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts++;
    if (attempts !== 1) return route.continue();

    // Let the server commit, then lose its answer. No synthetic budget
    // response is ever delivered; the retry and all reads reach the real
    // server.
    const response = await route.fetch({ maxRetries: 0 });
    try {
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({
        result: { data: { json: { revision: expect.any(Number) } } },
      });
      await route.abort("connectionreset");
      droppedCommittedResponse = true;
    } finally {
      await response.dispose();
    }
  });

  // The editor closes as the purchase shows; the browser retries the lost
  // answer with the same operation on its own.
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(transactionRow(page, "Uncertain market")).toContainText(
    "$12.50",
  );
  await saved(page);
  expect(droppedCommittedResponse).toBe(true);
  expect(attempts).toBe(2);

  await reloadBudget(page, budget);
  await expect(available(page, budget.category)).toHaveText("$187.50");
  await openRegister(page, budget.account);
  await expect(transactions(page)).toHaveCount(1);
  await expect(transactionRow(page, "Uncertain market")).toContainText(
    "$12.50",
  );
  await expect(accountBalance(page)).toHaveText("$987.50");
});
