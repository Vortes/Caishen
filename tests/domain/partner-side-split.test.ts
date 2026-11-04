import assert from "node:assert/strict";
import test from "node:test";
import {
  addMember,
  createBook,
  execute,
  projectBook,
  type Book,
  type Command,
} from "../../src/domain/engine";
import { withPeople } from "../../src/domain/people";
import { linkedPersonId } from "./fixtures/people";

const month = "2026-10";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

// Anna pays a $100 dinner and shares half with Alan, who covered Steve with
// her: his $50 is $25 of his own dinner and $25 of a gift.
function dinner() {
  let book: Book = withPeople(
    addMember(createBook("alan", "Alan", month), "anna", "Anna", month),
  );
  let sequence = 0;
  const run = (actorId: string, command: WithoutId<Command>) => {
    book = execute(book, actorId, {
      ...command,
      id: `operation-${++sequence}`,
    });
    return book;
  };
  run("anna", {
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
  });
  run("anna", { type: "category.add", categoryId: "food", name: "Food" });
  run("anna", {
    type: "transaction.upsert",
    transactionId: "dinner",
    accountId: "checking",
    date: "2026-10-12",
    amount: -10_000,
    payee: "Noodle House",
    status: "posted",
    categoryId: "food",
    counterpartyShare: {
      accountId: linkedPersonId(book, "anna"),
      amount: 5_000,
    },
    recordedAt: "2026-10-12T20:00:00Z",
  });
  run("alan", { type: "category.add", categoryId: "dining", name: "Dining" });
  run("alan", { type: "category.add", categoryId: "gifts", name: "Gifts" });
  return {
    run,
    // Anna, as Alan's linked person.
    partnerId: linkedPersonId(book, "alan"),
    entryId: "anna:dinner:dinner",
    view: () => projectBook(book, "alan", month),
  };
}

const activity = (view: ReturnType<typeof projectBook>, id: string) =>
  view.categories.find((category) => category.id === id)!.activity;

void test("splitting your side of a partner's purchase spends each line in its category", () => {
  const household = dinner();
  household.run("alan", {
    type: "partner.categorize",
    entryId: household.entryId,
    categoryId: null,
    lines: [
      { lineId: "mine", categoryId: "dining", amount: -2_500 },
      { lineId: "steve", categoryId: "gifts", amount: -2_500 },
    ],
  });
  const view = household.view();
  assert.equal(activity(view, "dining"), -2_500);
  assert.equal(activity(view, "gifts"), -2_500);
  const row = view.partnerLedger.find((item) => item.id === household.entryId)!;
  assert.equal(row.needsCategory, false);
  assert.deepEqual(row.lines, [
    { id: "mine", categoryId: "dining", amount: -2_500 },
    { id: "steve", categoryId: "gifts", amount: -2_500 },
  ]);
});

void test("a split that doesn't add up to your part, or names a paired envelope, is refused", () => {
  const household = dinner();
  const split = (lines: { categoryId: string; amount: number }[]) => () =>
    household.run("alan", {
      type: "partner.categorize",
      entryId: household.entryId,
      categoryId: null,
      lines: lines.map((line, index) => ({ ...line, lineId: `line-${index}` })),
    });
  assert.throws(
    split([
      { categoryId: "dining", amount: -2_500 },
      { categoryId: "gifts", amount: -2_000 },
    ]),
    /add up to your part/,
  );
  const envelope = household
    .view()
    .categories.find(
      (category) => category.counterpartyAccountId === household.partnerId,
    )!;
  assert.throws(
    split([
      { categoryId: "dining", amount: -2_500 },
      { categoryId: envelope.id, amount: -2_500 },
    ]),
    /spending category for every split line/,
  );
});

void test("deleting a category moves its split lines to the one taking its history", () => {
  const household = dinner();
  household.run("alan", {
    type: "partner.categorize",
    entryId: household.entryId,
    categoryId: null,
    lines: [
      { lineId: "mine", categoryId: "dining", amount: -2_500 },
      { lineId: "steve", categoryId: "gifts", amount: -2_500 },
    ],
  });
  household.run("alan", {
    type: "category.delete",
    categoryId: "gifts",
    moveTo: "dining",
  });
  const view = household.view();
  assert.equal(activity(view, "dining"), -5_000);
  const row = view.partnerLedger.find((item) => item.id === household.entryId)!;
  assert.deepEqual(
    row.lines?.map((line) => line.categoryId),
    ["dining", "dining"],
  );
});

void test("a share edited after the split leaves the rest to categorize, and one category replaces the split", () => {
  const household = dinner();
  household.run("alan", {
    type: "partner.categorize",
    entryId: household.entryId,
    categoryId: null,
    lines: [
      { lineId: "mine", categoryId: "dining", amount: -2_500 },
      { lineId: "steve", categoryId: "gifts", amount: -2_500 },
    ],
  });
  household.run("anna", {
    type: "partner.edit",
    entryId: household.entryId,
    share: 6_000,
    recordedAt: "2026-10-13T12:00:00Z",
  });
  let view = household.view();
  assert.equal(activity(view, "dining"), -2_500);
  assert.equal(activity(view, "gifts"), -2_500);
  let row = view.partnerLedger.find((item) => item.id === household.entryId)!;
  assert.equal(row.needsCategory, true);

  household.run("alan", {
    type: "partner.categorize",
    entryId: household.entryId,
    categoryId: "dining",
  });
  view = household.view();
  assert.equal(activity(view, "dining"), -6_000);
  assert.equal(activity(view, "gifts"), 0);
  row = view.partnerLedger.find((item) => item.id === household.entryId)!;
  assert.equal(row.lines, undefined);
  assert.equal(row.needsCategory, false);
});
