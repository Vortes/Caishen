import { expect, test, type Locator, type Page } from "@playwright/test";

import { notifications, openPrototype, toastUndo } from "./prototype-fixture";

const content = (page: Page) => page.locator("#prototype-content");
const details = (page: Page) =>
  page.getByRole("complementary", { name: "Details", exact: true });
const editor = (page: Page) =>
  page.getByRole("form", { name: /^(New|Edit) transaction$/ });
const addButton = (page: Page) =>
  page.getByRole("button", { name: "Add transaction", exact: true });
const field = (form: Locator, name: string) =>
  form.getByLabel(name, { exact: true });

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

async function choosePlacement(
  form: Locator,
  name: "Register row" | "Inspector",
) {
  await form
    .getByRole("radiogroup", { name: "Editor placement" })
    .getByRole("radio", { name })
    .click();
}

test("the register row saves a purchase, an income, and a refund through budget.execute", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await openRegister(page, "Checking");
  await addButton(page).click();
  const form = editor(page);
  await expect(content(page).getByRole("form")).toBeVisible();
  await expect(field(form, "Payee")).toBeFocused();
  await expect(
    form.getByRole("combobox", { name: "Account", exact: true }),
  ).toHaveValue("Checking");
  const date = await field(form, "Date").inputValue();

  // A purchase, then Save and add another keeps the date, account, and
  // status and empties the rest.
  await field(form, "Payee").fill("Corner market");
  await choose(form, "Category", "gif");
  await expect(
    form.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("Gifts");
  await field(form, "Outflow").fill("12.50");
  await field(form, "Bank status").selectOption("pending");
  await form.getByRole("button", { name: "Save and add another" }).click();
  await expect(notifications(page)).toContainText("Added Corner market");
  await expect(field(form, "Payee")).toHaveValue("");
  await expect(field(form, "Payee")).toBeFocused();
  await expect(field(form, "Outflow")).toHaveValue("");
  await expect(
    form.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("");
  await expect(field(form, "Date")).toHaveValue(date);
  await expect(field(form, "Bank status")).toHaveValue("pending");
  await expect(
    form.getByRole("combobox", { name: "Account", exact: true }),
  ).toHaveValue("Checking");

  // Income to Ready to Assign, saved with Enter.
  await field(form, "Payee").fill("Payroll");
  await choose(form, "Category", "ready");
  await field(form, "Bank status").selectOption("posted");
  await field(form, "Inflow").fill("100");
  await field(form, "Inflow").press("Enter");
  await expect(form).toHaveCount(0);
  await expect(addButton(page)).toBeFocused();
  await expect(notifications(page)).toContainText("Added Payroll");

  // A refund back to the category it came from.
  await page.keyboard.press("n");
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
        status: "pending",
        expenseMonth: plan.month,
        reviewed: false,
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
});

test("the inspector placement keeps the same draft and saves with Save and add another", async ({
  page,
}) => {
  const plan = await openPrototype(page);
  await openRegister(page, "All accounts");
  await addButton(page).click();
  let form = editor(page);
  await field(form, "Payee").fill("Hardware store");
  await field(form, "Outflow").fill("40");

  // Moving the editor keeps what's typed and keeps focus on the toggle.
  await choosePlacement(form, "Inspector");
  form = details(page).getByRole("form", { name: "New transaction" });
  await expect(form).toBeVisible();
  await expect(content(page).getByRole("form")).toHaveCount(0);
  await expect(field(form, "Payee")).toHaveValue("Hardware store");
  await expect(field(form, "Outflow")).toHaveValue("40");
  await expect(form.getByRole("radio", { name: "Inspector" })).toBeFocused();

  // Account context: All accounts starts on the first account; a card
  // can't take Ready to Assign.
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

  // The next one, after switching back, saves from the row.
  await field(form, "Payee").fill("Paint");
  await choosePlacement(form, "Register row");
  form = content(page).getByRole("form", { name: "New transaction" });
  await expect(field(form, "Payee")).toHaveValue("Paint");
  await expect(details(page).getByRole("form")).toHaveCount(0);
  await choose(form, "Category", "house");
  await field(form, "Outflow").fill("8");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(addButton(page)).toBeFocused();

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

  // The placement is remembered on this device.
  await addButton(page).click();
  await choosePlacement(editor(page), "Inspector");
  await page.reload();
  await openRegister(page, "Checking");
  await addButton(page).click();
  await expect(
    details(page).getByRole("form", { name: "New transaction" }),
  ).toBeVisible();
  await expect(
    details(page).getByRole("combobox", { name: "Account", exact: true }),
  ).toHaveValue("Checking");
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
  const account = form.getByRole("combobox", { name: "Account", exact: true });
  await expect(account).toBeDisabled();
  await expect(account).toHaveValue("Checking");
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

  // E edits the selected row, here in the inspector.
  await content(page)
    .getByRole("button", { name: /Bistro/ })
    .click();
  await page.keyboard.press("e");
  const inline = content(page).getByRole("form", { name: "Edit transaction" });
  await choosePlacement(inline, "Inspector");
  const panel = details(page).getByRole("form", { name: "Edit transaction" });
  await expect(field(panel, "Payee")).toHaveValue("Bistro");
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel).toHaveCount(0);
  await expect(
    details(page).getByRole("button", { name: "Edit", exact: true }),
  ).toBeFocused();
  expect(plan.executions).toHaveLength(1);
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
  await expect(form).toContainText("Enter an outflow or an inflow.");
  expect(plan.writes).toEqual([]);

  // Correcting a field clears its error; the others wait for the next save.
  await payee.fill("Draft");
  await expect(payee).not.toHaveAttribute("aria-invalid");
  await expect(form).not.toContainText("Enter a payee.");
  await expect(form).toContainText("Enter an outflow or an inflow.");

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

test("shared details: expense month, shared category, and your share", async ({
  page,
}) => {
  const plan = await openPrototype(page, { shared: true });
  await openRegister(page, "Checking");
  await addButton(page).click();
  const form = editor(page);
  await field(form, "Payee").fill("Landlord");
  await field(form, "Outflow").fill("100");
  await form.getByRole("button", { name: "More details" }).click();
  await field(form, "Shared category").selectOption({ label: "Rent" });
  await expect(
    form.getByRole("combobox", { name: "Category", exact: true }),
  ).toHaveValue("Rent");
  await field(form, "Your share (optional)").fill("101");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(field(form, "Your share (optional)")).toBeFocused();
  await expect(form).toContainText(
    "Your share cannot exceed the full outflow.",
  );
  await field(form, "Your share (optional)").fill("70");
  await field(form, "Expense belongs to").fill(plan.month);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(plan.executions[0]!.command).toMatchObject({
    categoryId: "rent",
    sharedCategoryId: "shared-rent",
    expenseMonth: plan.month,
    amount: -10_000,
    shares: { "prototype-partner": 3_000 },
  });

  // A shared expense can't be made personal from its editor.
  await content(page)
    .getByRole("button", { name: /Landlord/ })
    .click();
  await page.keyboard.press("e");
  const edit = editor(page);
  await expect(field(edit, "Shared category")).toBeVisible();
  await expect(
    field(edit, "Shared category").locator("option", {
      hasText: "Personal expense",
    }),
  ).toBeDisabled();
});

test("on a phone both placements fit, take 16px text, and skip touch autofocus", async ({
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
    await expect(field(form, "Payee")).not.toBeFocused();
    await expect(field(form, "Payee")).toHaveCSS("font-size", "16px");
    await expect(field(form, "Outflow")).toHaveCSS("font-size", "16px");
    await fits(form);

    await field(form, "Payee").fill("Phone market");
    await choosePlacement(form, "Inspector");
    const panel = details(page).getByRole("form", { name: "New transaction" });
    await expect(panel).toBeVisible();
    await expect(field(panel, "Payee")).toHaveValue("Phone market");
    await fits(panel);
    await choose(panel, "Category", "gifts");
    await field(panel, "Outflow").fill("3");
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await expect(panel).toHaveCount(0);
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
  await form.getByRole("combobox", { name: "Category", exact: true }).click();
  const list = page.getByRole("listbox", { name: "Category" });
  await expect(list).toBeVisible();
  const theme = (locator: Locator) =>
    locator.evaluate((element) =>
      element.closest("[data-theme]")?.getAttribute("data-theme"),
    );
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

// Within the phone's width, once a drawer has finished sliding in.
async function fits(locator: Locator) {
  await expect(async () => {
    const box = (await locator.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }).toPass();
}
