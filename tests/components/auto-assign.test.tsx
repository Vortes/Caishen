import { screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Command } from "~/domain/engine";
import { renderShell, stateFixture } from "./shell-harness";

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
  const shell = await renderShell({
    read: (month) => stateFixture({ month, seedCommands: groceries }),
  });
  await shell.user.click(screen.getByRole("button", { name: "Next month" }));
  await waitFor(() => expect(shell.read).toHaveBeenCalledWith("2026-11"));
  await shell.user.click(
    await screen.findByRole("checkbox", { name: "Select Gifts" }),
  );
  const details = within(
    screen.getByRole("complementary", { name: "Details" }),
  );
  await shell.user.click(details.getByRole("tab", { name: "Auto-Assign" }));
  await shell.user.click(
    details.getByRole("button", { name: /^Assigned last month/ }),
  );

  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(shell.execute.mock.calls[0]![0].command).toMatchObject({
    type: "assign.batch",
    month: "2026-11",
    changes: [{ categoryId: "gifts", amount: 10_000 }],
  });
  await screen.findByText("Assigned $100.00 to Gifts");
});
