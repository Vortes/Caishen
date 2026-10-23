import { screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { addMember, withCounterpartyAccounts } from "~/domain/engine";
import {
  budgetFixture,
  findToast,
  findTransactionRow,
  readyOverview,
  renderShell,
  type Overview,
} from "./shell-harness";

function bankImport(
  logicalId: string,
  payee: string,
  extra: Partial<Overview["imports"][number]> = {},
): Overview["imports"][number] {
  return {
    connectionId: "bank",
    logicalId,
    fingerprint: logicalId.padEnd(64, "0"),
    transactionId: undefined,
    categoryId: undefined,
    categoryName: null,
    providerAccountId: "provider-checking",
    accountId: "checking",
    date: "2026-10-12",
    payee,
    amount: -2500,
    pending: false,
    removed: false,
    needsMatchReview: false,
    error: null,
    history: [],
    reviewEvidence: [],
    quarantined: false,
    ...extra,
  };
}

test.each([
  { pending: true, accountId: "checking", kind: "cash" },
  { pending: false, accountId: "checking", kind: "cash" },
  { pending: true, accountId: "card", kind: "credit" },
  { pending: false, accountId: "card", kind: "credit" },
])(
  "a bank purchase in $kind (pending: $pending) carries its chosen share into the editor and becomes one shared purchase",
  async ({ pending, accountId }) => {
    let imports = [
      bankImport("coffee", "Imported coffee", { pending, accountId }),
    ];
    const shell = await renderShell({
      book: withCounterpartyAccounts(
        addMember(
          budgetFixture({
            seedCommands: [
              {
                type: "account.add",
                id: "card",
                accountId: "card",
                name: "Card",
                kind: "credit",
                date: "2026-10-01",
                openingBalance: 0,
              },
            ],
          }),
          "anna",
          "Anna budget",
          "2026-10",
        ),
      ),
      overview: () => readyOverview({ imports, partnerFirstName: "Anna" }),
      resolveImport: (input, server) => {
        const result = server.execute("owner", {
          command: input.command!,
          baseRevision: input.expectedRevision,
          clientId: "import",
        });
        imports = [];
        return { ...result, resolved: true };
      },
    });
    await shell.user.click(
      within(
        screen.getByRole("navigation", { name: "Budget navigation" }),
      ).getByRole("button", {
        name: accountId === "card" ? /^Card/ : /^Checking/,
      }),
    );
    await shell.user.click(
      screen.getByRole("button", { name: "Share Imported coffee" }),
    );
    await shell.user.click(
      screen.getByRole("button", { name: /Split with Anna/ }),
    );

    const form = within(screen.getByRole("form", { name: "Edit transaction" }));
    expect(form.getByRole("combobox", { name: "Category" })).toBe(
      document.activeElement,
    );
    expect(form.getByRole("button", { name: "Share" }).textContent).toContain(
      "$12.50",
    );
    expect(shell.resolveImport).not.toHaveBeenCalled();
    await shell.user.type(
      form.getByRole("combobox", { name: "Category" }),
      "Gifts{Enter}",
    );
    await shell.user.click(form.getByRole("button", { name: "Save" }));
    await findToast("Saved Imported coffee");
    const saved = within(await findTransactionRow("Imported coffee"));
    expect(saved.getByText("Gifts", { exact: true })).toBeTruthy();
    expect(saved.getByLabelText(pending ? "Pending" : "Cleared")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Anna's share of Imported coffee: $12.50. Change",
        }),
      ).toBeTruthy(),
    );
    expect(
      screen.getAllByRole("checkbox", { name: "Select Imported coffee" }),
    ).toHaveLength(1);
    await shell.user.click(
      within(
        screen.getByRole("navigation", { name: "Budget navigation" }),
      ).getByRole("button", { name: /^Anna/ }),
    );
    const ledger = within(screen.getByRole("group", { name: "Anna ledger" }));
    expect(ledger.getByText("Imported coffee", { exact: true })).toBeTruthy();
    expect(
      ledger.getAllByText("$12.50", { exact: true }).length,
    ).toBeGreaterThan(0);
  },
);

test("the register offers Share for purchases and categorized refunds while blocked imports and income stay excluded", async () => {
  const shell = await renderShell({
    book: withCounterpartyAccounts(
      budgetFixture({
        seedCommands: [
          {
            type: "account.add",
            id: "tracking",
            accountId: "tracking",
            name: "Tracking",
            kind: "tracking",
            date: "2026-10-01",
            openingBalance: 0,
          },
        ],
      }),
    ),
    overview: () =>
      readyOverview({
        imports: [
          bankImport("purchase", "Uncategorized purchase"),
          bankImport("refund", "Categorized refund", {
            amount: 1500,
            categoryId: "gifts",
            categoryName: "Gifts",
          }),
          bankImport("income", "Income", { amount: 10000 }),
          bankImport("zero", "Zero amount", { amount: 0 }),
          bankImport("removed", "Removed import", { removed: true }),
          bankImport("unmapped", "Unmapped import", { accountId: null }),
          bankImport("tracking", "Tracking import", { accountId: "tracking" }),
          bankImport("quarantined", "Quarantined import", {
            quarantined: true,
          }),
          bankImport("resolved", "Resolved import", {
            transactionId: "existing",
          }),
          bankImport("error", "Errored import", {
            error: "The bank changed this transaction",
          }),
          bankImport("match", "Import awaiting a match", {
            needsMatchReview: true,
          }),
          bankImport("partner-match", "Import matching a recorded purchase", {
            partnerMatches: [
              {
                entryId: "recorded",
                date: "2026-10-12",
                payee: "Recorded purchase",
                amount: 2500,
                share: 1250,
                payeesAlike: true,
              },
            ],
          }),
        ],
      }),
  });
  await shell.user.click(screen.getByRole("button", { name: "All accounts" }));
  expect(
    screen.getByRole("button", { name: "Share Uncategorized purchase" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Share Categorized refund" }),
  ).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /^Share / })).toHaveLength(2);
});
