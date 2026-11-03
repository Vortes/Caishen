import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { findToast, renderShell, sent } from "./shell-harness";

// Adding a category in a group the plan doesn't have yet, from a
// transaction's Category field, without going back to the plan.

async function addCategoryForm(shell: Awaited<ReturnType<typeof renderShell>>) {
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await shell.user.click(
    screen.getByRole("button", { name: "Add transaction" }),
  );
  await shell.user.keyboard("{Escape}");
  const transaction = within(
    screen.getByRole("form", { name: "New transaction" }),
  );
  const category = transaction.getByRole("combobox", { name: "Category" });
  await shell.user.click(category);
  await shell.user.type(category, "Dog walker");
  await shell.user.keyboard("{Enter}");
  return {
    transaction,
    form: within(screen.getByRole("dialog", { name: "Add a category" })),
  };
}

async function nameNewGroup(
  shell: Awaited<ReturnType<typeof renderShell>>,
  name: string,
) {
  // Typing replaces the chosen group's name. Another click in the well
  // would close the list, so the name is typed straight in.
  const form = within(screen.getByRole("dialog", { name: "Add a category" }));
  await shell.user.clear(
    form.getByRole("combobox", { name: "Category group" }),
  );
  await shell.user.keyboard(name);
  await shell.user.keyboard("{Enter}");
}

test("a category in a new group is added from the Category field in one command", async () => {
  const shell = await renderShell();
  const { transaction, form } = await addCategoryForm(shell);
  await nameNewGroup(shell, "Pets");
  expect(form.getByRole("textbox", { name: "New group" })).toHaveProperty(
    "value",
    "Pets",
  );
  await shell.user.click(
    form.getByRole("button", { name: "Add group and category" }),
  );

  await findToast("Added the Pets group with Dog walker");
  expect(sent(shell.execute)).toEqual([
    expect.objectContaining({
      type: "category.add",
      name: "Dog walker",
      group: "Pets",
    }),
  ]);
  expect(
    transaction.getByRole("combobox", { name: "Category" }),
  ).toHaveProperty("value", "Dog walker");
});

test("a new group goes back to the group list with the group it had, by × or a fresh Backspace", async () => {
  const shell = await renderShell();
  const { form } = await addCategoryForm(shell);
  const back = async () =>
    form.findByRole("combobox", { name: "Category group" });

  await nameNewGroup(shell, "Pets");
  await shell.user.click(
    form.getByRole("button", { name: "Back to existing groups" }),
  );
  let group = await back();
  expect(group).toHaveProperty("value", "Everyday");
  expect(document.activeElement).toBe(group);

  // Holding Backspace empties the name and stops there.
  await nameNewGroup(shell, "Pets");
  await shell.user.keyboard("{Backspace>6/}");
  const name = form.getByRole("textbox", { name: "New group" });
  expect(name).toHaveProperty("value", "");

  // A fresh press in the empty field goes back.
  await shell.user.keyboard("{Backspace}");
  group = await back();
  expect(group).toHaveProperty("value", "Everyday");
  expect(form.getByRole("button", { name: "Add category" })).toBeTruthy();
  expect(shell.execute).not.toHaveBeenCalled();
});
