import { screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { State } from "~/components/budget/types";
import type { RouterInputs } from "~/trpc/react";
import { readyOverview, renderShell } from "./shell-harness";

function connection(): State["connections"][number] {
  return {
    id: "discover",
    itemId: "discover-item",
    institutionId: "discover-bank",
    institutionName: "Discover",
    error: null,
    lastSyncedAt: new Date(),
    lastAttemptAt: new Date(),
    status: "connected",
    consentExpiresAt: null,
    lastSuccessfulUpdateAt: null,
    lastFailedUpdateAt: null,
    newAccountsAvailable: false,
    transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
    synchronizedAccountIds: [],
    accountMappings: {},
    accounts: [
      {
        accountId: "loan",
        name: "Discover personal loan",
        officialName: null,
        mask: "3460",
        type: "loan",
        subtype: "consumer",
        currentBalance: null,
        availableBalance: null,
        currency: "USD",
      },
    ],
  };
}

test.each([false, true])(
  "a partial bank response keeps all mapped cards visible and refreshes only the returned card (cached details: %s)",
  async (retainDetails) => {
    const cards = [
      { id: "gold", name: "Amex Gold" },
      { id: "everyday", name: "Amex EveryDay" },
      { id: "business", name: "My Business Platinum" },
      { id: "platinum", name: "Personal Platinum" },
      { id: "blue", name: "Blue Cash Preferred" },
    ];
    const bank: State["connections"][number] = {
      ...connection(),
      institutionName: "American Express",
      accountMappings: Object.fromEntries(
        cards.map(({ id }) => [
          `provider-${id}`,
          { accountId: id, startDate: "2026-10-02" },
        ]),
      ),
      accounts: [
        {
          accountId: "provider-business",
          name: "Business Platinum Card",
          officialName: null,
          mask: "1005",
          type: "credit",
          subtype: "credit card",
          currentBalance: 123.45,
          availableBalance: null,
          currency: "USD",
        },
      ],
    };
    if (retainDetails) {
      bank.unavailableAccountIds = [
        "provider-gold",
        "provider-everyday",
        "provider-platinum",
        "provider-blue",
      ];
      bank.accounts.push(
        ...cards
          .filter(({ id }) => id !== "business")
          .map(({ id, name }) => ({
            ...bank.accounts[0]!,
            accountId: `provider-${id}`,
            name,
            mask: "9999",
            currentBalance: 999,
          })),
      );
    }
    const shell = await renderShell({
      seedCommands: cards.map(({ id, name }) => ({
        type: "account.add",
        id: `add-${id}`,
        accountId: id,
        name,
        kind: "credit",
        date: "2026-10-01",
        openingBalance: 0,
      })),
      overview: () => readyOverview({ connections: [bank] }),
    });
    await shell.user.click(screen.getByRole("button", { name: "Banks" }));
    const accounts = screen.getByRole("list", {
      name: "American Express accounts in your budget",
    });
    expect(within(accounts).getAllByRole("listitem")).toHaveLength(5);
    for (const { name } of cards)
      expect(within(accounts).getByText(name)).toBeTruthy();
    expect(within(accounts).getByText("-$123.45")).toBeTruthy();
    expect(within(accounts).getAllByText("Not shared")).toHaveLength(4);
    await shell.user.click(
      screen.getByRole("button", { name: "American Express options" }),
    );
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /^Add / })).toBeNull();
    expect(
      within(menu).getByText("Restore updates for 4 not shared"),
    ).toBeTruthy();
    expect(
      within(menu).getByText("Your accounts and history stay"),
    ).toBeTruthy();
  },
);

test("a re-shared checking account whose Plaid id changed shows as shared with its fresh balance and is not offered again", async () => {
  // After the server recognized the account by its persistent id, the mapping
  // names the new Plaid id and the old id is gone from the catalog.
  const bank: State["connections"][number] = {
    ...connection(),
    institutionName: "Chase",
    synchronizedAccountIds: ["provider-checking-reissued"],
    accountMappings: {
      "provider-checking-reissued": {
        accountId: "cash",
        startDate: "2026-10-01",
      },
    },
    accounts: [
      {
        accountId: "provider-checking-reissued",
        persistentAccountId: "persistent-checking",
        name: "Chase checking",
        officialName: null,
        mask: "1234",
        type: "depository",
        subtype: "checking",
        currentBalance: 93,
        availableBalance: 93,
        currency: "USD",
      },
    ],
  };
  const shell = await renderShell({
    seedCommands: [
      {
        type: "account.add",
        id: "add-cash",
        accountId: "cash",
        name: "Checking",
        kind: "cash",
        date: "2026-10-01",
        openingBalance: 10000,
      },
    ],
    overview: () => readyOverview({ connections: [bank] }),
  });
  await shell.user.click(screen.getByRole("button", { name: "Banks" }));
  const accounts = screen.getByRole("list", {
    name: "Chase accounts in your budget",
  });
  const row = within(accounts).getByRole("listitem");
  expect(within(row).getByText("Checking")).toBeTruthy();
  expect(within(row).getByText("$93.00")).toBeTruthy();
  expect(within(row).queryByText("Not shared")).toBeNull();
  expect(screen.queryByText(/not added/)).toBeNull();
  await shell.user.click(screen.getByRole("button", { name: "Chase options" }));
  const menu = await screen.findByRole("menu");
  expect(within(menu).queryByText(/^(Add|Review) 1 account/)).toBeNull();
  expect(within(menu).getByText("Choose shared accounts")).toBeTruthy();
});

test("a fresh bank connection can recover the existing account after Item permission is revoked", async () => {
  const account = {
    ...connection().accounts[0]!,
    accountId: "old-checking",
    name: "Discover checking",
    type: "depository",
    subtype: "checking",
    currentBalance: 1000,
    availableBalance: 1000,
  };
  const revoked: State["connections"][number] = {
    ...connection(),
    status: "revoked",
    institutionName: "Previous Discover",
    accounts: [account],
    accountMappings: {
      "old-checking": { accountId: "checking", startDate: "2026-10-01" },
    },
    synchronizedAccountIds: ["old-checking"],
  };
  const replacement: State["connections"][number] = {
    ...connection(),
    id: "replacement",
    itemId: "replacement-item",
    accounts: [{ ...account, accountId: "new-checking" }],
    synchronizedAccountIds: ["new-checking"],
  };
  const setup =
    vi.fn<(input: RouterInputs["budget"]["setupBankAccounts"]) => void>();
  const shell = await renderShell({
    overview: () => readyOverview({ connections: [revoked, replacement] }),
    setupBankAccounts: (input, server) => {
      setup(input);
      return {
        revision: server.revision,
        changeSet: null,
        rebased: false,
        accountIds: ["checking"],
      };
    },
  });
  await shell.user.click(screen.getByRole("button", { name: "Banks" }));
  await shell.user.click(
    screen.getByRole("button", { name: "Discover options" }),
  );
  await shell.user.click(
    await screen.findByRole("menuitem", { name: /^Add 1 account/ }),
  );
  const dialog = await screen.findByRole("dialog", { name: /Discover/ });
  const existing = within(dialog).getByRole("combobox", { name: "Link to" });
  await shell.user.click(existing);
  expect(screen.getByRole("option", { name: "Checking" })).toBeTruthy();
  await shell.user.keyboard("{Escape}");
  expect(existing.textContent).toBe("Checking");
  expect(within(dialog).queryByLabelText("Import from")).toBeNull();
  const add = within(dialog).getByRole("button", { name: "Add accounts" });
  await waitFor(() => expect(add.hasAttribute("disabled")).toBe(false));
  await shell.user.click(add);
  await waitFor(() => expect(setup).toHaveBeenCalledOnce());
  expect(setup.mock.calls[0]![0].accounts).toEqual([
    {
      providerAccountId: "new-checking",
      name: "Discover checking",
      existingAccountId: "checking",
      expectedBalance: 1000,
    },
  ]);
  expect(shell.execute).not.toHaveBeenCalled();
});

test("a loan with no bank balance offers setup and asks for confirmed lender terms", async () => {
  const bank = connection();
  const setup =
    vi.fn<(input: RouterInputs["budget"]["setupBankAccounts"]) => void>();
  const shell = await renderShell({
    overview: () => readyOverview({ connections: [bank] }),
    setupBankAccounts: (input, server) => {
      setup(input);
      return {
        ...server.execute("owner", {
          clientId: "setup",
          baseRevision: input.expectedRevision,
          command: {
            type: "loan.add",
            id: input.operationId,
            loanId: "new-loan",
            categoryId: "loan-payment",
            name: input.accounts[0]!.name,
            ...input.accounts[0]!.loan!,
            effectiveDate: "2026-10-20",
          },
        }),
        accountIds: ["new-loan"],
      };
    },
  });
  await shell.user.click(screen.getByRole("button", { name: "Banks" }));
  await shell.user.click(
    screen.getByRole("button", { name: "Discover options" }),
  );
  await shell.user.click(
    await screen.findByRole("menuitem", { name: /^Add 1 account/ }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Add Discover to your budget",
  });
  expect(within(dialog).getByText(/hasn’t provided a balance/)).toBeTruthy();
  await shell.user.type(
    within(dialog).getByRole("textbox", { name: "Current principal owed" }),
    "8201.13",
  );
  await shell.user.type(
    within(dialog).getByRole("textbox", { name: "APR" }),
    "10.99",
  );
  await shell.user.type(
    within(dialog).getByRole("textbox", {
      name: "Required monthly payment",
    }),
    "498.48",
  );
  const add = within(dialog).getByRole("button", { name: "Add accounts" });
  await waitFor(() => expect(add.hasAttribute("disabled")).toBe(false));
  await shell.user.click(add);
  await waitFor(() => expect(setup).toHaveBeenCalledOnce());
  expect(setup.mock.calls[0]![0].accounts).toEqual([
    {
      providerAccountId: "loan",
      name: "Discover personal loan",
      expectedBalance: null,
      loan: {
        principal: 820_113,
        annualRateBps: 1_099,
        minimumPayment: 49_848,
        variable: false,
      },
    },
  ]);
});

test("an account missing required bank data has a review action that explains what is missing", async () => {
  const bank = connection();
  bank.accounts[0]!.type = "credit";
  bank.accounts[0]!.subtype = "credit card";
  bank.accounts[0]!.name = "Discover card";
  const shell = await renderShell({
    overview: () => readyOverview({ connections: [bank] }),
  });
  await shell.user.click(screen.getByRole("button", { name: "Banks" }));
  await shell.user.click(
    screen.getByRole("button", { name: "Discover options" }),
  );
  await shell.user.click(
    await screen.findByRole("menuitem", { name: /^Review 1 account/ }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Add Discover to your budget",
  });
  await shell.user.click(
    within(dialog).getByRole("button", {
      name: /1 account can’t be added yet/,
    }),
  );
  expect(
    within(dialog).getByText(
      "The bank hasn’t provided a current balance. Update and try again.",
    ),
  ).toBeTruthy();
});

test("a loan balance arriving during setup replaces the missing balance field", async () => {
  let bank = connection();
  const shell = await renderShell({
    overview: () => readyOverview({ connections: [bank] }),
    sync: (server) => {
      bank = {
        ...bank,
        accounts: bank.accounts.map((account) => ({
          ...account,
          currentBalance: 123.45,
        })),
      };
      return {
        imported: 0,
        updated: 0,
        revision: server.revision,
        changeSet: null,
        rebased: false,
      };
    },
  });
  await shell.user.click(screen.getByRole("button", { name: "Banks" }));
  await shell.user.click(
    screen.getByRole("button", { name: "Discover options" }),
  );
  await shell.user.click(
    await screen.findByRole("menuitem", { name: /^Add 1 account/ }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Add Discover to your budget",
  });
  await within(dialog).findByText(
    "Confirm the APR and required payment with your lender.",
  );
  expect(
    within(dialog)
      .getByRole("textbox", { name: "Current principal owed" })
      .getAttribute("value"),
  ).toBe("123.45");
});

test("a failed bank update's status names the Plaid request id for support", async () => {
  const bank = connection();
  bank.error =
    "Bank update failed. Reconnect or try again; previous records were preserved. (Plaid request id: req-7f3a)";
  const shell = await renderShell({
    overview: () => readyOverview({ connections: [bank] }),
  });
  await shell.user.click(screen.getByRole("button", { name: "Banks" }));
  await shell.user.click(
    screen.getByRole("button", { name: "Why Discover needs attention" }),
  );
  expect(
    await screen.findByText(/\(Plaid request id: req-7f3a\)/),
  ).toBeTruthy();
});
