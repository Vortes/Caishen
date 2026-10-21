import { expect, test, type Page } from "@playwright/test";

import { notifications, openPrototype } from "./prototype-fixture";

const form = (page: Page) =>
  page.getByRole("dialog", { name: "Add a category" });
const groupField = (page: Page) =>
  form(page).getByRole("combobox", { name: "Group" });
const categoryRow = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Categories" })
    .locator("[data-row]")
    .filter({ hasText: name });

test("adds a category to a chosen group, checks it first, and undoes", async ({
  page,
}) => {
  const plan = await openPrototype(page);

  // A selected category's group is where the new one starts.
  await categoryRow(page, "Dining").click();
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(form(page).getByLabel("Name")).toBeFocused();
  await expect(groupField(page)).toHaveValue("Everyday");

  // Card payments aren't offered as a group, and the list closes on a pick.
  await groupField(page).click();
  await expect(form(page).getByRole("option")).toHaveText([
    "Bills",
    "Everyday",
  ]);
  await groupField(page).press("ArrowDown");
  await groupField(page).press("Enter");
  await expect(groupField(page)).toHaveValue("Bills");
  await expect(form(page).getByRole("listbox")).toBeHidden();

  // Mistakes are caught next to their field, unsent.
  await form(page).getByRole("button", { name: "Add category" }).click();
  await expect(form(page).getByRole("alert")).toHaveText(
    "Enter a name for the category.",
  );
  await expect(form(page).getByLabel("Name")).toBeFocused();
  await form(page).getByLabel("Name").fill("phone");
  await form(page).getByLabel("Name").press("Enter");
  await expect(form(page).getByRole("alert")).toHaveText(
    "Bills already has Phone.",
  );
  await form(page).getByLabel("Name").fill("Streaming");
  await groupField(page).fill("credit card payments");
  await groupField(page).press("Enter");
  await expect(form(page).getByRole("alert")).toHaveText(
    "Credit card payments only holds payment categories. Choose another group.",
  );
  expect(plan.writes).toEqual([]);

  // A group typed in another case joins the existing group.
  await groupField(page).fill("bills");
  await groupField(page).press("Enter");
  await expect(form(page)).toBeHidden();
  await expect(notifications(page)).toContainText("Added Streaming to Bills");
  expect(plan.commands).toEqual([
    {
      type: "category.add",
      id: expect.any(String),
      categoryId: expect.any(String),
      name: "Streaming",
      group: "Bills",
    },
  ]);

  // The new category is selected with its details open, and focused.
  await expect(categoryRow(page, "Streaming")).toBeFocused();
  await expect(categoryRow(page, "Streaming")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(
    page.getByRole("complementary", { name: "Details" }),
  ).toContainText("Streaming");

  await expect(async () => {
    if (plan.historyCalls.length === 0) {
      await page.locator("#prototype-content").focus();
      await page.keyboard.press("Meta+z");
    }
    expect(plan.historyCalls).toHaveLength(1);
  }).toPass();
  await expect(notifications(page)).toContainText("Action undone.");
  await expect(categoryRow(page, "Streaming")).toHaveCount(0);
});

test("N starts a new group from any plan view and shows the category", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await page.getByRole("button", { name: /^Money available/ }).click();

  await page.locator("#prototype-content").focus();
  await page.keyboard.press("n");
  await form(page).getByLabel("Name").fill("Vet");
  await groupField(page).fill("Pets");
  await expect(form(page).getByText("Starts a new group")).toBeVisible();
  await groupField(page).press("Enter");

  await expect(form(page)).toBeHidden();
  expect(plan.commands).toEqual([
    expect.objectContaining({ name: "Vet", group: "Pets" }),
  ]);
  // A view that would hide it goes back to every category.
  await expect(page.getByRole("button", { name: "All" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: /^Pets/ })).toBeVisible();
  await expect(categoryRow(page, "Vet")).toBeFocused();

  // Escape closes the form without adding anything.
  await page.keyboard.press("n");
  await expect(form(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(form(page)).toBeHidden();
  expect(plan.commands).toHaveLength(1);
});

test("an empty plan adds its first category in one field", async ({ page }) => {
  const plan = await openPrototype(page, { empty: true });

  await expect(page.getByText("Give every dollar a job.")).toBeVisible();
  await page.getByRole("button", { name: "Add your first category" }).click();
  await expect(groupField(page)).toHaveValue("Everyday");
  await form(page).getByLabel("Name").fill("Rent");
  await form(page).getByLabel("Name").press("Enter");

  await expect(form(page)).toBeHidden();
  expect(plan.commands).toEqual([
    expect.objectContaining({ name: "Rent", group: "Everyday" }),
  ]);
  await expect(categoryRow(page, "Rent")).toBeVisible();
  await expect(page.getByText("Give every dollar a job.")).toHaveCount(0);
});
