import { expect, test } from "./shell-fixture";
import {
  reloadBudget,
  available,
  editAssigned,
  notifications,
  readyToAssign,
  saved,
} from "./shell-controls";

// Undo covers what this browser load changed (ADR 0006); a reload starts
// a fresh history and keeps what was saved.
test("a change can be undone and redone during the visit that made it", async ({
  page,
  budget,
}) => {
  await expect(available(page, budget.category)).toHaveText("$200.00");
  const input = await editAssigned(page, "Gifts");
  await input.fill("150");
  await input.press("Enter");
  await expect(available(page, "Gifts")).toHaveText("$150.00");
  await saved(page);

  await page.locator("#app-content").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(available(page, "Gifts")).toHaveText("$100.00");
  await expect(readyToAssign(page)).toHaveText("$700.00");
  await expect(notifications(page)).toContainText("Action undone.");

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(available(page, "Gifts")).toHaveText("$150.00");
  await expect(notifications(page)).toContainText("Action redone.");

  await reloadBudget(page, budget);
  await expect(available(page, "Gifts")).toHaveText("$150.00");
  await expect(readyToAssign(page)).toHaveText("$650.00");
  await page.locator("#app-content").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(notifications(page)).not.toContainText("Action undone.");
  await expect(available(page, "Gifts")).toHaveText("$150.00");
  await expect(available(page, budget.category)).toHaveText("$200.00");
});
