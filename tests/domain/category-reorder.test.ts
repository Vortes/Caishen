import assert from "node:assert/strict";
import test from "node:test";
import { createBook, execute, projectBook } from "../../src/domain/engine";
import { bookToRows, rowsToBook } from "../../src/domain/rows";

void test("category order survives storage while hidden categories and other groups keep their places", () => {
  let book = createBook("owner", "Budget", "2026-10");
  for (const [id, group] of [
    ["food", "Everyday"],
    ["rent", "Bills"],
    ["home", "Everyday"],
    ["fun", "Everyday"],
  ] as const)
    book = execute(book, "owner", {
      type: "category.add",
      id: `add-${id}`,
      categoryId: id,
      name: id,
      group,
    });

  const command = {
    type: "category.reorder" as const,
    id: "reorder",
    group: "Everyday",
    categoryIds: ["fun", "rent", "missing", "food", "fun"],
  };
  const reordered = execute(book, "owner", command);
  const restored = rowsToBook(bookToRows(reordered));
  const categories = projectBook(restored, "owner", "2026-10").categories;
  assert.deepEqual(
    categories
      .filter((item) => !item.counterpartyAccountId)
      .map((item) => item.id),
    ["fun", "rent", "home", "food"],
  );
  assert.equal(categories.find((item) => item.id === "rent")?.group, "Bills");
  assert.deepEqual(execute(reordered, "owner", command), reordered);
  assert.throws(() => execute(book, "owner", command, "agent"), /user action/);
});

void test("a category moves into another group at the place the drop names, and the group it leaves stays in the plan", () => {
  let book = createBook("owner", "Budget", "2026-10");
  for (const [id, group] of [
    ["food", "Everyday"],
    ["rent", "Bills"],
    ["power", "Bills"],
    ["gift", "Gifts"],
  ] as const)
    book = execute(book, "owner", {
      type: "category.add",
      id: `add-${id}`,
      categoryId: id,
      name: id,
      group,
    });

  const command = {
    type: "category.move" as const,
    id: "move",
    categoryId: "gift",
    group: "Bills",
    categoryIds: ["rent", "gift", "power"],
  };
  const executed = execute(book, "owner", command);
  const moved = rowsToBook(bookToRows(executed));
  const plan = projectBook(moved, "owner", "2026-10");
  const own = plan.categories.filter((item) => !item.counterpartyAccountId);
  assert.deepEqual(
    own.filter((item) => item.group === "Bills").map((item) => item.id),
    ["rent", "gift", "power"],
  );
  assert.deepEqual(
    own.filter((item) => item.group === "Everyday").map((item) => item.id),
    ["food"],
  );
  assert.deepEqual(
    moved.budgets.owner?.groups?.filter((name) => name !== "People"),
    ["Everyday", "Bills", "Gifts"],
  );
  assert.deepEqual(execute(executed, "owner", command), executed);
  assert.throws(() => execute(book, "owner", command, "agent"), /user action/);
});

void test("card payment categories stay in their group, and other categories stay out of it", () => {
  let book = createBook("owner", "Budget", "2026-10");
  book = execute(book, "owner", {
    type: "category.add",
    id: "add-food",
    categoryId: "food",
    name: "food",
    group: "Everyday",
  });
  book = execute(book, "owner", {
    type: "account.add",
    id: "add-card",
    accountId: "visa",
    name: "Visa",
    kind: "credit",
    openingBalance: 0,
  });

  assert.throws(
    () =>
      execute(book, "owner", {
        type: "category.move",
        id: "move-card",
        categoryId: "card:visa",
        group: "Everyday",
        categoryIds: ["card:visa", "food"],
      }),
    /stay in their group/,
  );
  assert.throws(
    () =>
      execute(book, "owner", {
        type: "category.move",
        id: "move-food",
        categoryId: "food",
        group: "Credit card payments",
        categoryIds: ["food", "card:visa"],
      }),
    /can't hold/,
  );
});
