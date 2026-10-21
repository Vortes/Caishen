import assert from "node:assert/strict";
import test from "node:test";
import {
  execute,
  projectBook,
  type Book,
  type Command,
} from "../../src/domain/engine";
import { isPersonalLedger } from "../../src/domain/shared-ledger";
import { personalSpendingEntries } from "../../src/domain/spending";
import {
  openPersonalBudget,
  PARTNER_MAINTENANCE_MESSAGE,
  storeState,
} from "../../src/domain/stored-book";
import {
  buildDevelopmentSeed,
  shiftMonth,
} from "../../src/server/dev/seed-scenarios";

const seed = buildDevelopmentSeed({
  userId: "alex",
  partnerId: "jordan",
  asOf: "2026-10-17",
});
type Stored = Record<string, unknown> & {
  budgets: Record<
    string,
    Record<string, unknown> & { transactions: Record<string, unknown>[] }
  >;
};
// Stored JSON has no undefined fields, so comparisons go through JSON too.
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const stored = (book: Book = seed.book) => json(book) as Stored;

// One budget holds a transaction kind written by newer code.
function withNewerKind(owner = "alex"): Stored {
  const value = stored();
  value.budgets[owner]!.transactions.push({
    ...(json(
      seed.book.budgets[owner]!.transactions.find(
        (transaction) => !transaction.sharedCategoryId,
      ),
    ) as object),
    id: "from-a-newer-release",
    kind: "rebate",
  });
  return value;
}

function ready(read: ReturnType<typeof openPersonalBudget>) {
  assert.equal(read.status, "ready");
  return read.state;
}

void test("a readable household opens as the whole book", () => {
  const read = openPersonalBudget(stored(), "alex");
  assert.deepEqual(json(read), {
    status: "ready",
    state: stored(),
    failures: [],
  });
});

void test("an unreadable personal budget puts only its owner's plan under maintenance", () => {
  const value = withNewerKind();
  const owner = openPersonalBudget(value, "alex");
  assert.equal(owner.status, "maintenance");
  assert.deepEqual(
    owner.failures.map((failure) => [
      failure.part,
      "ownerId" in failure && failure.ownerId,
    ]),
    [["budget", "alex"]],
  );
  assert.deepEqual(owner.failures[0]!.issues[0]!.path.slice(0, 3), [
    "budgets",
    "alex",
    "transactions",
  ]);
  assert.equal(owner.failures[0]!.issues[0]!.path.at(-1), "kind");

  for (const [unreadable, reader] of [
    ["alex", "jordan"],
    ["jordan", "alex"],
  ] as const) {
    const partner = openPersonalBudget(withNewerKind(unreadable), reader);
    const state = ready(partner);
    assert.ok(isPersonalLedger(state));
    assert.equal(partner.failures.length, 1);
    // The partner's numbers are exactly what the whole book gives them.
    for (const month of [
      seed.firstMonth,
      shiftMonth(seed.month, -1),
      seed.month,
    ])
      assert.deepEqual(
        json(projectBook(state, reader, month, seed.month)),
        json(projectBook(seed.book, reader, month, seed.month)),
      );
    assert.deepEqual(
      json(personalSpendingEntries(state, reader)),
      json(personalSpendingEntries(seed.book, reader)),
    );
  }
});

void test("the readable partner's changes save around the unreadable budget, which is never written over", () => {
  const value = withNewerKind();
  const commands: Command[] = [
    {
      type: "transaction.upsert",
      id: "shared-dinner",
      transactionId: "shared-dinner",
      accountId: "checking",
      date: "2026-10-16",
      amount: -8400,
      payee: "Corner bistro",
      categoryId: "groceries",
      sharedCategoryId: "groceries",
    },
    {
      type: "assign",
      id: "assign-dining",
      categoryId: "dining",
      month: seed.month,
      amount: 5000,
    },
  ];
  let state = ready(openPersonalBudget(value, "jordan"));
  let book = seed.book;
  for (const command of commands) {
    state = execute(state, "jordan", command);
    book = execute(book, "jordan", command);
  }
  const saved = json(storeState(value, state)) as Stored;
  assert.deepEqual(saved.budgets.alex, value.budgets.alex);
  const expected = stored(book);
  assert.deepEqual(saved.budgets.jordan, expected.budgets.jordan);
  for (const part of [
    "sharedCategories",
    "obligations",
    "settlements",
    "audit",
  ])
    assert.deepEqual(saved[part], expected[part]);
  // Once the newer kind can be read again, the household is whole.
  saved.budgets.alex = expected.budgets.alex!;
  assert.deepEqual(
    json(ready(openPersonalBudget(saved, "jordan"))),
    json(book),
  );
});

void test("changes that need the unreadable partner's budget are refused", () => {
  const value = withNewerKind();
  const state = execute(
    execute(ready(openPersonalBudget(value, "jordan")), "jordan", {
      type: "category.add",
      id: "add-pets",
      categoryId: "pets",
      name: "Pets",
    }),
    "jordan",
    {
      type: "shared.create",
      id: "share-pets",
      sharedCategoryId: "pets",
      participants: ["jordan", "alex"],
      weights: { jordan: 1, alex: 1 },
      categoryIds: { jordan: "pets", alex: "pets" },
    },
  );
  assert.throws(() => storeState(value, state), {
    message: PARTNER_MAINTENANCE_MESSAGE,
  });
});

void test("a partner's plan also waits when the facts it uses can't be read", () => {
  const value = stored();
  const shared = value.budgets.alex!.transactions.find(
    (transaction) => "sharedCategoryId" in transaction,
  ) as unknown as { status: string };
  shared.status = "authorized";
  assert.equal(openPersonalBudget(value, "alex").status, "maintenance");
  const partner = openPersonalBudget(value, "jordan");
  assert.equal(partner.status, "maintenance");
  assert.deepEqual(
    partner.failures.map((failure) => failure.part),
    ["budget", "partner-facts"],
  );
});

void test("unreadable household data puts both plans under maintenance", () => {
  const settlementKind = stored();
  (settlementKind.settlements as { allocations: { kind: string }[] }[]).find(
    (settlement) => settlement.allocations.length,
  )!.allocations[0]!.kind = "waived";
  const missingCategory = stored();
  (
    missingCategory.sharedCategories as {
      categoryIds: Record<string, string>;
    }[]
  )[0]!.categoryIds.jordan = "deleted";
  for (const value of [settlementKind, missingCategory, null, { version: 2 }])
    for (const userId of ["alex", "jordan"]) {
      const read = openPersonalBudget(value, userId);
      assert.equal(read.status, "maintenance");
      assert.deepEqual(
        read.failures.map((failure) => failure.part),
        ["household"],
      );
    }
});

void test("a write of the whole book is validated as strictly as a read", () => {
  const book = structuredClone(seed.book);
  book.budgets.alex!.transactions[0]!.status = "authorized" as "posted";
  assert.throws(() => storeState(stored(), book));
});
