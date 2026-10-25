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

test("a partial bank response keeps all mapped cards visible and refreshes only the returned card", async () => {
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
  expect(within(accounts).getAllByText("Not currently shared")).toHaveLength(4);
  expect(screen.queryByRole("button", { name: "Add accounts" })).toBeNull();
  expect(
    screen.getByText(/Your saved accounts and history are kept/),
  ).toBeTruthy();
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
  await shell.user.click(screen.getByRole("button", { name: "Add accounts" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Add Discover to your budget",
  });
  expect(within(dialog).getByText(/hasn’t provided a balance/)).toBeTruthy();
  await shell.user.type(
    within(dialog).getByRole("spinbutton", { name: "Current principal owed" }),
    "8201.13",
  );
  await shell.user.type(
    within(dialog).getByRole("spinbutton", { name: "APR (%)" }),
    "10.99",
  );
  await shell.user.type(
    within(dialog).getByRole("spinbutton", {
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
    screen.getByRole("button", { name: "Review accounts" }),
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
  await shell.user.click(screen.getByRole("button", { name: "Add accounts" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Add Discover to your budget",
  });
  await within(dialog).findByText(
    "Confirm the APR and required payment with your lender.",
  );
  expect(
    within(dialog)
      .getByRole("spinbutton", { name: "Current principal owed" })
      .getAttribute("value"),
  ).toBe("123.45");
});
