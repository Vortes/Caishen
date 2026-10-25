import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import {
  addMember,
  createBook,
  execute,
  withCounterpartyAccounts,
} from "~/domain/engine";
import {
  findToast,
  readyOverview,
  renderShell,
  transactionRow,
} from "./shell-harness";

function settledBook() {
  let book = withCounterpartyAccounts(
    addMember(
      createBook("owner", "Alan", "2026-10"),
      "partner",
      "Anna",
      "2026-10",
    ),
  );
  for (const actor of ["owner", "partner"])
    book = execute(book, actor, {
      type: "account.add",
      id: `checking-${actor}`,
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      openingBalance: 100_000,
    });
  return execute(
    book,
    "owner",
    {
      type: "partner.settle",
      id: "match",
      settlementId: "bad-match",
      method: "Venmo",
      legs: [
        {
          userId: "partner",
          accountId: "checking",
          date: "2026-10-12",
          amount: -5_000,
          payee: "Venmo to Alan",
          providerId: "payment",
        },
        {
          userId: "owner",
          accountId: "checking",
          date: "2026-10-12",
          amount: 5_000,
          payee: "Venmo from Anna",
          providerId: "deposit",
        },
      ],
    },
    "provider",
  );
}

test("a partner settlement can be rejected from its ledger", async () => {
  const shell = await renderShell({
    book: settledBook(),
    overview: () => readyOverview({ partnerFirstName: "Anna" }),
  });
  await shell.user.click(
    await within(
      screen.getByRole("navigation", { name: "Budget navigation" }),
    ).findByRole("button", { name: /^Anna/ }),
  );
  await shell.user.click(
    within(screen.getByRole("group", { name: "Anna ledger" })).getByRole(
      "button",
      { name: /Venmo from Anna/ },
    ),
  );
  await shell.user.click(screen.getByRole("button", { name: "Reject match" }));
  await findToast("Match rejected. Both bank imports are back in review.");
  expect(screen.queryByText("Venmo from Anna", { exact: true })).toBeNull();
  expect(
    within(screen.getByRole("button", { name: /^Checking/ })).getByText(
      "$1,000.00",
    ),
  ).toBeTruthy();
  await shell.user.click(screen.getByRole("button", { name: /^Checking/ }));
  expect(screen.queryByText("Venmo from Anna", { exact: true })).toBeNull();
});

test("a settlement can be rejected from its bank transaction", async () => {
  const shell = await renderShell({
    book: settledBook(),
    overview: () => readyOverview({ partnerFirstName: "Anna" }),
  });
  const navigation = within(
    screen.getByRole("navigation", { name: "Budget navigation" }),
  );
  await navigation.findByRole("button", { name: /^Anna/ });
  await shell.user.click(navigation.getByRole("button", { name: /^Checking/ }));
  await shell.user.click(transactionRow("Venmo from Anna"));
  await shell.user.keyboard("e");
  const form = within(
    screen.getByRole("form", { name: "Settlement from Anna" }),
  );
  await shell.user.click(form.getByRole("button", { name: "Reject match" }));
  await findToast("Match rejected. Both bank imports are back in review.");
  expect(
    screen.queryByRole("form", { name: "Settlement from Anna" }),
  ).toBeNull();
  expect(screen.queryByText("Venmo from Anna", { exact: true })).toBeNull();
  expect(
    within(navigation.getByRole("button", { name: /^Checking/ })).getByText(
      "$1,000.00",
    ),
  ).toBeTruthy();
});
