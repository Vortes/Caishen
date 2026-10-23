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

test.each(["owner", "partner"])(
  "F2: a linked refund paid by %s has no editable share control in the Partner register",
  async (payer) => {
    let book = settledBook();
    book = execute(book, payer, {
      type: "category.add",
      id: "food",
      categoryId: "food",
      name: "Food",
    });
    book = execute(book, payer, {
      type: "transaction.upsert",
      id: "purchase",
      transactionId: "purchase",
      accountId: "checking",
      date: "2026-10-10",
      payee: "Shared dinner",
      amount: -5000,
      categoryId: "food",
      counterpartyShare: { accountId: "counterparty:partner", amount: 2500 },
      recordedAt: "2026-10-10T12:00:00Z",
    });
    book = execute(book, payer, {
      type: "transaction.upsert",
      id: "refund",
      transactionId: "refund",
      accountId: "checking",
      date: "2026-10-11",
      payee: "Dinner refund",
      amount: 1000,
      refundOfTransactionId: "purchase",
      recordedAt: "2026-10-11T12:00:00Z",
    });
    const shell = await renderShell({
      book,
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
        { name: /Dinner refund/ },
      ),
    );
    expect(
      screen.queryByLabelText(
        payer === "owner" ? "Anna's share" : "Your share",
        { exact: true },
      ),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Update" }),
    ).toBeNull();
    expect(
      screen.getByText(
        "A linked refund's share follows its purchase. Change the purchase",
      ),
    ).toBeTruthy();
  },
);
