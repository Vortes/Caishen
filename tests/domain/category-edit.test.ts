import assert from "node:assert/strict";
import test from "node:test";
import {
  createBook,
  execute,
  projectBook,
  type Book,
  type Command,
} from "../../src/domain/engine";
import { bookToRows, rowsToBook } from "../../src/domain/rows";

const month = "2026-10";

function plan(...commands: Command[]) {
  let book = createBook("owner", "Budget", month);
  for (const command of commands) book = execute(book, "owner", command);
  return book;
}

function add(categoryId: string, group = "Everyday"): Command {
  return {
    type: "category.add",
    id: `add-${categoryId}`,
    categoryId,
    name: categoryId,
    group,
  };
}

const stored = (book: Book) =>
  projectBook(rowsToBook(bookToRows(book)), "owner", month);

void test("a renamed category keeps its group and survives storage", () => {
  const book = plan(add("food"), add("rent", "Bills"));
  const renamed = execute(book, "owner", {
    type: "category.rename",
    id: "rename",
    categoryId: "food",
    name: "  Groceries ",
  });
  const food = stored(renamed).categories.find((item) => item.id === "food");
  assert.equal(food?.name, "Groceries");
  assert.equal(food?.group, "Everyday");
  assert.throws(
    () =>
      execute(
        book,
        "owner",
        {
          type: "category.rename",
          id: "rename",
          categoryId: "food",
          name: "Groceries",
        },
        "agent",
      ),
    /user action/,
  );
});

void test("a category can't take a name its group already has, or rename a card's payment", () => {
  const book = plan(add("food"), add("rent"), {
    type: "account.add",
    id: "card",
    accountId: "card",
    name: "Visa",
    kind: "credit",
    openingBalance: 0,
  });
  const rename = (categoryId: string, name: string) =>
    execute(book, "owner", {
      type: "category.rename",
      id: `rename-${categoryId}-${name}`,
      categoryId,
      name,
    });
  assert.throws(() => rename("food", "RENT"), /Everyday already has rent/);
  // Its own name in another case is a rename, not a clash.
  assert.equal(
    projectBook(rename("food", "Food"), "owner", month).categories.find(
      (item) => item.id === "food",
    )?.name,
    "Food",
  );
  assert.throws(
    () => rename("card:card", "Card bill"),
    /Caishen names this category/,
  );
});

void test("a renamed group keeps its place and its categories, and survives storage", () => {
  const book = plan(
    add("food"),
    { type: "group.add", id: "bills", name: "Bills" },
    add("rent", "Bills"),
    { type: "group.add", id: "pets", name: "Pets" },
    {
      type: "account.add",
      id: "card",
      accountId: "card",
      name: "Visa",
      kind: "credit",
      openingBalance: 0,
    },
  );
  const rename = (from: string, name: string) =>
    execute(book, "owner", {
      type: "group.rename",
      id: `rename-${from}-${name}`,
      group: from,
      name,
    });
  const renamed = stored(rename("Bills", " Housing "));
  assert.deepEqual(renamed.budget.groups, ["Pets", "Housing"]);
  assert.equal(
    renamed.categories.find((item) => item.id === "rent")?.group,
    "Housing",
  );
  // A group older budgets know only through its categories.
  assert.equal(
    stored(rename("Everyday", "Daily")).categories.find(
      (item) => item.id === "food",
    )?.group,
    "Daily",
  );
  assert.deepEqual(stored(rename("Pets", "pets")).budget.groups, [
    "pets",
    "Bills",
  ]);
  assert.throws(() => rename("Pets", "bills"), /Category group already exists/);
  assert.throws(() => rename("Gone", "Here"), /Category group not found/);
  assert.throws(
    () => rename("Credit card payments", "Cards"),
    /Caishen keeps this group/,
  );
});

const checking: Command = {
  type: "account.add",
  id: "checking",
  accountId: "checking",
  name: "Checking",
  kind: "cash",
  openingBalance: 100_000,
};

void test("an unused category is deleted with its target, and a used one asks where its history goes", () => {
  const book = plan(
    checking,
    add("food"),
    add("fun"),
    add("rent"),
    {
      type: "target.set",
      id: "target",
      categoryId: "fun",
      target: {
        cadence: "monthly",
        behavior: "refill",
        amount: 5_000,
        startMonth: month,
      },
    },
    {
      type: "transaction.upsert",
      id: "coffee",
      transactionId: "coffee",
      accountId: "checking",
      date: "2026-10-02",
      amount: -400,
      payee: "Cafe",
      categoryId: "food",
    },
    {
      type: "assign",
      id: "assign-rent",
      categoryId: "rent",
      month,
      amount: 0,
    },
  );
  const remove = (categoryId: string) =>
    execute(book, "owner", {
      type: "category.delete",
      id: `delete-${categoryId}`,
      categoryId,
    });
  const ids = (deleted: Book) =>
    stored(deleted)
      .categories.filter((item) => !item.counterpartyAccountId)
      .map((item) => item.id);
  assert.deepEqual(ids(remove("fun")), ["food", "rent"]);
  // An assignment of nothing is no history.
  assert.deepEqual(ids(remove("rent")), ["food", "fun"]);
  assert.throws(
    () => remove("food"),
    /Choose a category for food's transactions and assigned money/,
  );
  assert.throws(
    () =>
      execute(
        book,
        "owner",
        {
          type: "category.delete",
          id: "delete-agent",
          categoryId: "fun",
        },
        "agent",
      ),
    /user action/,
  );
});

void test("a deleted category's transactions and assigned money move to the category the user chose", () => {
  const spend = (transactionId: string, extra: Partial<Command>) =>
    ({
      type: "transaction.upsert",
      id: transactionId,
      transactionId,
      accountId: "checking",
      date: "2026-10-02",
      amount: -400,
      payee: "Cafe",
      categoryId: "food",
      ...extra,
    }) as Command;
  const book = plan(
    checking,
    add("food"),
    add("rent"),
    {
      type: "account.add",
      id: "card",
      accountId: "card",
      name: "Visa",
      kind: "credit",
      openingBalance: 0,
    },
    spend("coffee", {}),
    spend("lunch", {
      amount: -1_000,
      payee: "Deli",
      categoryId: undefined,
      lines: [
        { lineId: "lunch-food", categoryId: "food", amount: -600 },
        { lineId: "lunch-rent", categoryId: "rent", amount: -400 },
      ],
    }),
    spend("mistake", { amount: -50, payee: "Oops" }),
    {
      type: "transaction.remove",
      id: "remove-mistake",
      transactionId: "mistake",
    },
    {
      type: "assign",
      id: "food-oct",
      categoryId: "food",
      month,
      amount: 2_000,
    },
    {
      type: "assign",
      id: "rent-oct",
      categoryId: "rent",
      month,
      amount: 3_000,
    },
    {
      type: "assign",
      id: "food-nov",
      categoryId: "food",
      month: "2026-11",
      amount: 500,
    },
  );
  const moved = execute(book, "owner", {
    type: "category.delete",
    id: "delete-food",
    categoryId: "food",
    moveTo: "rent",
  });
  const budget = rowsToBook(bookToRows(moved)).budgets.owner!;
  assert.deepEqual(
    budget.transactions.map((transaction) => [
      transaction.id,
      transaction.categoryId ??
        transaction.lines?.map((line) => line.categoryId),
    ]),
    [
      ["coffee", "rent"],
      ["lunch", ["rent", "rent"]],
      ["mistake", "rent"],
    ],
  );
  assert.deepEqual(
    budget.assignments.map((item) => [
      item.categoryId,
      item.month,
      item.amount,
    ]),
    [
      ["rent", month, 5_000],
      ["rent", "2026-11", 500],
    ],
  );
  assert.deepEqual(
    Object.values(budget.payeeMemory ?? {}).map((memory) => [
      memory.payee,
      memory.categoryId,
    ]),
    [
      ["Cafe", "rent"],
      ["Oops", "rent"],
    ],
  );
  const rent = projectBook(moved, "owner", month).categories.find(
    (item) => item.id === "rent",
  );
  assert.equal(rent?.available, 5_000 - 400 - 1_000);

  const refuse = (moveTo: string) =>
    execute(book, "owner", {
      type: "category.delete",
      id: `delete-food-${moveTo}`,
      categoryId: "food",
      moveTo,
    });
  assert.throws(() => refuse("food"), /another category/);
  assert.throws(() => refuse("gone"), /Category access denied/);
  assert.throws(() => refuse("card:card"), /another category/);
});

void test("a deleted group takes its categories with it, moving their history to the category the user chose", () => {
  const book = plan(
    checking,
    add("food"),
    { type: "group.add", id: "bills", name: "Bills" },
    add("rent", "Bills"),
    add("power", "Bills"),
    { type: "group.add", id: "pets", name: "Pets" },
    {
      type: "assign",
      id: "rent-oct",
      categoryId: "rent",
      month,
      amount: 3_000,
    },
    {
      type: "assign",
      id: "power-oct",
      categoryId: "power",
      month,
      amount: 1_000,
    },
  );
  const remove = (group: string, moveTo?: string) =>
    execute(book, "owner", {
      type: "group.delete",
      id: `delete-${group}-${moveTo}`,
      group,
      moveTo,
    });
  const empty = stored(remove("Pets"));
  assert.deepEqual(empty.budget.groups, ["Bills"]);
  const moved = stored(remove("Bills", "food"));
  assert.deepEqual(moved.budget.groups, ["Pets"]);
  assert.deepEqual(
    moved.categories
      .filter((item) => !item.counterpartyAccountId)
      .map((item) => [item.id, item.assigned]),
    [["food", 4_000]],
  );
  assert.throws(
    () => remove("Bills"),
    /Choose a category for rent's transactions and assigned money/,
  );
  assert.throws(() => remove("Bills", "power"), /another category/);
});
