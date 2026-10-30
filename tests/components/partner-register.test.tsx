import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import {
  addMember,
  createBook,
  execute,
  withCounterpartyAccounts,
} from "~/domain/engine";
import { findToast, readyOverview, renderShell } from "./shell-harness";

function sharedBook() {
  const book = withCounterpartyAccounts(
    addMember(
      createBook("owner", "Alan", "2026-10"),
      "partner",
      "Anna",
      "2026-10",
    ),
  );
  const withCategory = execute(book, "owner", {
    type: "category.add",
    id: "add-household",
    categoryId: "household",
    name: "Household",
  });
  return execute(withCategory, "partner", {
    type: "partner.record",
    id: "record",
    recordedAt: "2026-10-12T12:00:00Z",
    entryId: "groceries",
    payerId: "partner",
    date: "2026-10-12",
    payee: "Groceries",
    amount: 6_000,
    share: 3_000,
  });
}

async function openLedger() {
  const shell = await renderShell({
    book: sharedBook(),
    overview: () => readyOverview({ partnerFirstName: "Anna" }),
  });
  await shell.user.click(
    await within(
      screen.getByRole("navigation", { name: "Budget navigation" }),
    ).findByRole("link", { name: /^Anna/ }),
  );
  const ledger = within(screen.getByRole("group", { name: "Anna ledger" }));
  await shell.user.click(ledger.getByRole("button", { name: /Groceries/ }));
  return shell;
}

test("an opened shared entry edits its amount and your category, in the row", async () => {
  const shell = await openLedger();
  const form = within(screen.getByRole("form", { name: "Edit shared entry" }));
  expect(form.getAllByRole("textbox")).toHaveLength(1);
  expect(form.getAllByRole("combobox")).toHaveLength(1);
  expect(form.getByRole("combobox", { name: "Your category" })).toBeTruthy();
  expect(form.getByText("Groceries", { exact: true })).toBeTruthy();
  const amount = form.getByRole("textbox", { name: "Amount" });
  expect(amount).toHaveProperty("value", "30.00");
  expect(screen.queryByRole("button", { name: "Split evenly" })).toBeNull();
  expect(screen.queryByText("History")).toBeNull();

  await shell.user.clear(amount);
  await shell.user.type(amount, "20");
  await shell.user.click(form.getByRole("button", { name: "Save" }));
  await findToast("Your share of Groceries is $20.00. Both budgets updated.");
  expect(screen.queryByRole("form", { name: "Edit shared entry" })).toBeNull();
  expect(
    within(screen.getByRole("group", { name: "Anna ledger" })).getByRole(
      "button",
      { name: /Groceries.*\$60\.00\s*-\$20\.00/ },
    ),
  ).toBeTruthy();
});

test("an amount over the shared total is refused and Cancel closes the row", async () => {
  const shell = await openLedger();
  const form = within(screen.getByRole("form", { name: "Edit shared entry" }));
  const amount = form.getByRole("textbox", { name: "Amount" });
  await shell.user.clear(amount);
  await shell.user.type(amount, "61");
  await shell.user.click(form.getByRole("button", { name: "Save" }));
  expect(form.getByText("A share can be at most $60.00.")).toBeTruthy();
  await shell.user.click(form.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("form", { name: "Edit shared entry" })).toBeNull();
});

test("your category for what your partner paid saves with its amount", async () => {
  const shell = await openLedger();
  const form = within(screen.getByRole("form", { name: "Edit shared entry" }));
  await shell.user.click(form.getByRole("combobox", { name: "Your category" }));
  await shell.user.click(screen.getByRole("option", { name: /Household/ }));
  const amount = form.getByRole("textbox", { name: "Amount" });
  await shell.user.clear(amount);
  await shell.user.type(amount, "25");
  await shell.user.click(form.getByRole("button", { name: "Save" }));
  await findToast("Your share of Groceries is $25.00. Both budgets updated.");
  const row = within(
    screen.getByRole("group", { name: "Anna ledger" }),
  ).getByRole("button", { name: /Groceries/ });
  expect(within(row).getByText("Household")).toBeTruthy();
  expect(within(row).queryByText("Needs category")).toBeNull();
  expect(within(row).getAllByText("-$25.00")).toHaveLength(2);
});
