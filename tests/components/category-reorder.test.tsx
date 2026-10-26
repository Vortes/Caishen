import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { findToast, renderShell, waitForSaves } from "./shell-harness";

const seedCommands = [
  {
    type: "category.add" as const,
    id: "coffee",
    categoryId: "coffee",
    name: "Coffee",
  },
  {
    type: "category.add" as const,
    id: "food",
    categoryId: "food",
    name: "Food",
  },
  {
    type: "category.add" as const,
    id: "rent",
    categoryId: "rent",
    name: "Rent",
    group: "Bills",
  },
];
const categories = () =>
  within(screen.getByRole("group", { name: "Categories" }));
const order = () =>
  categories()
    .getAllByRole("checkbox", {
      name: /^Select (Gifts|Coffee|Food|Rent)$/,
    })
    .map((item) => item.getAttribute("aria-label"));

test("Alt+Arrow reorders a category within its group, supports undo, and survives reload", async () => {
  const shell = await renderShell({ seedCommands });
  await shell.user.click(categories().getByRole("button", { name: /^Coffee/ }));
  await shell.user.keyboard("{Alt>}{ArrowUp}{/Alt}");
  const toast = await findToast("Moved Coffee");
  expect(order()).toEqual([
    "Select Coffee",
    "Select Gifts",
    "Select Food",
    "Select Rent",
  ]);
  expect(document.activeElement?.textContent).toContain("Coffee");
  await shell.user.click(within(toast).getByRole("button", { name: "Undo" }));
  await waitForSaves();
  expect(order()).toEqual([
    "Select Gifts",
    "Select Coffee",
    "Select Food",
    "Select Rent",
  ]);

  await shell.user.click(categories().getByRole("button", { name: /^Coffee/ }));
  await shell.user.keyboard("{Alt>}{ArrowDown}{/Alt}");
  await waitForSaves();
  await shell.reload();
  expect(order()).toEqual([
    "Select Gifts",
    "Select Food",
    "Select Coffee",
    "Select Rent",
  ]);
  await shell.user.click(categories().getByRole("button", { name: /^Coffee/ }));
  await shell.user.keyboard("{Alt>}{ArrowDown}{/Alt}");
  expect(order()).toEqual([
    "Select Gifts",
    "Select Food",
    "Select Coffee",
    "Select Rent",
  ]);
});

test("reordering a filtered Plan view preserves the hidden category's position", async () => {
  const shell = await renderShell({
    seedCommands: [
      ...seedCommands,
      {
        type: "assign",
        id: "fund-food",
        categoryId: "food",
        month: "2026-10",
        amount: 1000,
      },
    ],
  });
  await shell.user.click(
    screen.getByRole("button", { name: /^Money available/ }),
  );
  await shell.user.click(categories().getByRole("button", { name: /^Food/ }));
  await shell.user.keyboard("{Alt>}{ArrowUp}{/Alt}");
  await waitForSaves();
  await shell.user.click(screen.getByRole("button", { name: "All" }));
  expect(order()).toEqual([
    "Select Food",
    "Select Coffee",
    "Select Gifts",
    "Select Rent",
  ]);
  await shell.reload();
  expect(order()).toEqual([
    "Select Food",
    "Select Coffee",
    "Select Gifts",
    "Select Rent",
  ]);
});
