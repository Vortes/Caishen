import assert from "node:assert/strict";
import test from "node:test";
import {
  optionAmount,
  overfunded,
  pastAmounts,
  planAutoAssign,
  type AutoAssignCategory,
} from "../../src/domain/auto-assign";
import type { Target } from "../../src/domain/engine";

const month = "2026-10";

function target(fields: Partial<Target> & Pick<Target, "cadence">): Target {
  return {
    behavior: "contribution",
    amount: 0,
    startMonth: "2026-01",
    snoozedMonths: [],
    ...fields,
  };
}

function category(
  id: string,
  fields: Partial<AutoAssignCategory> & {
    needed?: number;
    required?: number;
    snoozed?: boolean;
    dueMonth?: string;
  } = {},
): AutoAssignCategory {
  const { needed = 0, required, snoozed = false, dueMonth, ...rest } = fields;
  return {
    id,
    assigned: 0,
    available: 0,
    history: { assigned: [], spent: [] },
    ...rest,
    targetProgress: rest.target
      ? {
          needed,
          required: required ?? (rest.assigned ?? 0) + needed,
          snoozed,
          dueMonth,
        }
      : undefined,
  };
}

const ids = (plan: ReturnType<typeof planAutoAssign>) =>
  plan.changes.map((change) => `${change.categoryId}:${change.amount}`);

void test("underfunded funds overspending, then dated, end-of-month, future and card targets", () => {
  const scope = [
    category("card", {
      pairedAccountId: "amex",
      target: target({ cadence: "card-monthly", amount: 5000 }),
      needed: 5000,
    }),
    category("trip", {
      target: target({
        cadence: "custom",
        amount: 300000,
        dueDate: "2027-04-01",
      }),
      needed: 25000,
      dueMonth: "2027-04",
    }),
    category("insurance", {
      target: target({
        cadence: "yearly",
        amount: 108000,
        dueDate: "2027-01-15",
      }),
      needed: 18000,
      dueMonth: "2027-01",
    }),
    category("household", {
      target: target({ cadence: "monthly", amount: 15000 }),
      needed: 15000,
    }),
    category("phone", {
      target: target({ cadence: "monthly", amount: 6500, monthDay: 24 }),
      needed: 6500,
    }),
    category("netflix", {
      target: target({ cadence: "monthly", amount: 1549, monthDay: 23 }),
      needed: 1549,
    }),
    category("dining", { available: -8015 }),
  ];
  const plan = planAutoAssign({
    option: "underfunded",
    scope,
    readyToAssign: 1_000_000,
    month,
  });
  assert.deepEqual(ids(plan), [
    "dining:8015",
    "netflix:1549",
    "phone:6500",
    "household:15000",
    "insurance:18000",
    "trip:25000",
    "card:5000",
  ]);
  assert.equal(optionAmount("underfunded", scope), 79064);
});

void test("underfunded stops when Ready to Assign runs out and reports the shortfall", () => {
  const scope = [
    category("phone", {
      target: target({ cadence: "monthly", amount: 6500, monthDay: 24 }),
      needed: 6500,
    }),
    category("rent", {
      target: target({ cadence: "monthly", amount: 200000, monthDay: 1 }),
      needed: 200000,
    }),
  ];
  const plan = planAutoAssign({
    option: "underfunded",
    scope,
    readyToAssign: 100000,
    month,
  });
  assert.deepEqual(ids(plan), ["rent:100000"]);
  assert.equal(plan.short, 106500);
});

void test("weekly targets are funded one week at a time between other due dates", () => {
  // October 2026 Saturdays: 3, 10, 17, 24, 31. $400 already covers the first four.
  const scope = [
    category("groceries", {
      target: target({ cadence: "weekly", amount: 10000, weekday: 6 }),
      assigned: 40000,
      available: 13190,
      needed: 10000,
    }),
    category("netflix", {
      target: target({ cadence: "monthly", amount: 1549, monthDay: 23 }),
      needed: 1549,
    }),
  ];
  const plan = planAutoAssign({
    option: "underfunded",
    scope,
    readyToAssign: 50000,
    month,
  });
  assert.deepEqual(ids(plan), ["netflix:1549", "groceries:10000"]);
});

void test("overspent categories with a target are covered and fully funded", () => {
  const scope = [
    category("apartment", {
      target: target({ cadence: "monthly", amount: 15000 }),
      assigned: 13701,
      available: -1299,
      needed: 1299,
    }),
    category("dining", { assigned: 0, available: -500 }),
  ];
  assert.equal(optionAmount("underfunded", scope), 1799);
});

void test("snoozed targets and categories without one are skipped unless overspent", () => {
  const scope = [
    category("loan", {
      target: target({ cadence: "monthly", amount: 20333 }),
      snoozed: true,
      available: 20333,
    }),
    category("gifts", { available: 4500 }),
  ];
  const plan = planAutoAssign({
    option: "underfunded",
    scope,
    readyToAssign: 100000,
    month,
  });
  assert.deepEqual(plan.changes, []);
});

void test("averages start at the first active month and exclude the current month", () => {
  const dining = category("dining", {
    history: {
      assigned: [0, 0, 25000, 30000, 25000, 25000],
      spent: [0, 4210, 28840, 26115, 31120, 31120],
    },
  });
  assert.deepEqual(pastAmounts(dining), {
    lastAssigned: 25000,
    lastSpent: 31120,
    averageAssigned: 26250,
    averageSpent: 24281,
  });
});

void test("history options release money before funding increases", () => {
  const scope = [
    category("gifts", {
      assigned: 5000,
      available: 5000,
      history: { assigned: [0], spent: [0] },
    }),
    category("rent", {
      assigned: 0,
      history: { assigned: [192814], spent: [192814] },
    }),
  ];
  const plan = planAutoAssign({
    option: "assigned-last-month",
    scope,
    readyToAssign: 190000,
    month,
  });
  assert.deepEqual(ids(plan), ["gifts:-5000", "rent:192814"]);
  assert.equal(plan.short, 0);
});

void test("money already spent stays assigned", () => {
  const scope = [category("dining", { assigned: 25427, available: 0 })];
  const plan = planAutoAssign({
    option: "reset-assigned",
    scope,
    readyToAssign: 0,
    month,
  });
  assert.deepEqual(plan.changes, []);
  assert.equal(plan.stuck, 25427);
});

void test("reduce overfunding returns what is assigned beyond the target", () => {
  const scope = [
    category("iphone", {
      target: target({
        cadence: "custom",
        amount: 109900,
        dueDate: "2027-07-01",
      }),
      assigned: 8000,
      available: 13229,
      required: 5229,
    }),
    category("snoozed", {
      target: target({ cadence: "monthly", amount: 1000 }),
      snoozed: true,
      assigned: 3000,
      available: 2000,
      required: 1000,
    }),
  ];
  assert.equal(overfunded(scope[0]!), 2771);
  assert.equal(overfunded(scope[1]!), 2000);
  const plan = planAutoAssign({
    option: "reduce-overfunding",
    scope,
    readyToAssign: 0,
    month,
  });
  assert.deepEqual(ids(plan), ["iphone:-2771", "snoozed:-2000"]);
});

void test("history options skip categories with no earlier month", () => {
  const plan = planAutoAssign({
    option: "assigned-last-month",
    scope: [category("new", { assigned: 5000, available: 5000 })],
    readyToAssign: 0,
    month,
  });
  assert.deepEqual(plan.changes, []);
});

void test("resets show the money they return to Ready to Assign", () => {
  const scope = [
    category("dining", { assigned: 25427, available: 10000 }),
    category("gifts", { assigned: 3000, available: 8000 }),
    category("groceries", { assigned: 5000, available: -2000 }),
  ];
  assert.equal(optionAmount("reset-available", scope), 18000);
  assert.equal(optionAmount("reset-assigned", scope), 13000);
  for (const option of ["reset-available", "reset-assigned"] as const) {
    const freed = -planAutoAssign({
      option,
      scope,
      readyToAssign: 0,
      month,
    }).changes.reduce((total, change) => total + change.amount, 0);
    assert.equal(optionAmount(option, scope), freed);
  }
});
