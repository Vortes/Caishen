import { expect, test } from "@playwright/test";

import { money, openPrototype, pill } from "./prototype-fixture";

test("the prototype moves money from the Available pill without saving it", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  const popover = page.getByRole("dialog", { name: /Gifts/ });

  // Moving more than Gifts holds is caught next to the amount.
  await pill(page, "Gifts").click();
  await expect(popover.getByLabel("Amount")).toHaveValue("100.00");
  await popover.getByLabel("Amount").fill("150");
  await popover.getByRole("combobox", { name: "To" }).click();
  await popover.getByRole("combobox", { name: "To" }).fill("din");
  await popover.getByRole("combobox", { name: "To" }).press("Enter");
  await popover.getByRole("button", { name: "Move", exact: true }).click();
  await expect(popover.getByRole("alert")).toHaveText(
    "Gifts only has $100.00 available.",
  );

  await popover.getByLabel("Amount").fill("50");
  await popover.getByRole("button", { name: "Move", exact: true }).click();
  await expect(popover).not.toBeVisible();
  const covered = plan.expected([
    {
      type: "cover",
      id: "check-cover",
      fromCategoryId: "gifts",
      toCategoryId: "dining",
      month: plan.month,
      amount: 5_000,
    },
  ]);
  await expect(pill(page, "Dining")).toHaveText(
    money(covered.category("dining").available),
  );
  await expect(pill(page, "Gifts")).toHaveText(
    money(covered.category("gifts").available),
  );
  const toast = page.getByRole("status").filter({ hasText: "Moved" });
  await expect(toast).toHaveText(/Moved \$50\.00 from Gifts to Dining/);

  // Undo puts it back.
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(pill(page, "Dining")).toHaveText("-$80.15");
  await expect(pill(page, "Gifts")).toHaveText("$100.00");

  // An overspent pill covers from a source, listing only places with money.
  await pill(page, "Household").click();
  const cover = page.getByRole("dialog", { name: /Household/ });
  await expect(cover.getByLabel("Overspending to cover")).toHaveValue("12.99");
  await cover.getByRole("combobox", { name: "From" }).click();
  await expect(cover.getByRole("option", { name: /Dining/ })).toHaveCount(0);
  await cover.getByRole("option", { name: /^Ready to Assign/ }).click();
  await cover.getByRole("button", { name: "Cover", exact: true }).click();
  const assigned = plan.expected([
    {
      type: "assign",
      id: "check-assign",
      categoryId: "household",
      month: plan.month,
      amount: 1_299,
    },
  ]);
  await expect(pill(page, "Household")).toHaveText("$0.00");
  await expect(
    page.locator("section").filter({ hasText: "Ready to Assign" }).first(),
  ).toContainText(money(assigned.readyToAssign));

  // A second move, so Reset has more than one to drop.
  await pill(page, "Gifts").click();
  await popover.getByRole("combobox", { name: "To" }).click();
  await popover.getByRole("option", { name: /^Phone/ }).click();
  await popover.getByRole("button", { name: "Move", exact: true }).click();
  await expect(pill(page, "Phone")).toHaveText("$100.00");

  // Reset drops every simulated move, and nothing was ever written.
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(pill(page, "Household")).toHaveText("-$12.99");
  await expect(pill(page, "Phone")).toHaveText("$0.00");
  expect(plan.writes).toEqual([]);
});

test("the category inspector opens the same move", async ({ page }) => {
  await openPrototype(page);
  await page.getByRole("button", { name: /^Gifts/ }).click();
  await page.getByRole("button", { name: "Move money", exact: true }).click();
  const popover = page.getByRole("dialog", { name: /Gifts/ });
  await popover.getByRole("combobox", { name: "To" }).click();
  await popover.getByRole("option", { name: /^Rent/ }).click();
  await popover.getByRole("button", { name: "Move", exact: true }).click();
  await expect(pill(page, "Rent")).toHaveText("$600.00");
  await expect(pill(page, "Gifts")).toHaveText("$0.00");
});

test("a popover opened near the bottom of the window opens upward", async ({
  page,
}) => {
  await openPrototype(page);
  await page.setViewportSize({ width: 1440, height: 820 });
  const trigger = await pill(page, "Gifts").boundingBox();
  await pill(page, "Gifts").click();
  const popover = page.getByRole("dialog", { name: /Gifts/ });
  await popover.getByRole("combobox", { name: "To" }).click();
  // Above the pill, inside the window, with the list clear of the footer,
  // once Radix has placed it.
  await expect(async () => {
    const box = (await popover.boundingBox())!;
    const list = (await popover.getByRole("listbox").boundingBox())!;
    const cancel = (await popover
      .getByRole("button", { name: "Cancel" })
      .boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(trigger!.y);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(list.y + list.height).toBeLessThanOrEqual(cancel.y);
  }).toPass();
});
