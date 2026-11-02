import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Command } from "~/domain/engine";
import { findToast, renderShell } from "./shell-harness";

const groceries: Command[] = [
  {
    type: "category.add",
    id: "groceries",
    categoryId: "groceries",
    name: "Groceries",
  },
  {
    type: "assign",
    id: "assign-groceries",
    categoryId: "groceries",
    month: "2026-10",
    amount: 5000,
  },
];

test("Auto-Assign in a category's details assigns only that category", async () => {
  const shell = await renderShell({ seedCommands: groceries });
  await shell.user.click(screen.getByRole("button", { name: "Next month" }));
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Gifts" }),
  );
  const details = within(
    screen.getByRole("complementary", { name: "Details" }),
  );
  await shell.user.click(
    details.getByRole("button", { name: /^Assigned last month/ }),
  );

  await findToast("Assigned $100.00 to Gifts");
  const assigned = (category: string) =>
    screen.getByRole("button", {
      name: new RegExp(`assigned to ${category}\\. Edit assigned amount$`),
    }).textContent;
  expect(assigned("Gifts")).toBe("$100.00");
  expect(assigned("Groceries")).toBe("$0.00");
  // Close category details to show Ready to Assign.
  await shell.user.click(
    screen.getByRole("checkbox", { name: "Select Gifts" }),
  );
  expect(screen.getByText("$750.00")).toBeTruthy();
});
