import { screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { addMember, execute, personAccountId } from "~/domain/engine";
import { withPeople } from "~/domain/people";
import { budgetFixture, readyOverview, renderShell } from "./shell-harness";

const mom = personAccountId("mom");
// The owner's budget with one person, Mom, and her paired envelope.
const withMom = () =>
  execute(budgetFixture(), "owner", {
    type: "person.add",
    id: "add-mom",
    accountId: mom,
    name: "Mom",
  });

const sidebar = () =>
  within(screen.getByRole("navigation", { name: "Budget navigation" }));
const plan = () => within(screen.getByRole("group", { name: "Categories" }));

test("People lists each person in the sidebar and leads the plan with their envelope", async () => {
  // A person with a float isn't settled, so they stay in the list.
  await renderShell({
    book: execute(withMom(), "owner", {
      type: "assign",
      id: "float",
      categoryId: "envelope:person:mom",
      month: "2026-10",
      amount: 5_000,
    }),
  });

  const people = sidebar().getByRole("button", { name: /^People/ });
  expect(people.getAttribute("aria-expanded")).toBe("true");
  expect(sidebar().getByRole("link", { name: /^Mom/ })).toBeTruthy();

  // The column header's toggle opens and folds every group.
  const groups = plan()
    .getAllByRole("button", { expanded: true })
    .map((button) => button.getAttribute("aria-label"))
    .filter((name) => name !== "Collapse all groups");
  expect(groups[0]).toMatch(/^People/);
  expect(plan().getByRole("checkbox", { name: "Select Mom" })).toBeTruthy();
  // People holds only the system's envelopes.
  expect(
    plan().queryByRole("button", { name: "Add a category to People" }),
  ).toBeNull();
  expect(
    plan().getByRole("button", { name: "Add a category to Everyday" }),
  ).toBeTruthy();
});

const readyToAssign = () =>
  screen
    .getByText("Ready to Assign")
    .closest("section")!
    .querySelector("strong")!.textContent;

async function setFloat(
  user: Awaited<ReturnType<typeof renderShell>>["user"],
  amount: string,
) {
  await user.click(
    plan().getByRole("button", {
      name: /assigned to Mom\. Edit assigned amount$/,
    }),
  );
  const field = plan().getByRole("textbox", {
    name: "Assigned amount for Mom",
  });
  await user.clear(field);
  await user.type(field, `${amount}{Enter}`);
}

test("a float on a person comes out of Ready to Assign and shows as the envelope's available money", async () => {
  const { user } = await renderShell({ book: withMom() });
  expect(readyToAssign()).toBe("$900.00");

  await setFloat(user, "200");

  expect(readyToAssign()).toBe("$700.00");
  expect(
    plan().getByRole("button", {
      name: /^\$200\.00 available in Mom\./,
    }),
  ).toBeTruthy();
});

const property = (label: string) =>
  within(screen.getByRole("complementary", { name: "Details" })).getByText(
    label,
    { exact: true },
  ).nextElementSibling!.textContent;

test("the envelope's details show its float minus what's owed as its available money", async () => {
  const { user } = await renderShell({ book: withMom() });
  await setFloat(user, "200");

  await user.click(plan().getByRole("checkbox", { name: "Select Mom" }));

  expect(property("Float")).toBe("$200.00");
  expect(property("Owed to you")).toBe("$0.00");
  expect(property("Available")).toBe("$200.00");
  expect(property("Account")).toBe("Mom");
});

test("with a partner, People lists the partner by first name before everyone else", async () => {
  // A member's name is their budget's; the first name is their profile's.
  let book = withPeople(addMember(withMom(), "anna", "Home budget", "2026-10"));
  book = execute(book, "owner", {
    type: "assign",
    id: "float",
    categoryId: "envelope:person:mom",
    month: "2026-10",
    amount: 5_000,
  });
  await renderShell({
    book,
    overview: () => readyOverview({ partnerFirstName: "Anna" }),
  });

  await waitFor(() =>
    expect(
      sidebar()
        .getAllByRole("link", { name: /^(Anna|Mom|Partner)/ })
        .map((button) => button.textContent?.replace(/\$.*/, "")),
    ).toEqual(["Anna", "Mom"]),
  );
});

test("a person with nothing owed folds under Settled, and their register explains where its entries come from and offers no way to add one", async () => {
  const { user } = await renderShell({ book: withMom() });

  expect(sidebar().queryByRole("link", { name: /^Mom/ })).toBeNull();
  await user.click(sidebar().getByRole("button", { name: "Show settled (1)" }));
  await user.click(sidebar().getByRole("link", { name: /^Mom/ }));

  expect(screen.getByText("Nothing owed yet.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add transaction" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reconcile" })).toBeNull();
  expect(screen.queryByRole("button", { name: "File import" })).toBeNull();
  // No bank clears these entries, so the balance is simply what's owed.
  expect(screen.queryByText("Cleared")).toBeNull();
  expect(
    screen.getByText("You and Mom are even").nextElementSibling?.textContent,
  ).toBe("$0.00");
});

test("a new transaction can't go to a counterparty account or into a paired envelope", async () => {
  const { user } = await renderShell({ book: withMom() });
  await user.click(sidebar().getByRole("link", { name: /^Checking/ }));
  await user.click(screen.getByRole("button", { name: "Add transaction" }));
  await user.keyboard("{Escape}");
  const form = within(screen.getByRole("form", { name: "New transaction" }));

  await user.click(form.getByLabelText("Payee", { exact: true }));
  expect(screen.queryByRole("option", { name: /^Mom/ })).toBeNull();

  await user.click(form.getByRole("combobox", { name: "Category" }));
  expect(screen.getByRole("option", { name: /Gifts/ })).toBeTruthy();
  // Mom is offered once, as the person the whole purchase is for, never
  // as her envelope.
  expect(screen.getAllByRole("option", { name: /^Mom/ })).toHaveLength(1);
});

test("categorizing selected transactions doesn't offer a paired envelope", async () => {
  const { user } = await renderShell({
    book: execute(
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
      "owner",
      { type: "person.add", id: "add-mom", accountId: mom, name: "Mom" },
    ),
  });
  await user.click(sidebar().getByRole("link", { name: /^Checking/ }));
  await user.click(screen.getByRole("checkbox", { name: "Select Market" }));
  await user.click(
    within(
      screen.getByRole("toolbar", { name: "Selected transactions" }),
    ).getByRole("button", { name: "Categorize" }),
  );
  const menu = within(
    screen.getByRole("menu", { name: "Categorize transactions" }),
  );
  expect(menu.queryByRole("menuitem", { name: "People" })).toBeNull();
  await user.click(menu.getByRole("menuitem", { name: "Everyday" }));
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("menuitem", { name: /Gifts/ })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: /^Mom/ })).toBeNull();
});

// Mom owes the owner $20.00 for a dinner paid from checking.
const momOwes = () =>
  execute(withMom(), "owner", {
    type: "transaction.upsert",
    id: "dinner",
    transactionId: "dinner",
    accountId: "checking",
    date: "2026-10-05",
    payee: "Dinner",
    amount: -2_000,
    recordedAt: "2026-10-05T12:00:00Z",
    counterpartyShare: { accountId: mom, amount: 2_000 },
  });

const lunch = () =>
  execute(withMom(), "owner", {
    type: "transaction.upsert",
    id: "lunch",
    transactionId: "lunch",
    accountId: "checking",
    date: "2026-10-06",
    payee: "Lunch",
    amount: -3_000,
    categoryId: "gifts",
  });

test("picking a person who already has an account shares half with them", async () => {
  const { user } = await renderShell({ book: lunch() });
  await user.click(sidebar().getByRole("link", { name: /^Checking/ }));
  await user.click(screen.getByRole("button", { name: "Share Lunch" }));
  const menu = within(screen.getByRole("dialog", { name: "Who this is for" }));
  expect(menu.getByText("Who is this for?")).toBeTruthy();
  // The only person is already chosen; Half applies at once.
  expect(
    menu.getByRole("combobox", { name: "Who is this for" }),
  ).toHaveProperty("value", "Mom");
  await user.click(menu.getByRole("button", { name: /^Half/ }));

  expect(
    await screen.findByRole("button", {
      name: "Mom’s share of Lunch: $15.00. Change",
    }),
  ).toBeTruthy();
});

test("a name typed in Who is this for adds that person with the share", async () => {
  const { user } = await renderShell({ book: lunch() });
  await user.click(sidebar().getByRole("link", { name: /^Checking/ }));
  await user.click(screen.getByRole("button", { name: "Share Lunch" }));
  const menu = within(screen.getByRole("dialog", { name: "Who this is for" }));
  const who = menu.getByRole("combobox", { name: "Who is this for" });
  await user.clear(who);
  await user.type(who, "Sam");
  await user.click(screen.getByRole("option", { name: "New person “Sam”" }));
  // Nobody is added until the share applies.
  expect(sidebar().queryByRole("link", { name: /^Sam/ })).toBeNull();
  await user.click(menu.getByRole("button", { name: /^All of it/ }));

  expect(
    await screen.findByRole("button", {
      name: "Sam’s share of Lunch: $30.00. Change",
    }),
  ).toBeTruthy();
  await user.click(sidebar().getByRole("link", { name: /^Sam/ }));
  expect(screen.getByText("Sam owes you").nextElementSibling?.textContent).toBe(
    "$30.00",
  );
});

test("New person with nothing typed asks for the name in the same field", async () => {
  const { user } = await renderShell({ book: lunch() });
  await user.click(sidebar().getByRole("link", { name: /^Checking/ }));
  await user.click(screen.getByRole("button", { name: "Share Lunch" }));
  const menu = within(screen.getByRole("dialog", { name: "Who this is for" }));
  const who = menu.getByRole("combobox", { name: "Who is this for" });
  await user.click(who);
  await user.click(screen.getByRole("option", { name: "New person" }));
  // No second form: the same field waits for the name.
  const nameBox = menu.getByRole("textbox", { name: "Who is this for" });
  expect(nameBox).toHaveProperty("value", "");
  await waitFor(() => expect(nameBox).toBe(document.activeElement));
  expect(menu.queryByRole("button", { name: "Continue" })).toBeNull();
  expect(menu.getByRole("button", { name: /^Half/ })).toHaveProperty(
    "disabled",
    true,
  );
  // The field is the name now: no list offers to add them a second time,
  // and how much enables as the name is typed.
  await user.type(nameBox, "Sam");
  expect(screen.queryByRole("option", { name: /New person/ })).toBeNull();
  expect(
    menu.getByText("Joins People once shared. Only you see them."),
  ).toBeTruthy();
  expect(menu.getByRole("button", { name: /^Half/ })).toHaveProperty(
    "disabled",
    false,
  );
  await user.click(menu.getByRole("button", { name: /^Half/ }));

  expect(
    await screen.findByRole("button", {
      name: "Sam’s share of Lunch: $15.00. Change",
    }),
  ).toBeTruthy();
});

test("among several people and no partner, nobody is chosen for a new share", async () => {
  const book = execute(lunch(), "owner", {
    type: "person.add",
    id: "add-sam",
    accountId: personAccountId("sam"),
    name: "Sam",
  });
  const { user } = await renderShell({ book });
  await user.click(sidebar().getByRole("link", { name: /^Checking/ }));
  await user.click(screen.getByRole("button", { name: "Share Lunch" }));
  const menu = within(screen.getByRole("dialog", { name: "Who this is for" }));
  expect(
    menu.getByRole("combobox", { name: "Who is this for" }),
  ).toHaveProperty("value", "");
  for (const amount of [/^Half/, /^All of it/, /^An amount/])
    expect(menu.getByRole("button", { name: amount })).toHaveProperty(
      "disabled",
      true,
    );
  expect(menu.getByRole("button", { name: /^Just mine/ })).toHaveProperty(
    "disabled",
    false,
  );
});

test("the person on Caishen leads Who is this for, and everyone gets the same amounts", async () => {
  const book = withPeople(addMember(lunch(), "anna", "Home budget", "2026-10"));
  const { user } = await renderShell({
    book,
    overview: () => readyOverview({ partnerFirstName: "Anna" }),
  });
  await user.click(sidebar().getByRole("link", { name: /^Checking/ }));
  await user.click(screen.getByRole("button", { name: "Share Lunch" }));
  const menu = within(screen.getByRole("dialog", { name: "Who this is for" }));
  const who = menu.getByRole("combobox", { name: "Who is this for" });
  expect(who).toHaveProperty("value", "Anna");
  await user.click(who);
  const options = screen
    .getAllByRole("option")
    .map((option) => option.textContent);
  expect(options[0]).toMatch(/^New person/);
  expect(options[1]).toMatch(/^Anna/);
  expect(options[2]).toMatch(/^Mom/);
  expect(screen.getByText("On Caishen")).toBeTruthy();
  await user.click(screen.getByRole("option", { name: /^Mom/ }));
  for (const amount of [/^Half/, /^All of it/, /^An amount/])
    expect(menu.getByRole("button", { name: amount })).toBeTruthy();
});

test("a repayment recorded from a person's register clears what they owe", async () => {
  const { user } = await renderShell({ book: momOwes() });
  await user.click(sidebar().getByRole("link", { name: /^Mom/ }));
  expect(screen.getByText("Mom owes you").nextElementSibling?.textContent).toBe(
    "$20.00",
  );

  await user.click(screen.getByRole("button", { name: "Record repayment" }));
  const popover = within(
    screen.getByRole("dialog", { name: "Record a repayment from Mom" }),
  );
  // What Mom owes and the only cash account are filled in.
  expect(popover.getByLabelText("Amount")).toHaveProperty("value", "20.00");
  await user.click(popover.getByRole("button", { name: "Record" }));

  expect(
    (await screen.findByText("You and Mom are even")).nextElementSibling
      ?.textContent,
  ).toBe("$0.00");
  expect(screen.getByText("Repayment")).toBeTruthy();
});

test("a person is renamed from the People settings page", async () => {
  const { user } = await renderShell({ book: momOwes() });
  await user.click(screen.getByRole("button", { name: "Component budget" }));
  await user.click(screen.getByRole("menuitem", { name: "Settings" }));
  await user.click(screen.getByRole("link", { name: "People" }));
  await screen.findByRole("heading", { name: "Other people" });
  expect(screen.getByText("Mom owes you $20.00.")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Rename" }));
  const name = screen.getByLabelText("Name");
  await user.clear(name);
  await user.type(name, "Mother");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("Mother")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
});
