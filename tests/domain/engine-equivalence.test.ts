import assert from "node:assert/strict";
import test from "node:test";
import {
  execute,
  materialize,
  outstanding,
  projectBook,
  type Book,
  type Command,
} from "../../src/domain/engine";
import { projectSharedLedger } from "../../src/domain/shared-ledger";
import { buildDevelopmentSeed } from "../../src/server/dev/seed-scenarios";
import { monthAfter, syntheticBook } from "./fixtures/synthetic-book";
import {
  referenceAssign,
  referenceMaterialize,
  referenceOutstanding,
  referenceReceiptDate,
  referenceSynchronizeObligations,
} from "./reference/engine";

// The engine indexes rows by month and replays every later month once. These
// tests hold it to the straightforward implementation in ./reference, which
// filters every list for every month, on the development seed and on
// generated books full of cross-month edge cases.

type Outcome = { value: unknown } | { error: string };
function outcome(run: () => unknown): Outcome {
  try {
    return { value: run() };
  } catch (error) {
    return {
      error: `${(error as Error).name}: ${(error as Error).message}`,
    };
  }
}

const seed = buildDevelopmentSeed({
  userId: "alex",
  partnerId: "jordan",
  asOf: "2026-10-21",
});
const edgeBooks = [1, 2, 3, 4].map((value) =>
  syntheticBook({
    seed: value,
    startMonth: "2025-11",
    months: 12,
    transactionsPerMonth: 15,
    assignmentsPerMonth: 8,
    edge: true,
  }),
);
// Rows that point at a missing account and category, so error paths are
// compared too.
function broken(book: Book): Book {
  const copy = structuredClone(book);
  const alex = copy.budgets.alex!;
  alex.transactions.find(
    (transaction) =>
      transaction.date.slice(0, 7) === monthAfter(alex.startMonth, 5),
  )!.accountId = "closed";
  alex.assignments.find(
    (assignment) => assignment.month === monthAfter(alex.startMonth, 9),
  )!.categoryId = "deleted";
  return copy;
}
const books: [string, Book][] = [
  ["development seed", seed.book],
  ...edgeBooks.map((book, index): [string, Book] => [
    `edge ${index + 1}`,
    book,
  ]),
  ["broken references", broken(edgeBooks[0]!)],
];

function monthsOf(book: Book, userId: string): string[] {
  const budget = book.budgets[userId]!;
  const last = [
    ...budget.assignments.map((assignment) => assignment.month),
    ...budget.transactions.map((transaction) => transaction.date.slice(0, 7)),
  ]
    .sort()
    .at(-1)!;
  const months: string[] = [];
  for (
    let month = monthAfter(budget.startMonth, -1);
    month <= monthAfter(last, 1);
    month = monthAfter(month, 1)
  )
    months.push(month);
  return months;
}

void test("month figures match the reference replay for every month and cutoff", () => {
  let compared = 0;
  for (const [name, book] of books)
    for (const userId of Object.keys(book.budgets))
      for (const month of monthsOf(book, userId))
        for (const cutoff of [
          undefined,
          `${month}-01`,
          `${month}-14`,
          `${month}-28`,
        ]) {
          assert.deepStrictEqual(
            outcome(() => materialize(book, userId, month, cutoff)),
            outcome(() => referenceMaterialize(book, userId, month, cutoff)),
            `${name}, ${userId}, ${month}, cutoff ${cutoff ?? "month end"}`,
          );
          compared++;
        }
  assert.ok(compared > 500);
});

void test("assignments pass and fail exactly as when each later month was replayed", () => {
  const seen = new Map<string, number>();
  for (const [name, book] of books)
    for (const userId of Object.keys(book.budgets)) {
      const budget = book.budgets[userId]!;
      const categories = budget.categories.map((category) => category.id);
      for (const [index, month] of monthsOf(book, userId).entries()) {
        const ready = outcome(
          () => referenceMaterialize(book, userId, month).readyToAssign,
        );
        const readyToAssign =
          "value" in ready ? (ready.value as number) : 10_000;
        const commands: Extract<
          Command,
          { type: "assign" | "assign.batch" }
        >[] = [
          // Assigning exactly Ready to Assign is what later months most
          // often cannot afford, so every month tries it.
          ...(index % 3
            ? [readyToAssign]
            : [1, readyToAssign, readyToAssign + 1, -500, -1_000_000]
          ).map((amount, offset) => ({
            type: "assign" as const,
            id: `assign-${index}-${offset}`,
            categoryId: categories[(index + offset) % categories.length]!,
            month,
            amount: amount || 1,
          })),
          {
            type: "assign.batch",
            id: `batch-${index}`,
            month,
            changes: [
              { categoryId: categories[0]!, amount: readyToAssign || 1 },
              { categoryId: categories[1]!, amount: -100 },
            ],
          },
        ];
        for (const command of commands) {
          const expected = outcome(() =>
            referenceAssign(book, userId, command),
          );
          const actual = outcome(
            () => execute(book, userId, command).budgets[userId]!.assignments,
          );
          assert.deepStrictEqual(
            actual,
            expected,
            `${name}, ${userId}, ${JSON.stringify(command)}`,
          );
          const key = "error" in expected ? expected.error : "assigned";
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
    }
  for (const result of [
    "assigned",
    "AccountingError: This cash is already assigned in a future month",
    "AccountingError: Assignments require existing Ready to Assign cash",
    "AccountingError: Cannot unassign cash the category does not hold",
    "AccountingError: Account access denied",
  ])
    assert.ok(seen.get(result), `no case produced "${result}"`);
});

void test("settlement balances, receipts, and obligation checks match the reference", () => {
  for (const [name, book] of books.slice(0, -1)) {
    const cutoffs = [
      undefined,
      ...monthsOf(book, "alex").map((month) => `${month}-10`),
    ];
    for (const obligation of book.obligations)
      for (const cutoff of cutoffs)
        assert.equal(
          outstanding(book, obligation, cutoff),
          referenceOutstanding(book, obligation, cutoff),
          `${name}, ${obligation.id}, ${cutoff}`,
        );
    for (const userId of Object.keys(book.budgets))
      assert.deepStrictEqual(
        projectSharedLedger(book, userId).partnerReceiptDates,
        Object.fromEntries(
          book.settlements.flatMap((settlement) => {
            if (
              settlement.payerId !== userId ||
              settlement.recipientId === userId
            )
              return [];
            const date = referenceReceiptDate(book, settlement);
            return date ? [[settlement.id, date]] : [];
          }),
        ),
        `${name}, ${userId}`,
      );
    const corrections: [string, (book: Book) => void][] = [
      ["unchanged", () => undefined],
      [
        "settled expense removed",
        (copy) => {
          copy.settlements[0]!.allocations[0]!.obligationId = "missing";
        },
      ],
      [
        "settled expense moved later",
        (copy) => {
          const id = copy.settlements
            .flatMap((settlement) => settlement.allocations)
            .find((allocation) =>
              allocation.obligationId.startsWith("shared:"),
            )!.obligationId;
          const [, payerId, transactionId] = id.split(":");
          copy.budgets[payerId!]!.transactions.find(
            (transaction) => transaction.id === transactionId,
          )!.date = "2099-12-31";
        },
      ],
      [
        "settled expense reduced",
        (copy) => {
          copy.settlements.at(-1)!.allocations.at(-1)!.amount += 1_000_000;
        },
      ],
    ];
    for (const [label, correct] of corrections) {
      if (!book.settlements.length) continue;
      const copy = structuredClone(book);
      correct(copy);
      const expected = outcome(() => {
        const synchronized = structuredClone(copy);
        referenceSynchronizeObligations(synchronized);
        return synchronized.obligations;
      });
      const actual = outcome(
        () =>
          execute(copy, "alex", {
            type: "income.expect",
            id: "equivalence-sync",
            month: copy.budgets.alex!.startMonth,
            amount: 1,
          }).obligations,
      );
      assert.deepStrictEqual(actual, expected, `${name}, ${label}`);
    }
  }
});

void test("projections match across the whole development seed", () => {
  for (const userId of [seed.userId, seed.partnerId])
    for (const month of monthsOf(seed.book, userId)) {
      const view = outcome(() => projectBook(seed.book, userId, month));
      const reference = outcome(() =>
        referenceMaterialize(seed.book, userId, month),
      );
      if ("error" in reference) {
        assert.deepStrictEqual(view, reference);
        continue;
      }
      const projection = (view as { value: ReturnType<typeof projectBook> })
        .value;
      const calculated = reference.value as ReturnType<
        typeof referenceMaterialize
      >;
      assert.equal(projection.readyToAssign, calculated.readyToAssign);
      assert.equal(projection.cash, calculated.cash);
      for (const category of projection.categories)
        assert.deepStrictEqual(
          {
            assigned: category.assigned,
            activity: category.activity,
            available: category.available,
            opening: category.opening,
            cashOverspending: category.cashOverspending,
            cashActivity: category.cashActivity,
            settlementActivity: category.settlementActivity,
          },
          calculated.categories.get(category.id),
        );
    }
});
