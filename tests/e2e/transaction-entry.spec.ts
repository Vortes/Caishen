import { clerk, clerkSetup } from "@clerk/testing/playwright";
import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import { z } from "zod";

import { currentMonth } from "../../src/components/budget/format";
import type { State } from "../../src/components/budget/types";
import {
  addMember,
  commandSchema,
  createBook,
  execute,
  projectBook,
  type Command,
} from "../../src/domain/engine";

const mutationSchema = z.object({
  command: commandSchema,
  expectedRevision: z.number().int().nonnegative(),
});

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

async function openFixture(page: Page) {
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
  let book = addMember(
    createBook(user.id, "Transaction entry fixture", month),
    "transaction-fixture-partner",
    "Connected partner",
    month,
  );
  const initial: Command[] = [
    {
      type: "account.add",
      id: "seed-checking",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      date,
      openingBalance: 100_000,
    },
    {
      type: "account.add",
      id: "seed-savings",
      accountId: "savings",
      name: "Savings",
      kind: "cash",
      date,
      openingBalance: 50_000,
    },
    {
      type: "category.add",
      id: "seed-food",
      categoryId: "food",
      name: "Groceries",
      group: "Everyday",
    },
    {
      type: "category.add",
      id: "seed-rent",
      categoryId: "rent",
      name: "Rent",
      group: "Bills",
    },
    {
      type: "shared.create",
      id: "seed-shared",
      sharedCategoryId: "shared-rent",
      name: "Shared rent",
      participants: [user.id, "transaction-fixture-partner"],
      weights: { [user.id]: 1, "transaction-fixture-partner": 1 },
      categoryIds: {
        [user.id]: "rent",
        "transaction-fixture-partner": "partner-rent",
      },
    },
    {
      type: "assign",
      id: "seed-food-money",
      categoryId: "food",
      month,
      amount: 20_000,
    },
  ];
  for (const command of initial) book = execute(book, user.id, command);
  let revision = 0;
  const commands: Command[] = [];
  const expectedRevisions: number[] = [];
  const unexpectedRequests: string[] = [];
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/budget.state")) {
      const state: State = {
        view: projectBook(book, user.id, month),
        revision,
        services: [],
        connections: [],
        evidence: [],
        imports: [],
      };
      await respond(route, state);
      return;
    }
    if (url.pathname.endsWith("/budget.execute")) {
      const payload: unknown = route.request().postDataJSON();
      const serialized = (
        url.searchParams.has("batch")
          ? z.record(z.unknown()).parse(payload)["0"]
          : payload
      ) as ReturnType<typeof superjson.serialize>;
      const input = mutationSchema.parse(superjson.deserialize(serialized));
      expectedRevisions.push(input.expectedRevision);
      expect(input.expectedRevision).toBe(revision);
      book = execute(book, user.id, input.command);
      commands.push(input.command);
      revision++;
      await respond(route, { revision });
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
  return {
    user,
    date,
    commands,
    expectedRevisions,
    unexpectedRequests,
    book: () => book,
    projection: () => projectBook(book, user.id, month),
  };
}

async function choose(
  page: Page,
  editor: Locator,
  label: "Account" | "Category",
  name: string,
  searchText = name,
) {
  await editor.getByRole("combobox", { name: label, exact: true }).click();
  const search = page.getByRole("textbox", {
    name: label === "Account" ? "Search accounts" : "Search categories",
    exact: true,
  });
  await search.fill(searchText);
  await search.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    editor.getByRole("combobox", { name: label, exact: true }),
  ).toHaveText(name);
}

test("inline transaction entry saves distinct purchases, income, and refunds", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  const editor = page.locator(".transaction-editor-body");
  const add = page.locator(".register-add-transaction");
  await add.click();
  await expect(editor).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await choose(page, editor, "Account", "Savings", "sav");
  await editor.getByLabel("Date", { exact: true }).fill(fixture.date);
  await editor.getByLabel("Payee", { exact: true }).fill("Neighborhood market");
  await choose(page, editor, "Category", "Groceries", "groc");
  await editor.getByLabel("Outflow", { exact: true }).fill("30.00");
  await page.screenshot({
    path: "/tmp/caishen-inline-transaction-desktop.png",
    fullPage: true,
  });
  const categoryChoice = editor.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  await categoryChoice.click();
  await page.screenshot({
    path: "/tmp/caishen-inline-transaction-category.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("listbox", { name: "Category options", exact: true }),
  ).not.toBeVisible();
  await expect(editor).toBeVisible();
  await expect(categoryChoice).toBeFocused();
  await editor
    .getByRole("button", { name: "Save and add another", exact: true })
    .click();
  await expect.poll(() => fixture.commands.length).toBe(1);
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Date", { exact: true })).toHaveValue(
    fixture.date,
  );
  await expect(
    editor.getByRole("combobox", { name: "Account", exact: true }),
  ).toHaveText("Savings");
  await expect(editor.getByLabel("Payee", { exact: true })).toHaveValue("");
  await expect(editor.getByLabel("Outflow", { exact: true })).toHaveValue("");
  await expect(editor.getByLabel("Inflow", { exact: true })).toHaveValue("");
  await editor.getByLabel("Payee", { exact: true }).fill("Second market");
  await choose(page, editor, "Category", "Groceries");
  await editor.getByLabel("Outflow", { exact: true }).fill("20.00");
  await editor.getByLabel("Outflow", { exact: true }).press("Enter");
  await expect(editor).not.toBeVisible();
  await expect.poll(() => fixture.commands.length).toBe(2);
  const transactions = () =>
    fixture.book().budgets[fixture.user.id]!.transactions;
  expect(transactions().map((transaction) => transaction.amount)).toEqual([
    -3000, -2000,
  ]);
  expect(new Set(fixture.commands.map((command) => command.id)).size).toBe(2);
  expect(
    new Set(transactions().map((transaction) => transaction.id)).size,
  ).toBe(2);
  expect(
    transactions().every((transaction) => transaction.accountId === "savings"),
  ).toBe(true);
  expect(fixture.projection().cash).toBe(145_000);
  const readyBeforeIncome = fixture.projection().readyToAssign;
  await add.click();
  await editor.getByLabel("Payee", { exact: true }).fill("Payroll");
  await choose(page, editor, "Category", "Inflow: Ready to Assign", "ready");
  await editor.getByLabel("Inflow", { exact: true }).fill("100.00");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(transactions().at(-1)).toMatchObject({
    payee: "Payroll",
    amount: 10_000,
    kind: "income",
    categoryId: undefined,
  });
  expect(fixture.projection().readyToAssign).toBe(readyBeforeIncome + 10_000);
  await add.click();
  await editor.getByLabel("Payee", { exact: true }).fill("Market refund");
  await choose(page, editor, "Category", "Groceries");
  await editor.getByLabel("Inflow", { exact: true }).fill("50.00");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(transactions().at(-1)).toMatchObject({
    payee: "Market refund",
    amount: 5000,
    kind: "refund",
    categoryId: "food",
  });
  expect(fixture.projection().readyToAssign).toBe(readyBeforeIncome + 10_000);
  expect(fixture.projection().cash).toBe(160_000);
  expect(fixture.commands).toHaveLength(4);
  expect(fixture.expectedRevisions).toEqual([0, 1, 2, 3]);
  expect(fixture.unexpectedRequests).toEqual([]);
});

test("invalid drafts remain editable and account context survives cancellation on mobile", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  const editor = page.locator(".transaction-editor-body");
  const add = page.locator(".register-add-transaction");
  await add.click();
  await editor.getByLabel("Payee", { exact: true }).fill("Draft rent");
  await choose(page, editor, "Category", "Rent");
  await editor.getByLabel("Outflow", { exact: true }).fill("1.234");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toContainText(
    "Enter a positive amount with no more than two decimal places.",
  );
  await expect(editor.getByLabel("Payee", { exact: true })).toHaveValue(
    "Draft rent",
  );
  expect(fixture.commands).toHaveLength(0);
  await editor.getByLabel("Outflow", { exact: true }).fill("100.00");
  await editor.getByText("Transaction details", { exact: true }).click();
  await editor
    .getByLabel("Shared category (optional)", { exact: true })
    .selectOption({ label: "Shared rent" });
  await editor
    .getByLabel("Your share override ($, optional)", { exact: true })
    .fill("101.00");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toContainText(
    "Your share cannot exceed the full outflow.",
  );
  await expect(editor.getByLabel("Payee", { exact: true })).toHaveValue(
    "Draft rent",
  );
  expect(fixture.commands).toHaveLength(0);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(add).toBeFocused();
  await add.click();
  await editor
    .getByLabel("Payee", { exact: true })
    .fill("Canceled with Escape");
  await page.keyboard.press("Escape");
  await expect(editor).not.toBeVisible();
  await expect(add).toBeFocused();
  await page
    .getByRole("complementary", { name: "Budget navigation", exact: true })
    .getByRole("button", { name: /Savings/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Savings", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await add.click();
  await editor.getByText("Transaction details", { exact: true }).click();
  await expect(
    editor.getByRole("combobox", { name: "Account", exact: true }),
  ).toHaveText("Savings");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  const errorSummary = editor.locator(".transaction-editor-error");
  await expect(errorSummary).toHaveText("Enter a payee.");
  await expect(errorSummary).toBeVisible();
  const errorBounds = await errorSummary.boundingBox();
  expect(errorBounds!.x).toBeGreaterThanOrEqual(0);
  expect(errorBounds!.x + errorBounds!.width).toBeLessThanOrEqual(390);
  await editor.getByLabel("Payee", { exact: true }).fill("Mobile market");
  await choose(page, editor, "Category", "Groceries");
  await editor.getByLabel("Outflow", { exact: true }).fill("10.00");
  await page.screenshot({
    path: "/tmp/caishen-inline-transaction-mobile.png",
    fullPage: true,
  });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(fixture.commands).toHaveLength(1);
  expect(fixture.book().budgets[fixture.user.id]!.transactions).toMatchObject([
    { accountId: "savings", amount: -1000, payee: "Mobile market" },
  ]);
  expect(fixture.projection().cash).toBe(149_000);
  expect(fixture.unexpectedRequests).toEqual([]);
});
