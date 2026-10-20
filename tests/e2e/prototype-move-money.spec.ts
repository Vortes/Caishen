import { expect, test, type Page } from "@playwright/test";

import {
  money,
  moveSaved,
  notifications,
  openPrototype,
  pill,
  toastUndo,
} from "./prototype-fixture";

const readyToAssign = (page: Page) =>
  page.locator("section").filter({ hasText: "Ready to Assign" }).first();

// Presses a history shortcut from the plan, outside any field or popover.
async function shortcut(page: Page, keys = "Meta+z") {
  await page.locator("#prototype-content").focus();
  await page.keyboard.press(keys);
}

// Undoes or redoes once the shell is idle. A press while the last change is
// still settling is refused, so it's repeated until exactly one more history
// change reaches the server; once one is in flight, presses are refused.
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

async function move(page: Page, from: string, to: string, amount?: string) {
  await pill(page, from).click();
  const popover = page.getByRole("dialog", { name: new RegExp(from) });
  if (amount)
    await popover.getByLabel(/^(Amount|Overspending to cover)$/).fill(amount);
  await popover.getByRole("combobox").click();
  await popover.getByRole("option", { name: new RegExp(`^${to}`) }).click();
  await popover.getByRole("button", { name: /^(Move|Cover)$/ }).click();
  return popover;
}

test("a move saves the legacy command, shows before the server answers, and undoes", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  const popover = page.getByRole("dialog", { name: /Gifts/ });

  // Moving more than Gifts holds is caught next to the amount, unsent.
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
  expect(plan.writes).toEqual([]);

  // The plan shows the move while the server is still saving it, and undo
  // waits for the save.
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
  const release = plan.holdExecute();
  try {
    await popover.getByLabel("Amount").fill("50");
    await popover.getByRole("button", { name: "Move", exact: true }).click();
    await expect(popover).not.toBeVisible();
    await expect(pill(page, "Dining")).toHaveText(
      money(covered.category("dining").available),
    );
    await expect(pill(page, "Gifts")).toHaveText(
      money(covered.category("gifts").available),
    );
    expect(plan.writes).toEqual(["budget.execute"]);
    expect(plan.commands).toEqual([]);
    await shortcut(page);
    expect(plan.historyCalls).toEqual([]);
  } finally {
    release();
  }

  await moveSaved(page);
  expect(plan.commands).toEqual([
    {
      type: "cover",
      id: expect.any(String),
      fromCategoryId: "gifts",
      toCategoryId: "dining",
      month: plan.month,
      amount: 5_000,
    },
  ]);
  expect(plan.saved().category("dining").available).toBe(
    covered.category("dining").available,
  );
  await expect(notifications(page)).toContainText(
    "Moved $50.00 from Gifts to Dining",
  );

  // Cmd+Z undoes it on the server; Cmd+Shift+Z and Ctrl+Y redo it.
  await changeHistory(page, plan.historyCalls);
  await expect(notifications(page)).toContainText("Action undone.");
  await expect(pill(page, "Dining")).toHaveText("-$80.15");
  await expect(pill(page, "Gifts")).toHaveText("$100.00");
  expect(plan.saved().category("gifts").available).toBe(10_000);
  await expect(toastUndo(page)).toHaveCount(0);

  await changeHistory(page, plan.historyCalls, "Meta+Shift+z");
  await expect(notifications(page)).toContainText("Action redone.");
  await expect(pill(page, "Gifts")).toHaveText("$50.00");
  await changeHistory(page, plan.historyCalls);
  await expect(pill(page, "Gifts")).toHaveText("$100.00");
  await changeHistory(page, plan.historyCalls, "Control+y");
  await expect(pill(page, "Gifts")).toHaveText("$50.00");
  await expect(notifications(page)).toContainText("Action redone.");
  expect(plan.historyCalls.map((call) => call.direction)).toEqual([
    "undo",
    "redo",
    "undo",
    "redo",
  ]);
  expect(plan.historyCalls.map((call) => call.expectedRevision)).toEqual([
    1, 2, 3, 4,
  ]);
});

test("the toast's Undo takes back the move through the shared history", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await move(page, "Gifts", "Rent");
  await moveSaved(page);
  await expect(pill(page, "Rent")).toHaveText("$600.00");

  await toastUndo(page).click();
  await expect(notifications(page)).toContainText("Action undone.");
  await expect(pill(page, "Rent")).toHaveText("$500.00");
  await expect(pill(page, "Gifts")).toHaveText("$100.00");
  expect(plan.historyCalls).toEqual([
    expect.objectContaining({ direction: "undo", expectedRevision: 1 }),
  ]);
  expect(plan.saved().category("rent").available).toBe(50_000);
});

test("Ready to Assign on either side is an assignment", async ({ page }) => {
  const plan = await openPrototype(page);

  // Covering from Ready to Assign assigns more to the overspent category.
  const assigned = plan.expected([
    {
      type: "assign",
      id: "check-assign",
      categoryId: "household",
      month: plan.month,
      amount: 1_299,
    },
  ]);
  const cover = await move(page, "Household", "Ready to Assign");
  await expect(cover).not.toBeVisible();
  await expect(pill(page, "Household")).toHaveText("$0.00");
  await expect(readyToAssign(page)).toContainText(
    money(assigned.readyToAssign),
  );
  await moveSaved(page);
  await expect(notifications(page)).toContainText(
    "Moved $12.99 from Ready to Assign to Household",
  );

  // Moving to Ready to Assign takes the amount back out of the category.
  await move(page, "Gifts", "Ready to Assign", "40");
  await moveSaved(page);
  await expect(pill(page, "Gifts")).toHaveText("$60.00");
  expect(plan.commands).toEqual([
    {
      type: "assign",
      id: expect.any(String),
      categoryId: "household",
      month: plan.month,
      amount: 1_299,
    },
    {
      type: "assign",
      id: expect.any(String),
      categoryId: "gifts",
      month: plan.month,
      amount: -4_000,
    },
  ]);
});

test("the category inspector opens the same move", async ({ page }) => {
  const plan = await openPrototype(page);
  await page.getByRole("button", { name: /^Gifts/ }).click();
  await page.getByRole("button", { name: "Move money", exact: true }).click();
  const popover = page.getByRole("dialog", { name: /Gifts/ });
  await popover.getByRole("combobox", { name: "To" }).click();
  await popover.getByRole("option", { name: /^Rent/ }).click();
  await popover.getByRole("button", { name: "Move", exact: true }).click();
  await expect(pill(page, "Rent")).toHaveText("$600.00");
  await expect(pill(page, "Gifts")).toHaveText("$0.00");
  await moveSaved(page);
  expect(plan.commands).toHaveLength(1);
});

test("undo waits while a save or another undo is in flight, or a popover is open", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await move(page, "Gifts", "Rent", "10");
  await moveSaved(page);

  // A second move still saving: neither the toast nor the keys can undo, and
  // a third move waits its turn instead of racing the second.
  const release = plan.holdExecute();
  try {
    await move(page, "Gifts", "Phone", "10");
    await expect(pill(page, "Phone")).toHaveText("$10.00");
    await expect(toastUndo(page)).toBeDisabled();
    await shortcut(page);
    expect(plan.historyCalls).toEqual([]);
    const third = await move(page, "Rent", "Phone", "5");
    await expect(third.getByRole("alert")).toHaveText(
      "Wait for your last change to save, then try again.",
    );
    await third.getByRole("button", { name: "Cancel" }).click();
    expect(plan.writes).toEqual(["budget.execute", "budget.execute"]);
  } finally {
    release();
  }
  await moveSaved(page);

  // An open move popover holds the shortcut.
  await pill(page, "Gifts").click();
  const popover = page.getByRole("dialog", { name: /Gifts/ });
  await popover.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Meta+z");
  expect(plan.historyCalls).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(popover).not.toBeVisible();

  // Repeated keys and a second press while the undo is saving are ignored.
  const releaseHistory = plan.holdHistory();
  try {
    const repeatIgnored = await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          metaKey: true,
          repeat: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(repeatIgnored).toBe(true);
    await changeHistory(page, plan.historyCalls);
    await page.keyboard.press("Meta+z");
    await page.keyboard.press("Control+z");
    expect(plan.historyCalls).toHaveLength(1);
  } finally {
    releaseHistory();
  }
  await expect(notifications(page)).toContainText("Action undone.");
  await expect(pill(page, "Phone")).toHaveText("$0.00");
  expect(plan.historyCalls).toHaveLength(1);
});

test("failures show in a toast and leave the budget as saved", async ({
  page,
}) => {
  const plan = await openPrototype(page);

  // A rejected move rolls back its preview.
  plan.rejectNextExecute("The update could not be saved. Try again.");
  await move(page, "Gifts", "Rent");
  await expect(
    notifications(page).getByRole("alert").filter({ hasText: "Try again." }),
  ).toContainText("The update could not be saved. Try again.");
  await expect(pill(page, "Gifts")).toHaveText("$100.00");
  await expect(pill(page, "Rent")).toHaveText("$500.00");
  expect(plan.commands).toEqual([]);
  await notifications(page)
    .getByRole("button", { name: "Dismiss", exact: true })
    .click();
  await expect(notifications(page).getByRole("alert")).toHaveCount(0);

  // A rejected undo keeps the move and can be retried.
  await move(page, "Gifts", "Rent");
  await moveSaved(page);
  plan.rejectNextHistory("Undo is temporarily unavailable. Try again.");
  await changeHistory(page, plan.historyCalls);
  await expect(notifications(page).getByRole("alert")).toContainText(
    "Undo is temporarily unavailable. Try again.",
  );
  await expect(pill(page, "Rent")).toHaveText("$600.00");
  await changeHistory(page, plan.historyCalls);
  await expect(notifications(page)).toContainText("Action undone.");
  await expect(pill(page, "Rent")).toHaveText("$500.00");
  expect(plan.historyCalls).toHaveLength(2);
});

test("the toast stops offering Undo once the move isn't the latest change", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await move(page, "Gifts", "Rent");
  await moveSaved(page);

  // A partner's edit moves the budget on and empties the undo stack.
  plan.editElsewhere();
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(notifications(page)).toContainText(
    "Moved $100.00 from Gifts to Rent",
  );
  await expect(toastUndo(page)).toHaveCount(0);
  await shortcut(page);
  expect(plan.historyCalls).toEqual([]);
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
