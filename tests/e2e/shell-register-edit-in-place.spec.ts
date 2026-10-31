import type { Locator } from "@playwright/test";
import { connectPartner } from "./partner-household";
import { expect, shellPath, test } from "./shell-fixture";
import { openRegister, transactionRow } from "./shell-controls";

// Where each value's text sits: its left edge (its right edge for an
// amount, which ends where its column does) and its vertical center.
type Spots = Record<string, { x: number; y: number }>;

// Every value in a row, resting or open in its editor. A cell with an input
// is read at the input's content box, inside its border and padding; any
// other cell at its visible text. Text for screen readers sits in an element
// clipped to a pixel, though its own box stays full size, so it's skipped by
// its element.
const spotsIn = (row: Locator, columns: string[], amounts: string[]) =>
  row.evaluate(
    (element, { columns, amounts }) => {
      const spots: Record<string, { x: number; y: number }> = {};
      const px = (value: string) => parseFloat(value);
      for (const column of columns) {
        const cell = element.querySelector(`[data-column="${column}"]`);
        if (!cell) continue;
        const end = amounts.includes(column);
        const input = cell.querySelector("input");
        if (input) {
          const box = input.getBoundingClientRect();
          const style = getComputedStyle(input);
          const top = box.top + px(style.borderTopWidth) + px(style.paddingTop);
          const bottom =
            box.bottom - px(style.borderBottomWidth) - px(style.paddingBottom);
          spots[column] = {
            x: end
              ? box.right - px(style.borderRightWidth) - px(style.paddingRight)
              : box.left + px(style.borderLeftWidth) + px(style.paddingLeft),
            y: (top + bottom) / 2,
          };
          continue;
        }
        const text = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        let [left, right, top, bottom] = [
          Infinity,
          -Infinity,
          Infinity,
          -Infinity,
        ];
        for (let node = text.nextNode(); node; node = text.nextNode()) {
          if (!node.textContent?.trim()) continue;
          const holder = node.parentElement!.getBoundingClientRect();
          if (holder.width < 2 || holder.height < 2) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const box = range.getBoundingClientRect();
          if (box.width < 2 || box.height < 2) continue;
          left = Math.min(left, box.left);
          right = Math.max(right, box.right);
          top = Math.min(top, box.top);
          bottom = Math.max(bottom, box.bottom);
        }
        if (left === Infinity) continue;
        spots[column] = { x: end ? right : left, y: (top + bottom) / 2 };
      }
      return spots;
    },
    { columns, amounts },
  );

// Rounding of text boxes leaves under half a pixel; anything more is a
// shift a person sees.
const expectSameSpots = (after: Spots, before: Spots, columns: string[]) => {
  for (const column of columns) {
    expect(after[column], column).toBeDefined();
    expect(
      Math.abs(after[column]!.x - before[column]!.x),
      `${column} x`,
    ).toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(after[column]!.y - before[column]!.y),
      `${column} y`,
    ).toBeLessThanOrEqual(0.5);
  }
};

test("selecting a register row and opening it to edit moves none of its text", async ({
  page,
  budgets,
}) => {
  const columns = ["date", "payee", "category", "outflow"];
  const amounts = ["outflow"];
  const budget = await budgets.create({
    purchase: { payee: "Corner market", amount: 3_742 },
  });
  await page.goto(shellPath);
  await budgets.signIn(page, budget);
  await openRegister(page, budget.account);

  const row = transactionRow(page, "Corner market");
  const resting = await spotsIn(row, columns, amounts);
  expect(Object.keys(resting)).toEqual(columns);
  await row.click();
  expectSameSpots(await spotsIn(row, columns, amounts), resting, columns);

  await page.keyboard.press("e");
  const form = page.getByRole("form", {
    name: "Edit transaction",
    exact: true,
  });
  await expect(form).toBeVisible();
  expectSameSpots(await spotsIn(form, columns, amounts), resting, columns);

  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form).toHaveCount(0);
  expectSameSpots(await spotsIn(row, columns, amounts), resting, columns);
});

test("selecting a partner row and opening it to edit moves none of its text", async ({
  page,
  budgets,
  browser,
  baseURL,
}) => {
  const columns = ["date", "payee", "category", "amount", "balance"];
  const amounts = ["amount", "balance"];
  const budget = await budgets.create();
  await page.goto(shellPath);
  await budgets.signIn(page, budget);
  await connectPartner({
    page,
    browser,
    baseURL,
    budgets,
    partnerName: "Alex Partner",
  });

  await page.goto(shellPath);
  await page
    .getByRole("navigation", { name: "Budget navigation" })
    .getByRole("link", { name: /^Alex/ })
    .click();
  await page.getByRole("button", { name: "Record purchase" }).click();
  const record = page.getByRole("dialog", {
    name: "Record a shared purchase",
  });
  await record.getByLabel("Payee", { exact: true }).fill("Corner market");
  await record.getByLabel("Total paid", { exact: true }).fill("60");
  // A category, so the row and its editor show the same text there.
  const category = record.getByRole("combobox", { name: /^Your category/ });
  await category.click();
  await category.fill(budget.category);
  await category.press("Enter");
  await record.getByRole("button", { name: "Record", exact: true }).click();
  await expect(record).toHaveCount(0);

  const row = page
    .locator("[data-entry-row]")
    .filter({ hasText: "Corner market" });
  await expect(row).toBeVisible();
  const resting = await spotsIn(row, columns, amounts);
  expect(Object.keys(resting)).toEqual(columns);
  await row.click();
  expectSameSpots(await spotsIn(row, columns, amounts), resting, columns);

  // A selected entry opens at its amount.
  await row.locator('[data-column="amount"]').click();
  const form = page.getByRole("form", {
    name: "Edit shared entry",
    exact: true,
  });
  await expect(form).toBeVisible();
  expectSameSpots(await spotsIn(form, columns, amounts), resting, columns);

  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form).toHaveCount(0);
  expectSameSpots(await spotsIn(row, columns, amounts), resting, columns);
});
