import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { findToast, renderShell, transactionRow } from "./shell-harness";

// A figure in the account summary: Cleared + Uncleared = Working balance.
const summary = (label: string) =>
  screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;

const pendingSection = () =>
  screen.queryByRole("group", { name: "Pending transactions" });

test("unclearing a posted purchase keeps it out of Pending and moves its amount to Uncleared", async () => {
  const shell = await renderShell({
    seedCommands: [
      {
        type: "transaction.upsert",
        id: "grocer",
        transactionId: "grocer",
        accountId: "checking",
        date: "2026-10-04",
        payee: "Corner Grocer",
        amount: -4_210,
        categoryId: "gifts",
      },
    ],
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  expect(summary("Cleared")).toBe("$957.90");

  await shell.user.click(
    within(transactionRow("Corner Grocer").parentElement!).getByRole("button", {
      name: "Mark uncleared",
    }),
  );
  await findToast("Marked Corner Grocer uncleared");
  expect(
    await within(transactionRow("Corner Grocer")).findByLabelText("Uncleared"),
  ).toBeTruthy();
  expect(pendingSection()).toBeNull();
  expect(summary("Cleared")).toBe("$1,000.00");
  expect(summary("Uncleared")).toBe("-$42.10");
  expect(summary("Working balance")).toBe("$957.90");
});

test("clearing an entered pending deposit counts it in the balance, and unclearing brings back its clock", async () => {
  const shell = await renderShell({
    seedCommands: [
      {
        type: "transaction.upsert",
        id: "payroll",
        transactionId: "payroll",
        accountId: "checking",
        date: "2026-10-17",
        payee: "Payroll",
        amount: 325_000,
        status: "pending",
      },
    ],
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  expect(
    within(transactionRow("Payroll")).getByLabelText("Pending"),
  ).toBeTruthy();
  expect(summary("Working balance")).toBe("$1,000.00");

  await shell.user.click(
    within(transactionRow("Payroll").parentElement!).getByRole("button", {
      name: "Mark cleared",
    }),
  );
  await findToast("Marked Payroll cleared");
  expect(
    await within(transactionRow("Payroll")).findByLabelText("Cleared"),
  ).toBeTruthy();
  expect(summary("Cleared")).toBe("$4,250.00");
  expect(summary("Working balance")).toBe("$4,250.00");

  await shell.user.click(
    within(transactionRow("Payroll").parentElement!).getByRole("button", {
      name: "Mark uncleared",
    }),
  );
  await findToast("Marked Payroll uncleared");
  expect(
    await within(transactionRow("Payroll")).findByLabelText("Pending"),
  ).toBeTruthy();
  expect(summary("Working balance")).toBe("$1,000.00");
});

test("reconciling says it locks the cleared transactions, not every posted one", async () => {
  const purchase = (id: string, payee: string, cleared: boolean) => ({
    type: "transaction.upsert" as const,
    id,
    transactionId: id,
    accountId: "checking",
    date: "2026-10-04",
    payee,
    amount: -1_000,
    categoryId: "gifts",
    cleared,
  });
  const shell = await renderShell({
    seedCommands: [
      purchase("grocer", "Corner Grocer", true),
      purchase("bakery", "Bakery", false),
    ],
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(screen.getByRole("button", { name: "Reconcile" }));
  await shell.user.click(
    screen.getByRole("button", { name: "No, enter bank balance" }),
  );
  await shell.user.type(
    screen.getByLabelText("Current balance at your bank"),
    summary("Cleared")!.replace("$", ""),
  );
  await shell.user.click(screen.getByRole("button", { name: "Next" }));
  const result = await screen.findByRole("form", { name: "Reconcile result" });
  expect(result.textContent).toContain("They match.");
  const locked = Number(/locks (\d+) cleared/.exec(result.textContent)![1]);

  await shell.user.click(screen.getByRole("button", { name: "Finish" }));
  await findToast("Reconciled Checking");
  expect(await screen.findAllByLabelText("Reconciled")).toHaveLength(locked);
  expect(
    within(transactionRow("Bakery")).getByLabelText("Uncleared"),
  ).toBeTruthy();
});
