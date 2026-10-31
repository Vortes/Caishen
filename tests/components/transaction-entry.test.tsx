import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { SyncError } from "~/components/sync/transport";
import { execute, withCounterpartyAccounts } from "~/domain/engine";
import {
  deferred,
  findToast,
  openPurchase,
  renderShell,
  budgetFixture,
  transactionRow,
} from "./shell-harness";

test("a save closes the editor at once, and a draft the server refuses comes back", async () => {
  const gate = deferred<void>();
  const shell = await renderShell({
    execute: async (input, server) => {
      await gate.promise;
      throw new SyncError(
        "rejected",
        "This account was closed on another device.",
        server.revision,
      );
    },
  });
  const form = await openPurchase(shell.user);
  await shell.user.click(within(form).getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("form", { name: "New transaction" })).toBeNull();
  expect(screen.getByText("Market")).toBeTruthy();
  gate.resolve();

  await findToast("This account was closed on another device.");
  const restored = await screen.findByRole("form", {
    name: "New transaction",
  });
  expect(
    within(restored).getByText(
      "Not saved. Your changes are still here, so you can try again.",
    ),
  ).toBeTruthy();
  expect(
    within(restored).getByLabelText("Payee", { exact: true }),
  ).toHaveProperty("value", "Market");
  expect(
    within(restored).getByLabelText("Outflow", { exact: true }),
  ).toHaveProperty("value", "12.50");
  expect(shell.execute).toHaveBeenCalledTimes(1);
});

test("a dirty transaction holds shell navigation until canceled; a pristine editor can leave", async () => {
  const shell = await renderShell();
  const form = await openPurchase(shell.user);
  await shell.user.click(screen.getByRole("link", { name: "Plan" }));
  expect(screen.getByRole("heading", { name: "Checking" })).toBeTruthy();
  expect(
    within(form).getByText("Save or cancel this transaction first."),
  ).toBeTruthy();
  expect(within(form).getByLabelText("Payee", { exact: true })).toHaveProperty(
    "value",
    "Market",
  );
  expect(shell.execute).not.toHaveBeenCalled();
  await shell.user.click(within(form).getByRole("button", { name: "Cancel" }));
  await shell.user.click(
    screen.getByRole("button", { name: "Add transaction" }),
  );
  await shell.user.keyboard("{Escape}");
  await shell.user.click(screen.getByRole("link", { name: "Plan" }));
  expect(screen.getByRole("heading", { name: "Plan" })).toBeTruthy();
  expect(screen.queryByRole("form", { name: "New transaction" })).toBeNull();
  expect(shell.execute).not.toHaveBeenCalled();
});

test("choosing a person under People categorizes the whole purchase and survives reload", async () => {
  const shell = await renderShell({
    book: withCounterpartyAccounts(budgetFixture()),
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(
    screen.getByRole("button", { name: "Add transaction" }),
  );
  await shell.user.keyboard("{Escape}");
  const form = screen.getByRole("form", { name: "New transaction" });
  await shell.user.type(
    within(form).getByLabelText("Payee", { exact: true }),
    "Noodles Plus",
  );
  await shell.user.type(
    within(form).getByLabelText("Outflow", { exact: true }),
    "11.54",
  );
  await shell.user.click(
    within(form).getByRole("combobox", { name: "Category" }),
  );
  await shell.user.click(screen.getByRole("option", { name: "Someone else…" }));
  await shell.user.type(screen.getByLabelText("Who owes it"), "Mom");
  await shell.user.click(screen.getByRole("button", { name: "Apply" }));
  expect(
    within(form).getByRole("combobox", { name: "Category" }),
  ).toHaveProperty("value", "Mom");
  await shell.user.click(within(form).getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("form", { name: "New transaction" })).toBeNull();
  expect(
    within(transactionRow("Noodles Plus")).queryByText("Needs category"),
  ).toBeNull();
  await shell.reload();
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  expect(within(transactionRow("Noodles Plus")).getByText("Mom")).toBeTruthy();
});

test("a person picked before the amount keeps the full share as the amount changes", async () => {
  const shell = await renderShell({
    book: withCounterpartyAccounts(budgetFixture()),
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(
    screen.getByRole("button", { name: "Add transaction" }),
  );
  await shell.user.keyboard("{Escape}");
  const form = screen.getByRole("form", { name: "New transaction" });
  await shell.user.type(
    within(form).getByLabelText("Payee", { exact: true }),
    "Noodles Plus",
  );
  await shell.user.click(
    within(form).getByRole("combobox", { name: "Category" }),
  );
  await shell.user.click(screen.getByRole("option", { name: "Someone else…" }));
  await shell.user.type(screen.getByLabelText("Who owes it"), "Mom");
  await shell.user.click(screen.getByRole("button", { name: "Apply" }));
  await shell.user.type(
    within(form).getByLabelText("Outflow", { exact: true }),
    "11.54",
  );
  expect(
    within(form).getByRole("combobox", { name: "Category" }),
  ).toHaveProperty("value", "Mom");
  await shell.user.clear(
    within(form).getByLabelText("Outflow", { exact: true }),
  );
  await shell.user.type(
    within(form).getByLabelText("Outflow", { exact: true }),
    "20.00",
  );
  expect(
    within(form).getByRole("button", { name: /^Share / }).textContent,
  ).toContain("$20.00");
  await shell.user.click(within(form).getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("form", { name: "New transaction" })).toBeNull();
  await shell.user.click(screen.getByRole("link", { name: /^Reimbursements/ }));
  expect(screen.getByRole("heading", { name: "Reimbursements" })).toBeTruthy();
  expect(screen.getAllByText("$20.00").length).toBeGreaterThan(0);
});

test("a full share saves from the register and reducing it asks for a personal category", async () => {
  const book = execute(withCounterpartyAccounts(budgetFixture()), "owner", {
    type: "transaction.upsert",
    id: "noodles",
    transactionId: "noodles",
    accountId: "checking",
    date: "2026-10-05",
    amount: -1_154,
    payee: "Noodles Plus",
  });
  const shell = await renderShell({ book });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(
    screen.getByRole("button", { name: "Share Noodles Plus" }),
  );
  await shell.user.click(
    screen.getByRole("button", { name: /Someone else owes/ }),
  );
  await shell.user.type(screen.getByLabelText("Who owes it"), "Mom");
  await shell.user.click(screen.getByRole("button", { name: "Apply" }));
  expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
  await shell.user.click(
    screen.getByRole("button", { name: /Mom's share of Noodles Plus/ }),
  );
  await shell.user.clear(screen.getByLabelText("Amount", { exact: true }));
  await shell.user.type(
    screen.getByLabelText("Amount", { exact: true }),
    "7.00",
  );
  await shell.user.click(screen.getByRole("button", { name: "Apply" }));
  const form = screen.getByRole("form", { name: "Edit transaction" });
  await shell.user.click(within(form).getByRole("button", { name: "Save" }));
  expect(
    within(form).getByText("Choose a category for your part of it."),
  ).toBeTruthy();
  await shell.user.click(
    within(form).getByRole("combobox", { name: "Category" }),
  );
  await shell.user.click(screen.getByRole("option", { name: /Gifts/ }));
  await shell.user.click(within(form).getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
  expect(
    within(transactionRow("Noodles Plus")).getByText("Gifts"),
  ).toBeTruthy();
});

test("a split line can go entirely to someone under People", async () => {
  const book = execute(withCounterpartyAccounts(budgetFixture()), "owner", {
    type: "transaction.upsert",
    id: "noodles",
    transactionId: "noodles",
    accountId: "checking",
    date: "2026-10-05",
    amount: -2_000,
    payee: "Noodles Plus",
    lines: [
      { lineId: "mine", categoryId: "gifts", amount: -846 },
      { lineId: "mom", categoryId: "gifts", amount: -1_154 },
    ],
  });
  const shell = await renderShell({ book });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(transactionRow("Noodles Plus"));
  await shell.user.keyboard("e");
  const form = screen.getByRole("form", { name: "Edit transaction" });
  await shell.user.click(
    within(form).getByRole("combobox", { name: "Line 2 category" }),
  );
  await shell.user.click(screen.getByRole("option", { name: "Someone else…" }));
  await shell.user.type(screen.getByLabelText("Who owes it"), "Mom");
  await shell.user.click(screen.getByRole("button", { name: "Apply" }));
  await shell.user.click(within(form).getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
  await shell.reload();
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(transactionRow("Noodles Plus"));
  await shell.user.keyboard("e");
  const saved = screen.getByRole("form", { name: "Edit transaction" });
  expect(
    within(saved).getByRole("combobox", { name: "Line 1 category" }),
  ).toHaveProperty("value", "Gifts");
  expect(
    within(saved).getByRole("combobox", { name: "Line 2 category" }),
  ).toHaveProperty("value", "Mom");
});

test("a fully reimbursable refund reopens with its person and saves without a category", async () => {
  let book = execute(withCounterpartyAccounts(budgetFixture()), "owner", {
    type: "account.add",
    id: "card",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  book = execute(book, "owner", {
    type: "transaction.upsert",
    id: "purchase",
    transactionId: "purchase",
    accountId: "card",
    date: "2026-10-05",
    amount: -1_154,
    payee: "Noodles Plus",
    recordedAt: "2026-10-05T12:00:00Z",
    counterpartyShare: {
      accountId: "counterparty:reimbursements",
      counterpartyName: "Mom",
      amount: 1_154,
    },
  });
  book = execute(book, "owner", {
    type: "transaction.upsert",
    id: "refund",
    transactionId: "refund",
    accountId: "card",
    date: "2026-10-06",
    amount: 1_154,
    payee: "Noodles refund",
    counterpartyShare: {
      accountId: "counterparty:reimbursements",
      counterpartyName: "Mom",
      amount: 1_154,
    },
    recordedAt: "2026-10-06T12:00:00Z",
  });
  const shell = await renderShell({ book });
  await shell.user.click(
    within(
      screen.getByRole("navigation", { name: "Budget navigation" }),
    ).getByRole("link", { name: /^Card/ }),
  );
  await shell.user.click(transactionRow("Noodles refund"));
  await shell.user.keyboard("e");
  const form = screen.getByRole("form", { name: "Edit transaction" });
  expect(
    within(form).getByRole("combobox", { name: "Category" }),
  ).toHaveProperty("value", "Mom");
  await shell.user.click(within(form).getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
});

test("writing off a full reimbursement opens the editor to categorize the new personal cost", async () => {
  const book = execute(withCounterpartyAccounts(budgetFixture()), "owner", {
    type: "transaction.upsert",
    id: "purchase",
    transactionId: "purchase",
    accountId: "checking",
    date: "2026-10-05",
    amount: -1_154,
    payee: "Noodles Plus",
    recordedAt: "2026-10-05T12:00:00Z",
    counterpartyShare: {
      accountId: "counterparty:reimbursements",
      counterpartyName: "Mom",
      amount: 1_154,
    },
  });
  const shell = await renderShell({ book });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(transactionRow("Noodles Plus"));
  expect(screen.queryByRole("button", { name: "Details" })).toBeNull();
  await shell.user.click(
    screen.getByRole("button", { name: /Mom's share of Noodles Plus/ }),
  );
  await shell.user.click(screen.getByRole("button", { name: /Just mine/ }));
  const form = screen.getByRole("form", { name: "Edit transaction" });
  await shell.user.click(
    within(form).getByRole("combobox", { name: "Category" }),
  );
  await shell.user.click(screen.getByRole("option", { name: /Gifts/ }));
  await shell.user.click(within(form).getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("form", { name: "Edit transaction" })).toBeNull();
  expect(
    within(transactionRow("Noodles Plus")).getByText("Gifts"),
  ).toBeTruthy();
});
