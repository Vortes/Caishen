import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";
import { bookSchema, createBook, projectBook } from "../../src/domain/engine";
import { currentMonth } from "../../src/components/budget/format";
import type { State } from "../../src/components/budget/types";

test("large account registers scroll, search, and select across unmounted rows", async ({
  page,
}) => {
  await clerkSetup();
  const [user] = z
    .array(z.object({ id: z.string(), email: z.string().email() }))
    .nonempty()
    .parse(
      JSON.parse(
        await readFile(
          process.env.E2E_USERS_FILE ?? "/tmp/caishen-e2e-users.json",
          "utf8",
        ),
      ),
    );
  const month = currentMonth();
  const date = `${month}-01`;
  const book = createBook(user.id, "Large register fixture", month);
  const budget = book.budgets[user.id]!;
  budget.accounts.push({
    id: "checking",
    kind: "cash",
    name: "Checking",
    date,
    openingBalance: 0,
  });
  budget.transactions = Array.from({ length: 1000 }, (_, index) => ({
    id: `purchase-${String(index).padStart(4, "0")}`,
    accountId: "checking",
    date,
    expenseMonth: month,
    amount: -1,
    payee: `Performance payee ${String(index).padStart(4, "0")}`,
    kind: "purchase",
    status: "posted",
    reviewed: false,
    revision: 1,
    history: [],
  }));
  const pendingInflow = budget.transactions[0]!;
  pendingInflow.kind = "income";
  pendingInflow.status = "pending";
  pendingInflow.amount = 50_000;
  const pendingPurchase = budget.transactions[1]!;
  pendingPurchase.status = "pending";
  pendingPurchase.amount = -2_500;
  const state: State = {
    view: projectBook(bookSchema.parse(book), user.id, month),
    revision: 0,
    history: { undo: null, redo: null },
    services: [
      { name: "OpenRouter", status: "configured", detail: "Test fixture" },
    ],
    connections: [],
    evidence: [],
    imports: [],
  };
  await page.route("**/api/trpc/budget.state?**", async (route) => {
    if (route.request().headers()["trpc-accept"] === "application/jsonl") {
      const stream = jsonlStreamProducer({
        data: { 0: { result: { data: state } } },
        serialize: superjson.serialize,
      });
      await route.fulfill({
        contentType: "application/jsonl",
        body: await new Response(stream).text(),
      });
      return;
    }
    const result = { result: { data: superjson.serialize(state) } };
    await route.fulfill({
      json: new URL(route.request().url()).searchParams.has("batch")
        ? [result]
        : result,
    });
  });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your budget", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  const balances = page.getByRole("group", {
    name: "Account balances",
    exact: true,
  });
  await expect(
    balances
      .locator(".register-balance-item")
      .filter({ hasText: "Posted balance" }),
  ).toContainText("-$9.98");
  await expect(
    balances
      .locator(".register-balance-item")
      .filter({ hasText: "Pending outflows" }),
  ).toContainText("-$25.00");
  await expect(
    balances
      .locator(".register-balance-item")
      .filter({ hasText: "Working balance" }),
  ).toContainText("-$34.98");
  const headerBounds = await page.locator(".register-header").boundingBox();
  expect(headerBounds!.height).toBeLessThanOrEqual(140);
  expect(
    await page
      .locator(".register-payee-cell .register-cell-button")
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(14);
  const captionSizes = await page
    .locator(
      ".register-table th, .register-balance-item > span:last-child, .register-footer",
    )
    .evaluateAll((elements) =>
      elements.map((element) => parseFloat(getComputedStyle(element).fontSize)),
    );
  expect(Math.min(...captionSizes)).toBeGreaterThanOrEqual(13);
  await expect(
    page
      .getByRole("button", { name: "This needs a category", exact: true })
      .first(),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/caishen-all-accounts-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "View transactions", exact: true })
    .click();
  await expect(
    page.getByRole("menuitemradio", { name: "All transactions", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("menuitemradio", { name: "Needs review (1000)", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Clear review filter", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear review filter", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("button", { name: "View transactions", exact: true }),
  ).toBeFocused();
  const accountActions = page.getByRole("button", {
    name: "Account actions",
    exact: true,
  });
  await accountActions.click();
  await page
    .getByRole("menuitem", { name: "Reconcile a statement", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(accountActions).toBeFocused();
  await page.locator(".register-add-transaction").click();
  const transactionEditor = page.locator(".transaction-editor-body");
  await expect(transactionEditor).toBeVisible();
  await transactionEditor
    .getByText("Transaction details", { exact: true })
    .click();
  const largeScroller = page.locator(".register-table-scroll");
  await largeScroller.focus();
  await largeScroller.press("End");
  await expect(
    page.getByRole("button", { name: "Performance payee 0000", exact: true }),
  ).toBeVisible();
  expect(await page.getByRole("table").getByRole("row").count()).toBeLessThan(
    100,
  );
  await transactionEditor
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(transactionEditor).not.toBeVisible();
  await expect(page.locator(".register-add-transaction")).toBeFocused();
  const table = page.getByRole("table");
  const rows = table.getByRole("row");
  const rowBounds = await page
    .locator("tr[data-transaction-id]")
    .first()
    .boundingBox();
  expect(rowBounds!.height).toBeLessThanOrEqual(40);
  await expect(page.locator(".register-footer")).toContainText(
    "1000 transactions",
  );
  await expect(
    page.getByRole("button", { name: "Performance payee 0999", exact: true }),
  ).toBeVisible();
  expect(await rows.count()).toBeLessThan(100);
  const scroller = page.locator(".register-table-scroll");
  await scroller.focus();
  await scroller.press("End");
  await expect(
    page.getByRole("button", { name: "Performance payee 0000", exact: true }),
  ).toBeVisible();
  expect(await rows.count()).toBeLessThan(100);
  await page
    .getByRole("checkbox", {
      name: "Select all visible transactions",
      exact: true,
    })
    .check();
  await expect(page.locator(".register-selection-summary")).toContainText(
    "1000 selected",
  );
  await expect(
    page.getByRole("button", { name: "Approve (1000)", exact: true }),
  ).toBeDisabled();
  await page.locator(".register-suggestions > summary").click();
  const suggest = page.getByRole("button", {
    name: "Suggest categories",
    exact: true,
  });
  const selectionLimit = page.getByText(
    "Select up to 100 purchases at a time for category suggestions.",
    { exact: true },
  );
  await expect(suggest).toBeDisabled();
  await expect(selectionLimit).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "Select all visible transactions",
      exact: true,
    })
    .uncheck();
  const search = page.getByRole("searchbox", {
    name: "Search transactions by payee",
    exact: true,
  });
  await search.fill("Performance payee 09");
  await expect(page.locator(".register-footer")).toContainText(
    "100 transactions",
  );
  await page
    .getByRole("checkbox", {
      name: "Select all visible transactions",
      exact: true,
    })
    .check();
  await expect(suggest).toBeEnabled();
  await expect(selectionLimit).toBeHidden();
  await page
    .getByRole("checkbox", {
      name: "Select all visible transactions",
      exact: true,
    })
    .uncheck();
  await search.fill("Performance payee 0500");
  await expect(page.locator(".register-footer")).toContainText("1 transaction");
  await expect(
    page.getByRole("button", { name: "Performance payee 0500", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "Select all visible transactions",
      exact: true,
    })
    .check();
  await expect(
    page.getByRole("button", { name: "Approve (1)", exact: true }),
  ).toBeEnabled();
  await expect(suggest).toBeEnabled();
  await page.locator(".register-suggestions > summary").click();
  await search.clear();
  await expect(page.locator(".register-footer")).toContainText(
    "1000 transactions",
  );
  expect(await rows.count()).toBeLessThan(100);
  await page.screenshot({
    path: "/tmp/caishen-large-register.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const summaryBounds = await balances.boundingBox();
  expect(summaryBounds!.x).toBeGreaterThanOrEqual(0);
  expect(summaryBounds!.x + summaryBounds!.width).toBeLessThanOrEqual(390);
  const summaryFits = () =>
    balances
      .locator(
        ".register-balance-item, .register-balance-operator, .register-as-of",
      )
      .evaluateAll((elements) =>
        elements.every((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.left >= -0.5 &&
            bounds.right <= window.innerWidth + 0.5 &&
            element.scrollWidth <= element.clientWidth + 1
          );
        }),
      );
  expect(await summaryFits()).toBe(true);
  await expect(search).toBeVisible();
  expect(
    await search.evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(16);
  await page.screenshot({
    path: "/tmp/caishen-all-accounts-mobile.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "125%";
  });
  expect(await summaryFits()).toBe(true);
  expect(
    await search.evaluate((element) =>
      parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(20);
  expect(
    await page
      .locator(".register-toolbar button, .register-toolbar input")
      .evaluateAll((elements) =>
        elements.every((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.left >= -0.5 && bounds.right <= window.innerWidth + 0.5;
        }),
      ),
  ).toBe(true);
});
