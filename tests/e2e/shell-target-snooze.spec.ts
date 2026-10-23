import { expect, test } from "./shell-fixture";
import { notifications, reloadBudget } from "./shell-controls";

test("the month picker crosses years and a target can be snoozed and resumed after reload", async ({
  page,
  budget,
}) => {
  const gifts = page
    .getByRole("group", { name: "Categories", exact: true })
    .getByRole("button", { name: /^Gifts / })
    .getByText("Gifts", { exact: true });
  await gifts.click();
  await page
    .getByRole("button", { name: "Create target", exact: true })
    .click();
  const form = page.getByRole("form", { name: "Create target for Gifts" });
  await form.getByRole("textbox", { name: "I need", exact: true }).fill("50");
  await form.getByRole("button", { name: "Save target", exact: true }).click();
  await expect(notifications(page)).toContainText("Added a target to Gifts");

  const picker = page.getByRole("button", { name: /, choose a month$/ });
  await picker.click();
  await page.getByRole("button", { name: "Next year", exact: true }).click();
  const futureYear = Number(budget.month.slice(0, 4)) + 1;
  await page
    .getByRole("button", { name: `February ${futureYear}`, exact: true })
    .click();
  await expect(picker).toHaveText(`February ${futureYear}`);
  const snooze = page.getByRole("switch", { name: /^Snooze for/ });
  await expect(snooze).toBeDisabled();

  await picker.click();
  await page.getByRole("button", { name: "This month", exact: true }).click();
  await expect(snooze).toBeEnabled();
  await snooze.click();
  await expect(notifications(page)).toContainText("Snoozed the Gifts target");
  await expect(snooze).toBeChecked();

  await reloadBudget(page, budget);
  await gifts.click();
  await expect(snooze).toBeChecked();
  await snooze.click();
  await expect(notifications(page)).toContainText("Resumed the Gifts target");
  await expect(snooze).not.toBeChecked();

  await reloadBudget(page, budget);
  await gifts.click();
  await expect(snooze).not.toBeChecked();
});
