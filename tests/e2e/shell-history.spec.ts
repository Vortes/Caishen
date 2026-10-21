import { expect, test } from "./shell-fixture";
import {
  reloadBudget,
  assigned,
  available,
  editAssigned,
  notifications,
  readyToAssign,
  saved,
} from "./shell-controls";

test("a saved action can be undone and redone across reloads", async ({
  page,
  budget,
}) => {
  await expect(available(page, budget.category)).toHaveText("$200.00");
  const input = await editAssigned(page, "Gifts");
  await input.fill("150");
  await input.press("Enter");
  await saved(page);

  await reloadBudget(page, budget);
  await expect(available(page, "Gifts")).toHaveText("$150.00");
  await expect(readyToAssign(page)).toHaveText("$650.00");
  await expect(assigned(page, "Gifts")).not.toHaveAttribute("aria-disabled");
  await page.locator("#prototype-content").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(notifications(page)).toContainText("Action undone.");

  await reloadBudget(page, budget);
  await expect(available(page, "Gifts")).toHaveText("$100.00");
  await expect(readyToAssign(page)).toHaveText("$700.00");
  await expect(assigned(page, "Gifts")).not.toHaveAttribute("aria-disabled");
  await page.locator("#prototype-content").focus();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(notifications(page)).toContainText("Action redone.");

  await reloadBudget(page, budget);
  await expect(available(page, "Gifts")).toHaveText("$150.00");
  await expect(readyToAssign(page)).toHaveText("$650.00");
  await expect(available(page, budget.category)).toHaveText("$200.00");
});
