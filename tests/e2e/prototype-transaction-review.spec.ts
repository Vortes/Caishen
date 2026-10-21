import { expect, test, type Page } from "@playwright/test";

import { currentMonth } from "../../src/components/budget/format";
import type { State } from "../../src/components/budget/types";
import type { Command } from "../../src/domain/engine";
import {
  moveSaved,
  notifications,
  openPrototype,
  pill,
  toastUndo,
} from "./prototype-fixture";

const month = currentMonth();

// Recorded transactions still waiting on review. Hardware store is a
// purchase with no category, which the engine won't approve.
const unreviewed = (
  transactionId: string,
  payee: string,
  amount: number,
  categoryId?: string,
): Command => ({
  type: "transaction.upsert",
  id: `seed-${transactionId}`,
  transactionId,
  accountId: "checking",
  date: `${month}-01`,
  payee,
  amount,
  categoryId,
  status: "posted",
  reviewed: false,
});
const commands = [
  unreviewed("coffee", "Corner coffee", -450, "dining"),
  unreviewed("paycheck", "Paycheck", 250_000),
  unreviewed("hardware", "Hardware store", -3_200),
];
const imports: State["imports"] = [
  {
    connectionId: "bank",
    logicalId: "market",
    providerAccountId: "provider-checking",
    accountId: "checking",
    date: `${month}-01`,
    payee: "Imported market",
    amount: -2_500,
    categoryName: null,
    pending: false,
    removed: false,
    needsMatchReview: false,
    error: null,
    history: [],
    reviewEvidence: [],
  },
];

const register = (page: Page) =>
  page.getByRole("group", { name: "Transactions" });
const island = (page: Page) =>
  page.getByRole("toolbar", { name: "Selected transactions" });
const row = (page: Page, payee: string) =>
  register(page).getByRole("button", { name: new RegExp(payee) });
const rowCheck = (page: Page, payee: string) =>
  register(page).getByRole("checkbox", {
    name: `Select ${payee}`,
    exact: true,
  });
const selectAll = (page: Page) =>
  register(page).getByRole("checkbox", { name: "Select all", exact: true });
const approve = (page: Page) =>
  island(page).getByRole("button", { name: /^Approve \(/ });
const reviewFilter = (page: Page) =>
  page.getByRole("button", { name: /^To review/ });
const allAccounts = (page: Page) =>
  page
    .getByRole("navigation", { name: "Budget navigation" })
    .getByRole("button", { name: /^All accounts/ });

test("the island shows only available actions and categorizes a selection with undo", async ({
  page,
}) => {
  const plan = await openPrototype(page, { commands });
  await allAccounts(page).click();
  await row(page, "Bistro").click();
  await expect(approve(page)).toHaveCount(0);
  await expect(
    island(page).getByRole("button", { name: "Reject", exact: true }),
  ).toHaveCount(0);
  await expect(
    island(page).getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await expect(
    island(page).getByRole("button", { name: "Categorize", exact: true }),
  ).toBeEnabled();
  await rowCheck(page, "Corner coffee").click();
  await expect(approve(page)).toBeEnabled();
  await expect(
    island(page).getByRole("button", { name: "Reject", exact: true }),
  ).toBeEnabled();
  await island(page)
    .getByRole("button", { name: "Categorize", exact: true })
    .click();
  const form = page.getByRole("form", {
    name: "Categorize transactions",
    exact: true,
  });
  await form
    .getByRole("combobox", { name: "Category", exact: true })
    .fill("Gifts");
  await form
    .getByRole("combobox", { name: "Category", exact: true })
    .press("Enter");
  const release = plan.holdExecute();
  try {
    await form.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(form).toBeVisible();
    await expect(form.getByRole("button", { name: "Saving…" })).toBeDisabled();
  } finally {
    release();
  }
  await expect(notifications(page)).toContainText("Categorized 2 transactions");
  expect(plan.saved().transaction("dinner")!.categoryId).toBe("gifts");
  expect(plan.saved().transaction("coffee")!.categoryId).toBe("gifts");
  await expect(approve(page)).toHaveCount(0);
  await expect(
    island(page).getByRole("button", { name: "Reject", exact: true }),
  ).toHaveCount(0);
  await toastUndo(page).click();
  await expect(row(page, "Corner coffee")).toContainText("Dining");
  expect(plan.saved().transaction("coffee")!.reviewed).toBe(false);
});

test("Reject removes only unapproved transactions in a mixed selection and Undo restores them", async ({
  page,
}) => {
  const plan = await openPrototype(page, { commands });
  await allAccounts(page).click();
  await row(page, "Bistro").click();
  await rowCheck(page, "Corner coffee").click();
  await island(page)
    .getByRole("button", { name: "Reject", exact: true })
    .click();
  await expect(notifications(page)).toContainText("Rejected 1 transaction");
  await expect(row(page, "Corner coffee")).toHaveCount(0);
  await expect(row(page, "Bistro")).toBeVisible();
  expect(plan.saved().transaction("coffee")!.removed).toBe(true);
  expect(plan.saved().transaction("dinner")!.removed).not.toBe(true);
  await toastUndo(page).click();
  await expect(row(page, "Corner coffee")).toBeVisible();
  expect(plan.saved().transaction("coffee")!.reviewed).toBe(false);
});

test("Categorize is absent for transfers that do not use budget categories", async ({
  page,
}) => {
  await openPrototype(page, { payments: true });
  await page
    .getByRole("navigation", { name: "Budget navigation" })
    .getByRole("button", { name: /^Checking/ })
    .click();
  await row(page, "Transfer to Savings").click();
  await expect(
    island(page).getByRole("button", { name: "Categorize", exact: true }),
  ).toHaveCount(0);
  await expect(approve(page)).toHaveCount(0);
  await expect(
    island(page).getByRole("button", { name: "Reject", exact: true }),
  ).toHaveCount(0);
  await expect(island(page).getByRole("link")).toHaveCount(0);
});

// The sidebar marks All accounts with a dot, without a number, while
// anything waits for review.
const sidebarDot = (page: Page, count: number) =>
  expect(
    allAccounts(page).getByRole("img", { name: "Transactions to review" }),
  ).toHaveCount(count ? 1 : 0);

// The review count on the toolbar filter, and the sidebar's dot.
async function reviewCount(page: Page, count: number) {
  await expect(reviewFilter(page)).toHaveText(
    new RegExp(`To review\\s*${count}$`),
  );
  await sidebarDot(page, count);
}

async function changeHistory(
  page: Page,
  calls: { length: number },
  keys = "Meta+z",
) {
  const count = calls.length + 1;
  await expect(async () => {
    if (calls.length < count) {
      await page.locator("#prototype-content").focus();
      await page.keyboard.press(keys);
    }
    expect(calls.length).toBe(count);
  }).toPass();
}

test("approving one clicked transaction saves on screen first and shares undo with move money", async ({
  page,
}) => {
  const plan = await openPrototype(page, { commands, imports });
  await allAccounts(page).click();
  await reviewCount(page, 4);

  // A bank import keeps its own review, which isn't built here, so it
  // can't be selected.
  await row(page, "Imported market").click();
  await expect(island(page)).toHaveCount(0);
  expect(plan.writes).toEqual([]);

  // Clicking a row selects just that row, and the island acts on it.
  await row(page, "Corner coffee").click();
  await expect(island(page)).toContainText("1 transaction");
  const release = plan.holdExecute();
  try {
    await approve(page).click();
    await expect(approve(page)).toHaveCount(0);
    await reviewCount(page, 3);
    await expect(row(page, "Corner coffee")).not.toContainText("Needs review");
    expect(plan.writes).toEqual(["budget.execute"]);
    expect(plan.commands).toEqual([]);
  } finally {
    release();
  }
  await moveSaved(page);
  await expect(notifications(page)).toContainText(
    "Marked 1 transaction reviewed",
  );
  expect(plan.commands).toEqual([
    {
      type: "transaction.approve",
      id: expect.any(String),
      transactionIds: ["coffee"],
    },
  ]);

  // One history: a move after the approval undoes first, then the approval.
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await pill(page, "Gifts").click();
  const popover = page.getByRole("dialog", { name: /Gifts/ });
  await popover.getByRole("combobox").click();
  await popover.getByRole("option", { name: /^Rent/ }).click();
  await popover.getByRole("button", { name: "Move", exact: true }).click();
  await moveSaved(page);

  await changeHistory(page, plan.historyCalls);
  await expect(pill(page, "Gifts")).toHaveText("$100.00");
  await changeHistory(page, plan.historyCalls);
  await allAccounts(page).click();
  await reviewCount(page, 4);
  await changeHistory(page, plan.historyCalls, "Meta+Shift+z");
  await reviewCount(page, 3);
  expect(plan.historyCalls.map((call) => call.direction)).toEqual([
    "undo",
    "undo",
    "redo",
  ]);
  expect(plan.historyCalls.map((call) => call.expectedRevision)).toEqual([
    2, 3, 4,
  ]);
});

test("a batch approves only what still needs review, never a bank import", async ({
  page,
}) => {
  const plan = await openPrototype(page, { commands, imports });
  await allAccounts(page).click();

  // Keyboard: arrows select the next row alone, x toggles the focused row.
  await row(page, "Corner coffee").click();
  await page.keyboard.press("ArrowUp");
  await expect(rowCheck(page, "Bistro")).toBeChecked();
  await expect(rowCheck(page, "Corner coffee")).not.toBeChecked();
  await page.keyboard.press("x");
  await expect(island(page)).toHaveCount(0);
  await page.keyboard.press("x");
  await rowCheck(page, "Corner coffee").click();
  await expect(rowCheck(page, "Bistro")).toBeChecked();
  await expect(island(page)).toContainText("2 transactions");
  await expect(approve(page)).toHaveText("Approve (1)");
  await expect(selectAll(page)).toHaveAttribute("aria-checked", "mixed");

  // A new filter starts a new selection. Import rows have no checkbox.
  await reviewFilter(page).click();
  await expect(island(page)).toHaveCount(0);
  await expect(register(page).getByRole("checkbox")).toHaveCount(4);
  await selectAll(page).click();
  await expect(approve(page)).toHaveText("Approve (3)");
  await rowCheck(page, "Hardware store").click();
  await expect(island(page)).toContainText("2 transactions");

  const release = plan.holdExecute();
  try {
    await approve(page).click();
    await expect(row(page, "Corner coffee")).toHaveCount(0);
    await expect(row(page, "Paycheck")).toHaveCount(0);
    await expect(row(page, "Hardware store")).toBeVisible();
    await expect(row(page, "Imported market")).toBeVisible();
    await reviewCount(page, 2);
    await expect(island(page)).toHaveCount(0);
  } finally {
    release();
  }
  await moveSaved(page);
  await expect(notifications(page)).toContainText(
    "Marked 2 transactions reviewed",
  );
  expect(plan.commands).toEqual([
    {
      type: "transaction.approve",
      id: expect.any(String),
      transactionIds: ["paycheck", "coffee"],
    },
  ]);

  // Undone, the rows come back to review without their old selection.
  await toastUndo(page).click();
  await expect(row(page, "Corner coffee")).toBeVisible();
  await reviewCount(page, 4);
  await expect(selectAll(page)).toHaveAttribute("aria-checked", "false");
});

test("a refused approval comes back selected and can be sent again", async ({
  page,
}) => {
  const plan = await openPrototype(page, { commands, imports });
  await allAccounts(page).click();
  await reviewFilter(page).click();
  await rowCheck(page, "Corner coffee").click();

  plan.rejectNextExecute("Your budget changed. Refresh and try again.");
  const release = plan.holdExecute();
  try {
    // A second press while the first saves sends nothing.
    await approve(page).dblclick();
    await expect(row(page, "Corner coffee")).toHaveCount(0);
    await reviewCount(page, 3);
  } finally {
    release();
  }
  await expect(notifications(page)).toContainText(
    "Your budget changed. Refresh and try again.",
  );
  await expect(row(page, "Corner coffee")).toBeVisible();
  await expect(rowCheck(page, "Corner coffee")).toBeChecked();
  await reviewCount(page, 4);
  expect(plan.writes).toEqual(["budget.execute"]);

  await approve(page).click();
  await moveSaved(page);
  await expect(row(page, "Corner coffee")).toHaveCount(0);
  await reviewCount(page, 3);
  expect(plan.commands).toEqual([
    expect.objectContaining({
      type: "transaction.approve",
      transactionIds: ["coffee"],
    }),
  ]);
});

test("an uncategorized purchase is refused without leaving review", async ({
  page,
}) => {
  const plan = await openPrototype(page, { commands, imports });
  await allAccounts(page).click();

  await row(page, "Hardware store").click();
  let release = plan.holdExecute();
  try {
    await approve(page).click();
    // The preview refuses it too, so nothing claims it was reviewed.
    await expect(approve(page)).toHaveText("Approve (1)");
    await reviewCount(page, 4);
  } finally {
    release();
  }
  const refused = notifications(page).getByRole("alert");
  await expect(refused).toContainText("Categorize purchases before approval");
  await expect(approve(page)).toBeEnabled();
  await refused.getByRole("button", { name: "Dismiss" }).click();
  await expect(refused).toHaveCount(0);

  // In a batch, the whole approval is refused and the selection stays.
  await reviewFilter(page).click();
  await rowCheck(page, "Hardware store").click();
  await rowCheck(page, "Corner coffee").click();
  release = plan.holdExecute();
  try {
    await approve(page).click();
    await expect(row(page, "Corner coffee")).toBeVisible();
    await expect(row(page, "Hardware store")).toBeVisible();
  } finally {
    release();
  }
  await expect(refused).toContainText("Categorize purchases before approval");
  await expect(approve(page)).toBeEnabled();
  await expect(approve(page)).toHaveText("Approve (2)");
  await reviewCount(page, 4);
  expect(plan.commands).toEqual([]);
});

test("approval stops at 500 transactions and says why", async ({ page }) => {
  await openPrototype(page, {
    commands: Array.from({ length: 501 }, (_, index) =>
      unreviewed(`bulk-${index}`, `Bulk ${index}`, -100, "dining"),
    ),
  });
  await allAccounts(page).click();
  await reviewFilter(page).click();
  await selectAll(page).click();
  await expect(approve(page)).toHaveText("Approve (501)");
  await expect(approve(page)).toBeDisabled();
  await expect(island(page)).toContainText("Approve up to 500 at a time.");

  // Bulk 0 is the last row; fold the prototype's controls off of it.
  await page.getByRole("button", { name: "Prototype", exact: true }).click();
  await rowCheck(page, "Bulk 0").click();
  await expect(approve(page)).toHaveText("Approve (500)");
  await expect(approve(page)).toBeEnabled();
  await expect(island(page)).not.toContainText("Approve up to 500");
});

test("review waits while a change saves, a month loads, or the budget is stale", async ({
  page,
}) => {
  const plan = await openPrototype(page, { commands, imports });
  await allAccounts(page).click();

  // The selection belongs to one register.
  await rowCheck(page, "Corner coffee").click();
  await page
    .getByRole("navigation", { name: "Budget navigation" })
    .getByRole("button", { name: /^Checking/ })
    .click();
  await expect(island(page)).toHaveCount(0);
  await allAccounts(page).click();

  // Saving.
  await row(page, "Corner coffee").click();
  const release = plan.holdExecute();
  try {
    await approve(page).click();
    await row(page, "Paycheck").click();
    await expect(approve(page)).toHaveText("Approve (1)");
    await expect(approve(page)).toBeDisabled();
  } finally {
    release();
  }
  await moveSaved(page);
  await expect(approve(page)).toBeEnabled();

  // Loading: the last month stays on screen, but can't be approved.
  let releaseState!: () => void;
  const loading = new Promise<void>((resolve) => {
    releaseState = resolve;
  });
  let failState = false;
  await page.route("**/api/trpc/budget.state**", async (route) => {
    if (failState) return route.abort();
    await loading;
    await route.fallback();
  });
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(island(page)).toHaveCount(0);
  await rowCheck(page, "Paycheck").click();
  await expect(approve(page)).toBeDisabled();
  releaseState();
  await expect(register(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Previous month" }).click();

  // Stale: once the budget fails to refresh, nothing more is sent.
  failState = true;
  await row(page, "Paycheck").click();
  await approve(page).click();
  await expect(notifications(page)).toContainText(
    "Your budget couldn’t refresh",
    { timeout: 20_000 },
  );
  await row(page, "Hardware store").click();
  await expect(approve(page)).toBeDisabled();
  failState = false;
  await notifications(page).getByRole("button", { name: "Try again" }).click();
  await expect(approve(page)).toBeEnabled();
  expect(plan.commands).toHaveLength(2);
});
