import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Command } from "~/domain/engine";
import {
  findToast,
  findTransactionRow,
  renderShell,
  transactionRow,
} from "./shell-harness";

// Splitting a transaction across categories in the register's editor.

const categories: Command[] = [
  {
    type: "category.add",
    id: "groceries",
    categoryId: "groceries",
    name: "Groceries",
  },
  {
    type: "category.add",
    id: "household",
    categoryId: "household",
    name: "Household",
  },
];
async function newTransaction(shell: Awaited<ReturnType<typeof renderShell>>) {
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(
    screen.getByRole("button", { name: "Add transaction" }),
  );
  await shell.user.keyboard("{Escape}");
  return within(screen.getByRole("form", { name: "New transaction" }));
}

async function choose(
  shell: Awaited<ReturnType<typeof renderShell>>,
  field: HTMLElement,
  name: string,
) {
  await shell.user.click(field);
  await shell.user.type(field, name);
  await shell.user.keyboard("{Enter}");
}

test("a Costco receipt splits across Groceries and Household, and the register shows Split (2)", async () => {
  const shell = await renderShell({ seedCommands: categories });
  const form = await newTransaction(shell);
  await shell.user.type(
    form.getByLabelText("Payee", { exact: true }),
    "Costco",
  );
  await shell.user.click(form.getByRole("combobox", { name: "Category" }));
  await shell.user.click(screen.getByRole("button", { name: "Split" }));
  await shell.user.type(form.getByLabelText("Outflow", { exact: true }), "200");

  await choose(
    shell,
    form.getByRole("combobox", { name: "Line 1 category" }),
    "Groceries",
  );
  await shell.user.clear(form.getByLabelText("Line 1 outflow"));
  await shell.user.type(form.getByLabelText("Line 1 outflow"), "150");
  expect(form.getByText("Remaining $50.00")).toBeTruthy();
  await choose(
    shell,
    form.getByRole("combobox", { name: "Line 2 category" }),
    "Household",
  );
  expect(form.getByLabelText("Line 2 outflow")).toHaveProperty(
    "value",
    "50.00",
  );
  expect(form.getByText("Remaining $0.00")).toBeTruthy();
  await shell.user.click(form.getByRole("button", { name: "Save" }));

  await findToast("Added Costco");
  const saved = within(await findTransactionRow("Costco"));
  expect(saved.getByText("Split (2)", { exact: true })).toBeTruthy();
  expect(saved.getByText("$200.00", { exact: true })).toBeTruthy();
  await shell.user.keyboard("{Escape}");
  await shell.user.click(transactionRow("Costco"));
  await shell.user.keyboard("e");
  const reopened = within(
    screen.getByRole("form", { name: "Edit transaction" }),
  );
  expect(
    reopened.getByRole("combobox", { name: "Line 1 category" }),
  ).toHaveProperty("value", "Groceries");
  expect(reopened.getByLabelText("Line 1 outflow")).toHaveProperty(
    "value",
    "150.00",
  );
  expect(
    reopened.getByRole("combobox", { name: "Line 2 category" }),
  ).toHaveProperty("value", "Household");
  expect(reopened.getByLabelText("Line 2 outflow")).toHaveProperty(
    "value",
    "50.00",
  );
});

const costcoSplit: Command = {
  type: "transaction.upsert",
  id: "costco",
  transactionId: "costco",
  accountId: "checking",
  date: "2026-10-10",
  payee: "Costco",
  amount: -20_000,
  lines: [
    { lineId: "food", categoryId: "groceries", amount: -15_000 },
    { lineId: "paper", categoryId: "household", amount: -5_000 },
  ],
};

test("the category footer Split button is reachable with Tab and activates with Enter", async () => {
  const shell = await renderShell({ seedCommands: categories });
  const form = await newTransaction(shell);
  await shell.user.click(form.getByRole("combobox", { name: "Category" }));
  await shell.user.tab();
  expect(screen.getByRole("button", { name: "Split" })).toBe(
    document.activeElement,
  );
  await shell.user.keyboard("{Enter}");
  expect(form.getByRole("combobox", { name: "Line 1 category" })).toBeTruthy();
  expect(form.getByLabelText("Outflow", { exact: true })).toBe(
    document.activeElement,
  );
  expect(shell.execute).not.toHaveBeenCalled();
});

test("a saved split opens with its lines, and removing one leaves a single-category transaction", async () => {
  const shell = await renderShell({
    seedCommands: [...categories, costcoSplit],
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(transactionRow("Costco"));
  await shell.user.keyboard("e");
  const form = within(screen.getByRole("form", { name: "Edit transaction" }));
  expect(form.getByRole("combobox", { name: "Category" })).toHaveProperty(
    "value",
    "Split",
  );
  expect(
    form.getByRole("combobox", { name: "Line 1 category" }),
  ).toHaveProperty("value", "Groceries");
  expect(form.getByLabelText("Line 2 outflow")).toHaveProperty(
    "value",
    "50.00",
  );

  await shell.user.click(form.getByRole("button", { name: "Remove line 1" }));
  expect(form.queryByRole("combobox", { name: "Line 1 category" })).toBeNull();
  expect(form.getByRole("combobox", { name: "Category" })).toHaveProperty(
    "value",
    "Household",
  );
  await shell.user.click(form.getByRole("button", { name: "Save" }));
  await findToast("Saved Costco");
  const saved = within(await findTransactionRow("Costco"));
  expect(saved.getByText("Household", { exact: true })).toBeTruthy();
  expect(saved.getByText("$200.00", { exact: true })).toBeTruthy();
  expect(saved.queryByText("Split (2)")).toBeNull();
  await shell.user.keyboard("{Escape}");
  await shell.user.click(transactionRow("Costco"));
  await shell.user.keyboard("e");
  const reopened = within(
    screen.getByRole("form", { name: "Edit transaction" }),
  );
  expect(reopened.getByRole("combobox", { name: "Category" })).toHaveProperty(
    "value",
    "Household",
  );
  expect(
    reopened.queryByRole("combobox", { name: "Line 1 category" }),
  ).toBeNull();
});

test("a split that leaves part of the amount unsplit doesn't save, and Add line takes what's left", async () => {
  const shell = await renderShell({
    seedCommands: [...categories, costcoSplit],
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(transactionRow("Costco"));
  await shell.user.keyboard("e");
  const form = within(screen.getByRole("form", { name: "Edit transaction" }));
  await shell.user.clear(form.getByLabelText("Outflow", { exact: true }));
  await shell.user.type(form.getByLabelText("Outflow", { exact: true }), "230");
  expect(form.getByText("Remaining $30.00")).toBeTruthy();
  await shell.user.click(form.getByRole("button", { name: "Save" }));
  expect(
    form.getByText(
      "Split the whole amount: the lines must add up to the total.",
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByRole("link", { name: /^Checking/ })).getByText(
      "$800.00",
    ),
  ).toBeTruthy();

  await shell.user.click(form.getByRole("button", { name: "Add line" }));
  expect(form.getByRole("combobox", { name: "Line 3 category" })).toBe(
    document.activeElement,
  );
  expect(form.getByLabelText("Line 3 outflow")).toHaveProperty(
    "value",
    "30.00",
  );
  expect(form.getByText("Remaining $0.00")).toBeTruthy();
  expect(
    form.queryByText(
      "Split the whole amount: the lines must add up to the total.",
    ),
  ).toBeNull();
  await shell.user.keyboard("Groceries{Enter}");
  await shell.user.click(form.getByRole("button", { name: "Save" }));
  await findToast("Saved Costco");
  const saved = within(await findTransactionRow("Costco"));
  expect(saved.getByText("Split (3)", { exact: true })).toBeTruthy();
  expect(saved.getByText("$230.00", { exact: true })).toBeTruthy();
  await shell.user.keyboard("{Escape}");
  await shell.user.click(transactionRow("Costco"));
  await shell.user.keyboard("e");
  const reopened = within(
    screen.getByRole("form", { name: "Edit transaction" }),
  );
  expect(reopened.getByLabelText("Line 1 outflow")).toHaveProperty(
    "value",
    "150.00",
  );
  expect(reopened.getByLabelText("Line 2 outflow")).toHaveProperty(
    "value",
    "50.00",
  );
  expect(
    reopened.getByRole("combobox", { name: "Line 3 category" }),
  ).toHaveProperty("value", "Groceries");
  expect(reopened.getByLabelText("Line 3 outflow")).toHaveProperty(
    "value",
    "30.00",
  );
});
