import { screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Command } from "~/domain/engine";
import {
  findToast,
  findTransactionRow,
  readyOverview,
  renderShell,
  transactionRow as row,
  type Overview,
} from "./shell-harness";

// Trader Joe's, categorized as Gifts once by the owner.
const categorized: Command = {
  type: "transaction.upsert",
  id: "seed-trader-joes",
  transactionId: "trader-joes",
  accountId: "checking",
  categoryId: "gifts",
  date: "2026-10-03",
  payee: "Trader Joe’s",
  amount: -4210,
  status: "posted",
};

const bankImport = (
  logicalId: string,
  payee: string,
  amount = -3150,
): Overview["imports"][number] => ({
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
  amount,
  pending: false,
  removed: false,
  needsMatchReview: false,
  error: null,
  history: [],
  reviewEvidence: [],
  quarantined: false,
  eligibility: "eligible",
});

const editor = () =>
  within(screen.getByRole("form", { name: "Edit transaction" }));

test("a waiting bank import from a remembered payee shows and saves its remembered category", async () => {
  const shell = await renderShell({
    seedCommands: [categorized],
    overview: () =>
      readyOverview({
        imports: [
          bankImport("held-trader-joes", "Trader Joe's"),
          bankImport("corner-deli", "Corner Deli"),
        ],
      }),
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  const held = row("Trader Joe's");
  expect(within(held).getByText("Gifts")).toBeTruthy();
  expect(within(held).queryByText("Needs category")).toBeNull();
  expect(within(row("Corner Deli")).getByText("Needs category")).toBeTruthy();

  await shell.user.click(within(held).getByText("Trader Joe's"));
  await shell.user.click(within(held).getByText("Gifts"));
  expect(editor().getByLabelText("Category", { exact: true })).toHaveProperty(
    "value",
    "Gifts",
  );
  await shell.user.click(editor().getByRole("button", { name: "Save" }));
  await waitFor(() => expect(shell.resolveImport).toHaveBeenCalledTimes(1));
  expect(shell.resolveImport.mock.calls[0]![0]).toMatchObject({
    logicalId: "held-trader-joes",
    command: { payee: "Trader Joe's", categoryId: "gifts", amount: -3150 },
  });
});

const household: Command = {
  type: "category.add",
  id: "seed-household",
  categoryId: "household",
  name: "Household",
};

async function newTransaction(shell: Awaited<ReturnType<typeof renderShell>>) {
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(
    screen.getByRole("button", { name: "Add transaction" }),
  );
  await shell.user.keyboard("{Escape}");
  return within(screen.getByRole("form", { name: "New transaction" }));
}

test("a new transaction takes its payee's remembered category", async () => {
  const shell = await renderShell({ seedCommands: [categorized] });
  const form = await newTransaction(shell);
  await shell.user.type(
    form.getByLabelText("Payee", { exact: true }),
    "Trader Joe's",
  );
  expect(form.getByRole("combobox", { name: "Category" })).toHaveProperty(
    "value",
    "Gifts",
  );
  await shell.user.type(
    form.getByLabelText("Outflow", { exact: true }),
    "31.50",
  );
  await shell.user.click(form.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(shell.execute.mock.calls[0]![0].command).toMatchObject({
    payee: "Trader Joe's",
    categoryId: "gifts",
    amount: -3150,
  });
});

test("picking a remembered payee selects its whole category label for acceptance or replacement", async () => {
  const shell = await renderShell({ seedCommands: [categorized, household] });
  const form = await newTransaction(shell);
  const payee = form.getByLabelText("Payee", { exact: true });
  const category = form.getByRole("combobox", { name: "Category" });
  await shell.user.type(payee, "Trader");
  expect(document.activeElement).toBe(payee);
  await shell.user.keyboard("{ArrowDown}{Enter}");
  expect(document.activeElement).toBe(category);
  expect(category).toHaveProperty("value", "Gifts");
  expect(category).toHaveProperty("selectionStart", 0);
  expect(category).toHaveProperty("selectionEnd", 5);

  await shell.user.tab();
  expect(document.activeElement).toBe(
    form.getByLabelText("Share", { exact: true }),
  );
  await shell.user.tab();
  expect(document.activeElement).toBe(
    form.getByLabelText("Outflow", { exact: true }),
  );
  expect(category).toHaveProperty("value", "Gifts");
  await shell.user.tab({ shift: true });
  expect(document.activeElement).toBe(
    form.getByLabelText("Share", { exact: true }),
  );
  await shell.user.tab({ shift: true });
  await shell.user.keyboard("Household");
  expect(category).toHaveProperty("value", "Household");
  await shell.user.keyboard("{Enter}");
  expect(category).toHaveProperty("value", "Household");
  expect(document.activeElement).toBe(
    form.getByLabelText("Outflow", { exact: true }),
  );
  await shell.user.keyboard("31.50{Enter}");
  await findToast(/^Added Trader Joe/);
  expect(
    within(screen.getByRole("group", { name: "Transactions" })).getByRole(
      "button",
      { name: /Trader Joe.*Household.*\$31\.50/ },
    ),
  ).toBeTruthy();
});

test("a payee with no memory prefills nothing, and a category you choose stays when the payee changes", async () => {
  const shell = await renderShell({ seedCommands: [categorized, household] });
  const form = await newTransaction(shell);
  const payee = form.getByLabelText("Payee", { exact: true });
  const category = form.getByRole("combobox", { name: "Category" });
  await shell.user.type(payee, "Corner Deli");
  expect(category).toHaveProperty("value", "");
  await shell.user.clear(payee);
  await shell.user.type(payee, "Trader Joe's");
  expect(category).toHaveProperty("value", "Gifts");
  await shell.user.clear(payee);
  await shell.user.type(payee, "Corner Deli");
  expect(category).toHaveProperty("value", "");
  await shell.user.click(category);
  await shell.user.type(category, "Household");
  await shell.user.keyboard("{Enter}");
  await shell.user.clear(payee);
  await shell.user.type(payee, "Trader Joe's");
  expect(category).toHaveProperty("value", "Household");
});

test("editing a transaction never takes a remembered category", async () => {
  const shell = await renderShell({
    seedCommands: [
      categorized,
      household,
      {
        type: "transaction.upsert",
        id: "seed-deli",
        transactionId: "deli",
        accountId: "checking",
        categoryId: "household",
        date: "2026-10-05",
        payee: "Corner Deli",
        amount: -1200,
        status: "posted",
      },
    ],
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(within(row("Corner Deli")).getByText("Corner Deli"));
  await shell.user.click(within(row("Corner Deli")).getByText("Corner Deli"));
  const payee = editor().getByLabelText("Payee", { exact: true });
  await shell.user.clear(payee);
  await shell.user.type(payee, "Trader Joe's");
  expect(editor().getByRole("combobox", { name: "Category" })).toHaveProperty(
    "value",
    "Household",
  );
  await shell.user.click(editor().getByRole("button", { name: "Save" }));
  await findToast("Saved Trader Joe's");
  expect(
    within(await findTransactionRow("Trader Joe's")).getByText("Household", {
      exact: true,
    }),
  ).toBeTruthy();
});

test("Ready to Assign prefills only while the money comes in", async () => {
  const shell = await renderShell({
    seedCommands: [
      {
        type: "transaction.upsert",
        id: "seed-pay",
        transactionId: "pay",
        accountId: "checking",
        date: "2026-10-01",
        payee: "Acme Payroll",
        amount: 300_000,
        status: "posted",
      },
    ],
  });
  const form = await newTransaction(shell);
  const category = form.getByRole("combobox", { name: "Category" });
  await shell.user.type(
    form.getByLabelText("Payee", { exact: true }),
    "Acme Payroll",
  );
  expect(category).toHaveProperty("value", "Ready to Assign");
  await shell.user.type(form.getByLabelText("Outflow", { exact: true }), "20");
  expect(category).toHaveProperty("value", "");
});
