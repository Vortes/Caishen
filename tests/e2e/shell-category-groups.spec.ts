import { expect, test } from "./shell-fixture";
import {
  notifications,
  openRegister,
  reloadBudget,
  saved,
} from "./shell-controls";

test("category groups and their categories are added separately and persist", async ({
  page,
  budget,
}) => {
  // The plan's groups, top first, by their header toggles.
  const groups = () =>
    page
      .getByRole("group", { name: "Categories", exact: true })
      .locator("[data-group-toggle]")
      .evaluateAll((toggles) =>
        toggles.map((toggle) => toggle.getAttribute("data-group-toggle")),
      );
  const row = (name: string) =>
    page
      .getByRole("group", { name: "Categories", exact: true })
      .locator("[data-row]")
      .filter({ hasText: name });

  // A new category group opens empty, before spending groups, with focus
  // on its header; the header's + adds the first category.
  await page
    .getByRole("button", { name: "Add category group", exact: true })
    .click();
  const groupForm = page.getByRole("dialog", { name: "Add a category group" });
  await groupForm.getByLabel("Group name").fill("everyday");
  await groupForm.getByLabel("Group name").press("Enter");
  await expect(groupForm.getByLabel("Group name")).toHaveAccessibleDescription(
    "You already have a group called Everyday.",
  );
  await groupForm.getByLabel("Group name").fill("Bills");
  await groupForm.getByLabel("Group name").press("Enter");
  await saved(page);
  await expect(notifications(page)).toContainText("Added the Bills group");
  const bills = page.getByRole("button", { name: /^Bills$/ });
  await expect(bills).toBeFocused();
  await expect(bills).toHaveAttribute("aria-expanded", "true");
  await expect.poll(groups).toEqual(["People", "Bills", "Everyday"]);
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
  await expect.poll(groups).toEqual(["People", "Bills", "Everyday"]);

  // An existing group's header + adds to that group, refusing duplicates.
  await page.getByRole("button", { name: "Everyday", exact: true }).hover();
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
  await expect(
    everydayForm.getByLabel("Category name"),
  ).toHaveAccessibleDescription(`Everyday already has ${budget.category}.`);
  await everydayForm.getByLabel("Category name").fill("Coffee");
  await everydayForm.getByLabel("Category name").press("Enter");
  await saved(page);
  await expect(row("Coffee")).toBeFocused();

  await reloadBudget(page, budget);
  await expect.poll(groups).toEqual(["People", "Bills", "Everyday"]);
  await expect(row("Rent")).toBeVisible();
  await expect(row("Coffee")).toBeVisible();
});

test("a category in a new group is added from a transaction's Category field and shows on the plan", async ({
  page,
  budget,
}) => {
  await openRegister(page, budget.account);
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Date calendar", exact: true })
    .press("Escape");
  const transaction = page.getByRole("form", {
    name: "New transaction",
    exact: true,
  });
  const category = transaction.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  await category.fill("Dog walker");
  await category.press("Enter");

  const form = page.getByRole("dialog", { name: "Add a category" });
  const group = form.getByRole("combobox", { name: "Category group" });
  await expect(group).toHaveValue("Everyday");
  await group.fill("Pets");
  await group.press("Enter");
  const newGroup = form.getByRole("textbox", { name: "New group" });
  await expect(newGroup).toHaveValue("Pets");
  await expect(newGroup).toBeFocused();
  await form
    .getByRole("button", { name: "Add group and category", exact: true })
    .click();
  await saved(page);
  await expect(notifications(page)).toContainText(
    "Added the Pets group with Dog walker",
  );
  await expect(category).toHaveValue("Dog walker");
  await transaction
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  await reloadBudget(page, budget);
  const pets = page.getByRole("button", { name: /^Pets/ });
  await expect(pets).toBeVisible();
  if ((await pets.getAttribute("aria-expanded")) === "false")
    await pets.click();
  await expect(
    page
      .getByRole("group", { name: "Categories", exact: true })
      .locator("[data-row]")
      .filter({ hasText: "Dog walker" }),
  ).toBeVisible();
});
