import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Command } from "~/domain/engine";
import { renderShell, transactionRow } from "./shell-harness";

// The plan's Activity amount opens the month's transactions in its category,
// as YNAB's does.

const seedCommands: Command[] = [
  {
    type: "category.add",
    id: "household",
    categoryId: "household",
    name: "Household",
  },
  {
    type: "transaction.upsert",
    id: "florist",
    transactionId: "florist",
    accountId: "checking",
    date: "2026-10-04",
    payee: "Florist",
    amount: -4_210,
    categoryId: "gifts",
  },
  {
    type: "transaction.upsert",
    id: "target",
    transactionId: "target",
    accountId: "checking",
    date: "2026-10-12",
    payee: "Target",
    amount: -9_000,
    lines: [
      { lineId: "wrap", categoryId: "gifts", amount: -1_500 },
      { lineId: "towels", categoryId: "household", amount: -7_500 },
    ],
  },
  {
    type: "transaction.upsert",
    id: "hardware",
    transactionId: "hardware",
    accountId: "checking",
    date: "2026-10-08",
    payee: "Hardware Store",
    amount: -2_000,
    categoryId: "household",
  },
];

test("Activity lists the month's transactions in the category, and each opens in its account", async () => {
  const shell = await renderShell({ seedCommands });
  await shell.user.click(
    screen.getByRole("button", {
      name: "-$57.10 activity in Gifts. Show transactions",
    }),
  );
  const popover = within(
    screen.getByRole("dialog", { name: "Gifts activity" }),
  );
  const rows = popover.getAllByRole("button");
  expect(rows.map((row) => row.textContent)).toEqual([
    "CheckingOct 12Target-$15.00",
    "CheckingOct 4Florist-$42.10",
  ]);
  expect(popover.queryByText("Hardware Store")).toBeNull();

  await shell.user.click(rows[1]!);
  expect(screen.queryByRole("dialog", { name: "Gifts activity" })).toBeNull();
  expect(transactionRow("Florist").getAttribute("aria-current")).toBe("true");
});

test("the details panel's Activity opens the same transactions, for plans too narrow to show the column", async () => {
  const shell = await renderShell({ seedCommands });
  await shell.user.click(screen.getByRole("button", { name: /^Gifts/ }));
  const details = within(
    screen.getByRole("complementary", { name: "Details" }),
  );
  await shell.user.click(
    details.getByRole("button", {
      name: "-$57.10 activity in Gifts. Show transactions",
    }),
  );
  const popover = within(
    screen.getByRole("dialog", { name: "Gifts activity" }),
  );
  expect(popover.getAllByRole("button").map((row) => row.textContent)).toEqual([
    "CheckingOct 12Target-$15.00",
    "CheckingOct 4Florist-$42.10",
  ]);
});

// A transaction opened from the plan's activity keeps a way back to the
// category it was opened from, in the register's selection island.

async function jumpToFlorist(shell: Awaited<ReturnType<typeof renderShell>>) {
  await shell.user.click(
    screen.getByRole("button", {
      name: "-$57.10 activity in Gifts. Show transactions",
    }),
  );
  await shell.user.click(
    within(screen.getByRole("dialog", { name: "Gifts activity" })).getByRole(
      "button",
      { name: /^Florist/ },
    ),
  );
}

test("Back from a transaction opened from Activity returns to its category in the plan", async () => {
  const shell = await renderShell({ seedCommands });
  await jumpToFlorist(shell);

  await shell.user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Back to Gifts in the plan" }),
  );

  expect(
    screen.getByRole("button", { name: /^Gifts/ }).getAttribute("aria-current"),
  ).toBe("true");
  expect(
    within(screen.getByRole("complementary", { name: "Details" })).getByRole(
      "button",
      {
        name: "-$57.10 activity in Gifts. Show transactions",
      },
    ),
  ).toBeTruthy();
});

test("the way back stays once the selection is cleared", async () => {
  const shell = await renderShell({ seedCommands });
  await jumpToFlorist(shell);

  await shell.user.keyboard("{Escape}");

  expect(
    screen.queryByRole("toolbar", { name: "Selected transactions" }),
  ).toBeNull();
  await shell.user.click(
    screen.getByRole("button", { name: "Back to Gifts in the plan" }),
  );
  expect(
    screen.getByRole("button", { name: /^Gifts/ }).getAttribute("aria-current"),
  ).toBe("true");
});

test("browsing away from the register forgets the way back", async () => {
  const shell = await renderShell({ seedCommands });
  await jumpToFlorist(shell);

  await shell.user.click(screen.getByRole("link", { name: /^All accounts/ }));
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));

  expect(
    screen.queryByRole("button", { name: "Back to Gifts in the plan" }),
  ).toBeNull();
});
