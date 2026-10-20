import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import { z } from "zod";

import { currentMonth } from "../../src/components/budget/format";
import type { State } from "../../src/components/budget/types";
import {
  commandSchema,
  createBook,
  execute,
  projectBook,
} from "../../src/domain/engine";

async function respond(route: Route, value: unknown) {
  if (route.request().headers()["trpc-accept"] === "application/jsonl") {
    const stream = jsonlStreamProducer({
      data: { 0: { result: { data: value } } },
      serialize: superjson.serialize,
    });
    await route.fulfill({
      contentType: "application/jsonl",
      body: await new Response(stream).text(),
    });
    return;
  }
  const result = { result: { data: superjson.serialize(value) } };
  await route.fulfill({
    json: new URL(route.request().url()).searchParams.has("batch")
      ? [result]
      : result,
  });
}

async function openFixture(page: Page, large = false) {
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
  let book = createBook(user.id, "Bank register fixture", month);
  book = execute(book, user.id, {
    type: "account.add",
    id: "add-checking",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    date: `${month}-01`,
    openingBalance: 100_000,
  });
  book = execute(book, user.id, {
    type: "account.add",
    id: "add-savings",
    accountId: "savings",
    name: "Savings",
    kind: "cash",
    date: `${month}-01`,
    openingBalance: 50_000,
  });
  book = execute(book, user.id, {
    type: "category.add",
    id: "add-food",
    categoryId: "food",
    name: "Dining out",
    group: "Everyday",
  });
  book = execute(book, user.id, {
    type: "transaction.upsert",
    id: "add-existing",
    transactionId: "existing",
    accountId: "checking",
    date: `${month}-03`,
    amount: -1800,
    payee: "Recorded coffee",
    categoryId: "food",
    status: "posted",
    reviewed: true,
  });
  book = execute(book, user.id, {
    type: "transaction.upsert",
    id: "add-unreviewed",
    transactionId: "unreviewed",
    accountId: "checking",
    date: `${month}-02`,
    amount: -500,
    payee: "Recorded lunch",
    categoryId: "food",
    status: "posted",
    reviewed: false,
  });
  if (large) {
    for (let index = 0; index < 120; index++) {
      book = execute(book, user.id, {
        type: "transaction.upsert",
        id: `add-${index}`,
        transactionId: `transaction-${index}`,
        accountId: "checking",
        date: `${month}-01`,
        amount: -100,
        payee: `Recorded purchase ${index}`,
        categoryId: "food",
        status: "posted",
        reviewed: true,
      });
    }
  }
  const bankImport = (
    logicalId: string,
    payee: string,
    date: string,
    amount: number,
    accountId: string | null = "checking",
  ): State["imports"][number] => ({
    connectionId: "bank",
    logicalId,
    providerAccountId: accountId
      ? `provider-${accountId}`
      : "provider-new-savings",
    accountId,
    date,
    payee,
    amount,
    categoryName: null,
    pending: false,
    removed: false,
    needsMatchReview: false,
    error: null,
    history: [],
    reviewEvidence: [],
  });
  let imports = [
    {
      ...bankImport("coffee", "Imported coffee", `${month}-03`, -1800),
      pending: true,
      needsMatchReview: true,
      categoryName: "Dining out",
    },
    {
      ...bankImport("purchase", "Imported market", `${month}-04`, -2500),
      pending: true,
    },
    bankImport("savings", "Imported interest", `${month}-05`, 1287, null),
    {
      ...bankImport("old", "Older bank activity", "2000-01-01", -100),
      removed: true,
    },
    bankImport("future", "Future bank activity", "2099-01-01", -100),
  ];
  let revision = 0;
  const resolutions: z.infer<typeof resolveSchema>[] = [];
  const unexpectedRequests: string[] = [];
  const resolveSchema = z.object({
    connectionId: z.string(),
    logicalId: z.string(),
    expectedRevision: z.number(),
    existingTransactionId: z.string().optional(),
    ignore: z.boolean().optional(),
    command: commandSchema.optional(),
  });
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/budget.state")) {
      const state: State = {
        view: projectBook(book, user.id, month),
        revision,
        history: { undo: null, redo: null },
        services: [],
        connections: [],
        evidence: [],
        imports,
      };
      await respond(route, state);
      return;
    }
    const payload: unknown = route.request().postDataJSON();
    const serialized = (
      url.searchParams.has("batch")
        ? z.record(z.unknown()).parse(payload)["0"]
        : payload
    ) as ReturnType<typeof superjson.serialize>;
    const input = superjson.deserialize(serialized);
    if (url.pathname.endsWith("/budget.resolveImport")) {
      const resolution = resolveSchema.parse(input);
      expect(resolution.expectedRevision).toBe(revision);
      if (resolution.command) {
        book = execute(book, user.id, resolution.command);
        revision++;
      }
      imports = imports.filter(
        (item) => item.logicalId !== resolution.logicalId,
      );
      resolutions.push(resolution);
      await respond(route, { resolved: true });
      return;
    }
    if (url.pathname.endsWith("/budget.mapBankAccount")) {
      const mapping = z
        .object({
          providerAccountId: z.string(),
          accountId: z.string(),
          startDate: z.string(),
        })
        .parse(input);
      imports = imports.map((item) =>
        item.providerAccountId === mapping.providerAccountId
          ? { ...item, accountId: mapping.accountId }
          : item,
      );
      await respond(route, { mapped: true });
      return;
    }
    unexpectedRequests.push(url.pathname);
    await route.abort("blockedbyclient");
  });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your budget", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  return { month, resolutions, unexpectedRequests };
}

test("bank activity shares register sorting, search, review filtering, and virtualization", async ({
  page,
}) => {
  await openFixture(page, true);
  const table = page.getByRole("table");
  const search = page.getByRole("searchbox", {
    name: "Search transactions by payee",
    exact: true,
  });
  await expect(page.locator(".register-footer")).toContainText(
    "126 transactions",
  );
  await expect(table).toHaveAttribute("aria-rowcount", "127");
  await expect(page.locator(".register-table-scroll")).toHaveAttribute(
    "data-virtualized",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "Bank activity to review" }),
  ).toHaveCount(0);
  await expect(table.locator("tr[data-transaction-id]").first()).toContainText(
    "Imported interest",
  );
  const dates = await table
    .locator("time")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("datetime")),
    );
  expect(dates).toEqual([...dates].sort().reverse());
  await expect(
    table
      .locator("tr[data-bank-import]")
      .filter({ hasText: "Imported market" }),
  ).toContainText("$25.00");
  await search.fill("imported");
  await expect(page.locator(".register-footer")).toContainText(
    "3 transactions",
  );
  await expect(table.locator("tr[data-bank-import]")).toHaveCount(3);
  const coffee = table
    .locator("tr[data-bank-import]")
    .filter({ hasText: "Imported coffee" });
  await expect(coffee).toContainText("Check match");
  await expect(coffee).toContainText("Pending");
  await expect(coffee.locator(".register-category-cell")).toHaveText(
    "Dining out",
  );
  await expect(coffee.locator(".register-status-cell")).toContainText(
    "Check match",
  );
  const purchase = table
    .locator("tr[data-bank-import]")
    .filter({ hasText: "Imported market" });
  await expect(purchase.locator(".register-category-cell")).toHaveText(
    "Choose category",
  );
  await expect(purchase.locator(".register-status-cell")).toContainText(
    "Pending",
  );
  await expect(purchase.locator(".register-needs-review")).toHaveCount(0);
  await expect(
    table
      .locator("tr[data-bank-import]")
      .filter({ hasText: "Imported interest" })
      .locator(".register-category-cell"),
  ).toHaveText("Choose category");
  await search.fill("missing payee");
  await expect(
    page.getByRole("heading", { name: "No matching transactions" }),
  ).toBeVisible();
  await search.clear();
  await page
    .getByRole("button", { name: "View transactions", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "Needs review (5)", exact: true })
    .click();
  await expect(page.locator(".register-footer")).toContainText(
    "5 transactions",
  );
  await expect(
    table.getByRole("button", { name: "Future bank activity", exact: true }),
  ).toBeVisible();
  const posted = table
    .locator("tr[data-bank-import]")
    .filter({ hasText: "Future bank activity" });
  await expect(posted.locator(".register-status-cell")).toContainText("Posted");
  await expect(posted.locator(".register-needs-review")).toHaveCount(0);
  await expect(
    table.getByRole("button", { name: "Older bank activity", exact: true }),
  ).toBeVisible();
  const removed = table
    .locator("tr[data-bank-import]")
    .filter({ hasText: "Older bank activity" });
  await expect(removed.locator(".register-category-cell")).toHaveText(
    "Choose category",
  );
  await expect(removed.locator(".register-status-cell")).toContainText(
    "Check bank update",
  );
  await expect(
    table.locator(".register-category-cell").filter({
      hasText: /Removed by bank|Needs review|Check match|Connect account/,
    }),
  ).toHaveCount(0);
  await expect(
    table.getByRole("button", { name: "Imported market", exact: true }),
  ).toHaveCount(0);
  await expect(
    table.getByRole("button", { name: "Recorded coffee", exact: true }),
  ).toHaveCount(0);
  await table
    .getByRole("checkbox", {
      name: "Select all visible transactions",
      exact: true,
    })
    .check();
  await expect(page.locator(".register-selection-summary")).toContainText(
    "1 selected",
  );
  await expect(
    page.getByRole("button", { name: "Approve (1)", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Clear review filter", exact: true })
    .click();
  const opener = table.getByRole("button", {
    name: "Imported market",
    exact: true,
  });
  await opener.click();
  await expect(
    page.getByRole("dialog", { name: "Review Imported market", exact: true }),
  ).toBeVisible();
  await page.locator(".register-table-scroll").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await page.getByRole("button", { name: /^Checking / }).click();
  await expect(
    table
      .locator("tr[data-bank-import]")
      .filter({ hasText: "Imported interest" }),
  ).toHaveCount(0);
  await expect(
    table.getByRole("button", { name: "Imported market", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  await page.screenshot({
    path: "/tmp/caishen-unified-register.png",
    fullPage: true,
  });
});

test("bank rows support validation, categorization, matching, account mapping, and ignoring", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  const table = page.getByRole("table", { includeHidden: true });
  const balanceBefore = await page
    .getByRole("group", { name: "Account balances", exact: true })
    .innerText();
  await table
    .getByRole("button", { name: "Imported coffee", exact: true })
    .click();
  let review = page.getByRole("dialog");
  await review
    .getByLabel("Already recorded?", { exact: true })
    .selectOption("existing");
  await expect(review.getByLabel("Category", { exact: true })).toHaveCount(0);
  await review
    .getByRole("button", { name: "Confirm bank activity", exact: true })
    .click();
  await expect(review).not.toBeVisible();
  await expect(
    table.getByRole("button", { name: "Imported coffee", exact: true }),
  ).toHaveCount(0);
  expect(fixture.resolutions[0]?.existingTransactionId).toBe("existing");
  expect(fixture.resolutions[0]?.command).toBeUndefined();
  await expect(
    page.getByRole("group", { name: "Account balances", exact: true }),
  ).toHaveText(balanceBefore, { useInnerText: true });
  await table
    .getByRole("button", { name: "Imported market", exact: true })
    .click();
  review = page.getByRole("dialog");
  await review
    .getByRole("button", { name: "Confirm bank activity", exact: true })
    .click();
  await expect(review.getByRole("alert")).toContainText("Choose a category");
  expect(fixture.resolutions).toHaveLength(1);
  await review.getByLabel("Category", { exact: true }).selectOption("food");
  await expect(review.getByRole("alert")).toHaveCount(0);
  await review
    .getByRole("button", { name: "Confirm bank activity", exact: true })
    .click();
  await expect(review).not.toBeVisible();
  await expect(
    table
      .locator("tr[data-bank-import]")
      .filter({ hasText: "Imported market" }),
  ).toHaveCount(0);
  await expect(
    table
      .locator("tr[data-transaction-id]")
      .filter({ hasText: "Imported market" }),
  ).toContainText("Dining out");
  expect(fixture.resolutions[1]?.command).toMatchObject({
    type: "transaction.upsert",
    categoryId: "food",
    accountId: "checking",
    amount: -2500,
  });
  await table
    .getByRole("button", { name: "Imported interest", exact: true })
    .click();
  review = page.getByRole("dialog");
  await expect(
    review.getByLabel("Your budget account", { exact: true }),
  ).toBeVisible();
  await review
    .getByLabel("Your budget account", { exact: true })
    .selectOption("savings");
  await review
    .getByLabel("Import activity beginning", { exact: true })
    .fill(`${fixture.month}-02`);
  await review
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await expect(
    review.getByLabel("Already recorded?", { exact: true }),
  ).toBeVisible();
  await expect(
    table
      .locator("tr[data-bank-import]")
      .filter({ hasText: "Imported interest" }),
  ).toContainText("Savings");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(review).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: "/tmp/caishen-bank-review-mobile.png",
    fullPage: true,
  });
  await review
    .getByRole("button", { name: "Confirm bank activity", exact: true })
    .click();
  await expect(review).not.toBeVisible();
  expect(fixture.resolutions[2]?.command).toMatchObject({
    type: "transaction.upsert",
    accountId: "savings",
    amount: 1287,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await table
    .getByRole("button", { name: "Older bank activity", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "This does not confirm a cancellation or refund.",
  );
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm bank activity", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ignore this bank transaction", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(fixture.resolutions[3]?.ignore).toBe(true);
  await expect(
    table.getByRole("button", { name: "Older bank activity", exact: true }),
  ).toHaveCount(0);
  expect(fixture.unexpectedRequests).toEqual([]);
});
