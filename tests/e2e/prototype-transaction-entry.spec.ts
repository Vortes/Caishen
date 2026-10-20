import { expect, test, type Locator, type Page } from "@playwright/test";

import { notifications, openPrototype, toastUndo } from "./prototype-fixture";

const content = (page: Page) => page.locator("#prototype-content");
const sidebar = (page: Page) =>
  page.getByRole("navigation", { name: "Budget navigation" });
const details = (page: Page) =>
  page.getByRole("complementary", { name: "Details", exact: true });
const editor = (page: Page) =>
  page.getByRole("form", { name: /^(New|Edit) transaction$/ });
const addButton = (page: Page) =>
  page.getByRole("button", { name: "Add transaction", exact: true });
const field = (form: Locator, name: string) =>
  form.getByLabel(name, { exact: true });
const calendar = (page: Page) =>
  page.getByRole("dialog", { name: "Date calendar", exact: true });
const today = (page: Page) => calendar(page).locator('[aria-current="date"]');

// The date field shows MM/DD/YYYY; commands carry YYYY-MM-DD.
function iso(display: string) {
  const [month, day, year] = display.split("/");
  return `${year}-${month}-${day}`;
}
function display(date: string) {
  const [year, month, day] = date.split("-");
  return `${month}/${day}/${year}`;
}
function addMonths(month: string, by: number) {
  const [year, index] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year!, index! - 1 + by, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}
// A calendar day, by its full name.
const dayButton = (page: Page, date: string) =>
  calendar(page).getByRole("button", {
    name: new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }),
    exact: true,
  });
function monthTitle(month: string) {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function openRegister(page: Page, account: string) {
  await page
    .getByRole("navigation", { name: "Budget navigation" })
    .getByRole("button", { name: new RegExp(`^${account}`) })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: account, exact: true }),
  ).toBeVisible();
}

// Types into a choice field and takes the highlighted match.
async function choose(form: Locator, name: string, search: string) {
  const input = form.getByRole("combobox", { name, exact: true });
  await input.fill(search);
  await input.press("Enter");
}

test("the register row saves a purchase, an income, and a refund through budget.execute", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await openRegister(page, "Checking");
  await addButton(page).click();
  const form = editor(page);
  await expect(content(page).getByRole("form")).toBeVisible();

  // The row opens on its date: the calendar is already showing, on today.
  await expect(calendar(page)).toBeVisible();
  await expect(today(page)).toBeFocused();
  await expect(field(form, "Payee")).not.toBeFocused();
  await page.keyboard.press("Enter");
  await expect(calendar(page)).toHaveCount(0);
  await expect(field(form, "Payee")).toBeFocused();
  const date = iso(await field(form, "Date").inputValue());

  // A single account's register saves to its account, with no account
  // field, and the row has nothing past its columns.
  await expect(
    form.getByRole("combobox", { name: "Account", exact: true }),
  ).toHaveCount(0);
  await expect(form.getByRole("button", { name: /details/i })).toHaveCount(0);
  await expect(form.getByRole("radiogroup")).toHaveCount(0);

  // A purchase, then Save and add another keeps the date and empties the
  // rest.
  await field(form, "Payee").fill("Corner market");
  await choose(form, "Category", "gif");
  await expect(
    form.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("Gifts");
  await field(form, "Outflow").fill("12.50");
  await form.getByRole("button", { name: "Save and add another" }).click();
  await expect(notifications(page)).toContainText("Added Corner market");
  await expect(field(form, "Payee")).toHaveValue("");
  await expect(field(form, "Payee")).toBeFocused();
  await expect(field(form, "Outflow")).toHaveValue("");
  await expect(
    form.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("");
  await expect(field(form, "Date")).toHaveValue(display(date));
  await expect(calendar(page)).toHaveCount(0);

  // Income to Ready to Assign, saved with Enter.
  await field(form, "Payee").fill("Payroll");
  await choose(form, "Category", "ready");
  await field(form, "Inflow").fill("100");
  await field(form, "Inflow").press("Enter");
  await expect(form).toHaveCount(0);
  await expect(addButton(page)).toBeFocused();
  await expect(notifications(page)).toContainText("Added Payroll");

  // A refund back to the category it came from. Tab leaves the calendar
  // for the payee.
  await page.keyboard.press("n");
  await expect(today(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(calendar(page)).toHaveCount(0);
  await expect(field(editor(page), "Payee")).toBeFocused();
  await field(form, "Payee").fill("Bistro refund");
  await choose(form, "Category", "dining");
  await field(form, "Inflow").fill("20.00");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);

  expect(plan.executions).toEqual([
    {
      expectedRevision: 0,
      command: {
        type: "transaction.upsert",
        id: expect.any(String),
        transactionId: expect.any(String),
        accountId: "checking",
        date,
        payee: "Corner market",
        amount: -1_250,
        categoryId: "gifts",
        status: "posted",
        expenseMonth: plan.month,
      },
    },
    {
      expectedRevision: 1,
      command: expect.objectContaining({
        payee: "Payroll",
        amount: 10_000,
        categoryId: undefined,
        status: "posted",
        date,
      }),
    },
    {
      expectedRevision: 2,
      command: expect.objectContaining({
        payee: "Bistro refund",
        amount: 2_000,
        categoryId: "dining",
      }),
    },
  ]);
  const ids = plan.executions.map(
    (call) =>
      (call.command as { transactionId: string; id: string }).transactionId,
  );
  expect(new Set(ids).size).toBe(3);
  expect(plan.saved().transactions.map((item) => item.kind)).toEqual([
    "purchase",
    "purchase",
    "purchase",
    "income",
    "refund",
  ]);
  expect(plan.writes).toEqual([
    "budget.execute",
    "budget.execute",
    "budget.execute",
  ]);
  await expect(
    content(page).getByRole("button", { name: /Corner market/ }),
  ).toBeVisible();

  // What you enter yourself is already reviewed: nothing waits in the
  // register or the sidebar.
  for (const id of ids)
    expect(plan.saved().transaction(id)!.reviewed).toBe(true);
  await expect(
    sidebar(page).getByRole("img", { name: "Transactions to review" }),
  ).toHaveCount(0);
});

test("All accounts picks the account in its column and keeps it for the next entry", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await openRegister(page, "All accounts");
  await addButton(page).click();
  const form = editor(page);
  await page.keyboard.press("Escape");
  await expect(calendar(page)).toHaveCount(0);
  await field(form, "Payee").fill("Hardware store");
  await field(form, "Outflow").fill("40");

  // All accounts starts on the first account; a card can't take Ready to
  // Assign.
  const account = form.getByRole("combobox", { name: "Account", exact: true });
  await expect(account).toHaveValue("Checking");
  await choose(form, "Account", "vis");
  await expect(account).toHaveValue("Visa");
  await form.getByRole("combobox", { name: "Category", exact: true }).click();
  await expect(
    page.getByRole("option", { name: /^Ready to Assign/ }),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("option", { name: /^Household/ })).toContainText(
    "-$12.99",
  );
  await page.getByRole("option", { name: /^Household/ }).click();
  await form.getByRole("button", { name: "Save and add another" }).click();
  await expect(notifications(page)).toContainText("Added Hardware store");
  await expect(field(form, "Payee")).toHaveValue("");
  await expect(account).toHaveValue("Visa");

  await field(form, "Payee").fill("Paint");
  await choose(form, "Category", "house");
  await field(form, "Outflow").fill("8");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(addButton(page)).toBeFocused();
  // The details panel never takes the editor.
  await expect(details(page).getByRole("form")).toHaveCount(0);

  expect(
    plan.executions.map(({ expectedRevision, command }) => ({
      expectedRevision,
      command,
    })),
  ).toEqual([
    {
      expectedRevision: 0,
      command: expect.objectContaining({
        accountId: "card",
        payee: "Hardware store",
        amount: -4_000,
        categoryId: "household",
      }),
    },
    {
      expectedRevision: 1,
      command: expect.objectContaining({
        accountId: "card",
        payee: "Paint",
        amount: -800,
      }),
    },
  ]);
});

test("clicking the payee lists recent payees, and the category keeps its name while open", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await openRegister(page, "Checking");
  await addButton(page).click();
  const form = editor(page);
  await page.keyboard.press("Escape");

  // An empty payee lists earlier payees, most recent first, on a click.
  const payee = field(form, "Payee");
  await payee.click();
  const suggestions = page.getByRole("listbox", { name: "Payee suggestions" });
  await expect(suggestions).toBeVisible();
  const latest = [...plan.saved().transactions]
    .filter((item) => !item.removed)
    .sort((a, b) => b.date.localeCompare(a.date))[0]!.payee;
  await expect(suggestions.getByRole("option").first()).toHaveText(latest);
  // A suggestion's text lines up with what's typed in the field.
  const typed = (await payee.boundingBox())!.x + 11;
  const optionText = await suggestions
    .getByRole("option")
    .first()
    .locator("span")
    .first()
    .boundingBox();
  expect(Math.abs(optionText!.x - typed)).toBeLessThan(1.5);
  await suggestions.getByRole("option").first().click();
  await expect(payee).toHaveValue(latest);
  await expect(suggestions).toHaveCount(0);

  // Typing narrows the list; Escape closes only the list.
  await payee.fill("bis");
  await expect(suggestions.getByRole("option")).toHaveText(["Bistro"]);
  await page.keyboard.press("Escape");
  await expect(suggestions).toHaveCount(0);
  await expect(form).toBeVisible();

  // The category field reads "Category" open or closed.
  const category = form.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  await expect(category).toHaveAttribute("placeholder", "Category");
  await category.click();
  await expect(page.getByRole("listbox", { name: "Category" })).toBeVisible();
  await expect(category).toHaveAttribute("placeholder", "Category");
});

test("each pick opens the next field: date, payee, category, then the amount", async ({
  page,
}) => {
  await openPrototype(page);
  await openRegister(page, "Checking");
  await addButton(page).click();
  const form = editor(page);
  const category = form.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  const categories = page.getByRole("listbox", { name: "Category" });
  const suggestions = page.getByRole("listbox", { name: "Payee suggestions" });

  await today(page).click();
  await expect(field(form, "Payee")).toBeFocused();
  await expect(suggestions).toBeVisible();
  await suggestions.getByRole("option").first().click();
  await expect(category).toBeFocused();
  await expect(categories).toBeVisible();
  // Long names keep room beside their balances.
  expect((await categories.boundingBox())!.width).toBeGreaterThanOrEqual(320);
  await categories.getByRole("option", { name: /^Dining/ }).click();
  await expect(field(form, "Outflow")).toBeFocused();

  // Ready to Assign only takes an inflow, so the inflow is next.
  await category.click();
  await page.keyboard.type("ready");
  await page.keyboard.press("Enter");
  await expect(field(form, "Inflow")).toBeFocused();

  // Tab moves on by itself and still opens what it reaches.
  await field(form, "Payee").fill("New shop");
  await field(form, "Payee").press("Tab");
  await expect(category).toBeFocused();
  await expect(categories).toBeVisible();
});

test("Add transaction's tooltip stays shut when focus comes back from the editor", async ({
  page,
}) => {
  await openPrototype(page);
  await openRegister(page, "Checking");
  await addButton(page).click();
  await editor(page).getByRole("button", { name: "Cancel" }).click();
  await expect(addButton(page)).toBeFocused();
  await page.waitForTimeout(800);
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  await page.keyboard.press("n");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(addButton(page)).toBeFocused();
  await page.waitForTimeout(800);
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  // Reaching it with Tab still names its shortcut.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tooltip")).toContainText("Add a transaction");
});

test("work waiting for review shows as a gray dot in the sidebar, never a count", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  const allAccounts = sidebar(page).getByRole("button", {
    name: /^All accounts/,
  });
  await expect(
    allAccounts.getByRole("img", { name: "Transactions to review" }),
  ).toHaveCount(0);
  plan.changeElsewhere({
    type: "transaction.upsert",
    id: "unreviewed-elsewhere",
    transactionId: "unreviewed-elsewhere",
    accountId: "checking",
    date: `${plan.month}-02`,
    payee: "Imported coffee",
    amount: -450,
    categoryId: "dining",
    status: "posted",
    reviewed: false,
  });
  await page.reload();
  const dot = allAccounts.getByRole("img", { name: "Transactions to review" });
  await expect(dot).toBeVisible();
  await expect(allAccounts).toHaveText("All accounts");
  const [dotColor, textColor] = await dot.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--text-secondary)";
    element.parentElement!.append(probe);
    const colors = [
      getComputedStyle(element).backgroundColor,
      getComputedStyle(probe).color,
    ];
    probe.remove();
    return colors;
  });
  expect(dotColor).toBe(textColor);
});

test("a selected transaction stays read-only until Edit, keeps its account, and undoes through history", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await openRegister(page, "Checking");
  const revision = plan.saved().transaction("dinner")!.revision;
  await content(page)
    .getByRole("button", { name: /Bistro/ })
    .click();
  await expect(
    details(page).getByRole("heading", { name: "Bistro" }),
  ).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
  await expect(details(page).getByRole("textbox")).toHaveCount(0);

  await details(page)
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  const form = content(page).getByRole("form", { name: "Edit transaction" });
  await expect(
    form.getByRole("combobox", { name: "Category", exact: true }),
  ).toBeFocused();
  await expect(
    content(page).getByRole("button", { name: /Bistro/ }),
  ).toHaveCount(0);
  await expect(calendar(page)).toHaveCount(0);
  await expect(
    form.getByRole("combobox", { name: "Account", exact: true }),
  ).toHaveCount(0);
  await expect(
    form.getByRole("button", { name: "Save and add another" }),
  ).toHaveCount(0);
  await expect(field(form, "Outflow")).toHaveValue("280.15");
  await field(form, "Outflow").fill("30");
  await field(form, "Payee").fill("Bistro lunch");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(
    details(page).getByRole("button", { name: "Edit", exact: true }),
  ).toBeFocused();
  expect(plan.executions).toEqual([
    {
      expectedRevision: 0,
      command: expect.objectContaining({
        type: "transaction.upsert",
        transactionId: "dinner",
        accountId: "checking",
        payee: "Bistro lunch",
        amount: -3_000,
        categoryId: "dining",
        revision: revision + 1,
      }),
    },
  ]);

  // The toast takes it back through the shared history.
  await expect(notifications(page)).toContainText("Saved Bistro lunch");
  await expect(toastUndo(page)).toBeEnabled();
  await toastUndo(page).click();
  await expect(notifications(page)).toContainText("Action undone.");
  await expect(
    content(page).getByRole("button", { name: /Bistro/ }),
  ).toBeVisible();
  expect(plan.saved().transaction("dinner")).toMatchObject({
    payee: "Bistro",
    amount: -28_015,
  });
  expect(plan.historyCalls).toEqual([
    expect.objectContaining({ direction: "undo", expectedRevision: 1 }),
  ]);

  // E edits the selected row in place.
  await content(page)
    .getByRole("button", { name: /Bistro/ })
    .click();
  await page.keyboard.press("e");
  const inline = content(page).getByRole("form", { name: "Edit transaction" });
  await expect(field(inline, "Payee")).toHaveValue("Bistro");
  await inline.getByRole("button", { name: "Cancel" }).click();
  await expect(inline).toHaveCount(0);
  await expect(
    details(page).getByRole("button", { name: "Edit", exact: true }),
  ).toBeFocused();
  expect(plan.executions).toHaveLength(1);

  // In All accounts a saved transaction's account can't move.
  await openRegister(page, "All accounts");
  await content(page)
    .getByRole("button", { name: /Bistro/ })
    .click();
  await page.keyboard.press("e");
  const account = editor(page).getByRole("combobox", {
    name: "Account",
    exact: true,
  });
  await expect(account).toBeDisabled();
  await expect(account).toHaveValue("Checking");
});

test("special transactions explain where they're changed instead of offering Edit", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  plan.changeElsewhere({
    type: "card.payment",
    id: "pay-card",
    cashAccountId: "checking",
    cardAccountId: "card",
    date: `${plan.month}-01`,
    amount: 5_000,
  });
  await page.reload();
  await openRegister(page, "Visa");
  await content(page)
    .getByRole("button", { name: /payment/i })
    .first()
    .click();
  await expect(details(page)).toContainText(
    "Card payments are changed from the card payment action.",
  );
  await expect(
    details(page).getByRole("button", { name: "Edit", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("e");
  await expect(editor(page)).toHaveCount(0);
});

test("validation waits for Save, errors sit by their fields, and Escape closes only what's on top", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await openRegister(page, "Checking");
  await addButton(page).click();
  const form = editor(page);

  await form.getByRole("button", { name: "Save", exact: true }).click();
  const payee = field(form, "Payee");
  await expect(payee).toHaveAttribute("aria-invalid", "true");
  await expect(payee).toBeFocused();
  const describedBy = await payee.getAttribute("aria-describedby");
  await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(
    "Enter a payee.",
  );
  // One message covers both amounts, and both fields point to it.
  const amountError = form.getByText("Enter an outflow or an inflow.", {
    exact: true,
  });
  await expect(amountError).toHaveCount(1);
  const amountErrorId = await amountError.getAttribute("id");
  for (const name of ["Outflow", "Inflow"])
    await expect(field(form, name)).toHaveAttribute(
      "aria-describedby",
      amountErrorId!,
    );
  await expect(form).toContainText("Choose a category.");
  expect(plan.writes).toEqual([]);

  // Correcting a field clears its error; the others wait for the next save,
  // which focuses the first problem on screen.
  await payee.fill("Draft");
  await expect(payee).not.toHaveAttribute("aria-invalid");
  await expect(form).not.toContainText("Enter a payee.");
  await expect(amountError).toHaveCount(1);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    form.getByRole("combobox", { name: "Category", exact: true }),
  ).toBeFocused();

  // Outflow and inflow are one amount.
  await field(form, "Outflow").fill("5");
  await field(form, "Inflow").fill("6");
  await expect(field(form, "Outflow")).toHaveValue("");
  await field(form, "Inflow").fill("1.234");
  await choose(form, "Category", "rent");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(field(form, "Inflow")).toBeFocused();
  await expect(form).toContainText(
    "Enter a positive amount with no more than two decimal places.",
  );
  expect(plan.writes).toEqual([]);

  // Escape in the open category list closes the list; the next closes the
  // editor and returns to Add transaction.
  const category = form.getByRole("combobox", {
    name: "Category",
    exact: true,
  });
  await category.click();
  await expect(page.getByRole("listbox", { name: "Category" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Category" })).toHaveCount(0);
  await expect(form).toBeVisible();
  await expect(category).toBeFocused();
  await expect(payee).toHaveValue("Draft");

  // Undo waits while the editor is open, wherever focus is.
  await form.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Meta+z");
  await page.keyboard.press("Escape");
  await expect(form).toHaveCount(0);
  await expect(addButton(page)).toBeFocused();
  expect(plan.historyCalls).toEqual([]);
  expect(plan.writes).toEqual([]);
});

test("a dirty draft holds navigation; an untouched one closes with it", async ({
  page,
}) => {
  await openPrototype(page);
  await openRegister(page, "Checking");
  await addButton(page).click();
  await field(editor(page), "Payee").fill("Keep me");
  const sidebar = page.getByRole("navigation", { name: "Budget navigation" });
  await sidebar.getByRole("button", { name: /^Plan/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Checking" }),
  ).toBeVisible();
  await expect(editor(page)).toContainText(
    "Save or cancel this transaction first.",
  );
  await expect(field(editor(page), "Payee")).toHaveValue("Keep me");

  // Changing months keeps the editor and its draft.
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(field(editor(page), "Payee")).toHaveValue("Keep me");
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click();

  await editor(page).getByRole("button", { name: "Cancel" }).click();
  await addButton(page).click();
  await sidebar.getByRole("button", { name: /^Plan/ }).click();
  await expect(
    page.getByRole("heading", { name: "Plan", exact: true }),
  ).toBeVisible();
  await openRegister(page, "Checking");
  await expect(editor(page)).toHaveCount(0);
});

test("a failed save keeps the draft, retries with the same command, and blocks a second submit", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await openRegister(page, "Checking");
  await addButton(page).click();
  const form = editor(page);
  await field(form, "Payee").fill("Bookshop");
  await choose(form, "Category", "gifts");
  await field(form, "Outflow").fill("15");

  // Keyboard focus draws one 2px ring, on the well and not the input.
  await field(form, "Outflow").press("Tab");
  const inflow = field(form, "Inflow");
  await expect(inflow).toBeFocused();
  await expect(inflow).toHaveCSS("outline-style", "none");
  await expect(inflow.locator("..")).toHaveCSS("outline-style", "solid");
  await expect(inflow.locator("..")).toHaveCSS("outline-width", "2px");

  plan.rejectNextExecute("The update could not be saved. Try again.");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(notifications(page).getByRole("alert")).toContainText(
    "The update could not be saved. Try again.",
  );
  await expect(form).toContainText("Not saved. Your changes are still here");
  await expect(field(form, "Payee")).toHaveValue("Bookshop");
  await expect(
    content(page).getByRole("button", { name: /Bookshop/ }),
  ).toHaveCount(0);

  // The retry sends once with the same ids. While it saves both save
  // actions are disabled, and Enter or a direct form submit sends nothing.
  const release = plan.holdExecute();
  try {
    const save = form.getByRole("button", { name: /^(Save|Saving…)$/ });
    await save.click();
    await expect(save).toHaveText("Saving…");
    await expect(save).toBeDisabled();
    await expect(
      form.getByRole("button", { name: "Save and add another" }),
    ).toBeDisabled();
    await field(form, "Outflow").press("Enter");
    await form.evaluate((element: HTMLFormElement) => element.requestSubmit());
    await expect(save).toHaveText("Saving…");
    expect(plan.executions).toHaveLength(2);
  } finally {
    release();
  }
  await expect(form).toHaveCount(0);
  expect(plan.executions).toHaveLength(2);
  expect(plan.executions[1]!.command).toEqual(plan.executions[0]!.command);
  expect(plan.commands).toEqual([plan.executions[0]!.command]);
});

test("a save against a stale budget can be retried, and a transaction changed or deleted elsewhere keeps the draft", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await openRegister(page, "Checking");
  const bistro = () => content(page).getByRole("button", { name: /Bistro/ });

  // Another change moves the budget on: the save is refused, the budget
  // refreshes, and the same draft saves on the next try.
  await bistro().click();
  await page.keyboard.press("e");
  let form = editor(page);
  await field(form, "Payee").fill("Bistro dinner");
  plan.editElsewhere();
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(notifications(page).getByRole("alert")).toContainText(
    "Your budget changed. Refresh and try again.",
  );
  await expect(field(form, "Payee")).toHaveValue("Bistro dinner");
  await expect(
    form.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(plan.executions.map((call) => call.expectedRevision)).toEqual([0, 1]);
  expect(plan.executions[1]!.command.id).toBe(plan.executions[0]!.command.id);
  expect(plan.saved().transaction("dinner")!.payee).toBe("Bistro dinner");

  // The same transaction edited in another tab: the editor says so and keeps
  // the draft instead of overwriting it.
  await bistro().click();
  await page.keyboard.press("e");
  form = editor(page);
  await field(form, "Payee").fill("Mine");
  const latest = plan.saved().transaction("dinner")!;
  plan.changeElsewhere({
    type: "transaction.upsert",
    id: "edit-elsewhere",
    transactionId: "dinner",
    accountId: "checking",
    date: latest.date,
    payee: "Theirs",
    amount: latest.amount,
    categoryId: "dining",
    revision: latest.revision + 1,
  });
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(notifications(page).getByRole("alert")).toContainText(
    "Your budget changed.",
  );
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toContainText(
    "This transaction changed in another session.",
  );
  await expect(field(form, "Payee")).toHaveValue("Mine");
  expect(plan.saved().transaction("dinner")!.payee).toBe("Theirs");
  await form.getByRole("button", { name: "Cancel" }).click();

  // Deleted elsewhere while open: no save, and Cancel still closes it.
  await content(page)
    .getByRole("button", { name: /Theirs/ })
    .click();
  await page.keyboard.press("e");
  form = editor(page);
  await field(form, "Payee").fill("Gone");
  plan.changeElsewhere({
    type: "transaction.remove",
    id: "remove-elsewhere",
    transactionId: "dinner",
  });
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText(
    "This transaction was deleted in another session",
  );
  await expect(
    form.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await expect(field(form, "Payee")).toHaveValue("Gone");
  const sent = plan.executions.length;
  await field(form, "Payee").press("Enter");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(editor(page)).toHaveCount(0);
  expect(plan.executions).toHaveLength(sent);
});

test("on a phone the row fits, takes 16px text, and skips touch autofocus", async ({
  browser,
}) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    const plan = await openPrototype(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Show sidebar" }).first().click();
    await openRegister(page, "Checking");
    const coarse = await page.evaluate(
      () => window.matchMedia("(pointer: coarse)").matches,
    );
    await addButton(page).click();
    const form = content(page).getByRole("form", { name: "New transaction" });
    await expect(form).toBeVisible();
    expect(coarse).toBe(true);
    // The calendar shows and takes focus, which opens no keyboard; a tapped
    // day leaves focus on the calendar button, not a text field.
    await expect(calendar(page)).toBeVisible();
    await expect(today(page)).toBeFocused();
    await fits(calendar(page));
    await expect(field(form, "Payee")).not.toBeFocused();
    const date = iso(await field(form, "Date").inputValue());
    await dayButton(page, `${plan.month}-01`).tap();
    await expect(calendar(page)).toHaveCount(0);
    await expect(field(form, "Date")).toHaveValue(display(`${plan.month}-01`));
    await expect(
      form.getByRole("button", { name: "Choose date" }),
    ).toBeFocused();
    await expect(field(form, "Date")).not.toBeFocused();
    await expect(field(form, "Payee")).not.toBeFocused();
    await expect(field(form, "Date")).toHaveCSS("font-size", "16px");
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(field(form, "Payee")).toHaveCSS("font-size", "16px");
    await expect(field(form, "Outflow")).toHaveCSS("font-size", "16px");
    await fits(form);

    await field(form, "Payee").fill("Phone market");
    await choose(form, "Category", "gifts");
    await field(form, "Outflow").fill("3");
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect(form).toHaveCount(0);
    expect(plan.commands).toEqual([
      expect.objectContaining({ payee: "Phone market", amount: -300 }),
    ]);
  } finally {
    await context.close();
  }
});

test("the editor and its lists follow the light theme", async ({ page }) => {
  await openPrototype(page);
  await page
    .getByRole("radiogroup", { name: "Theme" })
    .getByRole("radio", { name: "Light" })
    .click();
  await openRegister(page, "Checking");
  await addButton(page).click();
  const form = editor(page);
  const theme = (locator: Locator) =>
    locator.evaluate((element) =>
      element.closest("[data-theme]")?.getAttribute("data-theme"),
    );
  await expect(calendar(page)).toBeVisible();
  expect(await theme(calendar(page))).toBe("light");
  const lightCalendar = await calendar(page).evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await form.getByRole("combobox", { name: "Category", exact: true }).click();
  await expect(calendar(page)).toHaveCount(0);
  const list = page.getByRole("listbox", { name: "Category" });
  await expect(list).toBeVisible();
  expect(await theme(list)).toBe("light");
  expect(await theme(form)).toBe("light");
  await expect(form).toHaveCSS("color-scheme", "light");
  const lightBackground = await list.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page
    .getByRole("radiogroup", { name: "Theme" })
    .getByRole("radio", { name: "Dark" })
    .click();
  await addButton(page).click();
  await expect(calendar(page)).toBeVisible();
  expect(await theme(calendar(page))).toBe("dark");
  expect(
    await calendar(page).evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).not.toBe(lightCalendar);
  await editor(page)
    .getByRole("combobox", { name: "Category", exact: true })
    .click();
  await expect(list).toBeVisible();
  expect(await theme(list)).toBe("dark");
  await expect(editor(page)).toHaveCSS("color-scheme", "dark");
  expect(
    await list.evaluate((element) => getComputedStyle(element).backgroundColor),
  ).not.toBe(lightBackground);
});

test("Add opens the first column at once, and the entry row sits under the register's columns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPrototype(page);
  for (const [account, columns] of [
    ["Checking", ["date", "payee", "category", "outflow", "inflow"]],
    [
      "All accounts",
      ["account", "date", "payee", "category", "outflow", "inflow"],
    ],
  ] as const) {
    await openRegister(page, account);
    await addButton(page).click();
    const form = content(page).getByRole("form", { name: "New transaction" });
    // All accounts leads with the account; picking one opens the calendar.
    if (account === "All accounts") {
      const accountField = form.getByRole("combobox", {
        name: "Account",
        exact: true,
      });
      await expect(accountField).toBeFocused();
      const accounts = page.getByRole("listbox", { name: "Account" });
      await expect(accounts).toBeVisible();
      await expect(calendar(page)).toHaveCount(0);
      await accounts.getByRole("option", { name: /^Checking/ }).click();
    }
    await expect(calendar(page)).toBeVisible();
    await expect(today(page)).toBeFocused();
    await expect(today(page).locator("xpath=..")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // The calendar opens under the date field.
    const dateBox = (await field(form, "Date").boundingBox())!;
    const calendarBox = (await calendar(page).boundingBox())!;
    expect(calendarBox.y).toBeGreaterThan(dateBox.y + dateBox.height - 1);
    expect(Math.abs(calendarBox.x - dateBox.x)).toBeLessThan(24);

    // Header, field, and an actual row share each column's edges.
    const header = content(page).locator(
      '[role="group"][aria-label="Transactions"] > [aria-hidden="true"]',
    );
    const entryRow = form.locator('[data-column="date"]').locator("..");
    const row = content(page).locator("[data-row]").first();
    const box = async (scope: Locator, column: string) =>
      (await scope
        .locator(`:scope > [data-column="${column}"]`)
        .boundingBox())!;
    for (const column of columns) {
      const head = await box(header, column);
      const input = await box(entryRow, column);
      const cell = await box(row, column);
      const right = (rect: typeof head) => rect.x + rect.width;
      if (column === "outflow" || column === "inflow") {
        // Amounts line up on their right edge, like the headers above them.
        expect(Math.abs(right(input) - right(head))).toBeLessThan(1.5);
        if (cell.width > 0)
          expect(Math.abs(right(cell) - right(head))).toBeLessThan(1.5);
        expect(input.width).toBeGreaterThan(80);
      } else {
        expect(head.width).toBeGreaterThan(48);
        for (const other of [input, cell]) {
          expect(Math.abs(other.x - head.x)).toBeLessThan(1.5);
          expect(Math.abs(other.width - head.width)).toBeLessThan(1.5);
        }
      }
      // Each field fills its column.
      const control = (await form
        .locator(`[data-column="${column}"] input`)
        .first()
        .boundingBox())!;
      expect(control.x).toBeGreaterThanOrEqual(input.x - 1);
      expect(control.x + control.width).toBeLessThanOrEqual(right(input) + 1);
      expect(control.width).toBeGreaterThan(24);
    }
    // The entry row is the first row, right under the headers.
    const headBox = (await header.boundingBox())!;
    const formBox = (await form.boundingBox())!;
    expect(Math.abs(formBox.y - (headBox.y + headBox.height))).toBeLessThan(6);
    expect((await row.boundingBox())!.y).toBeGreaterThan(formBox.y);
    // One line: every field shares the date's top.
    for (const column of columns) {
      const top = (await form
        .locator(`[data-column="${column}"]`)
        .boundingBox())!.y;
      expect(Math.abs(top - dateBox.y)).toBeLessThan(8);
    }
    await page.keyboard.press("Escape");
    await expect(calendar(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
  }
});

test("the calendar changes months, picks a day, takes a typed date, and closes before the editor", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await openRegister(page, "Checking");
  await addButton(page).click();
  const form = editor(page);
  const date = field(form, "Date");
  await expect(date).toHaveAttribute("aria-expanded", "true");

  // The account opened this month, so earlier months can't be shown and
  // its days before the opening can't be picked.
  await expect(
    calendar(page).getByRole("button", { name: "Show previous month" }),
  ).toBeDisabled();
  await expect(
    calendar(page).getByRole("heading", { name: monthTitle(plan.month) }),
  ).toBeVisible();

  // Next month, then a day: the date fills in and focus moves to the payee.
  const next = addMonths(plan.month, 1);
  await calendar(page).getByRole("button", { name: "Show next month" }).click();
  await expect(
    calendar(page).getByRole("heading", { name: monthTitle(next) }),
  ).toBeVisible();
  await dayButton(page, `${next}-15`).click();
  await expect(calendar(page)).toHaveCount(0);
  await expect(date).toHaveValue(display(`${next}-15`));
  await expect(field(form, "Payee")).toBeFocused();

  // The keyboard: Arrow Down in the field opens on the chosen day; arrows
  // move by day and Page Up by month; Enter picks without saving.
  await date.focus();
  await date.press("ArrowDown");
  const chosen = calendar(page)
    .getByRole("gridcell", { selected: true })
    .getByRole("button");
  await expect(chosen).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("PageUp");
  await expect(
    calendar(page).getByRole("heading", { name: monthTitle(plan.month) }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(date).toHaveValue(display(`${plan.month}-16`));
  await expect(form).toBeVisible();

  // Typing a full date moves the open calendar to it; Arrow Down enters the
  // calendar, where the arrows never reach a day before the account opened.
  await date.click();
  await expect(calendar(page)).toBeVisible();
  await date.fill(display(`${plan.month}-01`));
  await date.press("ArrowDown");
  await expect(dayButton(page, `${plan.month}-01`)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(dayButton(page, `${plan.month}-01`)).toBeFocused();
  // The previous month's days shown in the first week can't be picked.
  await expect(
    calendar(page)
      .getByRole("row")
      .first()
      .locator("[data-outside] button:enabled"),
  ).toHaveCount(0);

  // Escape closes the calendar first and keeps the editor.
  await page.keyboard.press("Escape");
  await expect(calendar(page)).toHaveCount(0);
  await expect(form).toBeVisible();
  await expect(date).toBeFocused();

  // A typed date, with Enter in the open calendar closing it, not saving.
  await date.click();
  await expect(calendar(page)).toBeVisible();
  await date.fill(`${Number(plan.month.slice(5))}/7/${plan.month.slice(0, 4)}`);
  await date.press("Enter");
  await expect(calendar(page)).toHaveCount(0);
  await expect(date).toHaveValue(display(`${plan.month}-07`));
  expect(plan.writes).toEqual([]);

  // A day before the budget starts, or no date, waits for a fix.
  await date.fill(display(`${addMonths(plan.month, -1)}-30`));
  await field(form, "Payee").fill("Typed date");
  await choose(form, "Category", "gifts");
  await field(form, "Outflow").fill("4");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(date).toHaveAttribute("aria-invalid", "true");
  await expect(date).toBeFocused();
  await expect(form).toContainText("must be on or after the budget start");
  await date.fill("13/45");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toContainText("Enter a valid transaction date.");
  expect(plan.writes).toEqual([]);

  await date.fill(display(`${plan.month}-07`));
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(plan.commands).toEqual([
    expect.objectContaining({
      payee: "Typed date",
      date: `${plan.month}-07`,
      amount: -400,
    }),
  ]);
});

// Within the phone's width, once a drawer has finished sliding in.
async function fits(locator: Locator) {
  await expect(async () => {
    const box = (await locator.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }).toPass();
}
