import { screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Command } from "~/domain/engine";
import { renderShell, sent } from "./shell-harness";

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
const register = () =>
  within(screen.getByRole("group", { name: "Transactions" }));

async function newTransaction(shell: Awaited<ReturnType<typeof renderShell>>) {
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
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
  const categoryList = screen.getByRole("listbox", { name: "Category" });
  expect(
    within(categoryList).queryByRole("option", { name: "Split" }),
  ).toBeNull();
  const splitButton = screen.getByRole("button", {
    name: "Split",
    exact: true,
  });
  expect(categoryList.contains(splitButton)).toBe(false);
  expect(
    within(screen.getByRole("dialog", { name: "Category" })).getByRole(
      "separator",
    ),
  ).toBeTruthy();
  await shell.user.click(splitButton);
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

  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  const [command] = sent(shell.execute);
  expect(command).toMatchObject({
    type: "transaction.upsert",
    amount: -20_000,
    payee: "Costco",
    categoryId: undefined,
    lines: [
      { categoryId: "groceries", amount: -15_000 },
      { categoryId: "household", amount: -5_000 },
    ],
  });
  const row = register().getByRole("button", { name: /Costco/ });
  expect(within(row).getByText("Split (2)")).toBeTruthy();
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
  expect(screen.getByRole("button", { name: "Split", exact: true })).toBe(
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
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
  await shell.user.click(register().getByRole("button", { name: /Costco/ }));
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
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(sent(shell.execute)[0]).toMatchObject({
    type: "transaction.upsert",
    transactionId: "costco",
    amount: -20_000,
    categoryId: "household",
  });
  expect(sent(shell.execute)[0]).not.toHaveProperty("lines");
});

test("a split that leaves part of the amount unsplit doesn't save, and Add line takes what's left", async () => {
  const shell = await renderShell({
    seedCommands: [...categories, costcoSplit],
  });
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
  await shell.user.click(register().getByRole("button", { name: /Costco/ }));
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
  expect(shell.execute).not.toHaveBeenCalled();

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
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(sent(shell.execute)[0]).toMatchObject({
    amount: -23_000,
    lines: [
      { lineId: "food", categoryId: "groceries", amount: -15_000 },
      { lineId: "paper", categoryId: "household", amount: -5_000 },
      { categoryId: "groceries", amount: -3_000 },
    ],
  });
});
