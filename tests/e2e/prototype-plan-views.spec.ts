import { expect, test, type Page } from "@playwright/test";

import { openPrototype, pill } from "./prototype-fixture";

const views = (page: Page) => page.getByRole("group", { name: "Plan views" });
const chip = (page: Page, name: string) =>
  views(page).getByRole("button", { name: new RegExp(`^${name}`) });
const row = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name} `) });

async function move(page: Page, from: string, to: string, amount?: string) {
  await pill(page, from).click();
  const popover = page.getByRole("dialog", { name: new RegExp(from) });
  if (amount) await popover.getByRole("textbox").first().fill(amount);
  const destination = popover.getByRole("combobox");
  await destination.click();
  await popover.getByRole("option", { name: new RegExp(`^${to}`) }).click();
  await popover.getByRole("button", { name: /^(Move|Cover)$/ }).click();
  await expect(popover).not.toBeVisible();
}

test("YNAB's preset views filter the plan and count their categories", async ({
  page,
}) => {
  await openPrototype(page);
  await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(page, "Overspent")).toHaveText("Overspent2");
  // Dining's overspending is cash, so the chip is red, not yellow.
  await expect(chip(page, "Overspent")).toHaveAttribute("data-tone", "red");
  await expect(chip(page, "Snoozed")).toHaveText("Snoozed0");
  await expect(chip(page, "Underfunded")).toHaveText("Underfunded3");
  await expect(chip(page, "Overfunded")).toHaveText("Overfunded0");
  await expect(chip(page, "Money available")).toHaveText("Money available3");

  // Underfunded: Phone's unmet target and both overspent categories, under
  // their groups, with group totals for what's showing.
  await chip(page, "Underfunded").click();
  await expect(row(page, "Phone")).toBeVisible();
  await expect(row(page, "Household")).toBeVisible();
  await expect(row(page, "Dining")).toBeVisible();
  await expect(row(page, "Rent")).toHaveCount(0);
  await expect(row(page, "Gifts")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Bills 2/ })).toBeVisible();

  // Picking the selected view again shows every category.
  await chip(page, "Underfunded").click();
  await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");
  await expect(row(page, "Rent")).toBeVisible();

  // Covering Household leaves only Dining's cash overspending.
  await chip(page, "Overspent").click();
  await move(page, "Household", "Ready to Assign");
  await expect(row(page, "Household")).toHaveCount(0);
  await expect(chip(page, "Overspent")).toHaveText("Overspent1");

  // Covering the last one keeps the view, now empty, until you leave it.
  await move(page, "Dining", "Rent");
  await expect(page.getByText("Nothing is overspent.")).toBeVisible();
  await chip(page, "Money available").click();
  await expect(chip(page, "Overspent")).toHaveCount(0);

  // More assigned than Phone's $65 target needs shows as overfunded.
  await move(page, "Gifts", "Phone");
  await chip(page, "Overfunded").click();
  await expect(row(page, "Phone")).toBeVisible();
  await expect(chip(page, "Overfunded")).toHaveText("Overfunded1");
});

test("the selected view is remembered on this device", async ({ page }) => {
  await openPrototype(page);
  await chip(page, "Money available").click();
  await page.reload();
  await expect(chip(page, "Money available")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(row(page, "Phone")).toHaveCount(0);
  await expect(row(page, "Rent")).toBeVisible();
});
