import type { Locator } from "@playwright/test";
import { expect, shellPath, test } from "./shell-fixture";
import { openRegister, transactionRow } from "./shell-controls";

// Where each value's text sits: its left edge (its right edge for an
// amount, which ends where its column does) and its vertical center.
type Spots = Record<string, { x: number; y: number }>;

const columns = ["date", "payee", "category", "outflow"];
const amounts = new Set(["outflow"]);

// The text in a register row's cells, read off the visible text itself:
// a cell also carries text for screen readers, clipped to a pixel.
const rowSpots = (row: Locator) =>
  row.evaluate(
    (element, { columns, amounts }) => {
      const spots: Record<string, { x: number; y: number }> = {};
      for (const column of columns) {
        const cell = element.querySelector(`[data-column="${column}"]`);
        if (!cell) continue;
        const text = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        let [left, right, top, bottom] = [
          Infinity,
          -Infinity,
          Infinity,
          -Infinity,
        ];
        for (let node = text.nextNode(); node; node = text.nextNode()) {
          if (!node.textContent?.trim()) continue;
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
        spots[column] = {
          x: amounts.includes(column) ? right : left,
          y: (top + bottom) / 2,
        };
      }
      return spots;
    },
    { columns, amounts: [...amounts] },
  );

// The text in the editor's wells: each input's content box, inside its
// border and padding.
const editorSpots = (form: Locator) =>
  form.evaluate(
    (element, { columns, amounts }) => {
      const spots: Record<string, { x: number; y: number }> = {};
      for (const column of columns) {
        const input = element.querySelector(`[data-column="${column}"] input`);
        if (!input) continue;
        const box = input.getBoundingClientRect();
        const style = getComputedStyle(input);
        const px = (value: string) => parseFloat(value);
        const top = box.top + px(style.borderTopWidth) + px(style.paddingTop);
        const bottom =
          box.bottom - px(style.borderBottomWidth) - px(style.paddingBottom);
        spots[column] = {
          x: amounts.includes(column)
            ? box.right - px(style.borderRightWidth) - px(style.paddingRight)
            : box.left + px(style.borderLeftWidth) + px(style.paddingLeft),
          y: (top + bottom) / 2,
        };
      }
      return spots;
    },
    { columns, amounts: [...amounts] },
  );

// Rounding of text boxes leaves under half a pixel; anything more is a
// shift a person sees.
const expectSameSpots = (after: Spots, before: Spots) => {
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
  const budget = await budgets.create({
    purchase: { payee: "Corner market", amount: 3_742 },
  });
  await page.goto(shellPath);
  await budgets.signIn(page, budget);
  await openRegister(page, budget.account);

  const row = transactionRow(page, "Corner market");
  const resting = await rowSpots(row);
  expect(Object.keys(resting)).toEqual(columns);
  await row.click();
  const selected = await rowSpots(row);
  expectSameSpots(selected, resting);

  await page.keyboard.press("e");
  const form = page.getByRole("form", {
    name: "Edit transaction",
    exact: true,
  });
  await expect(form).toBeVisible();
  expectSameSpots(await editorSpots(form), selected);

  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form).toHaveCount(0);
  expectSameSpots(await rowSpots(row), selected);
});
