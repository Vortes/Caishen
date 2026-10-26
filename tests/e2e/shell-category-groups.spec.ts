import { expect, test } from "./shell-fixture";
import { notifications, reloadBudget, saved } from "./shell-controls";

test("category groups and their categories are added separately and persist", async ({
  page,
  budget,
}) => {
  const groups = page
    .getByRole("group", { name: "Categories", exact: true })
    .getByRole("button", { expanded: true });
  const row = (name: string) =>
    page
      .getByRole("group", { name: "Categories", exact: true })
      .locator("[data-row]")
      .filter({ hasText: name });

  // A new category group starts empty and folded, before spending groups;
  // its header's + adds the first category.
  await page
    .getByRole("button", { name: "Add category group", exact: true })
    .click();
  const groupForm = page.getByRole("dialog", { name: "Add a category group" });
  await groupForm.getByLabel("Group name").fill("everyday");
  await groupForm.getByLabel("Group name").press("Enter");
  await expect(groupForm.getByRole("alert")).toHaveText(
    "You already have a group called Everyday.",
  );
  await groupForm.getByLabel("Group name").fill("Bills");
  await groupForm.getByLabel("Group name").press("Enter");
  await saved(page);
  await expect(notifications(page)).toContainText("Added the Bills group");
  const bills = page.getByRole("button", { name: /^Bills$/ });
  await expect(bills).toBeFocused();
  await expect(bills).toHaveAttribute("aria-expanded", "false");
  await expect(groups).toHaveText([/^People$/, /^Everyday/]);
  await expect(
    page.getByRole("button", { name: "Add category", exact: true }),
  ).toHaveCount(0);

  await bills.hover();
  await page
    .getByRole("button", { name: "Add a category to Bills", exact: true })
    .click();
  const billsForm = page.getByRole("dialog", {
    name: "Add a category to Bills",
  });
  await billsForm.getByLabel("Category name").fill("Rent");
  await billsForm.getByLabel("Category name").press("Enter");
  await saved(page);
  await expect(row("Rent")).toBeFocused();
  await expect(groups).toHaveText([/^People$/, /^Bills$/, /^Everyday/]);

  // An existing group's header + adds to that group, refusing duplicates.
  await page.getByRole("button", { name: /^Everyday \d+$/ }).hover();
  await page
    .getByRole("button", { name: "Add a category to Everyday", exact: true })
    .click();
  const everydayForm = page.getByRole("dialog", {
    name: "Add a category to Everyday",
  });
  await everydayForm
    .getByLabel("Category name")
    .fill(budget.category.toUpperCase());
  await everydayForm.getByLabel("Category name").press("Enter");
  await expect(everydayForm.getByRole("alert")).toHaveText(
    `Everyday already has ${budget.category}.`,
  );
  await everydayForm.getByLabel("Category name").fill("Coffee");
  await everydayForm.getByLabel("Category name").press("Enter");
  await saved(page);
  await expect(row("Coffee")).toBeFocused();

  await reloadBudget(page, budget);
  await expect(groups).toHaveText([/^People$/, /^Bills$/, /^Everyday$/]);
  await expect(row("Rent")).toBeVisible();
  await expect(row("Coffee")).toBeVisible();
});
