import { screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import {
  addMember,
  createBook,
  execute,
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
  waitForSaves,
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

test("matching an import to a recorded purchase offers Undo and supports redo", async () => {
  const book = execute(
    withCounterpartyAccounts(
      addMember(budgetFixture(), "partner", "Anna", "2026-10"),
    ),
    "partner",
    {
      type: "partner.record",
      id: "record-market",
      recordedAt: "2026-10-10T12:00:00Z",
      entryId: "recorded-market",
      payerId: "owner",
      date: "2026-10-10",
      payee: "Recorded Market",
      amount: 2500,
      share: 1250,
    },
  );
  const imported: Overview["imports"][number] = {
    connectionId: "bank",
    logicalId: "market",
    fingerprint: "a".repeat(64),
    transactionId: undefined,
    categoryId: "gifts",
    categoryName: "Gifts",
    providerAccountId: "provider-checking",
    accountId: "checking",
    date: "2026-10-10",
    payee: "Bank Market",
    amount: -2500,
    pending: false,
    removed: false,
    needsMatchReview: true,
    error: null,
    history: [],
    reviewEvidence: [],
    quarantined: false,
    eligibility: "eligible",
    partnerMatches: [
      {
        entryId: "recorded-market",
        date: "2026-10-10",
        payee: "Recorded Market",
        amount: 2500,
        share: 1250,
        payeesAlike: true,
        recordedBy: "partner",
      },
    ],
  };
  const shell = await renderShell({
    book,
    overview: (server) =>
      readyOverview({
        partnerFirstName: "Anna",
        imports: server
          .book()
          .budgets.owner!.transactions.some(
            (transaction) =>
              !transaction.removed && transaction.providerId === "bank-market",
          )
          ? []
          : [imported],
      }),
    resolveImport: (input, server) => {
      if (input.command?.type !== "partner.match")
        throw new Error("Expected the recorded purchase to be matched");
      return {
        ...server.execute("owner", {
          command: { ...input.command, providerId: "bank-market" },
          baseRevision: input.expectedRevision,
          clientId: "import",
        }),
        resolved: true,
      };
    },
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(row("Bank Market"));
  await shell.user.keyboard("e");
  await shell.user.click(editor().getByRole("button", { name: "Match" }));
  const toast = await findToast("Matched your import to Recorded Market");
  expect(await findRow("Recorded Market")).toBeTruthy();

  await shell.user.click(within(toast).getByRole("button", { name: "Undo" }));
  await waitForSaves();
  expect(await findRow("Bank Market")).toBeTruthy();
  expect(screen.queryByText("Recorded Market", { exact: true })).toBeNull();

  await shell.user.keyboard("{Meta>}{Shift>}z{/Shift}{/Meta}");
  await waitForSaves();
  expect(await findRow("Recorded Market")).toBeTruthy();
  expect(screen.queryByText("Bank Market", { exact: true })).toBeNull();
  await shell.reload();
  expect(await findRow("Recorded Market")).toBeTruthy();
});

test("a card's Starting Balance has no category, can be edited and deleted, and arrives reviewed", async () => {
  const shell = await renderShell({
    seedCommands: [
      {
        type: "account.add",
        id: "card",
        accountId: "card",
        name: "Visa",
        kind: "credit",
        openingBalance: -20_000,
        date: "2026-10-10",
      },
    ],
  });
  await shell.user.click(screen.getByRole("link", { name: /^Visa/ }));
  expect(screen.getAllByText("Starting Balance", { exact: true })).toHaveLength(
    1,
  );
  const opening = await findRow("Starting Balance");
  expect(within(opening).getByText("Category not needed")).toBeTruthy();
  expect(within(opening).getByLabelText("Cleared")).toBeTruthy();
  await shell.user.click(opening);
  await shell.user.keyboard("e");
  expect(editor().getByLabelText("Category", { exact: true })).toHaveProperty(
    "disabled",
    true,
  );
  await shell.user.clear(editor().getByLabelText("Date", { exact: true }));
  await shell.user.type(
    editor().getByLabelText("Date", { exact: true }),
    "10/05/2026{Tab}",
  );
  await shell.user.clear(editor().getByLabelText("Outflow", { exact: true }));
  await shell.user.type(
    editor().getByLabelText("Outflow", { exact: true }),
    "250",
  );
  await shell.user.clear(editor().getByLabelText("Payee", { exact: true }));
  await shell.user.type(
    editor().getByLabelText("Payee", { exact: true }),
    "Corrected balance",
  );
  await shell.user.click(
    editor().getByRole("button", { name: "Save", exact: true }),
  );
  await waitForSaves();
  expect(
    within(await findRow("Corrected balance")).getByText("$250.00", {
      exact: true,
    }),
  ).toBeTruthy();
  expect(screen.getByRole("link", { name: /^Visa/ }).textContent).toContain(
    "-$250.00",
  );
  await shell.user.click(screen.getByRole("button", { name: /To review/ }));
  expect(screen.queryByText("Corrected balance", { exact: true })).toBeNull();
  await shell.user.click(screen.getByRole("button", { name: /To review/ }));
  await shell.user.click(
    screen.getByRole("checkbox", {
      name: "Select Corrected balance",
      exact: true,
    }),
  );
  await shell.user.click(
    screen.getByRole("button", { name: "More", exact: true }),
  );
  await shell.user.click(
    screen.getByRole("menuitem", { name: "Delete", exact: true }),
  );
  await findToast("Deleted 1 transaction");
  expect(screen.queryByText("Corrected balance", { exact: true })).toBeNull();
  expect(screen.getByRole("link", { name: /^Visa/ }).textContent).toContain(
    "$0.00",
  );
  await shell.user.click(
    screen.getByRole("button", { name: "Undo", exact: true }),
  );
  expect(await findRow("Corrected balance")).toBeTruthy();
});

test("Starting Balances follow account and search filters, including zero balances from earlier months", async () => {
  let book = createBook("owner", "Opening balances", "2026-09");
  book = execute(book, "owner", {
    type: "account.add",
    id: "checking-opening",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
    date: "2026-10-01",
  });
  book = execute(book, "owner", {
    type: "account.add",
    id: "card-opening",
    accountId: "card",
    name: "Travel card",
    kind: "credit",
    openingBalance: 0,
    date: "2026-09-30",
  });
  const shell = await renderShell({ book });
  await shell.user.click(screen.getByRole("link", { name: "All accounts" }));
  expect(
    screen.getByRole("button", {
      name: /Starting Balance.*Inflow: Ready to Assign/,
    }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", {
      name: /Starting Balance.*Category not needed/,
    }),
  ).toBeNull();
  const search = screen.getByPlaceholderText("Search all accounts");
  await shell.user.type(search, "Travel card");
  const opening = screen.getByRole("button", {
    name: /Starting Balance.*Category not needed/,
  });
  expect(within(opening).getByText("$0.00", { exact: true })).toBeTruthy();
  expect(
    within(opening).getByText("Travel card", { exact: true }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", {
      name: /Starting Balance.*Inflow: Ready to Assign/,
    }),
  ).toBeNull();
  await shell.user.clear(search);
  await shell.user.type(search, "Starting Balance");
  expect(
    screen.getAllByRole("button", {
      name: /Starting Balance.*(?:Inflow: Ready to Assign|Category not needed)/,
    }),
  ).toHaveLength(2);
  await shell.user.clear(search);
  await shell.user.type(search, "no-such-merchant");
  expect(
    screen.queryByRole("button", {
      name: /Starting Balance.*(?:Inflow: Ready to Assign|Category not needed)/,
    }),
  ).toBeNull();
});

test.each(["pending", "posted"] as const)(
  "a first click selects a %s purchase, a second edits its field, and the keyboard action corrects the same transaction",
  async (status) => {
    const shell = await renderShell({
      seedCommands: [{ ...purchase(), status }],
    });
    await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
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
      ).getByRole("link", { name: new RegExp(`^${accountName}`) }),
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
    type: "transaction.upsert",
    transactionId: `${"card-payment"}:cash`,
    id: "card-payment",
    date: "2026-10-10",
    accountId: "checking",
    transferAccountId: "visa",
    amount: -5000,
    payee: "Credit card payment",
    status: "posted",
  },
];

test("both sides of a card payment display the card's payment category", async () => {
  const shell = await renderShell({ seedCommands: cardSeeds });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  expect(
    within(row("Payment to Visa")).getByText("Payments: Visa"),
  ).toBeTruthy();
  await shell.user.click(screen.getByRole("link", { name: /^Visa/ }));
  expect(
    within(row("Payment from Checking")).getByText("Payments: Visa"),
  ).toBeTruthy();
  await shell.user.click(row("Payment from Checking"));
  await shell.user.keyboard("e");
  expect(editor().getByLabelText("Category", { exact: true })).toHaveProperty(
    "value",
    "Payments: Visa",
  );
});

test("payment payees exclude the current account and a receiving-side edit submits the existing payment", async () => {
  const shell = await renderShell({ seedCommands: cardSeeds });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
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
  await shell.user.click(screen.getByRole("link", { name: /^Visa/ }));
  await shell.user.click(row("Payment from Checking"));
  await shell.user.keyboard("e");
  expect(editor().getByLabelText("Payee", { exact: true })).toBe(
    document.activeElement,
  );
  expect(editor().getByLabelText("Category", { exact: true })).toHaveProperty(
    "value",
    "Payments: Visa",
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
    transactionId: "card-payment:counterpart",
    accountId: "visa",
    transferAccountId: "checking",
    amount: 6001,
  });
});

test("a payment link selects its counterpart without opening an editor or offering categorization", async () => {
  const shell = await renderShell({ seedCommands: cardSeeds });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  const link = screen.getByRole("link", { name: "View in Visa" });
  const address = new URL(link.getAttribute("href")!, window.location.origin);
  expect(address.pathname).toBe("/app/accounts/visa");
  expect(address.searchParams.get("transaction")).toBe(
    "card-payment:counterpart",
  );
  expect(address.searchParams.get("month")).toBe("2026-10");
  await shell.user.click(link);
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
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
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
  await shell.user.click(screen.getByRole("menuitem", { name: "Everyday" }));
  await shell.user.keyboard("{ArrowRight}{End}{Enter}");
  expect(
    screen.queryByRole("menu", { name: "Categorize transactions" }),
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
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
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
  await shell.user.click(screen.getByRole("link", { name: /^Brokerage/ }));
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
      type: "transaction.upsert",
      transactionId: `${"loan-payment"}:payment`,
      id: "loan-payment",
      loanId: "loan",
      date: "2026-10-10",
      interest: 1000,
      accountId: "checking",
      amount: -(4000 + 1000),
      payee: "Loan payment",
      status: "posted",
    },
  ];
  const shell = await renderShell({ seedCommands: seeds });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
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
  await shell.user.click(form.getByRole("combobox", { name: "Account type" }));
  await shell.user.click(
    screen.getByRole("option", { name: "Tracking / brokerage" }),
  );
  await shell.user.type(form.getByLabelText("Opening balance"), "25000");
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
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
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
    within(screen.getByRole("link", { name: /^Savings/ })).getByText("$0.00"),
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
  await shell.user.click(screen.getByRole("link", { name: "All accounts" }));
  await shell.user.click(
    screen.getByRole("button", { name: "Add transaction" }),
  );
  const form = within(screen.getByRole("form", { name: "New transaction" }));
  await shell.user.click(form.getByRole("combobox", { name: "Account" }));
  expect(screen.getByRole("option", { name: /Checking/ })).toBeTruthy();
  expect(
    screen.queryByRole("option", { name: /Partner|Anna|Reimbursements/ }),
  ).toBeNull();
});

test("cash, card and tracking adjustments use the existing editor with their category fixed", async () => {
  const shell = await renderShell({
    seedCommands: [
      {
        type: "account.add",
        id: "card",
        accountId: "card",
        name: "Visa",
        kind: "credit",
        openingBalance: -50_000,
        date: "2026-10-01",
      },
      {
        type: "account.add",
        id: "tracking",
        accountId: "tracking",
        name: "Brokerage",
        kind: "tracking",
        openingBalance: 0,
        date: "2026-10-01",
      },
      {
        type: "account.reconcile",
        id: "cash-adjust",
        accountId: "checking",
        date: "2026-10-10",
        balance: 110_000,
        adjustmentId: "cash-adjustment",
      },
      {
        type: "account.reconcile",
        id: "card-adjust",
        accountId: "card",
        date: "2026-10-10",
        balance: -60_000,
        adjustmentId: "card-adjustment",
      },
      {
        type: "account.reconcile",
        id: "tracking-adjust",
        accountId: "tracking",
        date: "2026-10-10",
        balance: 10_000,
        adjustmentId: "tracking-adjustment",
      },
    ],
  });
  for (const [name, label] of [
    ["Checking", "Inflow: Ready to Assign"],
    ["Visa", "Category not needed"],
    ["Brokerage", "Category not needed"],
  ]) {
    await shell.user.click(
      screen.getByRole("link", { name: new RegExp(`^${name}`) }),
    );
    expect(
      within(row("Reconciliation balance adjustment")).getByText(label!),
    ).toBeTruthy();
    expect(
      within(row("Reconciliation balance adjustment")).queryByText(
        "Needs review",
      ),
    ).toBeNull();
    await shell.user.click(row("Reconciliation balance adjustment"));
    await shell.user.keyboard("e");
    expect(editor().getByLabelText("Category", { exact: true })).toHaveProperty(
      "disabled",
      true,
    );
    expect(editor().getByLabelText("Category", { exact: true })).toHaveProperty(
      "value",
      label,
    );
    expect(editor().getByLabelText("Payee", { exact: true })).toBe(
      document.activeElement,
    );
    expect(editor().queryByRole("button", { name: "Split" })).toBeNull();
    await shell.user.clear(editor().getByLabelText("Date", { exact: true }));
    await shell.user.type(
      editor().getByLabelText("Date", { exact: true }),
      "10/05/2026{Tab}",
    );
    await shell.user.clear(editor().getByLabelText("Payee", { exact: true }));
    await shell.user.type(
      editor().getByLabelText("Payee", { exact: true }),
      `Corrected ${name}`,
    );
    await shell.user.clear(editor().getByLabelText("Inflow", { exact: true }));
    await shell.user.clear(editor().getByLabelText("Outflow", { exact: true }));
    await shell.user.type(
      editor().getByLabelText("Outflow", { exact: true }),
      "125.00",
    );
    await shell.user.click(
      editor().getByRole("button", { name: "Save", exact: true }),
    );
    const corrected = await findRow(`Corrected ${name}`);
    expect(within(corrected).getByText(label!)).toBeTruthy();
    expect(within(corrected).getByText("Oct 5")).toBeTruthy();
    expect(within(corrected).getByText("$125.00")).toBeTruthy();
    await waitForSaves();
    await shell.reload();
    expect(
      within(await findRow(`Corrected ${name}`)).getByText(label!),
    ).toBeTruthy();
  }
});

test("an adjustment can be corrected to zero and still have its payee edited", async () => {
  const shell = await renderShell({
    seedCommands: [
      {
        type: "account.reconcile",
        id: "reconcile-zero",
        accountId: "checking",
        date: "2026-10-10",
        balance: 101_000,
        adjustmentId: "adjustment-zero",
      },
    ],
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(row("Reconciliation balance adjustment"));
  await shell.user.keyboard("e");
  await shell.user.clear(editor().getByLabelText("Inflow", { exact: true }));
  await shell.user.type(
    editor().getByLabelText("Inflow", { exact: true }),
    "0.00",
  );
  await shell.user.click(
    editor().getByRole("button", { name: "Save", exact: true }),
  );
  expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
  await waitForSaves();
  await shell.reload();
  await shell.user.click(row("Reconciliation balance adjustment"));
  await shell.user.keyboard("e");
  await shell.user.clear(editor().getByLabelText("Payee", { exact: true }));
  await shell.user.type(
    editor().getByLabelText("Payee", { exact: true }),
    "Zero adjustment",
  );
  await shell.user.click(
    editor().getByRole("button", { name: "Save", exact: true }),
  );
  expect(
    within(await findRow("Zero adjustment")).getByText(
      "Inflow: Ready to Assign",
    ),
  ).toBeTruthy();
  await waitForSaves();
  await shell.reload();
  expect(await findRow("Zero adjustment")).toBeTruthy();
});

test("opening an adjustment from its fixed category focuses Payee and Cancel returns focus to its row", async () => {
  const shell = await renderShell({
    seedCommands: [
      {
        type: "account.reconcile",
        id: "reconcile-focus",
        accountId: "checking",
        date: "2026-10-10",
        balance: 101_000,
        adjustmentId: "adjustment-focus",
      },
    ],
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(row("Reconciliation balance adjustment"));
  await shell.user.click(
    within(row("Reconciliation balance adjustment")).getByText(
      "Inflow: Ready to Assign",
    ),
  );
  expect(editor().getByLabelText("Payee", { exact: true })).toBe(
    document.activeElement,
  );
  await shell.user.click(editor().getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(row("Reconciliation balance adjustment")).toBe(
      document.activeElement,
    ),
  );
});

test("More deletes the removable checked purchases and adjustments, keeps transfer sides, and Undo restores their balances", async () => {
  const shell = await renderShell({
    seedCommands: [
      {
        type: "account.add",
        id: "savings",
        accountId: "savings",
        name: "Savings",
        kind: "cash",
        openingBalance: 0,
        date: "2026-10-01",
      },
      {
        type: "account.reconcile",
        id: "reconcile-delete",
        accountId: "checking",
        date: "2026-10-10",
        balance: 110_000,
        adjustmentId: "adjustment-delete",
      },
      purchase(),
      {
        type: "transaction.upsert",
        id: "transfer-delete",
        transactionId: "transfer-delete",
        accountId: "checking",
        transferAccountId: "savings",
        date: "2026-10-10",
        amount: -5000,
        payee: "Transfer",
        status: "posted",
      },
    ],
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  expect(screen.getByRole("link", { name: "Checking $1,025.00" })).toBeTruthy();
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Transfer to Savings" }),
  );
  expect(
    screen.queryByRole("button", { name: "More", exact: true }),
  ).toBeNull();
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Market" }),
  );
  await shell.user.click(
    screen.getByRole("checkbox", {
      name: "Select Reconciliation balance adjustment",
    }),
  );
  await shell.user.click(
    screen.getByRole("button", { name: "More", exact: true }),
  );
  await shell.user.click(
    screen.getByRole("menuitem", { name: "Delete", exact: true }),
  );
  const toast = await findToast("Deleted 2 transactions");
  expect(screen.queryByRole("checkbox", { name: "Select Market" })).toBeNull();
  expect(
    screen.queryByRole("checkbox", {
      name: "Select Reconciliation balance adjustment",
    }),
  ).toBeNull();
  expect(await findRow("Transfer to Savings")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Checking $950.00" })).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "More", exact: true }),
  ).toBeNull();
  await shell.user.click(within(toast).getByRole("button", { name: "Undo" }));
  expect(await findRow("Market")).toBeTruthy();
  expect(await findRow("Reconciliation balance adjustment")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Checking $1,025.00" })).toBeTruthy();
  await waitForSaves();
  await shell.reload();
  expect(await findRow("Market")).toBeTruthy();
  expect(await findRow("Reconciliation balance adjustment")).toBeTruthy();
});
