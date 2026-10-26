import { screen, waitFor, within } from "@testing-library/react";
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
    eligibility: "eligible",
    ...extra,
  };
}

test.each([
  { source: "manual", status: "pending" },
  { source: "manual", status: "posted" },
  { source: "bank", status: "pending" },
  { source: "bank", status: "posted" },
] as const)(
  "a $status $source purchase offers its review actions and saves through the row editor",
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
    expect(Boolean(actions.queryByRole("button", { name: /^Approve/ }))).toBe(
      source === "bank" && status === "posted",
    );
    expect(actions.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(actions.getByRole("button", { name: "Categorize" })).toBeTruthy();
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
        {
          type: "category.add",
          id: "food",
          categoryId: "food",
          name: "Food",
          group: "Everyday",
        },
        {
          type: "transaction.upsert",
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
      await shell.user.click(
        screen.getByRole("menuitem", { name: "Everyday" }),
      );
      expect(screen.getByRole("menuitem", { name: "Food" })).toBeTruthy();
      await shell.user.keyboard("{ArrowRight}{End}{Enter}");
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

test("the existing Approve action reviews posted bank imports alongside recorded transactions", async () => {
  let imports = [bankImport({ categoryId: "gifts" })];
  const shell = await renderShell({
    seedCommands: [
      {
        type: "transaction.upsert",
        id: "market",
        transactionId: "market",
        accountId: "checking",
        date: "2026-10-10",
        payee: "Market",
        amount: -1000,
        categoryId: "gifts",
        reviewed: false,
      },
    ],
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
  for (const payee of ["Coffee", "Market"])
    await shell.user.click(
      screen.getByRole("checkbox", { name: `Select ${payee}` }),
    );
  await shell.user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Approve (2)" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull(),
  );
  await shell.reload();
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  for (const payee of ["Coffee", "Market"]) {
    const row = within(await findTransactionRow(payee));
    expect(row.getByText("Gifts", { exact: true })).toBeTruthy();
    expect(row.getByLabelText("Cleared")).toBeTruthy();
    await shell.user.click(
      screen.getByRole("checkbox", { name: `Select ${payee}` }),
    );
  }
  const actions = within(
    screen.getByRole("toolbar", { name: "Selected transactions" }),
  );
  expect(
    actions.queryByRole("button", { name: /^Approve|^Reject$/ }),
  ).toBeNull();
});

test("pending imports offer Enter now instead of Approve and stay pending after reload", async () => {
  let imports = [
    bankImport({ pending: true }),
    bankImport({ logicalId: "posted", payee: "Posted lunch" }),
  ];
  const shell = await renderShell({
    overview: () => readyOverview({ imports }),
    resolveImport: (input, server) => {
      const saved = server.execute("owner", {
        command: input.command!,
        baseRevision: input.expectedRevision,
        clientId: "import",
      });
      imports = imports.filter((item) => item.logicalId !== input.logicalId);
      return { ...saved, resolved: true };
    },
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Coffee" }),
  );
  const actions = within(
    screen.getByRole("toolbar", { name: "Selected transactions" }),
  );
  expect(actions.queryByRole("button", { name: /^Approve/ })).toBeNull();
  expect(actions.getByRole("button", { name: "Reject" })).toBeTruthy();
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Posted lunch" }),
  );
  expect(actions.queryByRole("button", { name: /^Enter now/ })).toBeNull();
  await shell.user.click(actions.getByRole("button", { name: "Approve (1)" }));
  await findToast("Approved Posted lunch");
  expect(
    screen
      .getByRole("checkbox", { name: "Select Coffee" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(actions.queryByRole("button", { name: /^Approve/ })).toBeNull();
  await shell.user.click(
    actions.getByRole("button", { name: "Enter now (1)" }),
  );
  await findToast("Entered Coffee");
  await shell.reload();
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  const row = within(await findTransactionRow("Coffee"));
  expect(row.getByLabelText("Pending")).toBeTruthy();
  expect(row.getByText("Needs category")).toBeTruthy();
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Coffee" }),
  );
  const entered = within(
    screen.getByRole("toolbar", { name: "Selected transactions" }),
  );
  expect(
    entered.queryByRole("button", { name: /^Approve|^Enter now|^Reject$/ }),
  ).toBeNull();
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Posted lunch" }),
  );
  expect(entered.queryByRole("button", { name: /^Approve/ })).toBeNull();
});

test("Reject dismisses pending and posted bank imports without recording them and keeps unselected activity", async () => {
  let imports = [
    bankImport({ pending: true }),
    bankImport({ logicalId: "posted", payee: "Posted lunch" }),
    bankImport({ logicalId: "keep", payee: "Keep this purchase" }),
  ];
  const shell = await renderShell({
    overview: () => readyOverview({ imports }),
    resolveImport: (input, server) => {
      if (!input.ignore)
        throw new Error("Reject must not record a transaction");
      imports = imports.filter((item) => item.logicalId !== input.logicalId);
      return {
        revision: server.revision,
        changeSet: null,
        rebased: false,
        resolved: true,
      };
    },
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  for (const payee of ["Coffee", "Posted lunch"])
    await shell.user.click(
      screen.getByRole("checkbox", { name: `Select ${payee}` }),
    );
  await shell.user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Reject" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("checkbox", { name: "Select Coffee" }),
    ).toBeNull(),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("checkbox", { name: "Select Posted lunch" }),
    ).toBeNull(),
  );
  await shell.reload();
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  expect(screen.queryByRole("checkbox", { name: "Select Coffee" })).toBeNull();
  expect(
    screen.queryByRole("checkbox", { name: "Select Posted lunch" }),
  ).toBeNull();
  expect(await findTransactionRow("Keep this purchase")).toBeTruthy();
});

test("Enter now retains an uncategorized pending credit-card inflow after reload", async () => {
  let imports = [
    bankImport({ accountId: "card", pending: true, amount: 2500 }),
  ];
  const shell = await renderShell({
    seedCommands: [
      {
        type: "account.add",
        id: "card",
        accountId: "card",
        name: "Card",
        kind: "credit",
        date: "2026-10-01",
        openingBalance: -5000,
      },
    ],
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
  await shell.user.click(screen.getByRole("link", { name: "All accounts" }));
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Coffee" }),
  );
  await shell.user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Enter now (1)" }),
  );
  await findToast("Entered Coffee");
  await shell.reload();
  await shell.user.click(screen.getByRole("link", { name: "All accounts" }));
  expect(
    within(await findTransactionRow("Coffee")).getByLabelText("Pending"),
  ).toBeTruthy();
  expect(
    screen.getAllByRole("checkbox", { name: "Select Coffee" }),
  ).toHaveLength(1);
});

test("bulk category menus support keyboard selection and change only the selected rows", async () => {
  const shell = await renderShell({
    seedCommands: [
      {
        type: "category.add",
        id: "food",
        categoryId: "food",
        name: "Food",
        group: "Essentials",
      },
      ...["Coffee", "Lunch", "Book"].map((payee) => ({
        type: "transaction.upsert" as const,
        id: payee,
        transactionId: payee,
        accountId: "checking",
        date: "2026-10-10",
        payee,
        amount: -500,
        categoryId: "gifts",
      })),
    ],
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Coffee" }),
  );
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Lunch" }),
  );
  const trigger = screen.getByRole("button", {
    name: "Categorize",
  });
  await shell.user.click(trigger);
  await shell.user.keyboard("{Escape}");
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  await shell.user.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(
    screen.getByRole("menuitem", { name: "Everyday" }),
  );
  await shell.user.keyboard("{ArrowDown}");
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Essentials" }),
    ),
  );
  await shell.user.keyboard("{ArrowRight}");
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "Food" }),
    ),
  );
  await shell.user.keyboard("{Enter}");
  await findToast("Categorized 2 transactions");
  for (const payee of ["Coffee", "Lunch"])
    expect(
      within(await findTransactionRow(payee)).getByText("Food", {
        exact: true,
      }),
    ).toBeTruthy();
  expect(
    within(transactionRow("Book")).getByText("Gifts", { exact: true }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("menu", { name: "Categorize transactions" }),
  ).toBeNull();
});

test("mixed selections keep Categorize available and change only entries that use a category", async () => {
  let imports = [bankImport({ pending: true })];
  const shell = await renderShell({
    seedCommands: [
      {
        type: "account.add",
        id: "savings",
        accountId: "savings",
        name: "Savings",
        kind: "cash",
        date: "2026-10-01",
        openingBalance: 0,
      },
      {
        type: "transaction.upsert",
        id: "transfer",
        transactionId: "transfer",
        accountId: "checking",
        transferAccountId: "savings",
        date: "2026-10-10",
        amount: -1000,
        payee: "Transfer",
        reviewed: true,
      },
    ],
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
  for (const payee of ["Coffee", "Transfer to Savings"])
    await shell.user.click(
      screen.getByRole("checkbox", { name: `Select ${payee}` }),
    );
  const actions = within(
    screen.getByRole("toolbar", { name: "Selected transactions" }),
  );
  await shell.user.click(actions.getByRole("button", { name: "Categorize" }));
  await shell.user.click(screen.getByRole("menuitem", { name: "Everyday" }));
  await shell.user.keyboard("{ArrowRight}{Home}{Enter}");
  await findToast("Categorized 1 transaction");
  expect(
    screen
      .getByRole("checkbox", { name: "Select Transfer to Savings" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  await shell.reload();
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  expect(
    within(await findTransactionRow("Coffee")).getByText("Gifts", {
      exact: true,
    }),
  ).toBeTruthy();
  expect(
    within(transactionRow("Transfer to Savings")).getByText(
      "Category not needed",
      { exact: true },
    ),
  ).toBeTruthy();
  await shell.user.click(screen.getByRole("link", { name: /^Savings/ }));
  expect(
    within(await findTransactionRow("Transfer from Checking")).getByText(
      "Category not needed",
      { exact: true },
    ),
  ).toBeTruthy();
});

test("bulk categorization records pending and posted imports with selected transactions and survives reload", async () => {
  let imports = [
    bankImport({
      logicalId: "coffee",
      payee: "Imported coffee",
      pending: true,
    }),
    bankImport({ logicalId: "lunch", payee: "Imported lunch", amount: -1500 }),
    bankImport({ logicalId: "book", payee: "Unselected book", amount: -900 }),
  ];
  const shell = await renderShell({
    seedCommands: [
      { type: "category.add", id: "food", categoryId: "food", name: "Food" },
      {
        type: "transaction.upsert",
        id: "market",
        transactionId: "market",
        accountId: "checking",
        date: "2026-10-10",
        payee: "Market",
        amount: -1000,
        categoryId: "food",
      },
    ],
    overview: () => readyOverview({ imports }),
    resolveImport: (input, server) => {
      const saved = server.execute("owner", {
        command: input.command!,
        baseRevision: input.expectedRevision,
        clientId: "import",
      });
      imports = imports.filter((item) => item.logicalId !== input.logicalId);
      return { ...saved, resolved: true };
    },
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  for (const payee of ["Imported coffee", "Imported lunch", "Market"])
    await shell.user.click(
      screen.getByRole("checkbox", { name: `Select ${payee}` }),
    );
  await shell.user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Categorize" }),
  );
  await shell.user.click(screen.getByRole("menuitem", { name: "Everyday" }));
  await shell.user.keyboard("{ArrowRight}{Home}{Enter}");
  await findToast("Categorized 3 transactions");
  await shell.reload();
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  for (const payee of ["Imported coffee", "Imported lunch", "Market"]) {
    expect(
      within(await findTransactionRow(payee)).getByText("Gifts", {
        exact: true,
      }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("checkbox", { name: `Select ${payee}` }),
    ).toHaveLength(1);
  }
  expect(
    within(transactionRow("Imported coffee")).getByLabelText("Pending"),
  ).toBeTruthy();
  expect(
    within(transactionRow("Imported lunch")).getByLabelText("Cleared"),
  ).toBeTruthy();
  expect(
    within(transactionRow("Unselected book")).getByText("Needs category"),
  ).toBeTruthy();
});
