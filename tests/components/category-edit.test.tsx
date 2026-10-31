import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { findToast, renderShell, waitForSaves } from "./shell-harness";

// Beside the fixture's Gifts, which has money assigned.
const seedCommands = [
  {
    type: "category.add" as const,
    id: "coffee",
    categoryId: "coffee",
    name: "Coffee",
  },
  {
    type: "category.add" as const,
    id: "rent",
    categoryId: "rent",
    name: "Rent",
    group: "Bills",
  },
  {
    type: "account.add" as const,
    id: "card",
    accountId: "card",
    name: "Visa",
    kind: "credit" as const,
    date: "2026-10-01",
    openingBalance: 0,
  },
];
const plan = () => within(screen.getByRole("group", { name: "Categories" }));
const names = () =>
  plan()
    .getAllByRole("checkbox", { name: /^Select (?!all)/ })
    .map((item) => item.getAttribute("aria-label")!.replace("Select ", ""));
const popover = (name: string) => screen.getByRole("dialog", { name });

test("a category's name renames it, with undo, and the rename survives reload", async () => {
  const shell = await renderShell({ seedCommands });
  await shell.user.click(plan().getByRole("button", { name: "Edit Coffee" }));
  const field = within(popover("Edit Coffee")).getByRole("textbox", {
    name: "Category name",
  });
  expect((field as HTMLInputElement).value).toBe("Coffee");
  await shell.user.keyboard("Café{Enter}");
  const toast = await findToast("Renamed Coffee to Café");
  expect(names()).toContain("Café");

  await shell.user.click(within(toast).getByRole("button", { name: "Undo" }));
  await waitForSaves();
  expect(names()).toContain("Coffee");

  await shell.user.click(plan().getByRole("button", { name: "Edit Coffee" }));
  await shell.user.keyboard("Gifts{Enter}");
  expect(
    within(popover("Edit Coffee")).getByText("Everyday already has Gifts."),
  ).toBeTruthy();
  await shell.user.keyboard("{Escape}");

  await shell.user.click(plan().getByRole("button", { name: "Edit Bills" }));
  await shell.user.keyboard("Housing{Enter}");
  await findToast("Renamed the Bills group to Housing");
  await waitForSaves();
  await shell.reload();
  expect(plan().getByRole("button", { name: "Housing" })).toBeTruthy();
  expect(plan().queryByRole("button", { name: "Edit Visa payment" })).toBe(
    null,
  );
  expect(
    plan().queryByRole("button", { name: "Edit Credit card payments" }),
  ).toBe(null);
});

test("deleting an unused category is immediate, and a used one moves its money first", async () => {
  const shell = await renderShell({ seedCommands });
  await shell.user.click(plan().getByRole("button", { name: "Edit Coffee" }));
  await shell.user.click(
    within(popover("Edit Coffee")).getByRole("button", { name: "Delete" }),
  );
  const toast = await findToast("Deleted Coffee");
  expect(names()).not.toContain("Coffee");
  await shell.user.click(within(toast).getByRole("button", { name: "Undo" }));
  await waitForSaves();
  expect(names()).toContain("Coffee");

  await shell.user.click(plan().getByRole("button", { name: "Edit Gifts" }));
  await shell.user.click(
    within(popover("Edit Gifts")).getByRole("button", { name: "Delete" }),
  );
  const step = popover("Edit Gifts");
  expect(
    within(step).getByText(
      "Gifts has transactions or assigned money. Choose a category to take them over.",
    ),
  ).toBeTruthy();
  await shell.user.click(
    within(step).getByRole("button", { name: "Delete category" }),
  );
  expect(
    within(step).getByText("Choose a category to move them to."),
  ).toBeTruthy();
  await shell.user.click(
    within(step).getByRole("combobox", { name: "Move to" }),
  );
  await shell.user.keyboard("Cof{Enter}");
  await shell.user.click(
    within(step).getByRole("button", { name: "Delete category" }),
  );
  await findToast("Deleted Gifts and moved its money to Coffee");
  expect(names()).not.toContain("Gifts");
  expect(
    plan().getByRole("button", { name: /\$100\.00 available in Coffee/ }),
  ).toBeTruthy();

  // A group goes with its categories.
  await shell.user.click(plan().getByRole("button", { name: "Edit Bills" }));
  await shell.user.click(
    within(popover("Edit Bills")).getByRole("button", { name: "Delete" }),
  );
  await findToast("Deleted the Bills group");
  await waitForSaves();
  await shell.reload();
  expect(names()).not.toContain("Rent");
  expect(plan().queryByRole("button", { name: "Bills" })).toBe(null);
});

test("right-clicking anywhere on a row or group header opens the same popover", async () => {
  const shell = await renderShell({ seedCommands });
  // The row's own button, away from the name.
  await shell.user.pointer({
    keys: "[MouseRight]",
    target: plan().getByRole("button", { name: /^Coffee/ }),
  });
  expect(
    within(popover("Edit Coffee")).getByRole("textbox", {
      name: "Category name",
    }),
  ).toBeTruthy();
  await shell.user.keyboard("{Escape}");
  // The group header's caret, away from the name.
  await shell.user.pointer({
    keys: "[MouseRight]",
    target: plan().getByRole("button", { name: "Bills" }),
  });
  expect(
    within(popover("Edit Bills")).getByRole("textbox", { name: "Group name" }),
  ).toBeTruthy();
  await shell.user.keyboard("{Escape}");
  // Caishen's own categories keep the browser's menu.
  await shell.user.pointer({
    keys: "[MouseRight]",
    target: plan().getByRole("button", { name: /^Visa payment/ }),
  });
  expect(screen.queryByRole("dialog")).toBe(null);
});
