import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Command } from "~/domain/engine";
import { deferred, renderShell, stateFixture } from "./shell-harness";

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
const row = (payee: string) =>
  within(screen.getByRole("group", { name: "Transactions" })).getByRole(
    "button",
    { name: new RegExp(payee) },
  );
const editor = () =>
  within(screen.getByRole("form", { name: "Edit transaction" }));

test("only newly checked rows get an entry marker when selecting all", async () => {
  const state = stateFixture({
    seedCommands: [purchase(), purchase("coffee")],
  });
  const shell = await renderShell({ read: () => state });
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
  const market = row("Market").parentElement!;
  const coffee = row("Coffee").parentElement!;

  fireEvent.click(screen.getByRole("checkbox", { name: "Select Market" }));
  expect(market.hasAttribute("data-entering")).toBe(true);
  expect(coffee.hasAttribute("data-entering")).toBe(false);
  await waitFor(() => expect(market.hasAttribute("data-entering")).toBe(false));

  fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
  expect(market.hasAttribute("data-entering")).toBe(false);
  expect(coffee.hasAttribute("data-entering")).toBe(true);
  expect(market.hasAttribute("data-checked")).toBe(true);
  expect(coffee.hasAttribute("data-checked")).toBe(true);
  await waitFor(() => expect(coffee.hasAttribute("data-entering")).toBe(false));

  fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
  expect(market.hasAttribute("data-checked")).toBe(false);
  expect(coffee.hasAttribute("data-checked")).toBe(false);
  expect(market.hasAttribute("data-entering")).toBe(false);
  expect(coffee.hasAttribute("data-entering")).toBe(false);
});

test("keyboard selection skips motion until the next pointer interaction", async () => {
  const state = stateFixture({ seedCommands: [purchase()] });
  const shell = await renderShell({ read: () => state });
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
  const register = screen.getByRole("group", { name: "Transactions" });
  const market = row("Market");
  await shell.user.click(market);
  await shell.user.keyboard("x");
  expect(register.hasAttribute("data-instant")).toBe(true);
  expect(market.parentElement!.hasAttribute("data-checked")).toBe(false);
  await shell.user.keyboard("x");
  expect(market.parentElement!.hasAttribute("data-checked")).toBe(true);

  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Market" }),
  );
  expect(register.hasAttribute("data-instant")).toBe(false);
  expect(market.parentElement!.hasAttribute("data-checked")).toBe(false);
});

test.each(["pending", "posted"] as const)(
  "a first click selects a %s purchase, a second edits its field, and the keyboard action corrects the same transaction",
  async (status) => {
    const state = stateFixture({ seedCommands: [{ ...purchase(), status }] });
    const shell = await renderShell({
      read: () => state,
      execute: () => {
        throw new Error("Hold the draft");
      },
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
    await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
    expect(shell.execute.mock.calls[0]![0].command).toMatchObject({
      type: "transaction.upsert",
      transactionId: "purchase",
      amount: -1875,
      status,
    });
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
  "a $status bank import in $accountName selects, opens its field, and saves through its bank link",
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
    const state = stateFixture({ seedCommands });
    state.imports = [
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
      },
    ];
    const pending = deferred<{ resolved: boolean }>();
    const shell = await renderShell({
      read: () => state,
      resolveImport: () => pending.promise,
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
    expect(shell.resolveImport).not.toHaveBeenCalled();
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
    await waitFor(() => expect(shell.resolveImport).toHaveBeenCalledTimes(1));
    expect(editor().getByRole("button", { name: "Saving…" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(shell.execute).not.toHaveBeenCalled();
    expect(shell.resolveImport.mock.calls[0]![0]).toMatchObject({
      connectionId: "bank",
      logicalId: "imported-coffee",
      expectedFingerprint: "a".repeat(64),
      command: {
        type: "transaction.upsert",
        accountId,
        payee: "Neighborhood cafe",
        amount: -1875,
        categoryId: "gifts",
        status,
      },
    });
    pending.reject(new Error("Save refused"));
    await screen.findByText(
      "Not saved. Your changes are still here, so you can try again.",
    );
    expect(editor().getByLabelText("Payee", { exact: true })).toHaveProperty(
      "value",
      "Neighborhood cafe",
    );
    const input = shell.resolveImport.mock.calls[0]![0];
    shell.read.mockReturnValue(
      stateFixture({ seedCommands: [...seedCommands, input.command!] }),
    );
    shell.resolveImport.mockResolvedValueOnce({ resolved: true });
    await shell.user.click(editor().getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("form", { name: "Edit transaction" }),
      ).toBeNull(),
    );
    expect(shell.resolveImport.mock.calls[1]![0].command!.id).toBe(
      input.command!.id,
    );
    expect(
      within(row("Neighborhood cafe")).getByLabelText(
        status === "pending" ? "Pending" : "Cleared",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Imported coffee.*Needs category/ }),
    ).toBeNull();
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
  const state = stateFixture({ seedCommands: cardSeeds });
  const shell = await renderShell({
    read: () => state,
    execute: () => {
      throw new Error("Hold the draft");
    },
  });
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
  expect(shell.execute.mock.calls[0]![0].command).toMatchObject({
    type: "transaction.save",
    transactionId: "card-payment:card",
    accountId: "visa",
    transferAccountId: "checking",
    amount: 6001,
  });
});

test("a payment link selects its counterpart without opening an editor or offering categorization", async () => {
  const shell = await renderShell({
    read: () => stateFixture({ seedCommands: cardSeeds }),
  });
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

test("categorization submits both selected purchases and holds the form until the save completes", async () => {
  const seeds: Command[] = [
    purchase(),
    purchase("coffee", false),
    { type: "category.add", id: "food", categoryId: "food", name: "Food" },
  ];
  const pending = deferred<{ revision: number }>();
  const shell = await renderShell({
    read: () => stateFixture({ seedCommands: seeds }),
    execute: () => pending.promise,
  });
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
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(within(form).getByRole("button", { name: "Saving…" })).toHaveProperty(
    "disabled",
    true,
  );
  const command = shell.execute.mock.calls[0]![0].command;
  expect(command).toMatchObject({
    type: "transaction.categorize.batch",
    categoryId: "food",
  });
  expect(command).toHaveProperty(
    "transactionIds",
    expect.arrayContaining(["purchase", "coffee"]),
  );
  expect(command).toHaveProperty("transactionIds.length", 2);
  shell.read.mockReturnValue(
    stateFixture({
      revision: 6,
      seedCommands: [
        ...seeds,
        {
          type: "transaction.categorize.batch",
          id: "categorized",
          categoryId: "food",
          transactionIds: ["purchase", "coffee"],
        },
      ],
    }),
  );
  pending.resolve({ revision: 6 });
  await waitFor(() =>
    expect(
      screen.queryByRole("form", { name: "Categorize transactions" }),
    ).toBeNull(),
  );
  expect(row("Market").textContent).toContain("Food");
  expect(row("Coffee").textContent).toContain("Food");
});

test("Reject submits only the unreviewed purchase in a mixed selection", async () => {
  const shell = await renderShell({
    read: () =>
      stateFixture({ seedCommands: [purchase(), purchase("coffee", false)] }),
    execute: () => {
      throw new Error("Hold the selection");
    },
  });
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
  await shell.user.click(row("Market"));
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Coffee" }),
  );
  await shell.user.click(screen.getByRole("button", { name: "Reject" }));
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(shell.execute.mock.calls[0]![0].command).toMatchObject({
    type: "transaction.reject",
    transactionIds: ["coffee"],
  });
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
      type: "transaction.save",
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
  const shell = await renderShell({
    read: () => stateFixture({ seedCommands: seeds }),
    execute: () => {
      throw new Error("Hold the draft");
    },
  });
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
  expect(shell.execute.mock.calls[0]![0].command).toMatchObject({
    type: "transaction.save",
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
  const shell = await renderShell({
    read: () => stateFixture({ seedCommands: seeds }),
    execute: () => {
      throw new Error("Hold the draft");
    },
  });
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
  expect(shell.execute.mock.calls[0]![0].command).toMatchObject({
    type: "transaction.save",
    transactionId: "loan-payment:payment",
    loanId: "loan",
    amount: -7000,
    interest: 1200,
  });
});

test("adding a brokerage account sends tracking type and its entered opening balance", async () => {
  const shell = await renderShell({
    execute: () => {
      throw new Error("Hold the account");
    },
  });
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
  expect(shell.execute.mock.calls[0]![0].command).toMatchObject({
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
  const shell = await renderShell({
    read: () => stateFixture({ seedCommands: seeds }),
    execute: () => {
      throw new Error("Hold the draft");
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
  await screen.findByText(
    "Not saved. Your changes are still here, so you can try again.",
  );
  expect(shell.execute.mock.calls[0]![0].command).toMatchObject({
    type: "transaction.save",
    transactionId: "purchase",
    transferAccountId: "savings",
    amount: -2500,
    categoryId: undefined,
  });
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
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(2));
  expect(shell.execute.mock.calls[1]![0].command).toMatchObject({
    type: "transaction.upsert",
    transactionId: "purchase",
    payee: "Merchant purchase",
    categoryId: "gifts",
    amount: -2500,
  });
});
