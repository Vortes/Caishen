import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import {
  findToast,
  findTransactionRow,
  readyOverview,
  renderShell,
  transactionRow,
  type Overview,
} from "./shell-harness";

function bankImport(
  extra: Partial<Overview["imports"][number]> = {},
): Overview["imports"][number] {
  return {
    connectionId: "bank",
    logicalId: "coffee",
    fingerprint: "a".repeat(64),
    transactionId: undefined,
    categoryId: undefined,
    categoryName: null,
    providerAccountId: "provider-checking",
    accountId: "checking",
    date: "2026-10-10",
    payee: "Coffee",
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
  { source: "manual", status: "pending" },
  { source: "manual", status: "posted" },
  { source: "bank", status: "pending" },
  { source: "bank", status: "posted" },
] as const)(
  "a $status $source purchase needs a category before approval and saves through the row editor",
  async ({ source, status }) => {
    let imports =
      source === "bank" ? [bankImport({ pending: status === "pending" })] : [];
    const shell = await renderShell({
      seedCommands:
        source === "manual"
          ? [
              {
                type: "transaction.upsert",
                id: "coffee",
                transactionId: "coffee",
                accountId: "checking",
                date: "2026-10-10",
                payee: "Coffee",
                amount: -2500,
                status,
                reviewed: false,
              },
            ]
          : [],
      overview: () => readyOverview({ imports }),
      resolveImport: (input, server) => {
        const saved = server.execute("owner", {
          command: input.command!,
          baseRevision: input.expectedRevision,
          clientId: "import",
        });
        imports = [];
        return { ...saved, resolved: true };
      },
    });
    await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
    await shell.user.click(transactionRow("Coffee"));
    const actions = within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    );
    expect(actions.queryByRole("button", { name: /^Approve/ })).toBeNull();
    expect(Boolean(actions.queryByRole("button", { name: "Reject" }))).toBe(
      source === "manual",
    );
    expect(Boolean(actions.queryByRole("button", { name: "Categorize" }))).toBe(
      source === "manual",
    );
    await shell.user.keyboard("e");
    const editor = within(
      screen.getByRole("form", { name: "Edit transaction" }),
    );
    await shell.user.type(
      editor.getByRole("combobox", { name: "Category" }),
      "Gifts{Enter}",
    );
    await shell.user.click(editor.getByRole("button", { name: "Save" }));
    await findToast("Saved Coffee");
    const saved = within(await findTransactionRow("Coffee"));
    expect(saved.getByText("Gifts", { exact: true })).toBeTruthy();
    expect(
      saved.getByLabelText(status === "pending" ? "Pending" : "Cleared"),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("checkbox", { name: "Select Coffee" }),
    ).toHaveLength(1);
    await shell.user.keyboard("{Escape}");
    await shell.user.click(transactionRow("Coffee"));
    const savedActions = within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    );
    expect(
      savedActions.getByRole("button", { name: "Categorize" }),
    ).toBeTruthy();
    if (source === "manual") {
      await shell.user.click(
        savedActions.getByRole("button", { name: "Approve (1)" }),
      );
      await findToast("Marked 1 transaction reviewed");
    }
    expect(
      savedActions.queryAllByRole("button", { name: /^Approve|^Reject$/ }),
    ).toHaveLength(0);
  },
);

test.each(["manual", "bank"] as const)(
  "keyboard editing a %s purchase waits until it is the only selected row",
  async (source) => {
    const shell = await renderShell({
      seedCommands: [
        {
          type: "transaction.upsert",
          id: "market",
          transactionId: "market",
          accountId: "checking",
          date: "2026-10-10",
          payee: "Market",
          amount: -5000,
          categoryId: "gifts",
        },
        ...(source === "manual"
          ? [
              {
                type: "transaction.upsert" as const,
                id: "coffee",
                transactionId: "coffee",
                accountId: "checking",
                date: "2026-10-10",
                payee: "Coffee",
                amount: -2500,
                categoryId: "gifts",
              },
            ]
          : []),
      ],
      overview: () =>
        readyOverview({ imports: source === "bank" ? [bankImport()] : [] }),
    });
    await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
    await shell.user.click(transactionRow("Coffee"));
    await shell.user.click(
      screen.getByRole("checkbox", { name: "Select Market" }),
    );
    await shell.user.keyboard("e");
    expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
    await shell.user.click(
      screen.getByRole("checkbox", { name: "Select Market" }),
    );
    await shell.user.keyboard("e");
    expect(
      within(
        screen.getByRole("form", { name: "Edit transaction" }),
      ).getByLabelText("Payee", { exact: true }),
    ).toHaveProperty("value", "Coffee");
  },
);

test.each([
  { reason: "unmapped account", extra: { accountId: null } },
  { reason: "unavailable account", extra: { accountId: "deleted-account" } },
  { reason: "removed import", extra: { removed: true } },
  { reason: "quarantined import", extra: { quarantined: true } },
  { reason: "already linked import", extra: { transactionId: "existing" } },
])(
  "an import with an $reason does not offer selection, editing, or sharing",
  async ({ extra }) => {
    const shell = await renderShell({
      overview: () => readyOverview({ imports: [bankImport(extra)] }),
    });
    await shell.user.click(screen.getByRole("link", { name: "All accounts" }));
    expect(
      screen.queryByRole("checkbox", { name: "Select Coffee" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Share Coffee" })).toBeNull();
    await shell.user.click(transactionRow("Coffee"));
    await shell.user.keyboard("e");
    expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
    expect(
      screen.queryByRole("toolbar", { name: "Selected transactions" }),
    ).toBeNull();
  },
);

test.each([
  { kind: "cash", accountName: "Savings" },
  { kind: "tracking", accountName: "Brokerage" },
] as const)(
  "a transfer into $accountName offers supported actions and updates both rows",
  async ({ kind, accountName }) => {
    const shell = await renderShell({
      seedCommands: [
        {
          type: "account.add",
          id: "destination",
          accountId: "destination",
          name: accountName,
          kind,
          openingBalance: 0,
          date: "2026-10-01",
        },
        { type: "category.add", id: "food", categoryId: "food", name: "Food" },
        {
          type: "transaction.save",
          id: "transfer",
          transactionId: "transfer",
          accountId: "checking",
          transferAccountId: "destination",
          date: "2026-10-10",
          amount: -2500,
          payee: "Transfer",
          categoryId: kind === "tracking" ? "gifts" : undefined,
          reviewed: false,
        },
      ],
    });
    await shell.user.click(
      within(
        screen.getByRole("navigation", { name: "Budget navigation" }),
      ).getByRole("link", { name: new RegExp(`^${accountName}`) }),
    );
    await shell.user.click(transactionRow("Transfer from Checking"));
    const actions = within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    );
    if (kind === "tracking") {
      await shell.user.click(
        actions.getByRole("button", { name: "Categorize" }),
      );
      const form = within(
        screen.getByRole("form", { name: "Categorize transactions" }),
      );
      await shell.user.type(
        form.getByRole("combobox", { name: "Category" }),
        "Food{Enter}",
      );
      await shell.user.click(form.getByRole("button", { name: "Apply" }));
      await findToast("Categorized 1 transaction");
      expect(
        within(await findTransactionRow("Transfer from Checking")).getByText(
          "Food",
          { exact: true },
        ),
      ).toBeTruthy();
    } else {
      expect(actions.queryByRole("button", { name: "Categorize" })).toBeNull();
      await shell.user.click(
        actions.getByRole("button", { name: "Approve (1)" }),
      );
      await findToast("Marked 1 transaction reviewed");
    }
    await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
    const sentPayee = `Transfer to ${accountName}`;
    await shell.user.click(transactionRow(sentPayee));
    expect(
      within(transactionRow(sentPayee)).getByText(
        kind === "tracking" ? "Food" : "Category not needed",
        { exact: true },
      ),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole("toolbar", { name: "Selected transactions" }),
      ).queryAllByRole("button", { name: /^Approve|^Reject$/ }),
    ).toHaveLength(0);
  },
);

test.each([true, false])(
  "Shift-click includes an editable bank import (pending: %s) and skips blocked imports",
  async (pending) => {
    const shell = await renderShell({
      seedCommands: [
        {
          type: "transaction.upsert",
          id: "market",
          transactionId: "market",
          accountId: "checking",
          date: "2026-10-12",
          payee: "Market",
          amount: -5000,
          categoryId: "gifts",
        },
        {
          type: "transaction.upsert",
          id: "bakery",
          transactionId: "bakery",
          accountId: "checking",
          date: "2026-10-10",
          payee: "Bakery",
          amount: -1500,
          categoryId: "gifts",
        },
      ],
      overview: () =>
        readyOverview({
          imports: [
            bankImport({ date: "2026-10-11", pending }),
            bankImport({
              logicalId: "removed",
              payee: "Removed import",
              date: "2026-10-11",
              removed: true,
            }),
          ],
        }),
    });
    await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
    await shell.user.click(transactionRow(pending ? "Coffee" : "Market"));
    await shell.user.keyboard("{Shift>}");
    await shell.user.click(transactionRow("Bakery"));
    await shell.user.keyboard("{/Shift}");
    for (const payee of ["Coffee", "Market", "Bakery"]) {
      expect(
        screen
          .getByRole("checkbox", { name: `Select ${payee}` })
          .getAttribute("aria-checked"),
      ).toBe("true");
    }
    expect(
      screen.queryByRole("checkbox", { name: "Select Removed import" }),
    ).toBeNull();
    expect(
      within(
        screen.getByRole("toolbar", { name: "Selected transactions" }),
      ).getByText("3 transactions"),
    ).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
  },
);
