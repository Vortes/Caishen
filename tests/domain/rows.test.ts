import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bookSchema,
  personalLedger,
  projectBook,
  type Book,
} from "../../src/domain/engine";
import {
  bookToRows,
  foldAssignments,
  personalLedgerToRows,
  rowKey,
  rowKeyParts,
  rowsToBook,
  rowsToPersonalLedger,
  rowVisibleTo,
  tableNames,
  type WireRow,
} from "../../src/domain/rows";
import { rowDataSchemas } from "../../src/domain/row-schemas";
import { deriveObligations } from "../../src/domain/shared-ledger";
import { buildDevelopmentSeed } from "../../src/server/dev/seed-scenarios";
import { buildCommandCorpus } from "./fixtures/command-corpus";
import { monthAfter, syntheticBook } from "./fixtures/synthetic-book";

// Stored JSON has no undefined fields, so comparisons go through JSON.
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// What rows hold of a book: everything but the audit, with assignments
// folded and generated obligations derived.
function stored(book: Book): Book {
  const copy = json(book);
  for (const budget of Object.values(copy.budgets))
    budget.assignments = foldAssignments(budget.assignments);
  copy.audit = [];
  copy.obligations = deriveObligations(copy);
  return json(copy);
}

const corpus = buildCommandCorpus();
const seed = buildDevelopmentSeed({
  userId: "alex",
  partnerId: "jordan",
  asOf: "2026-10-21",
});
const sample = bookSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("./fixtures/every-stored-value-book.json", import.meta.url),
      "utf8",
    ),
  ),
);
const books: [string, Book][] = [
  ["development seed", seed.book],
  ["stored sample", sample],
  ...corpus.steps.map((step, index): [string, Book] => [
    `corpus step ${index + 1} (${step.command.type})`,
    step.after,
  ]),
  ...[1, 2].map((value): [string, Book] => [
    `edge ${value}`,
    syntheticBook({
      seed: value,
      startMonth: "2025-11",
      months: 12,
      transactionsPerMonth: 15,
      assignmentsPerMonth: 8,
      edge: true,
    }),
  ]),
];

void test("every book round-trips through rows", () => {
  const filled = new Set<string>();
  for (const [name, book] of books) {
    const rows = bookToRows(book);
    for (const row of rows) filled.add(row.table);
    assert.deepStrictEqual(json(rowsToBook(rows)), stored(book), name);
    assert.ok(
      rows.every((row) => !row.deleted && row.revision === 0),
      name,
    );
    assert.deepStrictEqual(json(rows), rows, `${name}: rows are plain JSON`);
  }
  // Bank import rows come from the server's import state, not the engine,
  // and standing rules are no longer kept.
  assert.deepStrictEqual(
    tableNames.filter((table) => !filled.has(table)),
    ["rule", "bankImport"],
  );
});

void test("generated obligations derived from rows are the ones the engine keeps", () => {
  for (const [name, book] of [
    ["development seed", seed.book],
    ["corpus", corpus.book],
  ] as const) {
    assert.ok(book.obligations.some((obligation) => !obligation.opening));
    assert.deepStrictEqual(
      json(deriveObligations(book)),
      json(book.obligations),
      name,
    );
    assert.ok(
      bookToRows(book)
        .filter((row) => row.table === "obligation")
        .every((row) => row.data!.opening),
    );
  }
});

void test("rows keep each collection's order in explicit sort columns", () => {
  const rows = bookToRows(corpus.book);
  const of = (table: WireRow["table"]) =>
    rows.filter((row) => row.table === table).map((row) => row.data!);
  // Groups are listed newest first; their sort counts up from the oldest.
  assert.deepStrictEqual(corpus.book.budgets.alex!.groups, ["Fun", "Bills"]);
  assert.deepStrictEqual(
    of("categoryGroup").map((group) => [
      (group as { name: string }).name,
      (group as { sort: number }).sort,
    ]),
    [
      ["Fun", 1],
      ["Bills", 0],
    ],
  );
  // Rows given in any order build the same book.
  const shuffled = [...rows].reverse();
  assert.deepStrictEqual(json(rowsToBook(shuffled)), stored(corpus.book));
});

void test("stored standing rules still read and are left out of every budget", () => {
  const rows = bookToRows(corpus.book);
  const rule: WireRow = {
    table: "rule",
    id: rowKey("alex", "dining-covers-food"),
    revision: 3,
    deleted: false,
    data: {
      id: "dining-covers-food",
      fromCategoryId: "dining",
      toCategoryId: "food",
      enabled: true,
      userId: "alex",
      sort: 0,
    },
  };
  assert.ok(rowDataSchemas.rule.safeParse(rule.data).success);
  assert.deepStrictEqual(
    json(rowsToBook([...rows, rule])),
    json(rowsToBook(rows)),
  );
  const visible = [...rows, rule].filter((row) => rowVisibleTo(row, "alex"));
  assert.deepStrictEqual(
    json(rowsToPersonalLedger(visible, "alex")),
    json(
      rowsToPersonalLedger(
        visible.filter((row) => row !== rule),
        "alex",
      ),
    ),
  );
});

void test("row ids join key parts unambiguously", () => {
  for (const parts of [
    ["alex", "card:visa"],
    ["a/b", "c%2Fd", "%", "/"],
    ["2026-01", ""],
  ])
    assert.deepStrictEqual(rowKeyParts(rowKey(...parts)), parts);
  assert.notEqual(rowKey("a/b", "c"), rowKey("a", "b/c"));
});

void test("a partner's personal ledger from rows equals the one built from the household", () => {
  let compared = 0;
  for (const [name, book] of books) {
    if (Object.keys(book.budgets).length !== 2) continue;
    const rows = bookToRows(book);
    for (const userId of Object.keys(book.budgets)) {
      const visible = rows.filter((row) => rowVisibleTo(row, userId));
      const ledger = rowsToPersonalLedger(visible, userId);
      assert.deepStrictEqual(
        json(ledger),
        json(personalLedger(stored(book), userId)),
        `${name}, ${userId}`,
      );
      // The browser's rows rebuild the same ledger.
      assert.deepStrictEqual(
        json(rowsToPersonalLedger(personalLedgerToRows(ledger), userId)),
        json(ledger),
        `${name}, ${userId}: personal rows round trip`,
      );
      compared++;
    }
  }
  assert.ok(compared >= 40);
});

void test("projections from a personal ledger built from rows match the household's to the cent", () => {
  for (const [name, book] of [
    ["development seed", seed.book],
    ["corpus", corpus.book],
  ] as const)
    for (const userId of Object.keys(book.budgets)) {
      const ledger = rowsToPersonalLedger(bookToRows(book), userId);
      const first = book.budgets[userId]!.startMonth;
      for (
        let month = first;
        month <= "2026-12";
        month = monthAfter(month, 1)
      ) {
        const expected: Partial<ReturnType<typeof projectBook>> = projectBook(
          book,
          userId,
          month,
        );
        delete expected.audit;
        const { audit, ...actual } = projectBook(ledger, userId, month);
        assert.deepStrictEqual(audit, []);
        assert.deepStrictEqual(
          json(actual),
          json(expected),
          `${name}, ${userId}, ${month}`,
        );
      }
    }
});

void test("a partner's browser rows hold none of the other partner's budget", () => {
  const rows = bookToRows(corpus.book).filter((row) =>
    rowVisibleTo(row, "jordan"),
  );
  const text = JSON.stringify(rows);
  for (const secret of ["Checking", "Savings", "Visa", "Brokerage", "car-loan"])
    assert.ok(!text.includes(secret), secret);
  assert.ok(
    rows.every(
      (row) =>
        !["budgetSettings", "transaction", "account"].includes(row.table) ||
        rowKeyParts(row.id)[0] === "jordan",
    ),
  );
  // Alex's shared purchases reach Jordan only as partner facts.
  assert.ok(
    rows.some(
      (row) =>
        row.table === "partnerFact" &&
        row.id === rowKey("jordan", "purchase", "alex", "shared-market"),
    ),
  );
});

void test("rows sharing an id are refused rather than silently merged", () => {
  const book = json(corpus.book);
  book.budgets.alex!.accounts.push(book.budgets.alex!.accounts[0]!);
  assert.throws(() => bookToRows(book), /Two account rows share the id/);
});
