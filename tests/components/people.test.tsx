import { screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { addMember, withCounterpartyAccounts } from "~/domain/engine";
import { budgetFixture, readyOverview, renderShell } from "./shell-harness";

// The owner's budget as every budget now is: with its reimbursements account
// and paired envelope.
const withPeople = () => withCounterpartyAccounts(budgetFixture());

const sidebar = () =>
  within(screen.getByRole("navigation", { name: "Budget navigation" }));
const plan = () => within(screen.getByRole("group", { name: "Categories" }));

test("People holds the Reimbursements account in the sidebar and leads the plan with its envelope", async () => {
  await renderShell({ book: withPeople() });

  const people = sidebar().getByRole("button", { name: /^People/ });
  expect(people.getAttribute("aria-expanded")).toBe("true");
  expect(sidebar().getByRole("link", { name: /^Reimbursements/ })).toBeTruthy();

  // The column header's toggle opens and folds every group.
  const groups = plan()
    .getAllByRole("button", { expanded: true })
    .filter((button) => button.getAttribute("aria-label") === null)
    .map((button) => button.textContent);
  expect(groups[0]).toMatch(/^People/);
  expect(
    plan().getByRole("checkbox", { name: "Select Reimbursements" }),
  ).toBeTruthy();
  // People holds only the system's envelopes.
  expect(
    plan().queryByRole("button", { name: "Add a category to People" }),
  ).toBeNull();
  expect(
    plan().getByRole("button", { name: "Add a category to Everyday" }),
  ).toBeTruthy();
});

const readyToAssign = () =>
  screen.getByText("Ready to Assign").parentElement!.querySelector("strong")!
    .textContent;

async function setFloat(
  user: Awaited<ReturnType<typeof renderShell>>["user"],
  amount: string,
) {
  await user.click(
    plan().getByRole("button", {
      name: /assigned to Reimbursements\. Edit assigned amount$/,
    }),
  );
  const field = plan().getByRole("textbox", {
    name: "Assigned amount for Reimbursements",
  });
  await user.clear(field);
  await user.type(field, `${amount}{Enter}`);
}

test("a float on Reimbursements comes out of Ready to Assign and shows as the envelope's available money", async () => {
  const { user } = await renderShell({ book: withPeople() });
  expect(readyToAssign()).toBe("$900.00");

  await setFloat(user, "200");

  expect(readyToAssign()).toBe("$700.00");
  expect(
    plan().getByRole("button", {
      name: /^\$200\.00 available in Reimbursements\./,
    }),
  ).toBeTruthy();
});

const property = (label: string) =>
  within(screen.getByRole("complementary", { name: "Details" })).getByText(
    label,
    { exact: true },
  ).nextElementSibling!.textContent;

test("the envelope's details show its float minus what's owed as its available money", async () => {
  const { user } = await renderShell({ book: withPeople() });
  await setFloat(user, "200");

  await user.click(
    plan().getByRole("checkbox", { name: "Select Reimbursements" }),
  );

  expect(property("Float")).toBe("$200.00");
  expect(property("Owed to you")).toBe("$0.00");
  expect(property("Available")).toBe("$200.00");
  expect(property("Account")).toBe("Reimbursements");
});

test("with a partner, People lists the partner by first name before Reimbursements", async () => {
  // A member's name is their budget's; the first name is their profile's.
  await renderShell({
    book: withCounterpartyAccounts(
      addMember(budgetFixture(), "anna", "Home budget", "2026-10"),
    ),
    overview: () => readyOverview({ partnerFirstName: "Anna" }),
  });

  await waitFor(() =>
    expect(
      sidebar()
        .getAllByRole("link", { name: /^(Anna|Reimbursements|Partner)/ })
        .map((button) => button.textContent?.replace(/\$.*/, "")),
    ).toEqual(["Anna", "Reimbursements"]),
  );
  // The plan lists the envelopes in the same order.
  expect(
    plan()
      .getAllByRole("checkbox", { name: /^Select (Anna|Reimbursements)$/ })
      .map((box) => box.getAttribute("aria-label")),
  ).toEqual(["Select Anna", "Select Reimbursements"]);
});

test("Reimbursements opens its register, which explains where its entries come from and offers no way to add one", async () => {
  const { user } = await renderShell({ book: withPeople() });

  await user.click(sidebar().getByRole("link", { name: /^Reimbursements/ }));

  expect(screen.getByText("Nothing owed yet.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add transaction" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reconcile" })).toBeNull();
  expect(screen.queryByRole("button", { name: "File import" })).toBeNull();
  // No bank clears these entries, so the balance is simply what's owed.
  expect(screen.queryByText("Cleared")).toBeNull();
  expect(screen.getByText("Owed to you").nextElementSibling?.textContent).toBe(
    "$0.00",
  );
});

test("a new transaction can't go to a counterparty account or into a paired envelope", async () => {
  const { user } = await renderShell({ book: withPeople() });
  await user.click(sidebar().getByRole("link", { name: /^Checking/ }));
  await user.click(screen.getByRole("button", { name: "Add transaction" }));
  await user.keyboard("{Escape}");
  const form = within(screen.getByRole("form", { name: "New transaction" }));

  await user.click(form.getByLabelText("Payee", { exact: true }));
  expect(screen.queryByRole("option", { name: /Reimbursements/ })).toBeNull();

  await user.click(form.getByRole("combobox", { name: "Category" }));
  expect(screen.getByRole("option", { name: /Gifts/ })).toBeTruthy();
  expect(screen.queryByRole("option", { name: /Reimbursements/ })).toBeNull();
});

test("categorizing selected transactions doesn't offer a paired envelope", async () => {
  const { user } = await renderShell({
    book: withCounterpartyAccounts(
      budgetFixture({
        seedCommands: [
          {
            type: "transaction.upsert",
            id: "seed-market",
            transactionId: "market",
            accountId: "checking",
            date: "2026-10-10",
            payee: "Market",
            amount: -2500,
            status: "posted",
          },
        ],
      }),
    ),
  });
  await user.click(sidebar().getByRole("link", { name: /^Checking/ }));
  await user.click(screen.getByRole("checkbox", { name: "Select Market" }));
  await user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Categorize" }),
  );
  const form = within(
    screen.getByRole("form", { name: "Categorize transactions" }),
  );

  await user.click(form.getByRole("combobox", { name: "Category" }));
  expect(screen.getByRole("option", { name: /Gifts/ })).toBeTruthy();
  expect(screen.queryByRole("option", { name: /Reimbursements/ })).toBeNull();
});
