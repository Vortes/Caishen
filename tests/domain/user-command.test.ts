import assert from "node:assert/strict";
import test from "node:test";
import { createBook, execute, type Command } from "../../src/domain/engine";
import { budgetDay, prepareUserCommand } from "../../src/domain/user-command";

const now = new Date("2026-11-01T01:00:00Z");
const budget = createBook("alice", "Alice", "2026-10").budgets.alice!;

void test("client and server command preparation respect the budget's local day", () => {
  assert.equal(budgetDay("America/Los_Angeles", now), "2026-10-31");
  assert.equal(budgetDay("Asia/Tokyo", now), "2026-11-01");
  const command: Command = {
    type: "account.add",
    id: "opening",
    accountId: "cash",
    name: "Cash",
    kind: "cash",
    openingBalance: 100_000,
    date: "2026-11-01",
  };
  assert.throws(
    () => prepareUserCommand(budget, command, now),
    /Record confirmed activity on or before today/,
  );
  assert.deepEqual(
    prepareUserCommand(
      { ...budget, settings: { ...budget.settings, timezone: "Asia/Tokyo" } },
      command,
      now,
    ),
    command,
  );
  const original = structuredClone(command);
  const opening = prepareUserCommand(
    budget,
    { ...command, date: undefined },
    now,
  );
  const book = execute(
    createBook("alice", "Alice", "2026-10"),
    "alice",
    opening,
  );
  assert.equal(book.budgets.alice!.accounts[0]!.date, "2026-10-01");
  assert.deepEqual(command, original);
});

void test("snoozing uses the real local month and preserves the requested budget month", () => {
  const command: Command = {
    type: "target.snooze",
    id: "snooze",
    categoryId: "groceries",
    month: "2026-11",
    currentMonth: "2026-11",
    snoozed: true,
  };
  assert.deepEqual(prepareUserCommand(budget, command, now), {
    ...command,
    currentMonth: "2026-10",
  });
  assert.equal(command.currentMonth, "2026-11");
});

void test("future-dated shared payments and receipts cannot enter a cash preview", () => {
  for (const command of [
    {
      type: "settlement.record",
      id: "payment",
      settlementId: "settlement",
      otherUserId: "bob",
      date: "2026-11-01",
      accountId: "cash",
      amount: 100,
    },
    {
      type: "settlement.receive",
      id: "receipt",
      settlementId: "settlement",
      date: "2026-11-01",
      accountId: "cash",
    },
  ] satisfies Command[])
    assert.throws(() => prepareUserCommand(budget, command, now));
});
