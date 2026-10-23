import { act, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { addMember, withCounterpartyAccounts } from "~/domain/engine";
import { SyncError } from "~/components/sync/transport";
import {
  budgetFixture,
  deferred,
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
    eligibility: "eligible",
    ...extra,
  };
}

test("sharing previews the whole selection before the server answers and restores only a refused import", async () => {
  const sending = deferred<void>();
  let refuse = true;
  let imports = [
    bankImport("coffee", "Imported coffee", { amount: -2501 }),
    bankImport("lunch", "Imported lunch", { amount: -1501 }),
  ];
  const { user } = await renderShell({
    book: withCounterpartyAccounts(
      budgetFixture({
        seedCommands: [
          {
            type: "transaction.upsert",
            id: "market",
            transactionId: "market",
            accountId: "checking",
            date: "2026-10-12",
            payee: "Market",
            amount: -1000,
            status: "posted",
          },
        ],
      }),
    ),
    overview: () => readyOverview({ imports }),
    execute: async (input, server) => {
      await sending.promise;
      return server.execute("owner", input);
    },
    resolveImport: (input, server) => {
      if (input.logicalId === "coffee" && refuse) {
        refuse = false;
        throw new SyncError(
          "rejected",
          "Your bank updated Imported coffee. Reopen Share before saving.",
        );
      }
      const result = server.execute("owner", {
        command: input.command!,
        baseRevision: input.expectedRevision,
        clientId: "import",
      });
      imports = imports.filter((item) => item.logicalId !== input.logicalId);
      return { ...result, resolved: true };
    },
  });
  await user.click(screen.getByRole("button", { name: "All accounts" }));
  for (const payee of ["Market", "Imported coffee", "Imported lunch"])
    await user.click(screen.getByRole("checkbox", { name: `Select ${payee}` }));
  await user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Share" }),
  );
  await user.click(screen.getByRole("button", { name: /Someone else owes/ }));
  await user.type(screen.getByLabelText("Who owes it"), "Mom");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await user.click(
    screen.getByRole("button", { name: "Share 3 transactions" }),
  );
  expect(screen.queryByRole("form", { name: "Share transactions" })).toBeNull();
  for (const [payee, amount] of [
    ["Market", "$10.00"],
    ["Imported coffee", "$25.01"],
    ["Imported lunch", "$15.01"],
  ]) {
    expect(
      screen.getByRole("button", {
        name: `Mom's share of ${payee}: ${amount}. Change`,
      }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("checkbox", { name: `Select ${payee}` }),
    ).toHaveLength(1);
  }
  expect(
    screen.queryByRole("toolbar", { name: "Selected transactions" }),
  ).toBeNull();
  await act(async () => sending.resolve());
  await findToast(/Your bank updated Imported coffee/);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", {
        name: "Mom's share of Imported coffee: $25.01. Change",
      }),
    ).toBeNull(),
  );
  expect(
    screen
      .getByRole("checkbox", { name: "Select Imported coffee" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    screen
      .getByRole("checkbox", { name: "Select Imported lunch" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  expect(
    screen.getByRole("button", {
      name: "Mom's share of Market: $10.00. Change",
    }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", {
      name: "Mom's share of Imported lunch: $15.01. Change",
    }),
  ).toBeTruthy();
  await user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Share" }),
  );
  await user.click(screen.getByRole("button", { name: /Someone else owes/ }));
  await user.type(screen.getByLabelText("Who owes it"), "Mom");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await user.click(screen.getByRole("button", { name: "Share 1 transaction" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "Mom's share of Imported coffee: $25.01. Change",
      }),
    ).toBeTruthy(),
  );
  await user.click(
    within(
      screen.getByRole("navigation", { name: "Budget navigation" }),
    ).getByRole("button", { name: /^Reimbursements/ }),
  );
  expect(screen.getByText("$50.02", { selector: "dd" })).toBeTruthy();
});

test("a rejected import also rolls back edits made to its preview instead of creating an unlinked purchase", async () => {
  const sending = deferred<void>();
  const { user } = await renderShell({
    book: withCounterpartyAccounts(budgetFixture()),
    overview: () =>
      readyOverview({ imports: [bankImport("coffee", "Imported coffee")] }),
    resolveImport: async () => {
      await sending.promise;
      throw new SyncError(
        "rejected",
        "The bank changed Imported coffee. Review it before saving.",
      );
    },
  });
  await user.click(screen.getByRole("button", { name: "All accounts" }));
  await user.click(
    screen.getByRole("button", { name: "Share Imported coffee" }),
  );
  await user.click(screen.getByRole("button", { name: /Someone else owes/ }));
  await user.type(screen.getByLabelText("Who owes it"), "Mom");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  let form = within(screen.getByRole("form", { name: "Edit transaction" }));
  await user.click(form.getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
  await user.click(
    screen.getByRole("button", {
      name: "Mom's share of Imported coffee: $25.00. Change",
    }),
  );
  await user.click(screen.getByRole("button", { name: /Just mine/ }));
  form = within(screen.getByRole("form", { name: "Edit transaction" }));
  await user.clear(form.getByLabelText("Payee", { exact: true }));
  await user.type(
    form.getByLabelText("Payee", { exact: true }),
    "Personal copy",
  );
  await user.type(
    form.getByRole("combobox", { name: "Category" }),
    "Gifts{Enter}",
  );
  await user.click(form.getByRole("button", { name: "Save" }));
  expect(
    screen.getByRole("checkbox", { name: "Select Personal copy" }),
  ).toBeTruthy();
  await act(async () => sending.resolve());
  await findToast(/The bank changed Imported coffee/);
  await waitFor(() =>
    expect(
      screen.queryByRole("checkbox", { name: "Select Personal copy" }),
    ).toBeNull(),
  );
  const recovered = within(
    screen.getByRole("form", { name: "Edit transaction" }),
  );
  expect(
    recovered.getByLabelText("Payee", { exact: true }).getAttribute("value"),
  ).toBe("Imported coffee");
  await user.click(recovered.getByRole("button", { name: "Cancel" }));
  expect(
    screen.getAllByRole("checkbox", { name: "Select Imported coffee" }),
  ).toHaveLength(1);
  expect(
    within(await findTransactionRow("Imported coffee")).getByText(
      "Needs category",
    ),
  ).toBeTruthy();
});

test("the island fully reimburses unequal imports to someone else without requiring a purpose category", async () => {
  let imports = [
    bankImport("coffee", "Imported coffee", { amount: -2501 }),
    bankImport("lunch", "Imported lunch", { amount: -1501 }),
  ];
  const { user } = await renderShell({
    book: withCounterpartyAccounts(budgetFixture()),
    overview: () => readyOverview({ imports }),
    resolveImport: (input, server) => {
      const result = server.execute("owner", {
        command: input.command!,
        baseRevision: input.expectedRevision,
        clientId: "import",
      });
      imports = imports.filter((item) => item.logicalId !== input.logicalId);
      return { ...result, resolved: true };
    },
  });
  await user.click(screen.getByRole("button", { name: "All accounts" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Select Imported coffee" }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Select Imported lunch" }),
  );
  await user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Share" }),
  );
  await user.click(screen.getByRole("button", { name: /Someone else owes/ }));
  await user.type(screen.getByLabelText("Who owes it"), "Mom");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  const form = within(screen.getByRole("form", { name: "Share transactions" }));
  expect(
    form.queryByRole("combobox", { name: "Category for your portion" }),
  ).toBeNull();
  expect(form.getByText(/\$40.02 shared/)).toBeTruthy();
  await user.click(form.getByRole("button", { name: "Share 2 transactions" }));
  await waitFor(() => {
    expect(
      screen.getByRole("button", {
        name: "Mom's share of Imported coffee: $25.01. Change",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Mom's share of Imported lunch: $15.01. Change",
      }),
    ).toBeTruthy();
  });
  expect(
    within(await findTransactionRow("Imported coffee")).queryByText(
      "Needs category",
    ),
  ).toBeNull();
  expect(
    within(await findTransactionRow("Imported lunch")).queryByText(
      "Needs category",
    ),
  ).toBeNull();
});

test("the selection island splits each uncategorized import and categorizes only the personal portions", async () => {
  let imports = [
    bankImport("coffee", "Imported coffee", { amount: -2501 }),
    bankImport("lunch", "Imported lunch", { amount: -1501 }),
    bankImport("tiny", "One cent purchase", { amount: -1 }),
  ];
  const { user } = await renderShell({
    book: withCounterpartyAccounts(
      addMember(budgetFixture(), "anna", "Anna budget", "2026-10"),
    ),
    overview: () => readyOverview({ imports, partnerFirstName: "Anna" }),
    resolveImport: (input, server) => {
      const result = server.execute("owner", {
        command: input.command!,
        baseRevision: input.expectedRevision,
        clientId: "import",
      });
      imports = imports.filter((item) => item.logicalId !== input.logicalId);
      return { ...result, resolved: true };
    },
  });
  await user.click(screen.getByRole("button", { name: "All accounts" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Select Imported coffee" }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Select Imported lunch" }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Select One cent purchase" }),
  );
  await user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Share" }),
  );
  await user.click(screen.getByRole("button", { name: /Split with Anna/ }));
  const form = within(screen.getByRole("form", { name: "Share transactions" }));
  await user.type(
    form.getByRole("combobox", { name: "Category for your portion" }),
    "Gifts{Enter}",
  );
  await user.click(form.getByRole("button", { name: "Share 3 transactions" }));
  await waitFor(() => {
    expect(
      screen.getByRole("button", {
        name: "Anna's share of Imported coffee: $12.50. Change",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Anna's share of Imported lunch: $7.50. Change",
      }),
    ).toBeTruthy();
  });
  expect(
    within(await findTransactionRow("Imported coffee")).getByText("Gifts", {
      exact: true,
    }),
  ).toBeTruthy();
  expect(
    within(await findTransactionRow("Imported lunch")).getByText("Gifts", {
      exact: true,
    }),
  ).toBeTruthy();
  await user.click(
    within(
      screen.getByRole("navigation", { name: "Budget navigation" }),
    ).getByRole("button", { name: /^Anna/ }),
  );
  const ledger = within(screen.getByRole("group", { name: "Anna ledger" }));
  expect(ledger.getByText("Imported coffee", { exact: true })).toBeTruthy();
  expect(ledger.getByText("Imported lunch", { exact: true })).toBeTruthy();
});

test("a refused shared import stays selected for retry while saved rows leave the selection", async () => {
  let imports = [
    bankImport("coffee", "Imported coffee"),
    bankImport("lunch", "Imported lunch"),
  ];
  let refuse = true;
  const { user } = await renderShell({
    book: withCounterpartyAccounts(
      addMember(budgetFixture(), "anna", "Anna budget", "2026-10"),
    ),
    overview: () => readyOverview({ imports, partnerFirstName: "Anna" }),
    resolveImport: (input, server) => {
      if (input.logicalId === "coffee" && refuse) {
        refuse = false;
        throw new SyncError(
          "rejected",
          "Your bank updated this transaction. Reopen Share before saving.",
        );
      }
      const result = server.execute("owner", {
        command: input.command!,
        baseRevision: input.expectedRevision,
        clientId: "import",
      });
      imports = imports.filter((item) => item.logicalId !== input.logicalId);
      return { ...result, resolved: true };
    },
  });
  await user.click(screen.getByRole("button", { name: "All accounts" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Select Imported coffee" }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Select Imported lunch" }),
  );
  await user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Share" }),
  );
  await user.click(screen.getByRole("button", { name: /All Anna's/ }));
  await user.click(
    within(screen.getByRole("form", { name: "Share transactions" })).getByRole(
      "button",
      { name: "Share 2 transactions" },
    ),
  );
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Your bank updated this transaction");
  expect(screen.queryByRole("form", { name: "Share transactions" })).toBeNull();
  expect(
    screen
      .getByRole("checkbox", { name: "Select Imported coffee" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    screen
      .getByRole("checkbox", { name: "Select Imported lunch" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  await user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Share" }),
  );
  await user.click(screen.getByRole("button", { name: /All Anna's/ }));
  const form = within(screen.getByRole("form", { name: "Share transactions" }));
  expect(
    form.queryByRole("combobox", { name: "Category for your portion" }),
  ).toBeNull();
  await user.click(form.getByRole("button", { name: "Share 1 transaction" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "Anna's share of Imported coffee: $25.00. Change",
      }),
    ).toBeTruthy(),
  );
  expect(
    screen.getAllByRole("checkbox", { name: "Select Imported lunch" }),
  ).toHaveLength(1);
});

test("sharing a saved purchase and a bank import keeps keyboard focus and needs no category for full shares", async () => {
  let imports = [bankImport("coffee", "Imported coffee", { amount: -1800 })];
  const { user } = await renderShell({
    book: withCounterpartyAccounts(
      addMember(
        budgetFixture({
          seedCommands: [
            {
              type: "transaction.upsert",
              id: "market",
              transactionId: "market",
              accountId: "checking",
              date: "2026-10-12",
              payee: "Market",
              amount: -3000,
              status: "posted",
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
  await user.click(screen.getByRole("button", { name: "All accounts" }));
  await user.click(screen.getByRole("checkbox", { name: "Select Market" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Select Imported coffee" }),
  );
  await user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Share" }),
  );
  await user.click(screen.getByRole("button", { name: /All Anna's/ }));
  const form = within(screen.getByRole("form", { name: "Share transactions" }));
  const save = form.getByRole("button", { name: "Share 2 transactions" });
  expect(document.activeElement).toBe(save);
  expect(form.queryByRole("combobox")).toBeNull();
  await user.keyboard("{Enter}");
  await waitFor(() => {
    expect(
      screen.getByRole("button", {
        name: "Anna's share of Market: $30.00. Change",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Anna's share of Imported coffee: $18.00. Change",
      }),
    ).toBeTruthy();
  });
});

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
            eligibility: "eligible",
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
