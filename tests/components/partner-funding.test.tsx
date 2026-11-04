import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import {
  execute,
  personEnvelopeId,
  type Book,
  type Command,
} from "~/domain/engine";
import { partnerAccountOf, partnerEntryId } from "~/domain/partner-ledger";
import { buildDevelopmentSeed } from "~/server/dev/seed-scenarios";
import { findToast, readyOverview, renderShell, sent } from "./shell-harness";

type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

// The simple preset (#265), with you as Alex and Jordan as your partner:
// you owe Jordan $1,488.58 for five purchases, Parking is $20.00 short of
// your part of Platinum Parking, and Trader Joe's has no category, so
// $53.42 is still to fund.
function simple() {
  let book: Book = buildDevelopmentSeed({
    userId: "owner",
    partnerId: "partner",
    asOf: "2026-10-20",
    scenario: "simple",
  }).book;
  let sequence = 0;
  const run = (actorId: string, command: WithoutId<Command>) => {
    book = execute(book, actorId, { ...command, id: `test-${++sequence}` });
  };
  return {
    run,
    // Jordan buys something on her card and shares half with you.
    jordanBuys(payee: string, date: string, amount: number) {
      run("partner", {
        type: "transaction.upsert",
        transactionId: `test-${payee}`,
        accountId: "card",
        date,
        amount: -amount,
        payee,
        categoryId: "groceries",
        counterpartyShare: {
          accountId: partnerAccountOf(book.budgets.partner!)!.id,
          amount: amount / 2,
        },
        recordedAt: `${date}T20:00:00.000Z`,
      });
    },
    get book() {
      return book;
    },
  };
}

const details = () =>
  within(screen.getByRole("complementary", { name: "Details" }));

async function showJordan(book: Book) {
  const shell = await renderShell({
    book,
    overview: () => readyOverview({ partnerFirstName: "Jordan" }),
  });
  await shell.user.click(
    await screen.findByRole("checkbox", { name: "Select Jordan" }),
  );
  return shell;
}

const purchases = () =>
  within(
    details().getByRole("list", { name: "Your part of Jordan’s purchases" }),
  );
const purchase = (payee: string) =>
  within(
    purchases()
      .getAllByRole("listitem")
      .find((item) => within(item).queryByText(payee))!,
  );

test("the partner's details list your part of each purchase and whether it's set aside, six at a time", async () => {
  const home = simple();
  home.jordanBuys("Costco", "2026-10-05", 8_000);
  home.jordanBuys("Walgreens", "2026-10-06", 4_000);
  const { user } = await showJordan(home.book);

  // The newest six, then the rest on request.
  expect(
    purchases()
      .getAllByRole("listitem")
      .map((item) => item.querySelector("strong")?.textContent),
  ).toEqual([
    "Walgreens",
    "Costco",
    "Trader Joe’s",
    "Platinum Parking",
    "Shake Shack",
    "BILT · rent",
  ]);
  expect(purchase("Shake Shack").getByText("Set aside")).toBeTruthy();
  expect(purchase("Platinum Parking").getByText("$71.00")).toBeTruthy();
  expect(purchase("Platinum Parking").getByText("Parking")).toBeTruthy();
  expect(purchase("Platinum Parking").getByText("$20.00 short")).toBeTruthy();
  expect(purchase("Trader Joe’s").getByText("Needs a category")).toBeTruthy();
  expect(purchase("Trader Joe’s").getByText("Not set aside")).toBeTruthy();

  await user.click(details().getByRole("button", { name: "Show all 7" }));

  expect(purchases().getAllByRole("listitem")).toHaveLength(7);
  expect(purchase("H Mart").getByText("Set aside")).toBeTruthy();
});

test("choosing a category for a purchase in the partner's details saves your category for it", async () => {
  const { user, execute } = await showJordan(simple().book);

  await user.click(
    purchase("Trader Joe’s").getByRole("combobox", {
      name: "Category for Trader Joe’s",
    }),
  );
  await user.click(screen.getByRole("option", { name: /Groceries/ }));

  await findToast(
    "Your $33.42 of Trader Joe’s is in Groceries. Only you see that.",
  );
  expect(sent(execute)).toContainEqual(
    expect.objectContaining({
      type: "partner.categorize",
      entryId: partnerEntryId(
        "partner",
        "simple-trader-joes",
        "simple-trader-joes",
      ),
      categoryId: "groceries",
    }),
  );
  expect(purchase("Trader Joe’s").getByText("Groceries")).toBeTruthy();
  expect(purchase("Trader Joe’s").getByText("Set aside")).toBeTruthy();
});

test("Assign covers what's still to fund for the partner, up to what Ready to Assign holds", async () => {
  const home = simple();
  // Leave $37.05 in Ready to Assign, less than the $53.42 still to fund.
  home.run("owner", {
    type: "assign",
    categoryId: "fun",
    month: "2026-10",
    amount: 190_000,
  });
  const { user, execute } = await showJordan(home.book);

  await user.click(details().getByRole("button", { name: "Assign $37.05" }));

  await findToast("Assigned $37.05 to Jordan");
  expect(sent(execute).at(-1)).toMatchObject({
    type: "assign",
    categoryId: personEnvelopeId(
      partnerAccountOf(home.book.budgets.owner!)!.id,
    ),
    month: "2026-10",
    amount: 3_705,
  });
});

test("Assign on a red partner's envelope covers its overspending and what's still to fund", async () => {
  const home = simple();
  // You pay Jordan $1,460.00 of the $1,488.58 you owe, $24.84 more than
  // the $1,435.16 set aside, so $28.58 is still to fund.
  home.run("owner", {
    type: "partner.settle",
    settlementId: "test-settlement",
    method: "Bank transfer",
    legs: [
      {
        userId: "owner",
        accountId: "checking",
        date: "2026-10-15",
        amount: -146_000,
        payee: "Jordan",
      },
      {
        userId: "partner",
        accountId: "checking",
        date: "2026-10-15",
        amount: 146_000,
        payee: "Alex",
      },
    ],
  });
  const { user, execute } = await showJordan(home.book);

  await user.click(details().getByRole("button", { name: "Assign $53.42" }));

  expect(sent(execute).at(-1)).toMatchObject({
    type: "assign",
    month: "2026-10",
    amount: 5_342,
  });
});

test("once nothing is still to fund, a purchase that needs a category only says so", async () => {
  const home = simple();
  home.run("owner", {
    type: "assign",
    categoryId: personEnvelopeId(
      partnerAccountOf(home.book.budgets.owner!)!.id,
    ),
    month: "2026-10",
    amount: 5_342,
  });
  await showJordan(home.book);

  expect(purchase("Trader Joe’s").getByText("Needs a category")).toBeTruthy();
  expect(purchase("Trader Joe’s").queryByText("Not set aside")).toBeNull();
});

test("money moved out of the partner's envelope is listed above the purchases it was set aside for", async () => {
  // Parking covers the rest of Platinum Parking and Groceries covers
  // Trader Joe's, then $30.00 moves out of Jordan's envelope.
  const home = simple();
  home.run("owner", {
    type: "assign",
    categoryId: "parking",
    month: "2026-10",
    amount: 2_000,
  });
  home.run("owner", {
    type: "partner.categorize",
    entryId: partnerEntryId(
      "partner",
      "simple-trader-joes",
      "simple-trader-joes",
    ),
    categoryId: "groceries",
  });
  home.run("owner", {
    type: "assign",
    categoryId: personEnvelopeId(
      partnerAccountOf(home.book.budgets.owner!)!.id,
    ),
    month: "2026-10",
    amount: -3_000,
  });
  await showJordan(home.book);

  const movedOut = details().getByText("Moved out of Jordan’s envelope");
  expect(movedOut.closest("p")?.textContent).toContain("$30.00 short");
  expect(purchases().queryByText(/short$/)).toBeNull();
});
