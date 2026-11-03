import type { Locator, Page } from "@playwright/test";
import { connectPartner } from "./partner-household";
import { expect, shellPath, test } from "./shell-fixture";
import {
  fillPurchase,
  openRegister,
  saved,
  transactionRow,
} from "./shell-controls";

// What's compared in a column: where its ink starts at the top, and its
// left edge (text), its right edge (an amount, read off its last digits:
// the row draws "$37.42", the editor a "$" of its own in the well), or no
// edge (the date, "Oct 14" in the row and "10/14/2026" in the editor).
type Edge = "left" | "right" | "top";
type Columns = Record<string, Edge>;
type Ink = Record<string, { top: number; x: number | null }>;

// The columns' spans across the row, in CSS pixels from the row's left. A
// column the row leaves empty for a control beside it (the cleared mark)
// takes its span from the column header.
const columnSpans = (row: Locator, columns: Columns) =>
  row.evaluate((element, names) => {
    const left = element.getBoundingClientRect().left;
    const spans: Record<string, [number, number]> = {};
    for (const name of names) {
      const box = [
        element.querySelector(`[data-column="${name}"]`),
        ...document.querySelectorAll(`[data-column="${name}"]`),
      ]
        .map((cell) => cell?.getBoundingClientRect())
        .find((box) => box && box.width >= 4);
      if (box) spans[name] = [box.left - left, box.right - left];
    }
    return spans;
  }, Object.keys(columns));

// The glyphs as painted: the row's band captured, then read on a canvas,
// so a pixel the browser rounds differently in an input shows here even
// when the layout boxes agree. Light pixels are ink on the dark theme;
// borders, fills and the "$" in a well stay below the threshold.
async function inkIn(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
  spans: Record<string, [number, number]>,
  columns: Columns,
): Promise<Ink> {
  await page.mouse.move(0, 0);
  const png = (await page.screenshot({ clip })).toString("base64");
  return page.evaluate(
    async ({ png, spans, columns, width }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      const scale = image.width / width;
      const lit = (x: number, y: number) => {
        const i = (y * image.width + x) * 4;
        return (
          0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]! > 150
        );
      };
      const ink: Record<string, { top: number; x: number | null }> = {};
      for (const [name, edge] of Object.entries(columns)) {
        const [from, to] = spans[name]!;
        // Wells reach 8px past their column; an amount's digits end within
        // the last 24px of it.
        const start = Math.max(
          0,
          Math.floor((edge === "right" ? to - 24 : from - 12) * scale),
        );
        const end = Math.min(image.width, Math.ceil((to + 12) * scale));
        let [top, left, right] = [Infinity, Infinity, -Infinity];
        for (let x = start; x < end; x++)
          for (let y = 0; y < image.height; y++)
            if (lit(x, y)) {
              top = Math.min(top, y);
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
        ink[name] = {
          top: top / scale,
          x:
            edge === "left"
              ? left / scale
              : edge === "right"
                ? right / scale
                : null,
        };
      }
      return ink;
    },
    { png, spans, columns, width: clip.width },
  );
}

// The same glyphs on the same pixels: a shift of even one device pixel
// fails.
const expectStill = (after: Ink, before: Ink, columns: Columns) => {
  for (const name of Object.keys(columns)) {
    expect(Number.isFinite(before[name]!.top), `${name} has ink`).toBe(true);
    expect(after[name]!.top, `${name} top`).toBe(before[name]!.top);
    expect(after[name]!.x, `${name} edge`).toBe(before[name]!.x);
  }
};

// Captures a row's band, resting, selected, open in its editor, and closed
// again, and expects every column's glyphs to stay put through all four.
async function expectRowStill(
  page: Page,
  row: Locator,
  open: () => Promise<Locator>,
  columns: Columns,
) {
  const box = (await row.boundingBox())!;
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
  const spans = await columnSpans(row, columns);
  const resting = await inkIn(page, clip, spans, columns);

  await row.click();
  expectStill(await inkIn(page, clip, spans, columns), resting, columns);

  const form = await open();
  await expect(form).toBeVisible();
  expectStill(await inkIn(page, clip, spans, columns), resting, columns);

  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form).toHaveCount(0);
  expectStill(await inkIn(page, clip, spans, columns), resting, columns);
}

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

  await expectRowStill(
    page,
    transactionRow(page, "Corner market"),
    async () => {
      await page.keyboard.press("e");
      return page.getByRole("form", { name: "Edit transaction", exact: true });
    },
    {
      date: "top",
      payee: "left",
      category: "left",
      outflow: "right",
      status: "left",
    },
  );
});

test("selecting a partner row and opening it to edit moves none of its text", async ({
  page,
  budgets,
  browser,
  baseURL,
}) => {
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

  // A purchase split with the partner, so their ledger has an entry.
  await page.goto(shellPath);
  await openRegister(page, budget.account);
  const form = await fillPurchase(page, budget, "Corner market", "60");
  await form.getByRole("button", { name: /^Share/ }).click();
  // The partner leads Who is this for, already chosen.
  await page
    .getByRole("dialog", { name: "Who this is for", exact: true })
    .getByRole("group", { name: "How much is for Alex", exact: true })
    .getByRole("button", { name: /^Half/ })
    .click();
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await saved(page);
  await openRegister(page, "Alex");

  const row = page
    .locator("[data-entry-row]")
    .filter({ hasText: "Corner market" });
  await expect(row).toBeVisible();
  await expectRowStill(
    page,
    row,
    async () => {
      // A selected entry opens at the field clicked.
      await row.locator('[data-column="amount"]').click();
      return page.getByRole("form", { name: "Edit shared entry", exact: true });
    },
    {
      date: "top",
      payee: "left",
      category: "left",
      amount: "right",
      balance: "right",
    },
  );
});
