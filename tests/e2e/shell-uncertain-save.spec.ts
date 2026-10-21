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

    // Request an ordinary JSON response so its success can be checked only
    // after tRPC has awaited the database commit. No synthetic budget response
    // is ever delivered; the retry and all reads reach the real server.
    const response = await route.fetch({
      headers: {
        ...route.request().headers(),
        "trpc-accept": "application/json",
      },
      maxRetries: 0,
    });
    try {
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject([
        { result: { data: { json: { revision: expect.any(Number) } } } },
      ]);
      await route.abort("connectionreset");
      droppedCommittedResponse = true;
    } finally {
      await response.dispose();
    }
  });

  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toContainText(
    "Not saved. Your changes are still here, so you can try again.",
  );
  expect(droppedCommittedResponse).toBe(true);
  await expect(form.getByLabel("Payee", { exact: true })).toHaveValue(
    "Uncertain market",
  );
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
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
