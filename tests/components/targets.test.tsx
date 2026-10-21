import { screen, waitFor, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { Command, Target } from "~/domain/engine";
import { renderShell, stateFixture } from "./shell-harness";

type User = ReturnType<typeof userEvent.setup>;

const giftsTarget: Command = {
  type: "target.set",
  id: "gifts-target",
  categoryId: "gifts",
  target: {
    cadence: "monthly",
    behavior: "contribution",
    amount: 5_000,
    startMonth: "2026-10",
    snoozedMonths: [],
  },
};

const card: Command = {
  type: "account.add",
  id: "card",
  accountId: "card",
  name: "Visa",
  kind: "credit",
  date: "2026-10-01",
  openingBalance: -30_000,
};

async function select(user: User, name: string) {
  const plan = screen.getByRole("group", { name: "Categories" });
  await user.click(
    within(plan).getByRole("button", { name: new RegExp(`^${name}`) }),
  );
}

function targetForm(name: RegExp) {
  return screen.getByRole("form", { name });
}

function sent(execute: { mock: { calls: unknown[][] } }) {
  return execute.mock.calls.map(
    ([input]) => (input as { command: Command }).command,
  );
}

test("creating a weekly refill target sends it and shows its summary", async () => {
  const shell = await renderShell();
  await select(shell.user, "Gifts");
  await shell.user.click(screen.getByRole("button", { name: "Create target" }));
  const form = targetForm(/^Create target for Gifts$/);
  expect(document.activeElement).toBe(
    within(form).getByRole("textbox", { name: "I need" }),
  );

  await shell.user.click(within(form).getByRole("radio", { name: "Weekly" }));
  await shell.user.type(
    within(form).getByRole("textbox", { name: "I need" }),
    "20",
  );
  await shell.user.selectOptions(
    within(form).getByRole("combobox", { name: "Every" }),
    "Monday",
  );
  await shell.user.click(
    within(form).getByRole("button", { name: /Next month I want to/ }),
  );
  await shell.user.click(
    await screen.findByRole("menuitemradio", {
      name: /Refill up to \$20\.00\/week/,
    }),
  );
  const weekly: Target = {
    cadence: "weekly",
    behavior: "refill",
    amount: 2_000,
    weekday: 1,
    startMonth: "2026-10",
    snoozedMonths: [],
  };
  // The saved budget the shell reads back once the save succeeds.
  shell.read.mockReturnValue(
    stateFixture({
      revision: 6,
      seedCommands: [{ ...giftsTarget, target: weekly }],
    }),
  );
  await shell.user.click(
    within(form).getByRole("button", { name: "Save target" }),
  );

  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(sent(shell.execute)[0]).toMatchObject({
    type: "target.set",
    categoryId: "gifts",
    target: weekly,
  });
  expect(await screen.findByText("Refill up to $20.00 each week")).toBeTruthy();
  expect(screen.getByText("Every Monday")).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit target" }),
    ),
  );
});

test("a missing amount is named at the field and nothing is sent", async () => {
  const shell = await renderShell();
  await select(shell.user, "Gifts");
  await shell.user.click(screen.getByRole("button", { name: "Create target" }));
  const form = targetForm(/^Create target for Gifts$/);
  await shell.user.click(
    within(form).getByRole("button", { name: "Save target" }),
  );
  const amount = within(form).getByRole("textbox", { name: "I need" });
  expect(within(form).getByRole("alert").textContent).toBe(
    "Enter an amount above zero.",
  );
  expect(amount.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(amount);
  expect(shell.execute).not.toHaveBeenCalled();
});

test("editing opens with the saved target, and Delete target removes it", async () => {
  const shell = await renderShell({
    read: () => stateFixture({ seedCommands: [giftsTarget] }),
  });
  await select(shell.user, "Gifts");
  expect(screen.getByText("Set aside another $50.00 each month")).toBeTruthy();
  await shell.user.click(screen.getByRole("button", { name: "Edit target" }));
  const form = targetForm(/^Edit target for Gifts$/);
  expect(
    within(form)
      .getByRole("radio", { name: "Monthly" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(
    within(form).getByRole<HTMLInputElement>("textbox", { name: "I need" })
      .value,
  ).toBe("50.00");

  await shell.user.click(
    within(form).getByRole("button", { name: "Delete target" }),
  );
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(sent(shell.execute)[0]).toMatchObject({
    type: "target.set",
    categoryId: "gifts",
    target: null,
  });
  expect(await screen.findByText("Deleted the Gifts target")).toBeTruthy();
});

test("a custom balance goal can be due by a month", async () => {
  const shell = await renderShell();
  await select(shell.user, "Gifts");
  await shell.user.click(screen.getByRole("button", { name: "Create target" }));
  const form = targetForm(/^Create target for Gifts$/);
  await shell.user.click(within(form).getByRole("radio", { name: "Custom" }));
  await shell.user.type(
    within(form).getByRole("textbox", { name: "Amount" }),
    "1200",
  );
  await shell.user.click(
    within(form).getByRole("button", { name: /I want to/ }),
  );
  await shell.user.click(
    await screen.findByRole("menuitemradio", {
      name: /Have a balance of \$1,200\.00/,
    }),
  );
  // A balance goal has no repeat; its date is optional.
  expect(within(form).queryByRole("checkbox", { name: "Repeat" })).toBeNull();
  await shell.user.click(
    within(form).getByRole("checkbox", { name: "Due by date" }),
  );
  await shell.user.selectOptions(
    within(form).getByRole("combobox", { name: "Due on" }),
    "March",
  );
  await shell.user.selectOptions(
    within(form).getByRole("combobox", { name: "Due year" }),
    "2027",
  );
  await shell.user.click(
    within(form).getByRole("button", { name: "Save target" }),
  );
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(sent(shell.execute)[0]).toMatchObject({
    target: {
      cadence: "custom",
      behavior: "balance",
      amount: 120_000,
      dueDate: "2027-03-31",
    },
  });
});

test("a card's payment category is paid monthly or off by a date", async () => {
  const shell = await renderShell({
    read: () => stateFixture({ seedCommands: [card] }),
  });
  await select(shell.user, "Visa");
  await shell.user.click(screen.getByRole("button", { name: "Create target" }));
  const form = targetForm(/^Create target for Visa/);
  expect(
    within(form)
      .getAllByRole("radio")
      .map((radio) => radio.textContent),
  ).toEqual(["Monthly", "Pay off by date"]);
  await shell.user.click(
    within(form).getByRole("radio", { name: "Pay off by date" }),
  );
  expect(within(form).queryByRole("textbox", { name: "I need" })).toBeNull();
  const date = within(form).getByRole("combobox", { name: "Pay off by" });
  await shell.user.clear(date);
  await shell.user.type(date, "09/30/2026");
  await shell.user.click(
    within(form).getByRole("button", { name: "Save target" }),
  );
  expect(within(form).getByRole("alert").textContent).toBe(
    "Choose a date in October 2026 or later.",
  );
  await shell.user.clear(date);
  await shell.user.type(date, "04/30/2027");
  await shell.user.click(
    within(form).getByRole("button", { name: "Save target" }),
  );
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(sent(shell.execute)[0]).toMatchObject({
    categoryId: "card:card",
    target: {
      cadence: "card-payoff",
      behavior: "contribution",
      amount: 0,
      dueDate: "2027-04-30",
    },
  });
});

test("only a custom schedule offers a balance goal", async () => {
  const shell = await renderShell();
  await select(shell.user, "Gifts");
  await shell.user.click(screen.getByRole("button", { name: "Create target" }));
  const form = targetForm(/^Create target for Gifts$/);
  const options = async (label: RegExp) => {
    await shell.user.click(within(form).getByRole("button", { name: label }));
    // Each option's title, up to its amount.
    const names = (await screen.findAllByRole("menuitemradio")).map(
      (item) => /^.*?\$0\.00/.exec(item.textContent ?? "")?.[0],
    );
    await shell.user.keyboard("{Escape}");
    return names;
  };
  expect(await options(/Next month I want to/)).toEqual([
    "Set aside another $0.00",
    "Refill up to $0.00",
  ]);
  await shell.user.click(within(form).getByRole("radio", { name: "Custom" }));
  expect(await options(/I want to/)).toEqual([
    "Set aside $0.00",
    "Fill up to $0.00",
    "Have a balance of $0.00",
  ]);
});

test("Escape closes the behavior menu but keeps the editor open", async () => {
  const shell = await renderShell();
  await select(shell.user, "Gifts");
  await shell.user.click(screen.getByRole("button", { name: "Create target" }));
  const form = targetForm(/^Create target for Gifts$/);
  const trigger = within(form).getByRole("button", {
    name: /Next month I want to/,
  });
  await shell.user.click(trigger);
  await screen.findByRole("menu");
  await shell.user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(targetForm(/^Create target for Gifts$/)).toBe(form);
  expect(document.activeElement).toBe(trigger);
});

test("Escape from a field closes the editor without saving", async () => {
  const shell = await renderShell();
  await select(shell.user, "Gifts");
  await shell.user.click(screen.getByRole("button", { name: "Create target" }));
  await shell.user.type(
    screen.getByRole("textbox", { name: "I need" }),
    "40{Escape}",
  );
  expect(screen.queryByRole("form", { name: /target for Gifts/ })).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Create target" }),
  );
  expect(shell.execute).not.toHaveBeenCalled();
});
