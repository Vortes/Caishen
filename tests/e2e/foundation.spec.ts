import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { PrismaClient } from "../../src/generated/prisma/index.js";
import { bookSchema, projectBook } from "../../src/domain/engine";

const usersSchema = z
  .array(z.object({ id: z.string(), email: z.string().email() }))
  .length(2);
const suffix = randomUUID().slice(0, 7);
const names = {
  cash: `Checking ${suffix}`,
  card: `Card ${suffix}`,
  groceries: `Groceries ${suffix}`,
  dining: `Dining ${suffix}`,
  payee: `Private market ${suffix}`,
  loan: `Student loan ${suffix}`,
  privatePartner: `Partner hobby ${suffix}`,
};

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: email });
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(
    /Let’s give your money a home\.|Your budget/,
  );
}
async function onboard(page: Page, name: string) {
  if (
    await page.getByRole("button", { name: "Create my budget" }).isVisible()
  ) {
    await page.getByLabel("Budget name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Create my budget" }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Your budget", exact: true }),
  ).toBeVisible();
}
async function addAccount(
  page: Page,
  name: string,
  amount: string,
  kind = "cash",
) {
  await page
    .getByRole("button", { name: "Add account", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Account name", { exact: true }).fill(name);
  await dialog.getByLabel("Account type", { exact: true }).selectOption(kind);
  await dialog.getByLabel("Opening balance ($)", { exact: true }).fill(amount);
  await dialog
    .getByRole("button", { name: "Add account", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}
async function addCategory(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Add category", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Category name", { exact: true }).fill(name);
  await dialog
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
async function assign(page: Page, name: string, amount: string) {
  const assigned = page.getByTitle(`Assign money to ${name}`, { exact: true });
  await assigned.click();
  const editor = page.getByLabel(`Assigned amount for ${name}`, {
    exact: true,
  });
  await editor.fill(amount);
  await editor.press("Enter");
  await expect(editor).not.toBeVisible();
  await expect(assigned).toHaveText(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(amount)),
  );
  await expect(assigned).toBeEnabled();
  await expect(assigned).toBeFocused();
}
async function connectPartners(page: Page, partner: Page) {
  await expect(
    page.getByRole("complementary", { name: "Budget details", exact: true }),
  ).toBeVisible();
  const createInvite = page.getByRole("button", {
    name: "Create invitation code",
    exact: true,
  });
  if (!(await createInvite.isVisible())) return;
  await createInvite.click();
  await expect(page.locator(".inline-code")).toBeVisible();
  const code = await page.locator(".inline-code").innerText();
  await partner.reload();
  await expect(
    partner.getByRole("complementary", { name: "Budget details", exact: true }),
  ).toBeVisible();
  await partner
    .getByRole("button", { name: "Enter partner’s code", exact: true })
    .click();
  const joinDialog = partner.getByRole("dialog");
  await joinDialog
    .getByLabel("Partner’s invitation code", { exact: true })
    .fill(code);
  await joinDialog
    .getByRole("button", { name: "Connect budgets", exact: true })
    .click();
  await expect(joinDialog).not.toBeVisible();
  await page.reload();
}
function inspectorFor(page: Page, name: string) {
  return page.getByRole("complementary", {
    name: `${name} details`,
    exact: true,
  });
}
async function shareCategory(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  const inspector = inspectorFor(page, name);
  await inspector
    .getByRole("button", { name: "Share category", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Save shared category", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    inspector.getByRole("button", { name: `Edit ${name} split`, exact: true }),
  ).toBeVisible();
}
async function purchase(
  page: Page,
  payee: string,
  account: string,
  category: string,
  amount: string,
  sharedCategory?: string,
) {
  const startedOnPlan = await page
    .getByRole("heading", { name: "Your budget", exact: true })
    .isVisible();
  if (startedOnPlan)
    await page
      .getByRole("button", { name: "All accounts", exact: true })
      .click();
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .first()
    .click();
  const editor = page.locator(".transaction-editor-body");
  await expect(editor).toBeVisible();
  await editor.getByRole("combobox", { name: "Account", exact: true }).click();
  await page
    .getByRole("listbox", { name: "Account options", exact: true })
    .getByRole("option", { name: account, exact: true })
    .click();
  await editor.getByLabel("Payee", { exact: true }).fill(payee);
  await editor.getByLabel("Outflow", { exact: true }).fill(amount);
  await editor.getByRole("combobox", { name: "Category", exact: true }).click();
  await page
    .getByRole("listbox", { name: "Category options", exact: true })
    .getByRole("option", { name: category, exact: true })
    .click();
  if (sharedCategory) {
    await editor.getByText("Transaction details", { exact: true }).click();
    await editor
      .getByLabel("Shared category (optional)", { exact: true })
      .selectOption({ label: sharedCategory });
  }
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).not.toBeVisible();
  if (startedOnPlan)
    await page.getByRole("button", { name: "Plan", exact: true }).click();
}

test.beforeAll(async () => {
  const connectionUrl = process.env.DATABASE_URL;
  if (
    !connectionUrl ||
    !new URL(connectionUrl).hostname.startsWith("ep-odd-voice-b4sie2v1")
  )
    throw new Error(
      "Browser tests require the isolated dev-caishen database branch.",
    );
  await clerkSetup();
  const users = usersSchema.parse(
    JSON.parse(
      await readFile(
        process.env.E2E_USERS_FILE ?? "/tmp/caishen-e2e-users.json",
        "utf8",
      ),
    ),
  );
  if (
    users.some(
      (user) =>
        !user.id.startsWith("user_") ||
        !/^caishen-[^@]+\+clerk_test@example\.com$/.test(user.email),
    )
  )
    throw new Error(
      "E2E cleanup is restricted to explicitly supplied Caishen Clerk test fixtures.",
    );
  const userIds = users.map((user) => user.id);
  const db = new PrismaClient();
  try {
    const workspaces = await db.workspace.findMany({
      where: { members: { some: { clerkUserId: { in: userIds } } } },
      select: { id: true, members: { select: { clerkUserId: true } } },
    });
    if (
      workspaces.some((workspace) =>
        workspace.members.some(
          (member) => !userIds.includes(member.clerkUserId),
        ),
      )
    )
      throw new Error(
        "Refusing to clean a workspace containing a non-fixture member.",
      );
    await db.$transaction([
      db.reviewEvidence.deleteMany({ where: { clerkUserId: { in: userIds } } }),
      db.bankConnection.deleteMany({ where: { clerkUserId: { in: userIds } } }),
      db.dailyDelivery.deleteMany({ where: { clerkUserId: { in: userIds } } }),
      db.workspace.deleteMany({
        where: { id: { in: workspaces.map((workspace) => workspace.id) } },
      }),
    ]);
  } finally {
    await db.$disconnect();
  }
});

test("signed-out visitors see the budgeting entry point and cannot read a budget", async ({
  page,
}) => {
  await page.goto("/");
  await clerk.loaded({ page });
  await expect(
    page.getByRole("heading", { name: "Make yourself at home." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create your account" }),
  ).toBeVisible();
  const response = await page.request.get(
    `/api/trpc/budget.state?input=${encodeURIComponent(JSON.stringify({ json: { month: "2026-10" } }))}`,
  );
  expect(response.status()).toBe(401);
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()) {
    const webhook = await page.request.post("/api/webhooks/clerk", {
      data: { type: "user.created", data: { id: "user_unverified" } },
    });
    expect(webhook.status()).toBe(503);
    expect(await webhook.json()).toEqual({
      error: "Clerk webhook signing is not configured.",
    });
  }
});

test("two users budget, review, record card and loan payments, and share only authorized information", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const users = usersSchema.parse(
    JSON.parse(
      await readFile(
        process.env.E2E_USERS_FILE ?? "/tmp/caishen-e2e-users.json",
        "utf8",
      ),
    ),
  );
  const first = users[0]!;
  const second = users[1]!;
  const db = new PrismaClient();
  const partnerContext = await browser.newContext();
  const partner = await partnerContext.newPage();
  try {
    await signIn(page, first.email);
    await onboard(page, `Personal budget ${suffix}`);
    await addAccount(page, names.cash, "1000.00");
    await addCategory(page, names.groceries);
    await addCategory(page, names.dining);

    await page
      .getByRole("button", { name: "All accounts", exact: true })
      .click();
    const transactionOpener = page
      .getByRole("button", {
        name: "Add transaction",
        exact: true,
      })
      .first();
    await transactionOpener.click();
    await expect(page.locator(".transaction-editor-body")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(".transaction-editor-body")).not.toBeVisible();
    await expect(transactionOpener).toBeFocused();
    await page.getByRole("button", { name: "Plan", exact: true }).click();

    const monthPicker = page.locator(".month-picker-label");
    const initialMonth = await monthPicker.innerText();
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await expect(monthPicker).not.toHaveText(initialMonth);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(monthPicker).toHaveText(initialMonth);

    await page
      .getByRole("button", { name: "Collapse Everyday", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: names.groceries, exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Expand Everyday", exact: true })
      .click();
    await page
      .getByRole("checkbox", {
        name: "Select Everyday categories",
        exact: true,
      })
      .check();
    await expect(
      page.getByRole("heading", { name: "2 categories selected", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Clear category selection", exact: true })
      .click();

    const groceriesName = page.getByRole("button", {
      name: names.groceries,
      exact: true,
    });
    await groceriesName.focus();
    await groceriesName.press("Enter");
    const inspector = page.getByRole("complementary", {
      name: `${names.groceries} details`,
      exact: true,
    });
    await expect(inspector).toBeVisible();
    await expect(page.locator(".budget-plan")).toHaveCSS("display", "flex");
    const planBounds = await page.locator(".plan-main").boundingBox();
    const inspectorBounds = await inspector.boundingBox();
    expect(planBounds).not.toBeNull();
    expect(inspectorBounds).not.toBeNull();
    expect(inspectorBounds!.x).toBeGreaterThanOrEqual(
      planBounds!.x + planBounds!.width - 1,
    );
    expect(Math.abs(inspectorBounds!.y - planBounds!.y)).toBeLessThanOrEqual(1);
    await inspector
      .getByRole("button", {
        name: `Create target for ${names.groceries}`,
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await inspector.getByLabel("I need", { exact: true }).fill("400.00");
    await inspector
      .getByRole("button", { name: "Save target", exact: true })
      .click();
    await expect(
      inspector.getByLabel("I need", { exact: true }),
    ).not.toBeVisible();
    await expect(inspector).toContainText("more to meet your target");
    await expect(inspector).toContainText("$400.00");

    const filters = page.getByRole("group", { name: "Filter categories" });
    await filters.getByRole("button", { name: /^Underfunded/ }).click();
    await expect(groceriesName).toBeVisible();
    await expect(
      page.getByRole("button", { name: names.dining, exact: true }),
    ).toHaveCount(0);
    await filters.getByRole("button", { name: /^Money available/ }).click();
    await expect(
      page.getByRole("heading", { name: "No categories match", exact: true }),
    ).toBeVisible();
    await filters.getByRole("button", { name: "All", exact: true }).click();
    const categorySearch = page.getByRole("textbox", {
      name: "Search categories",
      exact: true,
    });
    await categorySearch.fill(names.groceries);
    await expect(groceriesName).toBeVisible();
    await expect(
      page.getByRole("button", { name: names.dining, exact: true }),
    ).toHaveCount(0);
    await categorySearch.clear();

    await assign(page, names.groceries, "300.00");
    await filters.getByRole("button", { name: /^Money available/ }).click();
    await expect(groceriesName).toBeVisible();
    await expect(
      page.getByRole("button", { name: names.dining, exact: true }),
    ).toHaveCount(0);
    await filters.getByRole("button", { name: "All", exact: true }).click();
    await page
      .getByTitle(`Assign money to ${names.groceries}`, { exact: true })
      .click();
    const canceledAssignment = page.getByLabel(
      `Assigned amount for ${names.groceries}`,
      { exact: true },
    );
    await canceledAssignment.fill("325.00");
    await canceledAssignment.press("Escape");
    await expect(canceledAssignment).not.toBeVisible();
    await expect(
      page.getByTitle(`Assign money to ${names.groceries}`, { exact: true }),
    ).toHaveText("$300.00");
    await assign(page, names.groceries, "350.00");
    const groceriesAssignment = page.getByTitle(
      `Assign money to ${names.groceries}`,
      { exact: true },
    );
    await groceriesAssignment.click();
    const blurredAssignment = page.getByLabel(
      `Assigned amount for ${names.groceries}`,
      { exact: true },
    );
    await blurredAssignment.fill("300.00");
    await categorySearch.click();
    await expect(blurredAssignment).not.toBeVisible();
    await expect(groceriesAssignment).toHaveText("$300.00");
    await expect(groceriesAssignment).toBeEnabled();
    await expect(categorySearch).toBeFocused();
    await assign(page, names.dining, "100.00");
    await purchase(page, names.payee, names.cash, names.groceries, "30.00");
    const groceriesRow = page
      .getByRole("row")
      .filter({ hasText: names.groceries });
    await expect(groceriesRow).toContainText("$270.00");
    await page.reload();
    await expect(
      page.getByRole("row").filter({ hasText: names.groceries }),
    ).toContainText("$270.00");
    await page
      .getByRole("button", { name: names.groceries, exact: true })
      .click();
    const groceriesDetails = inspectorFor(page, names.groceries);
    const breakdownRow = (label: string) =>
      groceriesDetails
        .locator(".inspector-values > div")
        .filter({ hasText: label });
    await expect(breakdownRow("Assigned this month")).toContainText("+$300.00");
    await expect(breakdownRow("Cash spending")).toContainText("-$30.00");
    await expect(breakdownRow("Credit spending")).toContainText("$0.00");
    await groceriesDetails
      .getByRole("button", { name: "Clear category selection", exact: true })
      .click();
    const budgetDetails = page.getByRole("complementary", {
      name: "Budget details",
      exact: true,
    });
    await expect(budgetDetails).toContainText("Cost to be me");
    const expectedIncome = budgetDetails.getByRole("textbox", {
      name: "Expected income",
      exact: true,
    });
    await expectedIncome.fill("$350");
    await expectedIncome.press("Enter");
    await expect(budgetDetails).toContainText(
      "Your targets need $50.00 more than you expect to earn.",
    );
    await expectedIncome.fill("1,000");
    await expectedIncome.blur();
    await expect(budgetDetails).toContainText(
      "Your income covers your targets with $600.00 to spare.",
    );
    await page.reload();
    await expect(
      page
        .getByRole("complementary", { name: "Budget details", exact: true })
        .getByRole("textbox", { name: "Expected income", exact: true }),
    ).toHaveValue("1000.00");

    await page
      .getByRole("button", { name: "All accounts", exact: true })
      .click();
    let purchaseRow = page.getByRole("row").filter({ hasText: names.payee });
    await purchaseRow
      .getByRole("button", { name: names.groceries, exact: true })
      .click();
    const transactionEditor = page.locator(".transaction-editor-body");
    await transactionEditor
      .getByRole("combobox", { name: "Category", exact: true })
      .click();
    await page
      .getByRole("listbox", { name: "Category options", exact: true })
      .getByRole("option", { name: names.dining, exact: true })
      .click();
    await transactionEditor
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(transactionEditor).not.toBeVisible();
    purchaseRow = page.getByRole("row").filter({ hasText: names.payee });
    await expect(purchaseRow).toContainText(names.dining);
    await purchaseRow.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Approve (1)", exact: true })
      .click();
    await expect(purchaseRow).toContainText("Approved");
    await purchaseRow
      .getByRole("button", { name: names.payee, exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog.getByText(/Transaction history ·/).click();
    await expect(dialog).toContainText("Revision 2");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await addAccount(page, `Other card ${suffix}`, "0.00", "credit");
    await addAccount(page, names.card, "200.00", "credit");
    const cardCategory = `${names.card} payment`;
    await page.getByRole("button", { name: cardCategory, exact: true }).click();
    const cardDetails = inspectorFor(page, cardCategory);
    await expect(cardDetails).toContainText(
      "Your card balance is $200.00 more than you’ve set aside to pay it.",
    );
    await cardDetails
      .getByRole("button", { name: "Assign $200.00", exact: true })
      .click();
    await expect(cardDetails.locator(".inspector-callout")).toHaveCount(0);
    await expect(
      page.getByTitle(`Assign money to ${cardCategory}`, { exact: true }),
    ).toHaveText("$200.00");
    await cardDetails
      .getByRole("button", { name: "Clear category selection", exact: true })
      .click();
    await purchase(
      page,
      `Card purchase ${suffix}`,
      names.card,
      names.groceries,
      "50.00",
    );
    await page
      .getByRole("complementary", { name: "Budget navigation", exact: true })
      .getByRole("button", { name: new RegExp(names.card) })
      .click();
    await expect(
      page.getByRole("heading", { name: names.card, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: `Card purchase ${suffix}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: names.payee }),
    ).toHaveCount(0);
    const accountTransactionOpener = page.getByRole("button", {
      name: "Add transaction",
      exact: true,
    });
    await accountTransactionOpener.click();
    const accountEditor = page.locator(".transaction-editor-body");
    await accountEditor
      .getByText("Transaction details", { exact: true })
      .click();
    await expect(
      accountEditor.getByRole("combobox", { name: "Account", exact: true }),
    ).toHaveText(names.card);
    await accountEditor
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(accountEditor).not.toBeVisible();
    await expect(accountTransactionOpener).toBeFocused();
    await page
      .getByRole("button", { name: "Account actions", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Record a card payment", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await expect(
      dialog
        .getByLabel("Paid to credit card", { exact: true })
        .locator("option:checked"),
    ).toHaveText(names.card);
    await dialog
      .getByLabel("Paid from cash account", { exact: true })
      .selectOption({ label: names.cash });
    await dialog
      .getByLabel("Payment amount ($)", { exact: true })
      .fill("250.00");
    await dialog
      .getByRole("button", { name: "Record payment", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("button", { name: cardCategory, exact: true }).click();
    const cardRow = (label: string) =>
      cardDetails.locator(".inspector-values > div").filter({ hasText: label });
    await expect(cardRow("Funded spending")).toContainText("+$50.00");
    await expect(cardRow("Payments made")).toContainText("-$250.00");
    await expect(cardRow("Start of month")).toContainText("-$200.00");
    await expect(cardRow("Current balance")).toContainText("$0.00");
    await cardDetails
      .getByRole("button", { name: "Clear category selection", exact: true })
      .click();
    await page
      .getByRole("button", { name: "All accounts", exact: true })
      .click();
    await expect(
      page.getByRole("row").filter({ hasText: names.payee }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Loans", exact: true }).click();
    await page.getByRole("button", { name: "Add loan", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Loan name", { exact: true }).fill(names.loan);
    await dialog
      .getByLabel("Confirmed principal ($)", { exact: true })
      .fill("5000.00");
    await dialog
      .getByLabel("Confirmed annual rate (%)", { exact: true })
      .fill("5.00");
    await dialog
      .getByLabel("Required monthly payment ($)", { exact: true })
      .fill("100.00");
    await dialog.getByRole("button", { name: "Add loan", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page
      .getByLabel("Preview a one-time extra payment", { exact: true })
      .fill("500.00");
    await expect(
      page.getByText(
        "This preview changes no funding and initiates no payment.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await assign(page, `${names.loan} payment`, "150.00");
    await page.getByRole("button", { name: "Loans", exact: true }).click();
    await page
      .getByRole("button", { name: "Record lender payment", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Paid from cash account", { exact: true })
      .selectOption({ label: names.cash });
    await dialog
      .getByLabel("Lender-confirmed principal ($)", { exact: true })
      .fill("120.00");
    await dialog
      .getByLabel("Lender-confirmed interest ($)", { exact: true })
      .fill("30.00");
    await dialog
      .getByRole("button", { name: "Record lender payment", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("$4,880.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page
      .getByRole("button", { name: names.groceries, exact: true })
      .click();
    await page.screenshot({
      path: "/tmp/caishen-plan-desktop.png",
      fullPage: true,
    });

    const member = await db.workspaceMember.findUniqueOrThrow({
      where: { clerkUserId: first.id },
      include: { workspace: true },
    });
    const own = bookSchema.parse(member.workspace.book).budgets[first.id]!;
    expect(
      own.transactions.filter(
        (transaction) =>
          transaction.payee === names.payee && !transaction.removed,
      ),
    ).toHaveLength(1);
    const cashAccount = own.accounts.find(
      (account) => account.name === names.cash,
    )!;
    const cardAccount = own.accounts.find(
      (account) => account.name === names.card,
    )!;
    const cardActivity = own.transactions
      .filter((transaction) => transaction.accountId === cardAccount.id)
      .reduce(
        (sum, transaction) => sum + transaction.amount,
        cardAccount.openingBalance,
      );
    expect(cardActivity).toBe(0);
    expect(
      own.loans.find((loan) => loan.name === names.loan)?.payments[0],
    ).toMatchObject({ principal: 12000, interest: 3000 });

    await signIn(partner, second.email);
    await onboard(partner, `Partner budget ${suffix}`);
    await addAccount(partner, `Partner checking ${suffix}`, "500.00");
    await addCategory(partner, names.privatePartner);
    await assign(partner, names.privatePartner, "40.00");
    await purchase(
      partner,
      names.privatePartner,
      `Partner checking ${suffix}`,
      names.privatePartner,
      "17.00",
    );
    await expect(partner.getByText(names.payee, { exact: true })).toHaveCount(
      0,
    );
    const partnerMember = await db.workspaceMember.findUniqueOrThrow({
      where: { clerkUserId: second.id },
    });
    const partnerWorkspace = await db.workspace.findUniqueOrThrow({
      where: { id: partnerMember.workspaceId },
    });
    const forbidden = await partner.request.post("/api/trpc/budget.execute", {
      data: {
        json: {
          expectedRevision: partnerWorkspace.revision,
          command: {
            type: "transaction.upsert",
            id: randomUUID(),
            transactionId: randomUUID(),
            accountId: cashAccount.id,
            payee: "Unauthorized transaction",
            date: new Date().toLocaleDateString("en-CA", {
              timeZone: "America/Los_Angeles",
            }),
            amount: -100,
            status: "posted",
          },
        },
      },
    });
    expect(forbidden.status()).toBeGreaterThanOrEqual(400);
    const state = await partner.request.get(
      `/api/trpc/budget.state?input=${encodeURIComponent(JSON.stringify({ json: { month: own.startMonth } }))}`,
    );
    expect(state.status()).toBe(200);
    expect(await state.text()).not.toContain(names.payee);

    await page.reload();
    await connectPartners(page, partner);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(
      page.getByText(names.privatePartner, { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: "/tmp/caishen-dashboard-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your budget", exact: true }),
    ).toBeVisible();
    const detailsToggle = page.getByRole("button", {
      name: "Toggle budget details",
      exact: true,
    });
    const detailsDialog = page.getByRole("dialog", {
      name: "Budget details",
      exact: true,
    });
    const mobileGroceriesCheckbox = page.getByRole("checkbox", {
      name: `Select ${names.groceries}`,
      exact: true,
    });
    const mobileDiningCheckbox = page.getByRole("checkbox", {
      name: `Select ${names.dining}`,
      exact: true,
    });
    await mobileGroceriesCheckbox.check();
    await expect(detailsDialog).not.toBeVisible();
    await mobileDiningCheckbox.check();
    await expect(detailsDialog).not.toBeVisible();
    await expect(mobileGroceriesCheckbox).toBeChecked();
    await expect(mobileDiningCheckbox).toBeChecked();
    await detailsToggle.click();
    await expect(detailsDialog).toBeVisible();
    await expect(
      detailsDialog.getByRole("heading", {
        name: "2 categories selected",
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(detailsDialog).not.toBeVisible();
    await expect(detailsToggle).toBeFocused();
    await expect(mobileGroceriesCheckbox).not.toBeChecked();
    await expect(mobileDiningCheckbox).not.toBeChecked();
    await detailsToggle.click();
    await expect(detailsDialog).toBeVisible();
    await expect(detailsDialog).toContainText("Available in categories");
    await expect(
      detailsDialog.getByRole("button", {
        name: "Close budget details",
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(detailsDialog).not.toBeVisible();
    await expect(detailsToggle).toBeFocused();
    const mobileCategory = page.getByRole("button", {
      name: names.groceries,
      exact: true,
    });
    await mobileCategory.click();
    await expect(detailsDialog).toBeVisible();
    await expect(
      detailsDialog.getByRole("heading", {
        name: names.groceries,
        exact: true,
      }),
    ).toBeVisible();
    await detailsDialog
      .getByRole("button", { name: "Clear category selection", exact: true })
      .click();
    await expect(detailsDialog).not.toBeVisible();
    await expect(mobileCategory).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "/tmp/caishen-dashboard-mobile.png",
      fullPage: true,
    });
    const finalMembership = await db.workspaceMember.findMany({
      where: { clerkUserId: { in: [first.id, second.id] } },
    });
    expect(new Set(finalMembership.map((item) => item.workspaceId)).size).toBe(
      1,
    );
    await clerk.signOut({ page });
    await expect(
      page.getByRole("heading", {
        name: "Make yourself at home.",
        exact: true,
      }),
    ).toBeVisible();
    await clerk.signIn({ page, emailAddress: second.email });
    await expect(
      page.getByRole("heading", { name: "Your budget", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(names.cash, { exact: true })).toHaveCount(0);
    await expect(
      page.getByText(names.privatePartner, { exact: true }),
    ).toBeVisible();
  } finally {
    await partnerContext.close();
    await db.$disconnect();
  }
});

test("shared rent and utilities net to one repayment, preserve original splits, and reconcile only matching evidence", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const users = usersSchema.parse(
    JSON.parse(
      await readFile(
        process.env.E2E_USERS_FILE ?? "/tmp/caishen-e2e-users.json",
        "utf8",
      ),
    ),
  );
  const first = users[0]!;
  const second = users[1]!;
  const partnerContext = await browser.newContext();
  const partner = await partnerContext.newPage();
  const db = new PrismaClient();
  const rent = `Shared rent ${suffix}`;
  const utilities = `Shared utilities ${suffix}`;
  const yourCash = `Settlement checking ${suffix}`;
  const partnerCash = `Rent checking ${suffix}`;
  const month = new Date()
    .toLocaleDateString("en-CA", {
      year: "numeric",
      month: "2-digit",
      timeZone: "America/Los_Angeles",
    })
    .slice(0, 7);
  const monthLabel = new Date(`${month}-15T12:00:00`).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );
  try {
    await signIn(page, first.email);
    await onboard(page, `Shared test budget ${suffix}`);
    await signIn(partner, second.email);
    await onboard(partner, `Shared partner budget ${suffix}`);
    await connectPartners(page, partner);
    const statementFor = async (userId: string) => {
      const saved = await db.workspaceMember.findUniqueOrThrow({
        where: { clerkUserId: userId },
        include: { workspace: true },
      });
      return projectBook(bookSchema.parse(saved.workspace.book), userId, month);
    };
    expect(
      (await statementFor(first.id)).settlement.net,
      "the shared e2e household starts each run settled",
    ).toBe(0);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await addAccount(page, yourCash, "2000.00");
    await addCategory(page, rent);
    await addCategory(page, utilities);
    await assign(page, rent, "1000.00");
    await assign(page, utilities, "200.00");
    const unusedShared = `Unused shared category ${suffix}`;
    await addCategory(page, unusedShared);
    for (const name of [rent, utilities, unusedShared])
      await shareCategory(page, name);
    await page.getByRole("button", { name: unusedShared, exact: true }).click();
    const unusedInspector = inspectorFor(page, unusedShared);
    const editUnused = unusedInspector.getByRole("button", {
      name: `Edit ${unusedShared} split`,
      exact: true,
    });
    await editUnused.click();
    const unusedDialog = page.getByRole("dialog");
    await unusedDialog
      .getByRole("button", { name: "Delete shared category", exact: true })
      .click();
    await expect(unusedDialog).toContainText(
      "Both personal budget categories and their assigned money will be kept.",
    );
    await unusedDialog
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(editUnused).toBeVisible();
    await editUnused.click();
    await unusedDialog
      .getByRole("button", { name: "Delete shared category", exact: true })
      .click();
    await unusedDialog
      .getByRole("button", { name: "Delete shared category", exact: true })
      .click();
    await expect(unusedDialog).not.toBeVisible();
    await expect(
      unusedInspector.getByRole("button", {
        name: "Share category",
        exact: true,
      }),
    ).toBeVisible();
    await partner.reload();
    await expect(
      partner
        .getByRole("row")
        .filter({ hasText: unusedShared })
        .locator(".shared-mark"),
    ).toHaveCount(0);
    await expect(
      partner
        .getByRole("row")
        .filter({ hasText: rent })
        .locator(".shared-mark"),
    ).toHaveText(/50\/50/);
    await partner.getByRole("button", { name: "Plan", exact: true }).click();
    await addAccount(partner, partnerCash, "3000.00");
    await assign(partner, rent, "2000.00");
    await assign(partner, utilities, "100.00");
    await purchase(
      partner,
      `Rent payment ${suffix}`,
      partnerCash,
      rent,
      "2000.00",
      rent,
    );
    await page.reload();
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await purchase(
      page,
      `Utility bill ${suffix}`,
      yourCash,
      utilities,
      "200.00",
      utilities,
    );
    await page.reload();
    const balance = page.locator(".shared-balance");
    const statement = balance.getByRole("list", {
      name: `${monthLabel} shared statement`,
      exact: true,
    });
    const line = (name: string | RegExp) =>
      statement.getByRole("listitem").filter({ hasText: name });
    await expect(balance.locator(".shared-verdict")).toContainText("$900.00");
    await expect(line(rent).locator("small")).toHaveText("1");
    await expect(line(rent)).toContainText("$1,000.00 you owe");
    await expect(line(utilities)).toContainText("$100.00 owed to you");
    const shown = (await statementFor(first.id)).sharedStatement;
    expect(shown.balance).toBe(90000);
    expect(
      shown.categories.find((category) => category.name === rent)?.effect,
    ).toBe(100000);
    expect(
      shown.categories.find((category) => category.name === utilities)?.effect,
    ).toBe(-10000);
    await page.getByRole("button", { name: rent, exact: true }).click();
    const rentInspector = inspectorFor(page, rent);
    await rentInspector
      .getByRole("button", { name: `Edit ${rent} split`, exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Your share (%)", { exact: true }).fill("75");
    await dialog
      .getByRole("button", { name: "Save shared category", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(rentInspector.locator(".shared-rule")).toContainText(
      "you 75%",
    );
    const editRent = rentInspector.getByRole("button", {
      name: `Edit ${rent} split`,
      exact: true,
    });
    await editRent.click();
    await dialog
      .getByRole("button", { name: "Delete shared category", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Delete shared category", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "recorded activity cannot be deleted",
    );
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editRent).toBeVisible();
    await partner.reload();
    await partner.getByRole("button", { name: rent, exact: true }).click();
    await expect(
      inspectorFor(partner, rent).locator(".shared-rule"),
    ).toContainText("you 25%");
    await expect(rentInspector.locator(".shared-balance")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Clear category selection", exact: true })
      .click();
    const summary = page.locator(".shared-balance");
    await expect(summary.locator(".shared-verdict")).toContainText("$900.00");
    await line(rent).getByRole("button").click();
    const breakdown = page.getByRole("dialog", {
      name: `${rent} in ${monthLabel.split(" ")[0]}`,
      exact: true,
    });
    const rentItem = breakdown
      .getByRole("listitem")
      .filter({ hasText: `Rent payment ${suffix}` });
    await expect(rentItem).toContainText("$2,000.00");
    await expect(rentItem).toContainText(
      "Your partner paid · your share $1,000.00",
    );
    await expect(rentItem).toContainText("you owe $1,000.00");
    await expect(
      rentItem.getByTitle("Split differs from the current rule"),
    ).toHaveText("50/50");
    await page.screenshot({
      path: "/tmp/caishen-shared-breakdown.png",
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(breakdown).not.toBeVisible();
    const member = await db.workspaceMember.findUniqueOrThrow({
      where: { clerkUserId: first.id },
      include: { workspace: true },
    });
    const beforeBook = bookSchema.parse(member.workspace.book);
    const before = projectBook(beforeBook, first.id, month);
    const partnerBefore = projectBook(beforeBook, second.id, month);
    await summary
      .getByRole("button", { name: "Settle up", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Payment from cash account", { exact: true })
      .selectOption({ label: yourCash });
    await expect(
      dialog.getByLabel("Actual net payment ($)", { exact: true }),
    ).toHaveValue("900.00");
    await dialog
      .getByRole("button", { name: "Record repayment", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const saved = await db.workspace.findUniqueOrThrow({
      where: { id: member.workspaceId },
    });
    const settledBook = bookSchema.parse(saved.book);
    const after = projectBook(settledBook, first.id, month);
    const partnerAfter = projectBook(settledBook, second.id, month);
    expect(after.settlement.net).toBe(0);
    expect(after.sharedStatement.balance).toBe(0);
    await expect(summary.locator(".shared-verdict")).toContainText(
      "You’re even",
    );
    const repaymentLine = line("You sent partner").filter({
      hasText: "Pending",
    });
    await expect(repaymentLine).toHaveCount(1);
    await expect(repaymentLine).toContainText("$900.00");
    await expect(line(rent)).toContainText("$1,000.00 you owe");
    expect(after.cash).toBe(before.cash - 90000);
    expect(after.readyToAssign).toBe(before.readyToAssign + 10000);
    expect(partnerAfter.cash).toBe(partnerBefore.cash);
    expect(
      settledBook.budgets[first.id]!.transactions.filter(
        (transaction) =>
          transaction.kind === "settlement" && transaction.amount > 0,
      ),
    ).toHaveLength(0);
    await partner.reload();
    await partner
      .locator(".shared-balance")
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    const receive = partner.getByRole("dialog");
    await receive
      .getByLabel("Receiving cash account", { exact: true })
      .selectOption({ label: partnerCash });
    await receive
      .getByRole("button", { name: "Record receipt", exact: true })
      .click();
    await expect(receive).not.toBeVisible();
    const received = await db.workspace.findUniqueOrThrow({
      where: { id: member.workspaceId },
    });
    expect(
      projectBook(bookSchema.parse(received.book), second.id, month).cash,
    ).toBe(partnerBefore.cash + 90000);

    await page.reload();
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    const reconcileAccount = `Statement checking ${suffix}`;
    await addAccount(page, reconcileAccount, "100.00");
    const statementCategory = `Statement expenses ${suffix}`;
    const statementPayee = `Statement purchase ${suffix}`;
    await addCategory(page, statementCategory);
    await assign(page, statementCategory, "10.00");
    await purchase(
      page,
      statementPayee,
      reconcileAccount,
      statementCategory,
      "10.00",
    );
    await page
      .getByRole("button", { name: "All accounts", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Account actions", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Reconcile a statement", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Account", { exact: true })
      .selectOption({ label: reconcileAccount });
    await dialog
      .getByLabel("Statement opening balance ($)", { exact: true })
      .fill("100.00");
    await dialog
      .getByLabel("Statement closing balance ($)", { exact: true })
      .fill("90.00");
    await dialog
      .getByLabel("Or paste statement CSV", { exact: true })
      .fill(
        `date,description,amount\n${new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })},${statementPayee},-10.00`,
      );
    await dialog.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "Compare statement", exact: true })
      .click();
    await expect(
      dialog.getByText("Statement matches your cleared ledger", {
        exact: true,
      }),
    ).toBeVisible();
    await dialog
      .getByLabel("Statement closing balance ($)", { exact: true })
      .fill("89.00");
    await dialog
      .getByRole("button", { name: "Compare statement", exact: true })
      .click();
    await expect(
      dialog.getByText("More evidence is needed", { exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      "Statement opening balance plus activity does not equal its closing balance.",
    );
    await dialog
      .getByLabel("Or paste statement CSV", { exact: true })
      .fill(
        `date,description,amount\n${new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })},${statementPayee},-11.00`,
      );
    await dialog
      .getByRole("button", { name: "Compare statement", exact: true })
      .click();
    await expect(
      dialog.getByText("There is a difference to investigate", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("button", { name: rent, exact: true }).click();
    await page.screenshot({
      path: "/tmp/caishen-shared-settlement.png",
      fullPage: true,
    });
  } finally {
    await partnerContext.close();
    await db.$disconnect();
  }
});
