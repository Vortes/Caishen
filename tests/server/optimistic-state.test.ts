import assert from "node:assert/strict";
import test from "node:test";
import type { State } from "../../src/components/budget/types";
import { optimisticState } from "../../src/components/workspace/optimistic-state";
import {
  addMember,
  createBook,
  execute,
  projectBook,
  type Book,
  type Command,
} from "../../src/domain/engine";

const month = "2026-10";
const now = new Date("2026-10-20T01:00:00Z");
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

function fixture() {
  let book = createBook("alan", "Alan", month);
  let sequence = 0;
  const run = (command: WithoutId<Command>, actor = "alan") => {
    book = execute(book, actor, { ...command, id: `setup-${++sequence}` });
  };
  run({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 300_000,
  });
  run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: 0,
  });
  run({ type: "category.add", categoryId: "food", name: "Food" });
  run({ type: "category.add", categoryId: "savings", name: "Savings" });
  return {
    run,
    get book() {
      return book;
    },
    set book(next: Book) {
      book = next;
    },
  };
}

function stateFor(book: Book, selectedMonth = month): State {
  return {
    status: "ready",
    view: projectBook(book, "alan", selectedMonth, month),
    revision: 17,
    history: { undo: "Previous real change", redo: null },
    services: [{ name: "Plaid", status: "configured", detail: "Connected" }],
    connections: [],
    evidence: [],
    imports: [],
  };
}

function expectProjection(book: Book, command: Command, selectedMonth = month) {
  const before = stateFor(book, selectedMonth);
  const original = structuredClone(before);
  const actual = optimisticState(before, command, now);
  const expected = projectBook(
    execute(book, "alan", command),
    "alan",
    selectedMonth,
    month,
  );
  assert.deepEqual(actual.view, { ...expected, audit: before.view!.audit });
  assert.deepEqual(before, original, "prediction must not mutate cached data");
  assert.equal(actual.revision, before.revision);
  assert.equal(actual.history, before.history);
  assert.equal(actual.services, before.services);
  assert.equal(actual.connections, before.connections);
  assert.equal(actual.evidence, before.evidence);
  assert.equal(actual.imports, before.imports);
  assert.equal(actual.view.audit, before.view!.audit);
  return actual;
}

void test("assignment predictions use the engine for every cached budget month", () => {
  const setup = fixture();
  const command: Command = {
    type: "assign.batch",
    id: "fund-categories",
    month,
    changes: [
      { categoryId: "food", amount: 45_000 },
      { categoryId: "savings", amount: 125_000 },
    ],
  };
  const current = expectProjection(setup.book, command);
  const future = expectProjection(setup.book, command, "2026-11");
  assert.equal(current.view.readyToAssign, 130_000);
  assert.equal(future.view.readyToAssign, 130_000);
  assert.equal(
    future.view.categories.find((category) => category.id === "food")?.opening,
    45_000,
  );
});

void test("purchases and card payments preserve deterministic reserve and balance effects", () => {
  const setup = fixture();
  setup.run({ type: "assign", categoryId: "food", month, amount: 45_000 });
  const purchase: Command = {
    type: "transaction.upsert",
    id: "buy-food",
    transactionId: "purchase",
    accountId: "card",
    date: "2026-10-18",
    amount: -12_000,
    payee: "Grocery",
    categoryId: "food",
  };
  const predicted = expectProjection(setup.book, purchase);
  assert.equal(predicted.view.personalSpending, 12_000);
  assert.equal(
    predicted.view.categories.find((category) => category.pairedAccountId)
      ?.available,
    12_000,
  );
  setup.book = execute(setup.book, "alan", purchase);
  const payment = expectProjection(setup.book, {
    type: "card.payment",
    id: "pay-card",
    cashAccountId: "checking",
    cardAccountId: "card",
    date: "2026-10-19",
    amount: 12_000,
  });
  assert.equal(payment.view.personalSpending, 12_000);
  assert.equal(payment.view.cash, 288_000);
  assert.equal(
    payment.view.accounts.find((account) => account.id === "card")?.balance,
    0,
  );
});

void test("rejected commands leave the original cache untouched", () => {
  const before = stateFor(fixture().book);
  const rejected: Command[] = [
    {
      type: "assign",
      id: "too-much",
      categoryId: "food",
      month,
      amount: 300_001,
    },
    {
      type: "assign",
      id: "missing",
      categoryId: "missing",
      month,
      amount: 100,
    },
    {
      type: "transaction.upsert",
      id: "future-activity",
      transactionId: "future",
      accountId: "checking",
      date: "2026-10-20",
      amount: 100,
      payee: "Tomorrow in budget timezone",
    },
    { type: "settings.update", id: "bad-timezone", timezone: "Invalid/Zone" },
    { type: "income.expect", id: "bad-amount", month, amount: -1 },
    {
      type: "shared.create",
      id: "needs-partner",
      sharedCategoryId: "shared-food",
      participants: ["alan", "partner"],
      weights: { alan: 1, partner: 1 },
      categoryIds: { alan: "food", partner: "partner-food" },
    },
  ];
  for (const command of rejected)
    assert.equal(optimisticState(before, command, now), before, command.id);
  const onboarding: State = {
    status: "new",
    view: null,
    revision: 0,
    history: { undo: null, redo: null },
    services: [],
    connections: [],
    evidence: [],
    imports: [],
  };
  assert.equal(optimisticState(onboarding, rejected[0]!, now), onboarding);
});

void test("target snoozing follows today in the budget timezone and projects future months", () => {
  const setup = fixture();
  setup.run({
    type: "target.set",
    categoryId: "food",
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: 10_000,
      startMonth: month,
      snoozedMonths: [],
    },
  });
  const before = stateFor(setup.book, "2026-11");
  const input: Command = {
    type: "target.snooze",
    id: "snooze",
    categoryId: "food",
    month,
    currentMonth: "2026-11",
    snoozed: true,
  };
  const predicted = optimisticState(
    before,
    input,
    new Date("2026-11-01T01:00:00Z"),
  );
  const expected = projectBook(
    execute(setup.book, "alan", { ...input, currentMonth: month }),
    "alan",
    "2026-11",
    month,
  );
  assert.deepEqual(predicted.view, { ...expected, audit: before.view!.audit });
  assert.equal(
    optimisticState(
      before,
      { ...input, month: "2026-11" },
      new Date("2026-11-01T01:00:00Z"),
    ),
    before,
  );
});

function household() {
  const setup = fixture();
  setup.book = addMember(setup.book, "partner", "Partner", month);
  setup.run({
    type: "shared.create",
    sharedCategoryId: "shared-food",
    participants: ["alan", "partner"],
    weights: { alan: 1, partner: 1 },
    categoryIds: { alan: "food", partner: "partner-food" },
  });
  setup.run({
    type: "transaction.upsert",
    transactionId: "purchase",
    accountId: "checking",
    date: "2026-10-18",
    amount: -1000,
    payee: "Shared grocery",
    categoryId: "food",
    sharedCategoryId: "shared-food",
    reviewed: false,
  });
  return setup;
}

void test("shared budget metadata updates retain private projection and authoritative metadata", () => {
  const setup = household();
  for (const command of [
    {
      type: "transaction.approve",
      id: "approve",
      transactionIds: ["purchase"],
    },
    { type: "income.expect", id: "expected", month, amount: 500_000 },
    {
      type: "income.expect",
      id: "future-expected",
      month: "2026-11",
      amount: 500_000,
    },
    { type: "income.expect", id: "remove-expected", month, amount: null },
  ] satisfies Command[])
    expectProjection(setup.book, command);

  const before = stateFor(setup.book);
  const updated = optimisticState(
    before,
    {
      type: "transaction.approve",
      id: "approve",
      transactionIds: ["purchase"],
    },
    now,
  );
  assert.equal(updated.view!.sharedStatement, before.view!.sharedStatement);
  assert.equal(updated.view!.categories, before.view!.categories);
  assert.equal(updated.view!.accounts, before.view!.accounts);
  assert.equal(updated.view!.settlement, before.view!.settlement);
  assert.equal(updated.view!.budget.settings, before.view!.budget.settings);
});

void test("settings wait for server confirmation so pending changes preserve preference drafts", () => {
  for (const book of [fixture().book, household().book]) {
    const before = stateFor(book);
    for (const command of [
      { type: "settings.update", id: "rename", name: "New name" },
      {
        type: "settings.update",
        id: "email-preferences",
        emailEnabled: false,
        emailHour: 0,
      },
      {
        type: "settings.update",
        id: "timezone-preference",
        timezone: "Pacific/Honolulu",
      },
    ] satisfies Command[])
      assert.equal(optimisticState(before, command, now), before, command.id);
  }
});

void test("connected budgets preview personal financial commands with the shared ledger", () => {
  const setup = household();
  expectProjection(setup.book, {
    type: "assign",
    id: "assign-shared",
    categoryId: "food",
    month,
    amount: 1000,
  });
  const removed = expectProjection(setup.book, {
    type: "transaction.remove",
    id: "remove-shared",
    transactionId: "purchase",
  });
  assert.equal(removed.view.settlement.owedToYou, 0);
});

void test("invalid connected-budget requests leave the original state untouched", () => {
  const setup = household();
  setup.run({
    type: "transaction.upsert",
    transactionId: "uncategorized",
    accountId: "checking",
    date: "2026-10-18",
    amount: -100,
    payee: "Unknown",
  });
  const before = stateFor(setup.book);
  for (const command of [
    {
      type: "transaction.approve",
      id: "invalid-approval",
      transactionIds: ["purchase", "uncategorized"],
    },
    {
      type: "transaction.approve",
      id: "missing-approval",
      transactionIds: ["missing"],
    },
    { type: "income.expect", id: "past-income", month: "2026-09", amount: 100 },
  ] satisfies Command[])
    assert.equal(optimisticState(before, command, now), before, command.id);

  const command: Command = {
    type: "income.expect",
    id: "already-saved",
    month,
    amount: 100,
  };
  const saved = stateFor(execute(setup.book, "alan", command));
  assert.equal(optimisticState(saved, command, now), saved);
});
