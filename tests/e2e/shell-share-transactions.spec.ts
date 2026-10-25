import { expect, test, shellPath } from "./shell-fixture";
import {
  accountBalance,
  available,
  openRegister,
  reloadBudget,
  saved,
  transactionRow,
  transactions,
} from "./shell-controls";

const cases = [
  {
    entry: "island",
    multiple: false,
    full: true,
    available: "$200.00",
    total: "$25.01",
  },
  {
    entry: "island",
    multiple: false,
    full: false,
    available: "$181.24",
    total: "$6.25",
  },
  {
    entry: "island",
    multiple: true,
    full: true,
    available: "$200.00",
    total: "$40.04",
  },
  {
    entry: "island",
    multiple: true,
    full: false,
    available: "$172.46",
    total: "$12.50",
  },
  {
    entry: "row",
    multiple: false,
    full: true,
    available: "$200.00",
    total: "$25.01",
  },
  {
    entry: "row",
    multiple: false,
    full: false,
    available: "$181.24",
    total: "$6.25",
  },
] as const;

for (const scenario of cases) {
  test(`${scenario.entry} saves ${scenario.full ? "full reimbursements" : "partial shares"} for ${scenario.multiple ? "multiple unequal transactions" : "one uncategorized transaction"} after reload`, async ({
    page,
    budgets,
  }) => {
    const purchases = [
      { payee: "Coffee for Mom", amount: 2501 },
      ...(scenario.multiple ? [{ payee: "Lunch for Mom", amount: 1503 }] : []),
    ];
    const budget = await budgets.create({ uncategorizedPurchases: purchases });
    await page.goto(shellPath);
    await budgets.signIn(page, budget);
    await openRegister(page, budget.account);
    for (const purchase of purchases)
      await expect(transactionRow(page, purchase.payee)).toContainText(
        "Needs category",
      );

    if (scenario.entry === "island") {
      for (const purchase of purchases)
        await page
          .getByRole("checkbox", {
            name: `Select ${purchase.payee}`,
            exact: true,
          })
          .check();
      await page
        .getByRole("toolbar", { name: "Selected transactions" })
        .getByRole("button", { name: "Share", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Share Coffee for Mom", exact: true })
        .click();
    }
    const popover = page.getByRole("dialog", {
      name:
        scenario.entry === "island"
          ? "Share selected transactions"
          : "Who this is for",
      exact: true,
    });
    await popover.getByRole("button", { name: /Someone else owes/ }).click();
    await popover.getByLabel("Who owes it", { exact: true }).fill("Mom");
    if (scenario.multiple) {
      const full = popover.getByRole("checkbox", {
        name: "Full amount of each transaction",
      });
      await expect(full).toBeChecked();
      if (!scenario.full) await full.uncheck();
    }
    if (!scenario.full)
      await popover
        .getByLabel(scenario.multiple ? "Amount each" : "Amount", {
          exact: true,
        })
        .fill("6.25");
    await popover.getByRole("button", { name: "Apply", exact: true }).click();

    if (scenario.entry === "island") {
      const confirmation = page.getByRole("form", {
        name: "Share transactions",
        exact: true,
      });
      await expect(confirmation).toContainText(`${scenario.total} shared`);
      const category = confirmation.getByRole("combobox", {
        name: "Category for your portion",
      });
      const save = confirmation.getByRole("button", {
        name: `Share ${purchases.length} ${scenario.multiple ? "transactions" : "transaction"}`,
        exact: true,
      });
      if (scenario.full) {
        await expect(category).toHaveCount(0);
      } else {
        await expect(save).toBeDisabled();
        await category.fill(budget.category);
        await category.press("Enter");
      }
      await save.click();
      await expect(confirmation).toHaveCount(0);
      await expect(
        page.getByRole("toolbar", { name: "Selected transactions" }),
      ).toHaveCount(0);
    } else if (!scenario.full) {
      const editor = page.getByRole("form", {
        name: "Edit transaction",
        exact: true,
      });
      const category = editor.getByRole("combobox", {
        name: "Category",
        exact: true,
      });
      await category.fill(budget.category);
      await category.press("Enter");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await expect(editor).toHaveCount(0);
    }
    for (const purchase of purchases) {
      const amount = scenario.full
        ? purchase.payee === "Coffee for Mom"
          ? "$25.01"
          : "$15.03"
        : "$6.25";
      await expect(
        page.getByRole("button", {
          name: `Mom's share of ${purchase.payee}: ${amount}. Change`,
          exact: true,
        }),
      ).toBeVisible();
    }

    await saved(page);

    await reloadBudget(page, budget);
    await expect(available(page, budget.category)).toHaveText(
      scenario.available,
    );
    await openRegister(page, budget.account);
    await expect(transactions(page)).toHaveCount(purchases.length);
    await expect(accountBalance(page)).toHaveText(
      scenario.multiple ? "$959.96" : "$974.99",
    );
    for (const purchase of purchases) {
      const row = transactionRow(page, purchase.payee);
      await expect(row).not.toContainText("Needs category");
      if (!scenario.full) await expect(row).toContainText(budget.category);
      const amount = scenario.full
        ? purchase.payee === "Coffee for Mom"
          ? "$25.01"
          : "$15.03"
        : "$6.25";
      await expect(
        page.getByRole("button", {
          name: `Mom's share of ${purchase.payee}: ${amount}. Change`,
          exact: true,
        }),
      ).toBeVisible();
    }
    await page
      .getByRole("navigation", { name: "Budget navigation" })
      .getByRole("link", { name: /^Reimbursements/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Reimbursements", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator("dl > div")
        .filter({ has: page.getByText("Owed to you", { exact: true }) })
        .locator("dd"),
    ).toHaveText(scenario.total);
    const ledger = page.getByRole("group", {
      name: "Reimbursements",
      exact: true,
    });
    await expect(ledger.getByRole("button")).toHaveCount(purchases.length);
    for (const purchase of purchases) {
      const amount = scenario.full
        ? purchase.payee === "Coffee for Mom"
          ? "$25.01"
          : "$15.03"
        : "$6.25";
      const row = ledger
        .getByRole("button")
        .filter({ hasText: purchase.payee });
      await expect(row.locator('[data-column="who"]')).toHaveText("Mom");
      await expect(row.locator('[data-column="amount"]')).toHaveText(
        `+${amount}`,
      );
    }
  });
}
