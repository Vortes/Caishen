import { expect, test } from "./shell-fixture";
import {
  assigned,
  readyToAssign,
  reloadBudget,
  saved,
  showMonth,
} from "./shell-controls";

test("Auto-Assign from a category's details survives reload with the correct Ready to Assign", async ({
  page,
  budget,
}) => {
  const next = new Date(`${budget.month}-15T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const month = next.toISOString().slice(0, 7);
  await showMonth(page, month);
  await expect(assigned(page, "Gifts")).toHaveText("$0.00");
  await page
    .getByRole("checkbox", { name: "Select Gifts", exact: true })
    .click();
  const details = page.getByRole("complementary", {
    name: "Details",
    exact: true,
  });
  await details.getByRole("tab", { name: "Auto-Assign", exact: true }).click();
  await details.getByRole("button", { name: /^Assigned last month/ }).click();
  await saved(page);

  await reloadBudget(page, budget);
  await showMonth(page, month);
  await expect(assigned(page, "Gifts")).toHaveText("$100.00");
  await expect(assigned(page, budget.category)).toHaveText("$0.00");
  // $1,000 cash - $300 assigned this month - $100 next month.
  await expect(readyToAssign(page)).toHaveText("$600.00");
});
