import { expect, test } from "./shell-fixture";
import {
  reloadBudget,
  assigned,
  editAssigned,
  readyToAssign,
  saved,
  showMonth,
} from "./shell-controls";

test("an assignment survives reload in its intended month with the correct Ready to Assign", async ({
  page,
  budget,
}) => {
  const next = new Date(`${budget.month}-15T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const month = next.toISOString().slice(0, 7);
  await showMonth(page, month);
  await expect(assigned(page, "Gifts")).toHaveText("$0.00");
  const input = await editAssigned(page, "Gifts");
  await input.fill("75.50");
  await input.press("Enter");
  await saved(page);

  await reloadBudget(page, budget);
  await expect(assigned(page, "Gifts")).toHaveText("$100.00");
  await showMonth(page, month);
  await expect(assigned(page, "Gifts")).toHaveText("$75.50");
  // $1,000 cash - $300 assigned this month - $75.50 next month.
  await expect(readyToAssign(page)).toHaveText("$624.50");
});
