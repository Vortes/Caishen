import { expect, test, type Page } from "@playwright/test";

import { notifications, openPrototype } from "./prototype-fixture";

const groupForm = (page: Page) =>
  page.getByRole("dialog", { name: "Add a category group" });
const categoryForm = (page: Page, group: string) =>
  page.getByRole("dialog", { name: `Add a category to ${group}` });
const categoryRow = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Categories" })
    .locator("[data-row]")
    .filter({ hasText: name });
const groupToggle = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name} \\d+$`) });

async function undoOnce(page: Page, calls: { length: number }) {
  const count = calls.length + 1;
  await expect(async () => {
    if (calls.length < count) {
      await page.locator("#prototype-content").focus();
      await page.keyboard.press("Meta+z");
    }
    expect(calls.length).toBe(count);
  }).toPass();
}

test("a group header's + adds a category to that group, and it undoes", async ({
  page,
}) => {
  const plan = await openPrototype(page);

  // Card payment groups take no categories of their own.
  await expect(
    page.getByRole("button", {
      name: "Add a category to Credit card payments",
    }),
  ).toHaveCount(0);

  await groupToggle(page, "Everyday").hover();
  await page
    .getByRole("button", { name: "Add a category to Everyday" })
    .click();
  const form = categoryForm(page, "Everyday");
  await expect(form.getByLabel("Category name")).toBeFocused();

  // Mistakes are caught next to the field, unsent.
  await form.getByRole("button", { name: "Add category" }).click();
  await expect(form.getByRole("alert")).toHaveText(
    "Enter a name for the category.",
  );
  await form.getByLabel("Category name").fill("gifts");
  await form.getByLabel("Category name").press("Enter");
  await expect(form.getByRole("alert")).toHaveText(
    "Everyday already has Gifts.",
  );
  expect(plan.writes).toEqual([]);

  await form.getByLabel("Category name").fill("Streaming");
  await form.getByLabel("Category name").press("Enter");
  await expect(form).toBeHidden();
  expect(plan.commands).toEqual([
    {
      type: "category.add",
      id: expect.any(String),
      categoryId: expect.any(String),
      name: "Streaming",
      group: "Everyday",
    },
  ]);
  await expect(notifications(page)).toContainText(
    "Added Streaming to Everyday",
  );

  // The new category is selected with its details open, and focused.
  await expect(categoryRow(page, "Streaming")).toBeFocused();
  await expect(categoryRow(page, "Streaming")).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(
    page.getByRole("complementary", { name: "Details" }),
  ).toContainText("Streaming");

  await undoOnce(page, plan.historyCalls);
  await expect(notifications(page)).toContainText("Action undone.");
  await expect(categoryRow(page, "Streaming")).toHaveCount(0);
});

test("Add category group makes an empty group ready for its first category", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  // A view that would hide the new group goes back to every category.
  await page.getByRole("button", { name: /^Money available/ }).click();

  await page.locator("#prototype-content").focus();
  await page.keyboard.press("n");
  await expect(groupForm(page).getByLabel("Group name")).toBeFocused();
  await groupForm(page).getByLabel("Group name").fill("everyday");
  await groupForm(page).getByLabel("Group name").press("Enter");
  await expect(groupForm(page).getByRole("alert")).toHaveText(
    "You already have a group called Everyday.",
  );
  await groupForm(page).getByLabel("Group name").fill("Pets");
  await groupForm(page).getByLabel("Group name").press("Enter");

  await expect(groupForm(page)).toBeHidden();
  expect(plan.commands).toEqual([
    { type: "group.add", id: expect.any(String), name: "Pets" },
  ]);
  await expect(notifications(page)).toContainText("Added the Pets group");
  await expect(page.getByRole("button", { name: "All" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(groupToggle(page, "Pets")).toHaveText(/Pets\s*0/);
  // New groups lead the plan.
  await expect(
    page.getByRole("group", { name: "Categories" }).getByRole("button", {
      expanded: true,
    }),
  ).toHaveText([/^Pets/, /^Credit card payments/, /^Bills/, /^Everyday/]);

  // Focus waits on the empty group's Add category, the next step.
  const next = page.locator('[data-add-category="Pets"]');
  await expect(next).toBeFocused();
  await next.click();
  await categoryForm(page, "Pets").getByLabel("Category name").fill("Vet");
  await categoryForm(page, "Pets").getByLabel("Category name").press("Enter");
  await expect(categoryRow(page, "Vet")).toBeFocused();
  await expect(page.locator('[data-add-category="Pets"]')).toHaveCount(0);
  expect(plan.commands.at(-1)).toEqual(
    expect.objectContaining({ name: "Vet", group: "Pets" }),
  );

  // Escape closes the group form without adding anything.
  await page.locator("#prototype-content").focus();
  await page.keyboard.press("n");
  await expect(groupForm(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(groupForm(page)).toBeHidden();
  expect(plan.commands).toHaveLength(2);
});

test("an empty plan starts with a category group", async ({ page }) => {
  const plan = await openPrototype(page, { empty: true });

  await expect(page.getByText("Give every dollar a job.")).toBeVisible();
  await page.getByRole("button", { name: "Add a category group" }).click();
  await groupForm(page).getByLabel("Group name").fill("Bills");
  await groupForm(page).getByLabel("Group name").press("Enter");

  await expect(groupToggle(page, "Bills")).toBeVisible();
  await expect(page.locator('[data-add-category="Bills"]')).toBeFocused();
  expect(plan.commands).toEqual([
    expect.objectContaining({ type: "group.add", name: "Bills" }),
  ]);
});
