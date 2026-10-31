import { expect, shellPath, test } from "./shell-fixture";
import { available, reloadBudget, saved } from "./shell-controls";

test("Tab takes the typed destination and the move lands there", async ({
  page,
  budgets,
}) => {
  const budget = await budgets.create({ categories: ["Rent"] });
  await page.goto(shellPath);
  await budgets.signIn(page, budget);
  await expect(available(page, "Rent")).toHaveText("$0.00");

  await available(page, budget.category).click();
  const move = page.getByRole("dialog", { name: /Groceries/ });
  await move.getByLabel("Amount", { exact: true }).fill("25");
  const to = move.getByRole("combobox", { name: "To", exact: true });
  await to.fill("ren");
  await to.press("Tab");
  await expect(
    move.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await expect(to).toHaveValue("Rent");
  await move.getByRole("button", { name: "Move", exact: true }).click();
  await saved(page);

  await expect(available(page, "Rent")).toHaveText("$25.00");
  await reloadBudget(page, budget);
  await expect(available(page, "Rent")).toHaveText("$25.00");
  await expect(available(page, budget.category)).toHaveText("$175.00");
});
