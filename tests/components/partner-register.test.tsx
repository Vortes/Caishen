import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import {
  addMember,
  createBook,
  execute,
  withCounterpartyAccounts,
  type Command,
} from "~/domain/engine";
import {
  findToast,
  readyOverview,
  renderShell,
  transactionRow,
} from "./shell-harness";

function sharedBook() {
  const book = withCounterpartyAccounts(
    addMember(
      createBook("owner", "Alan", "2026-10"),
      "partner",
      "Anna",
      "2026-10",
    ),
  );
  const withCategory = execute(book, "owner", {
    type: "category.add",
    id: "add-household",
    categoryId: "household",
    name: "Household",
  });
  const groceries = execute(withCategory, "partner", {
    type: "partner.record",
    id: "record",
    recordedAt: "2026-10-12T12:00:00Z",
    entryId: "groceries",
    payerId: "partner",
    date: "2026-10-12",
    payee: "Groceries",
    amount: 6_000,
    share: 3_000,
  });
  return execute(groceries, "partner", {
    type: "partner.record",
    id: "record-pharmacy",
    recordedAt: "2026-10-11T12:00:00Z",
    entryId: "pharmacy",
    payerId: "partner",
    date: "2026-10-11",
    payee: "Pharmacy",
    amount: 2_000,
    share: 1_000,
  });
}

const ledger = () => within(screen.getByRole("group", { name: "Anna ledger" }));
const entryRow = (payee: string) =>
  ledger().getByRole("button", { name: new RegExp(payee) });

async function showLedger() {
  const shell = await renderShell({
    book: sharedBook(),
    overview: () => readyOverview({ partnerFirstName: "Anna" }),
  });
  await shell.user.click(
    await within(
      screen.getByRole("navigation", { name: "Budget navigation" }),
    ).findByRole("link", { name: /^Anna/ }),
  );
  return shell;
}

// The first click selects the entry; the second opens it at the field
// under the pointer.
async function openLedger() {
  const shell = await showLedger();
  await shell.user.click(entryRow("Groceries"));
  await shell.user.click(within(entryRow("Groceries")).getByText("-$30.00"));
  return shell;
}

test("an opened shared entry edits its amount and your category, in the row", async () => {
  const shell = await openLedger();
  const form = within(screen.getByRole("form", { name: "Edit shared entry" }));
  expect(form.getAllByRole("textbox")).toHaveLength(1);
  expect(form.getAllByRole("combobox")).toHaveLength(1);
  expect(form.getByRole("combobox", { name: "Your category" })).toBeTruthy();
  expect(form.getByText("Groceries", { exact: true })).toBeTruthy();
  const amount = form.getByRole("textbox", { name: "Amount" });
  expect(amount).toHaveProperty("value", "30.00");
  expect(screen.queryByRole("button", { name: "Split evenly" })).toBeNull();
  expect(screen.queryByText("History")).toBeNull();

  await shell.user.clear(amount);
  await shell.user.type(amount, "20");
  await shell.user.click(form.getByRole("button", { name: "Save" }));
  await findToast("Your share of Groceries is $20.00. Both budgets updated.");
  expect(screen.queryByRole("form", { name: "Edit shared entry" })).toBeNull();
  expect(within(entryRow("Groceries")).getByText("-$20.00")).toBeTruthy();
});

test("an amount over the shared total is refused and Cancel closes the row", async () => {
  const shell = await openLedger();
  const form = within(screen.getByRole("form", { name: "Edit shared entry" }));
  const amount = form.getByRole("textbox", { name: "Amount" });
  await shell.user.clear(amount);
  await shell.user.type(amount, "61");
  await shell.user.click(form.getByRole("button", { name: "Save" }));
  expect(form.getByText("A share can be at most $60.00.")).toBeTruthy();
  await shell.user.click(form.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("form", { name: "Edit shared entry" })).toBeNull();
});

test("your category for what your partner paid saves with its amount", async () => {
  const shell = await openLedger();
  const form = within(screen.getByRole("form", { name: "Edit shared entry" }));
  await shell.user.click(form.getByRole("combobox", { name: "Your category" }));
  await shell.user.click(screen.getByRole("option", { name: /Household/ }));
  const amount = form.getByRole("textbox", { name: "Amount" });
  await shell.user.clear(amount);
  await shell.user.type(amount, "25");
  await shell.user.click(form.getByRole("button", { name: "Save" }));
  await findToast("Your share of Groceries is $25.00. Both budgets updated.");
  const row = entryRow("Groceries");
  expect(within(row).getByText("Household")).toBeTruthy();
  expect(within(row).queryByText("Needs category")).toBeNull();
  expect(within(row).getByText("-$25.00")).toBeTruthy();
});

test("clicking an entry selects it, and clicking it again opens the field clicked", async () => {
  const shell = await showLedger();
  await shell.user.click(entryRow("Groceries"));
  expect(screen.queryByRole("form", { name: "Edit shared entry" })).toBeNull();
  expect(
    ledger()
      .getByRole("checkbox", { name: "Select Groceries" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    screen.getByRole("toolbar", { name: "Selected transactions" }),
  ).toBeTruthy();

  await shell.user.click(
    within(entryRow("Groceries")).getByText("Needs category"),
  );
  const form = within(screen.getByRole("form", { name: "Edit shared entry" }));
  expect(document.activeElement).toBe(
    form.getByRole("combobox", { name: "Your category" }),
  );
});

test("checked entries are categorized together from the action bar", async () => {
  const shell = await showLedger();
  await shell.user.click(
    ledger().getByRole("checkbox", { name: "Select Groceries" }),
  );
  await shell.user.click(
    ledger().getByRole("checkbox", { name: "Select Pharmacy" }),
  );
  const actionBar = within(
    screen.getByRole("toolbar", { name: "Selected transactions" }),
  );
  expect(actionBar.getByText("2 transactions")).toBeTruthy();
  await shell.user.click(actionBar.getByRole("button", { name: "Categorize" }));
  await shell.user.click(screen.getByRole("menuitem", { name: "Everyday" }));
  expect(screen.getByRole("menuitem", { name: "Household" })).toBeTruthy();
  await shell.user.keyboard("{ArrowRight}{End}{Enter}");
  await findToast("Categorized 2 transactions");
  for (const payee of ["Groceries", "Pharmacy"]) {
    expect(within(entryRow(payee)).getByText("Household")).toBeTruthy();
    expect(within(entryRow(payee)).queryByText("Needs category")).toBeNull();
  }
});

test("an open entry keeps what's typed when another entry is clicked", async () => {
  const shell = await openLedger();
  const form = within(screen.getByRole("form", { name: "Edit shared entry" }));
  const amount = form.getByRole("textbox", { name: "Amount" });
  await shell.user.clear(amount);
  await shell.user.type(amount, "12");
  await shell.user.click(entryRow("Pharmacy"));
  expect(
    within(screen.getByRole("form", { name: "Edit shared entry" })).getByRole(
      "textbox",
      { name: "Amount" },
    ),
  ).toHaveProperty("value", "12");
});

test("an entry you paid opens its transaction from the action bar", async () => {
  let book = execute(sharedBook(), "owner", {
    type: "account.add",
    id: "add-checking",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  book = execute(book, "owner", {
    type: "transaction.upsert",
    id: "dinner",
    transactionId: "dinner",
    accountId: "checking",
    date: "2026-10-14",
    amount: -8_000,
    payee: "Dinner",
    categoryId: "household",
    recordedAt: "2026-10-14T12:00:00Z",
    counterpartyShare: { accountId: "counterparty:partner", amount: 4_000 },
  });
  const shell = await renderShell({
    book,
    overview: () => readyOverview({ partnerFirstName: "Anna" }),
  });
  await shell.user.click(
    await within(
      screen.getByRole("navigation", { name: "Budget navigation" }),
    ).findByRole("link", { name: /^Anna/ }),
  );
  expect(ledger().queryByText("Shared")).toBeNull();
  await shell.user.click(entryRow("Dinner"));
  await shell.user.click(
    screen.getByRole("button", { name: "Open in Checking" }),
  );
  expect(screen.getByRole("heading", { name: "Checking" })).toBeTruthy();
  expect(transactionRow("Dinner").getAttribute("aria-current")).toBe("true");
});

test("a partner's purchase suggests your earlier payees, and a picked one brings its category", async () => {
  const book = [
    {
      type: "account.add",
      id: "add-checking",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      date: "2026-10-01",
      openingBalance: 100_000,
    },
    {
      type: "transaction.upsert",
      id: "seed-trader-joes",
      transactionId: "trader-joes",
      accountId: "checking",
      categoryId: "household",
      date: "2026-10-03",
      payee: "Trader Joe’s",
      amount: -4_210,
      status: "posted",
    },
  ] satisfies Command[];
  const shell = await renderShell({
    book: book.reduce(
      (budget, command) => execute(budget, "owner", command),
      sharedBook(),
    ),
    overview: () => readyOverview({ partnerFirstName: "Anna" }),
  });
  await shell.user.click(
    await within(
      screen.getByRole("navigation", { name: "Budget navigation" }),
    ).findByRole("link", { name: /^Anna/ }),
  );
  await shell.user.click(
    screen.getByRole("button", { name: "Record purchase" }),
  );
  const form = within(
    screen.getByRole("dialog", { name: "Record a shared purchase" }),
  );

  await shell.user.type(form.getByLabelText("Payee", { exact: true }), "tra");
  await shell.user.click(screen.getByRole("option", { name: "Trader Joe’s" }));

  expect(form.getByLabelText("Payee", { exact: true })).toHaveProperty(
    "value",
    "Trader Joe’s",
  );
  expect(
    form.getByRole("combobox", { name: "Your category for your share" }),
  ).toHaveProperty("value", "Household");
});
