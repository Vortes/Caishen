import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderShell, transactionRow } from "./shell-harness";

async function openRegister() {
  const { user } = await renderShell({
    seedCommands: [
      {
        type: "transaction.upsert",
        id: "market",
        transactionId: "market",
        accountId: "checking",
        categoryId: "gifts",
        date: "2026-10-10",
        payee: "Market",
        amount: -2500,
        status: "posted",
        reviewed: true,
      },
      {
        type: "transaction.upsert",
        id: "coffee",
        transactionId: "coffee",
        accountId: "checking",
        categoryId: "gifts",
        date: "2026-10-10",
        payee: "Coffee",
        amount: -500,
        status: "posted",
        reviewed: true,
      },
    ],
  });
  await user.click(screen.getByRole("link", { name: /^Checking/ }));
  return user;
}

test("category checkboxes add to the selection and remove only the unchecked category", async () => {
  const { user } = await renderShell({
    seedCommands: [
      {
        type: "category.add",
        id: "groceries",
        categoryId: "groceries",
        name: "Groceries",
      },
      // Selecting every category shows only Auto-Assign.
      {
        type: "category.add",
        id: "rent",
        categoryId: "rent",
        name: "Rent",
        group: "Bills",
      },
    ],
  });
  const categories = within(screen.getByRole("group", { name: "Categories" }));
  const gifts = await categories.findByRole("checkbox", {
    name: "Select Gifts",
  });
  const groceries = categories.getByRole("checkbox", {
    name: "Select Groceries",
  });

  await user.click(gifts);
  await user.click(groceries);

  expect(
    categories.getByRole("checkbox", { name: "Select Gifts", checked: true }),
  ).toBe(gifts);
  expect(
    categories.getByRole("checkbox", {
      name: "Select Groceries",
      checked: true,
    }),
  ).toBe(groceries);
  expect(screen.getByText("2 categories selected")).toBeTruthy();

  await user.click(groceries);

  expect(
    categories.getByRole("checkbox", { name: "Select Gifts", checked: true }),
  ).toBe(gifts);
  expect(
    categories.getByRole("checkbox", {
      name: "Select Groceries",
      checked: false,
    }),
  ).toBe(groceries);
  expect(screen.queryByText("2 categories selected")).toBeNull();
});

test("checking and unchecking a transaction shows and hides the selection toolbar", async () => {
  const user = await openRegister();
  const market = screen.getByRole("checkbox", { name: "Select Market" });
  expect(
    screen.queryByRole("toolbar", { name: "Selected transactions" }),
  ).toBeNull();

  await user.click(market);

  expect(
    screen.getByRole("checkbox", { name: "Select Market", checked: true }),
  ).toBe(market);
  expect(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByText("1 transaction"),
  ).toBeTruthy();
  expect(
    screen.getByRole("checkbox", { name: "Select Coffee", checked: false }),
  ).toBeTruthy();

  await user.click(market);

  expect(
    screen.getByRole("checkbox", { name: "Select Market", checked: false }),
  ).toBe(market);
  expect(
    screen.queryByRole("toolbar", { name: "Selected transactions" }),
  ).toBeNull();
});

test("select-all clears a partial transaction selection and selects all from none", async () => {
  const user = await openRegister();
  const transactions = within(
    screen.getByRole("group", { name: "Transactions" }),
  );
  const all = transactions.getByRole("checkbox", { name: "Select all" });
  await user.click(
    transactions.getByRole("checkbox", { name: "Select Market" }),
  );
  expect(all.getAttribute("aria-checked")).toBe("mixed");

  await user.click(all);

  expect(
    transactions.queryAllByRole("checkbox", { checked: true }),
  ).toHaveLength(0);
  expect(
    screen.queryByRole("toolbar", { name: "Selected transactions" }),
  ).toBeNull();

  await user.click(all);

  expect(
    transactions.getByRole("checkbox", { name: "Select all", checked: true }),
  ).toBe(all);
  expect(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByText("2 transactions"),
  ).toBeTruthy();
});

test("select-all clears a partial category selection", async () => {
  const { user } = await renderShell({
    seedCommands: [
      {
        type: "category.add",
        id: "groceries",
        categoryId: "groceries",
        name: "Groceries",
      },
      {
        type: "category.add",
        id: "rent",
        categoryId: "rent",
        name: "Rent",
        group: "Bills",
      },
    ],
  });
  const categories = within(screen.getByRole("group", { name: "Categories" }));
  const all = await categories.findByRole("checkbox", {
    name: "Select all categories",
  });
  await user.click(categories.getByRole("checkbox", { name: "Select Gifts" }));
  await user.click(
    categories.getByRole("checkbox", { name: "Select Groceries" }),
  );
  expect(all.getAttribute("aria-checked")).toBe("mixed");

  await user.click(all);

  expect(categories.queryAllByRole("checkbox", { checked: true })).toHaveLength(
    0,
  );
  expect(screen.queryByText("2 categories selected")).toBeNull();
});

test("the keyboard shortcut toggles the focused category's selection", async () => {
  const { user } = await renderShell();
  const categories = within(screen.getByRole("group", { name: "Categories" }));
  const row = await categories.findByRole("button", { name: /^Gifts/ });
  await user.click(row);
  expect(
    categories.getByRole("checkbox", { name: "Select Gifts", checked: true }),
  ).toBeTruthy();

  await user.keyboard("x");

  expect(
    categories.getByRole("checkbox", { name: "Select Gifts", checked: false }),
  ).toBeTruthy();

  await user.keyboard("x");

  expect(
    categories.getByRole("checkbox", { name: "Select Gifts", checked: true }),
  ).toBeTruthy();
});

test("the keyboard shortcut toggles the focused transaction and its selection toolbar", async () => {
  const user = await openRegister();
  const transactions = within(
    screen.getByRole("group", { name: "Transactions" }),
  );
  await user.click(transactionRow("Market"));
  expect(
    transactions.getByRole("checkbox", {
      name: "Select Market",
      checked: true,
    }),
  ).toBeTruthy();

  await user.keyboard("x");

  expect(
    transactions.getByRole("checkbox", {
      name: "Select Market",
      checked: false,
    }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("toolbar", { name: "Selected transactions" }),
  ).toBeNull();

  await user.keyboard("x");

  expect(
    transactions.getByRole("checkbox", {
      name: "Select Market",
      checked: true,
    }),
  ).toBeTruthy();
  expect(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByText("1 transaction"),
  ).toBeTruthy();
});

test("a category group's checkbox selects all of a partial selection and then clears the group", async () => {
  const { user } = await renderShell({
    seedCommands: [
      {
        type: "category.add",
        id: "groceries",
        categoryId: "groceries",
        name: "Groceries",
      },
      // Selecting every category shows only Auto-Assign.
      {
        type: "category.add",
        id: "rent",
        categoryId: "rent",
        name: "Rent",
        group: "Bills",
      },
    ],
  });
  const categories = within(screen.getByRole("group", { name: "Categories" }));
  const group = await categories.findByRole("checkbox", {
    name: "Select Everyday",
  });
  await user.click(categories.getByRole("checkbox", { name: "Select Gifts" }));
  expect(group.getAttribute("aria-checked")).toBe("mixed");

  await user.click(group);

  expect(
    categories.getByRole("checkbox", {
      name: "Select Everyday",
      checked: true,
    }),
  ).toBe(group);
  for (const name of ["Select Gifts", "Select Groceries"])
    expect(
      categories.getByRole("checkbox", { name, checked: true }),
    ).toBeTruthy();
  expect(screen.getByText("2 categories selected")).toBeTruthy();

  await user.click(group);

  expect(categories.queryAllByRole("checkbox", { checked: true })).toHaveLength(
    0,
  );
  // Everyday and Bills, their three categories, and the column header's
  // select-all.
  expect(categories.getAllByRole("checkbox", { checked: false })).toHaveLength(
    6,
  );
  expect(screen.queryByText("2 categories selected")).toBeNull();
});
