import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { Command } from "~/domain/engine";
import { renderShell, stateFixture } from "./shell-harness";

const card: Command = {
  type: "account.add",
  id: "card",
  accountId: "card",
  name: "Chase Sapphire",
  kind: "credit",
  date: "2026-10-01",
  openingBalance: -552_290,
};

const reserve: Command = {
  type: "assign",
  id: "reserve",
  categoryId: "card:card",
  month: "2026-10",
  amount: 11_042,
};

test("the payment row omits the pay-in-full shortfall label", async () => {
  await renderShell({
    read: () => stateFixture({ seedCommands: [card, reserve] }),
  });
  const row = await screen.findByRole("button", {
    name: /^Chase Sapphire payment/,
  });
  expect(
    within(row).queryByText("$5,412.48 more needed to pay in full"),
  ).toBeNull();
});

test.each([
  {
    description: "without a target",
    target: undefined,
    fundingLabel: "Underfunded. $5,412.48 more needed to pay in full",
  },
  {
    description: "with a target",
    target: {
      type: "target.set",
      id: "target",
      categoryId: "card:card",
      target: {
        cadence: "card-monthly",
        behavior: "contribution",
        amount: 11_042,
        startMonth: "2026-10",
        snoozedMonths: [],
      },
    },
    fundingLabel: "Funded",
  },
] satisfies { description: string; target?: Command; fundingLabel: string }[])(
  "payment rows $description have no funding progress graphic",
  async ({ target, fundingLabel }) => {
    const seedCommands = target ? [card, reserve, target] : [card, reserve];
    await renderShell({ read: () => stateFixture({ seedCommands }) });
    const row = await screen.findByRole("button", {
      name: /^Chase Sapphire payment/,
    });
    expect(within(row).queryByRole("img", { name: fundingLabel })).toBeNull();
  },
);

test("spending categories keep their funding progress graphic", async () => {
  await renderShell({
    read: () => stateFixture({ seedCommands: [card, reserve] }),
  });
  const row = await screen.findByRole("button", { name: /^Gifts/ });
  expect(within(row).queryByRole("img", { name: "Funded" })).not.toBeNull();
});

test("the Underfunded view includes a card whose reserve is short of its balance", async () => {
  const shell = await renderShell({
    read: () => stateFixture({ seedCommands: [card, reserve] }),
  });
  const views = screen.getByRole("group", { name: "Plan views" });
  await shell.user.click(
    within(views).getByRole("button", { name: /^Underfunded/ }),
  );
  expect(
    screen.queryByRole("button", { name: /^Chase Sapphire payment/ }),
  ).not.toBeNull();
});
