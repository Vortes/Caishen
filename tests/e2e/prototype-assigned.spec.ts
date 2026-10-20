import { expect, test, type Page } from "@playwright/test";

import {
  money,
  moveSaved,
  notifications,
  openPrototype,
  pill,
  toastUndo,
} from "./prototype-fixture";

// The Assigned amount on a plan row, and the field it opens.
const amount = (page: Page, name: string) =>
  page.getByRole("button", {
    name: new RegExp(`assigned to ${name}\\. Edit assigned amount$`),
  });
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name: `Assigned amount for ${name}` });

// Presses a history shortcut from the plan, outside any field.
async function shortcut(page: Page, keys = "Meta+z") {
  await page.locator("#prototype-content").focus();
  await page.keyboard.press(keys);
}

// Undoes or redoes once the shell is idle; see prototype-move-money.spec.ts.
async function changeHistory(
  page: Page,
  calls: { length: number },
  keys = "Meta+z",
) {
  const count = calls.length + 1;
  await expect(async () => {
    if (calls.length < count) await shortcut(page, keys);
    expect(calls.length).toBe(count);
  }).toPass();
}

// Opens a row's Assigned field once the shell is idle enough to edit.
async function edit(page: Page, name: string) {
  await expect(amount(page, name)).not.toHaveAttribute("aria-disabled");
  await amount(page, name).click();
  await expect(field(page, name)).toBeFocused();
  return field(page, name);
}

test("a typed total assigns the difference, once, before the server answers", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await expect(amount(page, "Gifts")).toHaveText("$100.00");

  const input = await edit(page, "Gifts");
  await expect(input).toHaveValue("100.00");
  await input.fill("$50 + 25.50");

  const expected = plan.expected([
    {
      type: "assign",
      id: "check",
      categoryId: "gifts",
      month: plan.month,
      amount: -2_450,
    },
  ]);
  const release = plan.holdExecute();
  try {
    // Enter sends it; the blur that follows and a second Enter don't.
    await input.press("Enter");
    await input.press("Enter");
    await expect(input).toHaveAttribute("aria-busy", "true");
    await page.keyboard.press("Tab");
    await expect(pill(page, "Gifts")).toHaveText(
      money(expected.category("gifts").available),
    );
    // The screen updates first; the request reaches the server just after.
    await expect.poll(() => plan.writes).toEqual(["budget.execute"]);
    expect(plan.commands).toEqual([]);
  } finally {
    release();
  }

  await moveSaved(page);
  await expect(amount(page, "Gifts")).toHaveText("$75.50");
  // Focus had moved on before the save finished, so it stays there.
  await expect(amount(page, "Gifts")).not.toBeFocused();
  expect(plan.executions).toEqual([
    {
      command: {
        type: "assign",
        id: expect.any(String),
        categoryId: "gifts",
        month: plan.month,
        amount: -2_450,
      },
      expectedRevision: 0,
    },
  ]);
  expect(plan.saved().category("gifts").assigned).toBe(7_550);
  expect(plan.saved().readyToAssign).toBe(expected.readyToAssign);
  await expect(notifications(page)).toContainText(
    "Gifts now has $75.50 assigned",
  );

  // Subtracting from the keyboard: focus returns to the amount, which a
  // blur after saving can't send again.
  const again = await edit(page, "Rent");
  await again.fill("-100+450");
  await again.press("Enter");
  await expect(amount(page, "Rent")).toHaveText("$350.00");
  await expect(amount(page, "Rent")).toBeFocused();
  await moveSaved(page);
  await page.keyboard.press("Tab");
  expect(plan.commands.at(-1)).toEqual({
    type: "assign",
    id: expect.any(String),
    categoryId: "rent",
    month: plan.month,
    amount: -15_000,
  });
  expect(plan.commands).toHaveLength(2);
});

test("an unchanged amount or Escape closes without saving", async ({
  page,
}) => {
  const plan = await openPrototype(page);

  const input = await edit(page, "Rent");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(amount(page, "Rent")).toBeFocused();

  // The same total written differently is still no change.
  await amount(page, "Rent").press("Enter");
  await field(page, "Rent").fill("$500");
  await page.locator("#prototype-content").focus();
  await expect(field(page, "Rent")).toHaveCount(0);

  await amount(page, "Rent").click();
  await field(page, "Rent").fill("800");
  await field(page, "Rent").press("Escape");
  await expect(field(page, "Rent")).toHaveCount(0);
  await expect(amount(page, "Rent")).toHaveText("$500.00");
  await expect(amount(page, "Rent")).toBeFocused();
  // Escape belonged to the field: the row stays selected.
  const gifts = page
    .getByRole("group", { name: "Categories" })
    .getByRole("button", { name: /^Gifts/ });
  await gifts.click();
  await amount(page, "Rent").click();
  await field(page, "Rent").press("Escape");
  await expect(gifts).toHaveAttribute("aria-current", "true");
  expect(plan.writes).toEqual([]);
});

test("an amount that doesn't parse stays in the field with its error", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  const input = await edit(page, "Gifts");
  await input.fill("12..5");
  await input.press("Enter");
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAccessibleDescription(
    "Enter an amount or add/subtract amounts, such as 600+1000.",
  );
  await expect(notifications(page).getByRole("alert")).toContainText(
    "Enter an amount or add/subtract amounts",
  );

  // Leaving the field keeps the draft and the error.
  await page.locator("#prototype-content").focus();
  await expect(input).toHaveValue("12..5");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  expect(plan.writes).toEqual([]);

  await input.fill("60+30.25");
  await input.press("Enter");
  await expect(amount(page, "Gifts")).toHaveText("$90.25");
  await moveSaved(page);
  expect(plan.commands).toEqual([
    expect.objectContaining({ categoryId: "gifts", amount: -975 }),
  ]);
});

test("a failed save rolls back and retries the same change", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  plan.rejectNextExecute("The update could not be saved. Try again.");
  const input = await edit(page, "Gifts");
  await input.fill("90");
  await input.press("Enter");

  await expect(notifications(page).getByRole("alert")).toContainText(
    "The update could not be saved. Try again.",
  );
  await expect(input).toHaveValue("90");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toBeFocused();
  await expect(pill(page, "Gifts")).toHaveText("$100.00");
  expect(plan.commands).toEqual([]);

  // The retry is the same change: the server sees the same operation. A
  // press while the failure is still settling waits its turn.
  const release = plan.holdExecute();
  try {
    await expect(async () => {
      if (plan.executions.length < 2) await input.press("Enter");
      expect(plan.executions).toHaveLength(2);
    }).toPass();
    await expect(pill(page, "Gifts")).toHaveText("$90.00");
  } finally {
    release();
  }
  await moveSaved(page);
  await expect(amount(page, "Gifts")).toHaveText("$90.00");
  const [failed, retried] = plan.executions;
  expect(retried).toEqual(failed);
  expect(plan.commands).toEqual([
    expect.objectContaining({ amount: -1_000, id: failed!.command.id }),
  ]);

  // A new change from the saved revision is a new operation.
  const next = await edit(page, "Gifts");
  await next.fill("80");
  await next.press("Enter");
  await moveSaved(page);
  expect(plan.executions[2]).toEqual({
    command: expect.objectContaining({ amount: -1_000 }),
    expectedRevision: 1,
  });
  expect(plan.executions[2]!.command.id).not.toBe(failed!.command.id);
});

test("more than Ready to Assign holds is refused and keeps the draft", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  const input = await edit(page, "Phone");
  await input.fill("600+1000");
  await input.press("Enter");
  await expect(notifications(page).getByRole("alert")).toContainText(
    "Assignments require existing Ready to Assign cash",
  );
  await expect(input).toHaveValue("600+1000");
  await expect(amount(page, "Phone")).toHaveCount(0);
  await expect(pill(page, "Phone")).toHaveText("$0.00");
  expect(plan.commands).toEqual([]);
  expect(plan.executions).toEqual([
    {
      command: expect.objectContaining({
        categoryId: "phone",
        amount: 160_000,
      }),
      expectedRevision: 0,
    },
  ]);
});

test("a change saved elsewhere while editing asks before saving over it", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  const input = await edit(page, "Gifts");
  await input.fill("90");
  plan.editElsewhere();
  await input.press("Enter");
  await expect(notifications(page).getByRole("alert")).toContainText(
    "Your budget changed. Refresh and try again.",
  );
  await expect(pill(page, "Gifts")).toHaveText("$100.00");

  // Once the newer revision is on screen, the edit restarts from it and
  // needs another Enter.
  await expect(async () => {
    await input.press("Enter");
    await expect(input).toHaveAccessibleDescription(
      "Assigned changed to $100.00 while you were editing. Save again to make it $90.00.",
      { timeout: 500 },
    );
  }).toPass();
  expect(plan.executions).toHaveLength(1);
  await input.press("Enter");
  await moveSaved(page);
  expect(plan.executions[1]).toEqual({
    command: expect.objectContaining({ amount: -1_000 }),
    expectedRevision: 1,
  });
  expect(plan.executions[1]!.command.id).not.toBe(
    plan.executions[0]!.command.id,
  );
});

test("moves and Assigned edits share one undo history", async ({ page }) => {
  const plan = await openPrototype(page);
  await pill(page, "Gifts").click();
  const popover = page.getByRole("dialog", { name: /Gifts/ });
  await popover.getByLabel("Amount").fill("10");
  await popover.getByRole("combobox").click();
  await popover.getByRole("option", { name: /^Rent/ }).click();
  await popover.getByRole("button", { name: "Move", exact: true }).click();
  await moveSaved(page);
  await expect(amount(page, "Rent")).toHaveText("$510.00");

  const input = await edit(page, "Rent");
  await input.fill("450");
  await input.press("Enter");
  await moveSaved(page);
  await expect(amount(page, "Rent")).toHaveText("$450.00");

  // The toast takes back the edit, then the keys step through both.
  await toastUndo(page).click();
  await expect(notifications(page)).toContainText("Action undone.");
  await expect(amount(page, "Rent")).toHaveText("$510.00");

  // An open field holds the undo shortcut, even once focus has left it.
  const open = await edit(page, "Phone");
  await open.fill("abc");
  await shortcut(page);
  await expect(open).toHaveAttribute("aria-invalid", "true");
  await page.keyboard.press("Meta+z");
  expect(plan.historyCalls).toHaveLength(1);
  await open.focus();
  await open.press("Escape");
  await expect(open).toHaveCount(0);

  await changeHistory(page, plan.historyCalls);
  await expect(amount(page, "Rent")).toHaveText("$500.00");
  await expect(pill(page, "Gifts")).toHaveText("$100.00");
  await changeHistory(page, plan.historyCalls, "Meta+Shift+z");
  await changeHistory(page, plan.historyCalls, "Meta+Shift+z");
  await expect(amount(page, "Rent")).toHaveText("$450.00");
  await expect(pill(page, "Gifts")).toHaveText("$90.00");
  expect(plan.historyCalls.map((call) => call.direction)).toEqual([
    "undo",
    "undo",
    "redo",
    "redo",
  ]);
  expect(plan.saved().category("rent").assigned).toBe(45_000);
  expect(plan.commands).toHaveLength(2);
});

test("Assigned waits while anything saves and keeps an edit to its month", async ({
  page,
}) => {
  const plan = await openPrototype(page);

  // While a move saves, no amount opens.
  const release = plan.holdExecute();
  try {
    await pill(page, "Gifts").click();
    const popover = page.getByRole("dialog", { name: /Gifts/ });
    await popover.getByRole("combobox").click();
    await popover.getByRole("option", { name: /^Rent/ }).click();
    await popover.getByRole("button", { name: "Move", exact: true }).click();
    await expect(amount(page, "Phone")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await amount(page, "Phone").click({ force: true });
    await expect(field(page, "Phone")).toHaveCount(0);
  } finally {
    release();
  }
  await moveSaved(page);

  // Changing month saves the edit to the month it was made in, and the
  // next month opens with nothing being edited.
  const input = await edit(page, "Phone");
  await input.fill("12.99");
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(field(page, "Phone")).toHaveCount(0);
  await expect(async () =>
    expect(plan.commands.at(-1)).toEqual(
      expect.objectContaining({
        categoryId: "phone",
        month: plan.month,
        amount: 1_299,
      }),
    ),
  ).toPass();
  expect(plan.saved().category("phone").assigned).toBe(1_299);
});

test("Assigned hides with its column on a narrow plan", async ({ page }) => {
  await openPrototype(page);
  await expect(amount(page, "Gifts")).toBeVisible();
  await page.setViewportSize({ width: 480, height: 900 });
  await expect(amount(page, "Gifts")).toBeHidden();
  await expect(pill(page, "Gifts")).toBeVisible();
});
