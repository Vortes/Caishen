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
  await page.getByTitle(`Assign money to ${name}`, { exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount to add ($)", { exact: true }).fill(amount);
  await dialog
    .getByRole("button", { name: "Assign money", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}
async function purchase(
  page: Page,
  payee: string,
  account: string,
  category: string,
  amount: string,
  sharedCategory?: string,
) {
  await page
    .getByRole("button", { name: "Add transaction", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Payee", { exact: true }).fill(payee);
  await dialog.getByLabel("Amount ($)", { exact: true }).fill(amount);
  await dialog
    .getByLabel("Account", { exact: true })
    .selectOption({ label: account });
  await dialog
    .getByLabel("Category", { exact: true })
    .selectOption({ label: category });
  if (sharedCategory)
    await dialog
      .getByLabel("Shared category (optional)", { exact: true })
      .selectOption({ label: sharedCategory });
  await dialog
    .getByRole("button", { name: "Record transaction", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
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
    await assign(page, names.groceries, "300.00");
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

    await page.getByRole("button", { name: /^Transactions/ }).click();
    let purchaseRow = page.getByRole("row").filter({ hasText: names.payee });
    await purchaseRow
      .getByRole("button", { name: names.groceries, exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Category", { exact: true })
      .selectOption({ label: names.dining });
    await dialog
      .getByRole("button", { name: "Save correction", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
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
    dialog = page.getByRole("dialog");
    await dialog.getByText(/Transaction history ·/).click();
    await expect(dialog).toContainText("Revision 2");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Budget", exact: true }).click();
    await addAccount(page, names.card, "200.00", "credit");
    await assign(page, `${names.card} payment`, "200.00");
    await purchase(
      page,
      `Card purchase ${suffix}`,
      names.card,
      names.groceries,
      "50.00",
    );
    await page.getByRole("button", { name: /Record a card payment/ }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Paid from cash account", { exact: true })
      .selectOption({ label: names.cash });
    await dialog
      .getByLabel("Paid to credit card", { exact: true })
      .selectOption({ label: names.card });
    await dialog
      .getByLabel("Payment amount ($)", { exact: true })
      .fill("250.00");
    await dialog
      .getByRole("button", { name: "Record payment", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();

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
    await page.getByRole("button", { name: "Budget", exact: true }).click();
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

    await page.getByRole("button", { name: "Shared", exact: true }).click();
    if (
      await page
        .getByRole("button", { name: "Create invitation code", exact: true })
        .isVisible()
    ) {
      await page
        .getByRole("button", { name: "Create invitation code", exact: true })
        .click();
      await expect(page.locator(".inline-code")).toBeVisible();
      const code = await page.locator(".inline-code").innerText();
      await partner
        .getByRole("button", { name: "Shared", exact: true })
        .click();
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
    }
    await page.reload();
    await page.getByRole("button", { name: "Budget", exact: true }).click();
    await expect(
      page.getByText(names.privatePartner, { exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: "/tmp/caishen-dashboard-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your budget", exact: true }),
    ).toBeVisible();
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
  try {
    await signIn(page, first.email);
    await onboard(page, `Shared test budget ${suffix}`);
    await signIn(partner, second.email);
    await onboard(partner, `Shared partner budget ${suffix}`);
    await page.getByRole("button", { name: "Shared", exact: true }).click();
    if (
      await page
        .getByRole("button", { name: "Create invitation code", exact: true })
        .isVisible()
    ) {
      await page
        .getByRole("button", { name: "Create invitation code", exact: true })
        .click();
      await expect(page.locator(".inline-code")).toBeVisible();
      const code = await page.locator(".inline-code").innerText();
      await partner
        .getByRole("button", { name: "Shared", exact: true })
        .click();
      await partner
        .getByRole("button", { name: "Enter partner’s code", exact: true })
        .click();
      await partner
        .getByRole("dialog")
        .getByLabel("Partner’s invitation code", { exact: true })
        .fill(code);
      await partner
        .getByRole("dialog")
        .getByRole("button", { name: "Connect budgets", exact: true })
        .click();
      await expect(partner.getByRole("dialog")).not.toBeVisible();
      await page.reload();
    }
    await page.getByRole("button", { name: "Budget", exact: true }).click();
    await addAccount(page, yourCash, "2000.00");
    await addCategory(page, rent);
    await addCategory(page, utilities);
    await assign(page, rent, "1000.00");
    await assign(page, utilities, "200.00");
    await page.getByRole("button", { name: "Shared", exact: true }).click();
    for (const name of [rent, utilities]) {
      await page
        .getByRole("button", { name: "Shared category", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Shared category name", { exact: true })
        .fill(name);
      await dialog
        .getByLabel("Your budget category", { exact: true })
        .selectOption({ label: name });
      await dialog
        .getByRole("button", { name: "Save shared category", exact: true })
        .click();
      await expect(dialog).not.toBeVisible();
    }
    await partner.reload();
    await partner.getByRole("button", { name: "Budget", exact: true }).click();
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
    await page.getByRole("button", { name: "Budget", exact: true }).click();
    await purchase(
      page,
      `Utility bill ${suffix}`,
      yourCash,
      utilities,
      "200.00",
      utilities,
    );
    await page.getByRole("button", { name: "Shared", exact: true }).click();
    await expect(page.locator(".report-summary")).toContainText("$1,000.00");
    await expect(page.locator(".report-summary")).toContainText("$100.00");
    await expect(page.locator(".report-summary")).toContainText("$900.00");
    await page
      .locator(".account-row")
      .filter({ hasText: rent })
      .getByRole("button", { name: "Edit split", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Your share (%)", { exact: true }).fill("75");
    await dialog
      .getByRole("button", { name: "Save shared category", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".report-summary")).toContainText("$900.00");
    await page
      .getByText("Inspect full payments and original splits", { exact: true })
      .click();
    const rentRow = page
      .locator(".shared-inspection")
      .getByRole("row")
      .filter({ hasText: `Rent payment ${suffix}` });
    await expect(rentRow).toContainText("$2,000.00");
    expect(await rentRow.getByText("$1,000.00", { exact: true }).count()).toBe(
      2,
    );
    const member = await db.workspaceMember.findUniqueOrThrow({
      where: { clerkUserId: first.id },
      include: { workspace: true },
    });
    const beforeBook = bookSchema.parse(member.workspace.book);
    const before = projectBook(beforeBook, first.id, month);
    const partnerBefore = projectBook(beforeBook, second.id, month);
    await page
      .getByRole("button", { name: "Record net repayment", exact: true })
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
    await partner.getByRole("button", { name: "Shared", exact: true }).click();
    await partner
      .getByRole("button", { name: "Record receipt", exact: true })
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
    await page.getByRole("button", { name: "Budget", exact: true }).click();
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
    await page.getByRole("button", { name: /^Transactions/ }).click();
    await page
      .getByRole("button", { name: "Reconcile a statement", exact: true })
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
    await page.getByRole("button", { name: "Shared", exact: true }).click();
    await page.screenshot({
      path: "/tmp/caishen-shared-settlement.png",
      fullPage: true,
    });
  } finally {
    await partnerContext.close();
    await db.$disconnect();
  }
});
