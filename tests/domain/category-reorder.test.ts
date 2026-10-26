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
