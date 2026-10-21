import { expect, test } from "./shell-fixture";
import {
  reloadBudget,
  available,
  readyToAssign,
  saved,
} from "./shell-controls";

test("moving money persists both category balances and preserves the total", async ({
  page,
  budget,
}) => {
  await expect(available(page, budget.category)).toHaveText("$200.00");
  await expect(available(page, "Gifts")).toHaveText("$100.00");
  await available(page, "Gifts").click();
  const move = page.getByRole("dialog", { name: /Gifts/ });
  await move.getByLabel("Amount", { exact: true }).fill("25");
  await move.getByRole("combobox").click();
  await move.getByRole("option", { name: /^Groceries/ }).click();
  await move.getByRole("button", { name: "Move", exact: true }).click();
  await saved(page);

  await reloadBudget(page, budget);
  await expect(available(page, budget.category)).toHaveText("$225.00");
  await expect(available(page, "Gifts")).toHaveText("$75.00");
  await expect(readyToAssign(page)).toHaveText("$700.00");
  const total = page
    .getByRole("complementary", { name: "Details", exact: true })
    .getByText("Available", { exact: true })
    .locator("..");
  await expect(total).toContainText("$300.00");
});
