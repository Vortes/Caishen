import { screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import {
  addMember,
  withCounterpartyAccounts,
  type Command,
} from "~/domain/engine";
import { SyncError } from "~/components/sync/transport";
import {
  budgetFixture,
  findToast,
  findTransactionRow as findRow,
  readyOverview,
  renderShell,
  sent,
  transactionRow as row,
  type Overview,
} from "./shell-harness";

const purchase = (
  transactionId = "purchase",
  reviewed = true,
): Extract<Command, { type: "transaction.upsert" }> => ({
  type: "transaction.upsert",
  id: `seed-${transactionId}`,
  transactionId,
  accountId: "checking",
  categoryId: "gifts",
  date: "2026-10-10",
  payee: transactionId === "purchase" ? "Market" : "Coffee",
  amount: -2500,
  status: "posted",
  reviewed,
});
const editor = () =>
  within(screen.getByRole("form", { name: "Edit transaction" }));

test.each(["pending", "posted"] as const)(
  "a first click selects a %s purchase, a second edits its field, and the keyboard action corrects the same transaction",
  async (status) => {
    const shell = await renderShell({
      seedCommands: [{ ...purchase(), status }],
    });
    await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
    await shell.user.click(
      within(row("Market")).getByText("Market", { exact: true }),
    );
    expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
    await shell.user.click(
      within(row("Market")).getByText("Market", { exact: true }),
    );
    expect(editor().getByLabelText("Payee", { exact: true })).toBe(
      document.activeElement,
    );
    await shell.user.click(editor().getByRole("button", { name: "Cancel" }));
    await shell.user.keyboard("e");
    await shell.user.clear(editor().getByLabelText("Outflow", { exact: true }));
    await shell.user.type(
      editor().getByLabelText("Outflow", { exact: true }),
      "18.75",
    );
    await shell.user.click(editor().getByRole("button", { name: "Save" }));
    await findToast("Saved Market");
    const saved = within(await findRow("Market"));
    expect(saved.getByText("$18.75", { exact: true })).toBeTruthy();
    expect(saved.getByText("Gifts", { exact: true })).toBeTruthy();
    expect(
      saved.getByLabelText(status === "pending" ? "Pending" : "Cleared"),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("checkbox", { name: "Select Market" }),
    ).toHaveLength(1);
  },
);

test.each([
  {
    status: "pending",
    accountId: "checking",
    accountName: "Checking",
    kind: "cash",
  },
  {
    status: "posted",
    accountId: "checking",
    accountName: "Checking",
    kind: "cash",
  },
  {
    status: "pending",
    accountId: "card",
    accountName: "Chase Sapphire",
    kind: "credit",
  },
  {
    status: "posted",
    accountId: "card",
    accountName: "Chase Sapphire",
    kind: "credit",
  },
] as const)(
  "a $status bank import in $accountName keeps edits after a refused save and saves once on retry",
  async ({ status, accountId, accountName, kind }) => {
    const seedCommands: Command[] =
      accountId === "checking"
        ? []
        : [
            {
              type: "account.add",
              id: accountId,
              accountId,
              name: accountName,
              kind,
              openingBalance: 0,
              date: "2026-10-01",
            },
          ];
    let imports: Overview["imports"] = [
      {
        connectionId: "bank",
        logicalId: "imported-coffee",
        fingerprint: "a".repeat(64),
        transactionId: undefined,
        categoryId: undefined,
        categoryName: null,
        providerAccountId: "provider-checking",
        accountId,
        date: "2026-10-10",
        payee: "Imported coffee",
        amount: -2500,
        pending: status === "pending",
        removed: false,
        needsMatchReview: false,
        error: null,
        history: [],
        reviewEvidence: [],
        quarantined: false,
        eligibility: "eligible",
      },
    ];
    // The first save is refused; the next one resolves the import.
    let refuse = true;
    const shell = await renderShell({
      seedCommands,
      overview: () => readyOverview({ imports }),
      resolveImport: (input, server) => {
        if (refuse) {
          refuse = false;
          throw new SyncError("rejected", "Your bank changed this import.");
        }
        imports = [];
        return {
          ...server.execute("owner", {
            command: input.command!,
            baseRevision: input.expectedRevision,
            clientId: "import",
          }),
          resolved: true,
        };
      },
    });
    await shell.user.click(
      within(
        screen.getByRole("navigation", { name: "Budget navigation" }),
      ).getByRole("button", { name: new RegExp(`^${accountName}`) }),
    );
    await shell.user.click(
      within(row("Imported coffee")).getByText("Imported coffee"),
    );
    expect(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
    await shell.user.click(
      within(row("Imported coffee")).getByText("Imported coffee"),
    );
    expect(editor().getByLabelText("Payee", { exact: true })).toBe(
      document.activeElement,
    );
    await shell.user.click(editor().getByRole("button", { name: "Cancel" }));
    expect(within(row("Imported coffee")).getByText("$25.00")).toBeTruthy();
    await shell.user.keyboard("e");
    await shell.user.clear(editor().getByLabelText("Payee", { exact: true }));
    await shell.user.type(
      editor().getByLabelText("Payee", { exact: true }),
      "Neighborhood cafe",
    );
    await shell.user.clear(editor().getByLabelText("Outflow", { exact: true }));
    await shell.user.type(
      editor().getByLabelText("Outflow", { exact: true }),
      "18.75",
    );
    await shell.user.type(
      editor().getByLabelText("Category", { exact: true }),
      "Gifts{Enter}",
    );
    await shell.user.click(editor().getByRole("button", { name: "Save" }));
    await findToast("Your bank changed this import.");
    await screen.findByText(
      "Not saved. Your changes are still here, so you can try again.",
    );
    expect(editor().getByLabelText("Payee", { exact: true })).toHaveProperty(
      "value",
      "Neighborhood cafe",
    );
    expect(editor().getByLabelText("Outflow", { exact: true })).toHaveProperty(
      "value",
      "18.75",
    );
    expect(editor().getByRole("combobox", { name: "Category" })).toHaveProperty(
      "value",
      "Gifts",
    );
    await shell.user.click(editor().getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
    await findToast("Saved Neighborhood cafe");
    const saved = within(await findRow("Neighborhood cafe"));
    expect(saved.getByText("$18.75", { exact: true })).toBeTruthy();
    expect(saved.getByText("Gifts", { exact: true })).toBeTruthy();
    expect(
      saved.getByLabelText(status === "pending" ? "Pending" : "Cleared"),
    ).toBeTruthy();
    expect(screen.queryByText("Imported coffee", { exact: true })).toBeNull();
    expect(
      screen.getAllByRole("checkbox", { name: "Select Neighborhood cafe" }),
    ).toHaveLength(1);
  },
);

const cardSeeds: Command[] = [
  {
    type: "account.add",
    id: "visa",
    accountId: "visa",
    name: "Visa",
    kind: "credit",
    openingBalance: -20000,
    date: "2026-10-01",
  },
  {
    type: "assign",
    id: "fund-visa",
    categoryId: "card:visa",
    amount: 20000,
    month: "2026-10",
  },
  {
    type: "card.payment",
    id: "card-payment",
    cashAccountId: "checking",
    cardAccountId: "visa",
    date: "2026-10-10",
    amount: 5000,
  },
];

test("payment payees exclude the current account and a receiving-side edit submits the existing payment", async () => {
  const shell = await renderShell({ seedCommands: cardSeeds });
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
  await shell.user.click(
    screen.getByRole("button", { name: "Add transaction" }),
  );
  await shell.user.keyboard("{Escape}");
  const form = within(screen.getByRole("form", { name: "New transaction" }));
  await shell.user.click(form.getByLabelText("Payee", { exact: true }));
  expect(screen.getByRole("option", { name: "Payment to Visa" })).toBeTruthy();
  expect(
    screen.queryByRole("option", { name: "Transfer to Checking" }),
  ).toBeNull();
  await shell.user.click(form.getByRole("button", { name: "Cancel" }));
  await shell.user.click(screen.getByRole("button", { name: /^Visa/ }));
  await shell.user.click(row("Payment from Checking"));
  await shell.user.keyboard("e");
  expect(editor().getByLabelText("Payee", { exact: true })).toBe(
    document.activeElement,
  );
  expect(editor().getByLabelText("Category", { exact: true })).toHaveProperty(
    "value",
    "Category not needed",
  );
  await shell.user.clear(editor().getByLabelText("Inflow", { exact: true }));
  await shell.user.type(
    editor().getByLabelText("Inflow", { exact: true }),
    "60.01",
  );
  await shell.user.click(editor().getByRole("button", { name: "Save" }));
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(sent(shell.execute)[0]).toMatchObject({
    type: "transaction.upsert",
    transactionId: "card-payment:card",
    accountId: "visa",
    transferAccountId: "checking",
    amount: 6001,
  });
});

test("a payment link selects its counterpart without opening an editor or offering categorization", async () => {
  const shell = await renderShell({ seedCommands: cardSeeds });
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
  await shell.user.click(screen.getByRole("link", { name: "View in Visa" }));
  expect(screen.getByRole("heading", { name: "Visa" })).toBeTruthy();
  expect(
    screen
      .getByRole("checkbox", { name: "Select Payment from Checking" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  const actions = within(
    screen.getByRole("toolbar", { name: "Selected transactions" }),
  );
  expect(actions.queryByRole("button", { name: "Categorize" })).toBeNull();
  expect(
    actions.queryByRole("button", { name: /^Approve|Reject$/ }),
  ).toBeNull();
  expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
  await shell.user.click(
    screen.getByRole("link", { name: "View in Checking" }),
  );
  expect(screen.getByRole("heading", { name: "Checking" })).toBeTruthy();
  expect(
    screen
      .getByRole("checkbox", { name: "Select Payment to Visa" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(shell.execute).not.toHaveBeenCalled();
});

test("categorization applies to both selected purchases at once", async () => {
  const seeds: Command[] = [
    purchase(),
    purchase("coffee", false),
    { type: "category.add", id: "food", categoryId: "food", name: "Food" },
  ];
  const shell = await renderShell({ seedCommands: seeds });
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
  await shell.user.click(row("Market"));
  const actions = within(
    screen.getByRole("toolbar", { name: "Selected transactions" }),
  );
  expect(
    actions.queryByRole("button", { name: /^Approve|Reject$/ }),
  ).toBeNull();
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Coffee" }),
  );
  expect(actions.getByRole("button", { name: "Approve (1)" })).toBeTruthy();
  await shell.user.click(actions.getByRole("button", { name: "Categorize" }));
  const form = screen.getByRole("form", { name: "Categorize transactions" });
  await shell.user.type(
    within(form).getByRole("combobox", { name: "Category" }),
    "Food{Enter}",
  );
  await shell.user.click(within(form).getByRole("button", { name: "Apply" }));
  expect(
    screen.queryByRole("form", { name: "Categorize transactions" }),
  ).toBeNull();
  await findToast("Categorized 2 transactions");
  expect(
    within(await findRow("Market")).getByText("Food", { exact: true }),
  ).toBeTruthy();
  expect(
    within(await findRow("Coffee")).getByText("Food", { exact: true }),
  ).toBeTruthy();
});

test("Reject removes only the unreviewed purchase in a mixed selection", async () => {
  const shell = await renderShell({
    seedCommands: [purchase(), purchase("coffee", false)],
  });
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
  await shell.user.click(row("Market"));
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Coffee" }),
  );
  await shell.user.click(screen.getByRole("button", { name: "Reject" }));
  await findToast("Rejected 1 transaction");
  expect(within(await findRow("Market")).getByText("$25.00")).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: "Select Coffee" })).toBeNull();
  expect(screen.queryByText("Coffee", { exact: true })).toBeNull();
});

test("editing a brokerage transfer from the tracking register retains its required budget category", async () => {
  const seeds: Command[] = [
    {
      type: "account.add",
      id: "brokerage",
      accountId: "brokerage",
      name: "Brokerage",
      kind: "tracking",
      openingBalance: 0,
      date: "2026-10-01",
    },
    {
      type: "transaction.upsert",
      id: "seed-tracking",
      transactionId: "tracking",
      accountId: "brokerage",
      transferAccountId: "checking",
      categoryId: "gifts",
      date: "2026-10-10",
      amount: 5000,
      payee: "Transfer from Checking",
    },
  ];
  const shell = await renderShell({ seedCommands: seeds });
  await shell.user.click(screen.getByRole("button", { name: /^Brokerage/ }));
  await shell.user.click(row("Transfer from Checking"));
  await shell.user.keyboard("e");
  expect(editor().getByLabelText("Category", { exact: true })).toHaveProperty(
    "value",
    "Gifts",
  );
  await shell.user.clear(editor().getByLabelText("Inflow", { exact: true }));
  await shell.user.type(
    editor().getByLabelText("Inflow", { exact: true }),
    "75",
  );
  await shell.user.click(editor().getByRole("button", { name: "Save" }));
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(sent(shell.execute)[0]).toMatchObject({
    type: "transaction.upsert",
    transactionId: "tracking",
    accountId: "brokerage",
    transferAccountId: "checking",
    categoryId: "gifts",
    amount: 7500,
  });
});

test("editing a loan payment loads confirmed interest and sends the corrected total and interest", async () => {
  const seeds: Command[] = [
    {
      type: "loan.add",
      id: "loan",
      loanId: "loan",
      categoryId: "loan-category",
      name: "Student loan",
      principal: 100000,
      annualRateBps: 500,
      minimumPayment: 5000,
      variable: false,
      effectiveDate: "2026-10-01",
    },
    {
      type: "assign",
      id: "fund-loan",
      categoryId: "loan-category",
      month: "2026-10",
      amount: 10000,
    },
    {
      type: "loan.payment",
      id: "loan-payment",
      loanId: "loan",
      accountId: "checking",
      date: "2026-10-10",
      principal: 4000,
      interest: 1000,
    },
  ];
  const shell = await renderShell({ seedCommands: seeds });
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
  await shell.user.click(row("Payment to Student loan"));
  await shell.user.keyboard("e");
  const interest = editor().getByLabelText("Lender-confirmed interest", {
    exact: true,
  });
  expect(interest).toHaveProperty("value", "10.00");
  await shell.user.clear(editor().getByLabelText("Outflow", { exact: true }));
  await shell.user.type(
    editor().getByLabelText("Outflow", { exact: true }),
    "70",
  );
  await shell.user.clear(interest);
  await shell.user.type(interest, "12");
  await shell.user.click(editor().getByRole("button", { name: "Save" }));
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(sent(shell.execute)[0]).toMatchObject({
    type: "transaction.upsert",
    transactionId: "loan-payment:payment",
    loanId: "loan",
    amount: -7000,
    interest: 1200,
  });
});

test("adding a brokerage account sends tracking type and its entered opening balance", async () => {
  const shell = await renderShell();
  await shell.user.click(screen.getByRole("button", { name: "Add account" }));
  const form = within(screen.getByRole("form", { name: "Add account" }));
  await shell.user.type(
    form.getByLabelText("Account name"),
    "Fidelity brokerage",
  );
  await shell.user.selectOptions(
    form.getByLabelText("Account type"),
    "tracking",
  );
  await shell.user.type(form.getByLabelText("Opening balance ($)"), "25000");
  await shell.user.click(form.getByRole("button", { name: "Add account" }));
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(sent(shell.execute)[0]).toMatchObject({
    type: "account.add",
    name: "Fidelity brokerage",
    kind: "tracking",
    openingBalance: 2500000,
    date: "2026-10-20",
  });
});

test("choosing and removing a transfer payee changes category requirements without changing the purchase identity", async () => {
  const seeds: Command[] = [
    {
      type: "account.add",
      id: "savings",
      accountId: "savings",
      name: "Savings",
      kind: "cash",
      openingBalance: 0,
      date: "2026-10-01",
    },
    purchase("purchase", false),
  ];
  // The server turns the first save down, so the draft comes back.
  let first = true;
  const shell = await renderShell({
    seedCommands: seeds,
    execute: (input, server) => {
      if (first) {
        first = false;
        throw new SyncError("rejected", "Try that again.", server.revision);
      }
      return server.execute("owner", input);
    },
  });
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
  await shell.user.click(row("Market"));
  await shell.user.keyboard("e");
  await shell.user.click(editor().getByLabelText("Payee", { exact: true }));
  await shell.user.click(
    screen.getByRole("option", { name: "Transfer to Savings" }),
  );
  expect(editor().getByLabelText("Category", { exact: true })).toHaveProperty(
    "value",
    "Category not needed",
  );
  await shell.user.click(editor().getByRole("button", { name: "Save" }));
  await findToast("Try that again.");
  await screen.findByText(
    "Not saved. Your changes are still here, so you can try again.",
  );
  expect(editor().getByLabelText("Payee", { exact: true })).toHaveProperty(
    "value",
    "Transfer to Savings",
  );
  expect(editor().getByLabelText("Category", { exact: true })).toHaveProperty(
    "value",
    "Category not needed",
  );
  await shell.user.clear(editor().getByLabelText("Payee", { exact: true }));
  await shell.user.type(
    editor().getByLabelText("Payee", { exact: true }),
    "Merchant purchase",
  );
  await shell.user.clear(editor().getByRole("combobox", { name: "Category" }));
  await shell.user.type(
    editor().getByRole("combobox", { name: "Category" }),
    "Gifts{Enter}",
  );
  await shell.user.click(editor().getByRole("button", { name: "Save" }));
  await findToast("Saved Merchant purchase");
  const saved = within(await findRow("Merchant purchase"));
  expect(saved.getByText("Gifts", { exact: true })).toBeTruthy();
  expect(saved.getByText("$25.00", { exact: true })).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: "Select Market" })).toBeNull();
  expect(
    screen.getAllByRole("checkbox", { name: "Select Merchant purchase" }),
  ).toHaveLength(1);
  expect(
    within(screen.getByRole("button", { name: /^Savings/ })).getByText("$0.00"),
  ).toBeTruthy();
});

test("F3: the new transaction account picker excludes Partner and Reimbursements", async () => {
  const book = withCounterpartyAccounts(
    addMember(budgetFixture(), "partner", "Anna", "2026-10"),
  );
  const shell = await renderShell({
    book,
    overview: () => readyOverview({ partnerFirstName: "Anna" }),
  });
  await shell.user.click(screen.getByRole("button", { name: "All accounts" }));
  await shell.user.click(
    screen.getByRole("button", { name: "Add transaction" }),
  );
  await shell.user.keyboard("{Escape}");
  const form = within(screen.getByRole("form", { name: "New transaction" }));
  await shell.user.click(form.getByRole("combobox", { name: "Account" }));
  expect(screen.getByRole("option", { name: /Checking/ })).toBeTruthy();
  expect(
    screen.queryByRole("option", { name: /Partner|Anna|Reimbursements/ }),
  ).toBeNull();
});
