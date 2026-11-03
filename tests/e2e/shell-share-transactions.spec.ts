import type { Locator, Page } from "@playwright/test";
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

type Amount = "full" | "half" | "custom";

// Mom's share of each purchase, what's shared in all, and what's left in
// Groceries' $200.00 once your portions are categorized there.
const cases = [
  {
    entry: "row",
    amount: "full",
    shares: ["$25.01"],
    total: "$25.01",
    available: "$200.00",
  },
  {
    entry: "row",
    amount: "half",
    shares: ["$12.50"],
    total: "$12.50",
    available: "$187.49",
  },
  {
    entry: "row",
    amount: "custom",
    shares: ["$6.25"],
    total: "$6.25",
    available: "$181.24",
  },
  {
    entry: "island",
    amount: "full",
    shares: ["$25.01", "$15.03"],
    total: "$40.04",
    available: "$200.00",
  },
  {
    entry: "island",
    amount: "half",
    shares: ["$12.50", "$7.51"],
    total: "$20.01",
    available: "$179.97",
  },
  {
    entry: "island",
    amount: "custom",
    shares: ["$6.25", "$6.25"],
    total: "$12.50",
    available: "$172.46",
  },
] as const;

const purchases = [
  { payee: "Coffee for Mom", amount: 2501 },
  { payee: "Lunch for Mom", amount: 1503 },
];

const shareButton = (page: Page, payee: string, amount: string) =>
  page.getByRole("button", {
    name: `Mom’s share of ${payee}: ${amount}. Change`,
    exact: true,
  });

const choice: Record<Amount, RegExp> = {
  full: /^All of it/,
  half: /^Half/,
  custom: /^An amount…/,
};

// Names someone new in Who is this for, then takes an amount for them.
async function shareWithNewPerson(
  popover: Locator,
  amount: Amount,
  multiple: boolean,
) {
  await popover
    .getByRole("combobox", { name: "Who is this for", exact: true })
    .fill("Mom");
  await expect(
    popover.getByRole("option", { name: "New person “Mom”", exact: true }),
  ).toBeVisible();
  const detail = popover.getByRole("group", {
    name: "How much is for Mom",
    exact: true,
  });
  await detail.getByRole("button", { name: choice[amount] }).click();
  if (amount !== "custom") return;
  await detail
    .getByLabel(multiple ? "Mom’s share per transaction" : "Mom’s share", {
      exact: true,
    })
    .fill("6.25");
  await detail.getByRole("button", { name: "Apply", exact: true }).click();
}

async function selectAll(page: Page, payees: readonly string[]) {
  for (const payee of payees)
    await page
      .getByRole("checkbox", { name: `Select ${payee}`, exact: true })
      .check();
  await page
    .getByRole("toolbar", { name: "Selected transactions" })
    .getByRole("button", { name: "Share", exact: true })
    .click();
  return page.getByRole("dialog", {
    name: "Share selected transactions",
    exact: true,
  });
}

// The island's confirmation: what's shared, a category for your portions
// when any is left uncategorized, then Share.
async function confirmShare(
  page: Page,
  count: number,
  summary: string,
  category: string | null,
) {
  const confirmation = page.getByRole("form", {
    name: "Share transactions",
    exact: true,
  });
  await expect(confirmation).toContainText(summary);
  const field = confirmation.getByRole("combobox", {
    name: "Category for your portion",
  });
  const save = confirmation.getByRole("button", {
    name: `Share ${count} ${count === 1 ? "transaction" : "transactions"}`,
    exact: true,
  });
  if (category === null) await expect(field).toHaveCount(0);
  else {
    await expect(save).toBeDisabled();
    await field.fill(category);
    await field.press("Enter");
  }
  await save.click();
  await expect(confirmation).toHaveCount(0);
  await expect(
    page.getByRole("toolbar", { name: "Selected transactions" }),
  ).toHaveCount(0);
}

for (const scenario of cases) {
  const shared =
    scenario.entry === "row" ? purchases.slice(0, 1) : purchases.slice();
  test(`${scenario.entry === "row" ? "a row's Share" : "the selection's Share"} saves a ${scenario.amount} share with a new person for ${shared.length === 1 ? "one uncategorized transaction" : "unequal uncategorized transactions"} that survives a reload`, async ({
    page,
    budgets,
  }) => {
    const budget = await budgets.create({ uncategorizedPurchases: shared });
    await page.goto(shellPath);
    await budgets.signIn(page, budget);
    await openRegister(page, budget.account);
    for (const purchase of shared)
      await expect(transactionRow(page, purchase.payee)).toContainText(
        "Needs category",
      );

    if (scenario.entry === "island") {
      const popover = await selectAll(
        page,
        shared.map((purchase) => purchase.payee),
      );
      await shareWithNewPerson(popover, scenario.amount, true);
      await confirmShare(
        page,
        shared.length,
        `${scenario.total} shared${scenario.amount === "half" ? " · 50/50 each" : ""}`,
        scenario.amount === "full" ? null : budget.category,
      );
    } else {
      await page
        .getByRole("button", { name: "Share Coffee for Mom", exact: true })
        .click();
      await shareWithNewPerson(
        page.getByRole("dialog", { name: "Who this is for", exact: true }),
        scenario.amount,
        false,
      );
      // A share that leaves some of it yours opens the editor for its
      // category; all of it for Mom needs none.
      if (scenario.amount !== "full") {
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
    }
    for (const [index, purchase] of shared.entries())
      await expect(
        shareButton(page, purchase.payee, scenario.shares[index]!),
      ).toBeVisible();
    await saved(page);

    await reloadBudget(page, budget);
    await expect(available(page, budget.category)).toHaveText(
      scenario.available,
    );
    await openRegister(page, budget.account);
    await expect(transactions(page)).toHaveCount(shared.length);
    await expect(accountBalance(page)).toHaveText(
      shared.length === 1 ? "$974.99" : "$959.96",
    );
    for (const [index, purchase] of shared.entries()) {
      const row = transactionRow(page, purchase.payee);
      await expect(row).not.toContainText("Needs category");
      if (scenario.amount !== "full")
        await expect(row).toContainText(budget.category);
      await expect(
        shareButton(page, purchase.payee, scenario.shares[index]!),
      ).toBeVisible();
    }

    // Reopened, the picker shows the saved share as chosen for Mom.
    await shareButton(page, "Coffee for Mom", scenario.shares[0]).click();
    const picker = page.getByRole("dialog", {
      name: "Who this is for",
      exact: true,
    });
    const detail = picker.getByRole("group", {
      name: "How much is for Mom",
      exact: true,
    });
    await expect(
      detail.getByRole("button", { name: choice[scenario.amount] }),
    ).toHaveAttribute("aria-pressed", "true");
    if (scenario.amount === "custom")
      await expect(
        detail.getByLabel("Mom’s share", { exact: true }),
      ).toHaveValue("6.25");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    // Mom has her own register under People, with each share she owes.
    await page
      .getByRole("navigation", { name: "Budget navigation" })
      .getByRole("link", { name: /^Mom/ })
      .click();
    await expect(
      page
        .locator("dl > div")
        .filter({ has: page.getByText("Mom owes you", { exact: true }) })
        .locator("dd"),
    ).toHaveText(scenario.total);
    const ledger = page.getByRole("group", { name: "Mom ledger", exact: true });
    for (const [index, purchase] of shared.entries())
      await expect(
        ledger
          .locator("[data-entry-row]")
          .filter({ hasText: purchase.payee })
          .getByLabel(`${scenario.shares[index]} more owed to you`, {
            exact: true,
          }),
      ).toBeVisible();
  });
}

test("the selection's Just mine clears a mixed selection's one share, which stays cleared after a reload", async ({
  page,
  budgets,
}) => {
  const budget = await budgets.create({ uncategorizedPurchases: purchases });
  await page.goto(shellPath);
  await budgets.signIn(page, budget);
  await openRegister(page, budget.account);
  await page
    .getByRole("button", { name: "Share Coffee for Mom", exact: true })
    .click();
  await shareWithNewPerson(
    page.getByRole("dialog", { name: "Who this is for", exact: true }),
    "full",
    false,
  );
  await expect(shareButton(page, "Coffee for Mom", "$25.01")).toBeVisible();
  await saved(page);

  // One shared and one not: Mom, the only person, is highlighted, and Just
  // mine is there to clear the share.
  const popover = await selectAll(
    page,
    purchases.map((purchase) => purchase.payee),
  );
  await popover
    .getByRole("group", { name: "How much is for Mom", exact: true })
    .getByRole("button", { name: /^Just mine/ })
    .click();
  await confirmShare(page, 2, "$0.00 shared", budget.category);
  await expect(
    page.getByRole("button", { name: /^Mom’s share of/ }),
  ).toHaveCount(0);
  await saved(page);

  await reloadBudget(page, budget);
  await expect(available(page, budget.category)).toHaveText("$159.96");
  await openRegister(page, budget.account);
  for (const purchase of purchases) {
    const row = transactionRow(page, purchase.payee);
    await expect(row).toContainText(budget.category);
    await expect(
      page.getByRole("button", {
        name: `Share ${purchase.payee}`,
        exact: true,
      }),
    ).toBeAttached();
  }
  // Even with Mom, she folds under Show settled.
  const navigation = page.getByRole("navigation", {
    name: "Budget navigation",
  });
  await expect(navigation.getByRole("link", { name: /^Mom/ })).toHaveCount(0);
  await navigation
    .getByRole("button", { name: "Show settled (1)", exact: true })
    .click();
  await navigation.getByRole("link", { name: /^Mom/ }).click();
  await expect(
    page.getByText("You and Mom are even", { exact: true }),
  ).toBeVisible();
});
