import assert from "node:assert/strict";
import test from "node:test";

import {
  createBook,
  execute,
  projectBook,
  type Command,
  type Target,
} from "../../src/domain/engine";
import {
  buildTarget,
  createTargetDraft,
  describeTarget,
  type TargetDraft,
  type TargetKind,
} from "../../src/components/prototype/app-shell/target-draft";

const month = "2026-10";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

// A budget with a spending category, a card, and a loan, each of which can
// hold a target.
function budget() {
  let book = createBook("alan", "Alan", month);
  let sequence = 0;
  const run = (command: WithoutId<Command>) => {
    book = execute(book, "alan", { ...command, id: `setup-${++sequence}` });
  };
  run({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 100_000,
    date: `${month}-01`,
  });
  run({
    type: "account.add",
    accountId: "card",
    name: "Card",
    kind: "credit",
    openingBalance: -50_000,
    date: `${month}-01`,
  });
  run({
    type: "loan.add",
    loanId: "loan",
    categoryId: "loan-payment",
    name: "Loan",
    principal: 120_000,
    annualRateBps: 0,
    minimumPayment: 5_000,
    variable: false,
    effectiveDate: `${month}-01`,
  });
  run({ type: "category.add", categoryId: "gifts", name: "Gifts" });
  const categoryFor: Record<TargetKind, string> = {
    spending: "gifts",
    card: "card:card",
    loan: "loan-payment",
  };
  // Saves the target the way the editor does and reads the category back.
  return (kind: TargetKind, target: Target) => {
    run({ type: "target.set", categoryId: categoryFor[kind], target });
    return projectBook(book, "alan", month).categories.find(
      (category) => category.id === categoryFor[kind],
    )!;
  };
}

// What the editor builds from a new draft with these changes.
function build(
  kind: TargetKind,
  changes: Partial<TargetDraft>,
  existing?: Target,
) {
  return buildTarget(
    { ...createTargetDraft(kind, month, existing), ...changes },
    { month, existing },
  );
}

void test("a new target with only an amount sets it aside by the end of each month", () => {
  const target: Target = {
    cadence: "monthly",
    behavior: "contribution",
    amount: 15_000,
    startMonth: "2026-10",
    snoozedMonths: [],
  };
  assert.deepEqual(build("spending", { amount: "150" }), { ok: true, target });
  assert.deepEqual(budget()("spending", target).target, target);
});

void test("a missing, zero, or malformed amount names the amount field", () => {
  const aboveZero = {
    ok: false,
    field: "amount",
    message: "Enter an amount above zero.",
  };
  assert.deepEqual(build("spending", { amount: "" }), aboveZero);
  assert.deepEqual(build("spending", { amount: "0" }), aboveZero);
  assert.deepEqual(build("spending", { amount: "12.345" }), {
    ok: false,
    field: "amount",
    message: "Enter a dollar amount with no more than two decimal places.",
  });
});

void test("a monthly target can be due by a day of the month", () => {
  const target: Target = {
    cadence: "monthly",
    behavior: "contribution",
    amount: 15_000,
    startMonth: "2026-10",
    snoozedMonths: [],
    monthDay: 15,
  };
  assert.deepEqual(build("spending", { amount: "150", monthDay: 15 }), {
    ok: true,
    target,
  });
  assert.deepEqual(budget()("spending", target).target, target);
});

void test("a monthly target can refill up to its amount", () => {
  const target: Target = {
    cadence: "monthly",
    behavior: "refill",
    amount: 15_000,
    startMonth: "2026-10",
    snoozedMonths: [],
  };
  assert.deepEqual(build("spending", { amount: "150", behavior: "refill" }), {
    ok: true,
    target,
  });
  assert.deepEqual(budget()("spending", target).target, target);
});

void test("a weekly target saves its weekday and drops a monthly due day", () => {
  const target: Target = {
    cadence: "weekly",
    behavior: "contribution",
    amount: 2_000,
    startMonth: "2026-10",
    snoozedMonths: [],
    weekday: 1,
  };
  assert.deepEqual(
    build("spending", {
      schedule: "weekly",
      amount: "20",
      weekday: 1,
      // Left from the monthly schedule before switching.
      monthDay: 15,
    }),
    { ok: true, target },
  );
  assert.deepEqual(budget()("spending", target).target, target);
});

void test("a yearly target is due by a date, first offering next month's first day", () => {
  const target: Target = {
    cadence: "yearly",
    behavior: "contribution",
    amount: 60_000,
    startMonth: "2026-10",
    snoozedMonths: [],
    dueDate: "2027-03-01",
  };
  assert.deepEqual(build("spending", { schedule: "yearly", amount: "600" }), {
    ok: true,
    target: { ...target, dueDate: "2026-11-01" },
  });
  assert.deepEqual(
    build("spending", {
      schedule: "yearly",
      amount: "600",
      dueDate: "2027-03-01",
    }),
    { ok: true, target },
  );
  assert.deepEqual(budget()("spending", target).target, target);
});

void test("a missing or unreadable due date names the date field", () => {
  const yearly = { schedule: "yearly" as const, amount: "600" };
  assert.deepEqual(build("spending", { ...yearly, dueDate: " " }), {
    ok: false,
    field: "dueDate",
    message: "Choose a due date.",
  });
  // What's left when typing stops partway through a date.
  assert.deepEqual(build("spending", { ...yearly, dueDate: "13/01" }), {
    ok: false,
    field: "dueDate",
    message: "Enter the date as MM/DD/YYYY.",
  });
  assert.deepEqual(build("spending", { ...yearly, dueDate: "2027-02-30" }), {
    ok: false,
    field: "dueDate",
    message: "Enter the date as MM/DD/YYYY.",
  });
});

void test("a custom target sets aside an amount by its due date", () => {
  const target: Target = {
    cadence: "custom",
    behavior: "contribution",
    amount: 30_000,
    startMonth: "2026-10",
    snoozedMonths: [],
    dueDate: "2027-01-15",
  };
  assert.deepEqual(
    build("spending", {
      schedule: "custom",
      amount: "300",
      dueDate: "2027-01-15",
    }),
    { ok: true, target },
  );
  assert.deepEqual(budget()("spending", target).target, target);
});

void test("a custom target can repeat every few months or years", () => {
  const target: Target = {
    cadence: "custom",
    behavior: "contribution",
    amount: 30_000,
    startMonth: "2026-10",
    snoozedMonths: [],
    dueDate: "2027-01-15",
    repeatEvery: 3,
    repeatUnit: "months",
  };
  const custom = {
    schedule: "custom" as const,
    amount: "300",
    dueDate: "2027-01-15",
    repeat: true,
  };
  assert.deepEqual(build("spending", { ...custom, repeatEvery: "3" }), {
    ok: true,
    target,
  });
  assert.deepEqual(budget()("spending", target).target, target);
  assert.deepEqual(build("spending", { ...custom, repeatEvery: "0" }), {
    ok: false,
    field: "repeatEvery",
    message: "Repeat every 1 to 120 months or years.",
  });
  // Left on from the custom schedule before switching to monthly.
  assert.deepEqual(
    build("spending", { amount: "300", repeat: true, repeatEvery: "3" }),
    {
      ok: true,
      target: {
        cadence: "monthly",
        behavior: "contribution",
        amount: 30_000,
        startMonth: "2026-10",
        snoozedMonths: [],
      },
    },
  );
});

void test("a balance goal needs no due date and never repeats", () => {
  const target: Target = {
    cadence: "custom",
    behavior: "balance",
    amount: 500_000,
    startMonth: "2026-10",
    snoozedMonths: [],
  };
  assert.deepEqual(
    build("spending", {
      schedule: "custom",
      behavior: "balance",
      amount: "5000",
      // Left on from setting aside before choosing a balance.
      repeat: true,
    }),
    { ok: true, target },
  );
  assert.deepEqual(budget()("spending", target).target, target);
});

void test("a balance goal due by a month is due on that month's last day", () => {
  const due = (dueMonth: string) =>
    build("spending", {
      schedule: "custom",
      behavior: "balance",
      amount: "5000",
      balanceDue: true,
      dueMonth,
    });
  const target: Target = {
    cadence: "custom",
    behavior: "balance",
    amount: 500_000,
    startMonth: "2026-10",
    snoozedMonths: [],
    dueDate: "2027-02-28",
  };
  assert.deepEqual(due("2027-02"), { ok: true, target });
  assert.deepEqual(due("2028-02"), {
    ok: true,
    target: { ...target, dueDate: "2028-02-29" },
  });
  assert.deepEqual(budget()("spending", target).target, target);
});

void test("a balance left from the custom schedule sets money aside on a monthly one", () => {
  assert.deepEqual(build("spending", { amount: "150", behavior: "balance" }), {
    ok: true,
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: 15_000,
      startMonth: "2026-10",
      snoozedMonths: [],
    },
  });
});

void test("a card's payment target pays an amount each month", () => {
  const target: Target = {
    cadence: "card-monthly",
    behavior: "contribution",
    amount: 20_000,
    startMonth: "2026-10",
    snoozedMonths: [],
  };
  assert.deepEqual(build("card", { amount: "200" }), { ok: true, target });
  assert.deepEqual(budget()("card", target).target, target);
});

void test("paying a card off by a date needs no amount", () => {
  const target: Target = {
    cadence: "card-payoff",
    behavior: "contribution",
    amount: 0,
    startMonth: "2026-10",
    snoozedMonths: [],
    dueDate: "2027-04-30",
  };
  assert.deepEqual(
    build("card", { schedule: "card-payoff", dueDate: "2027-04-30" }),
    { ok: true, target },
  );
  const category = budget()("card", target);
  assert.deepEqual(category.target, target);
  // The card owes $500.00 over seven months, rounded up to the cent.
  assert.equal(category.targetProgress?.needed, 7_143);
});

void test("a loan's payment target pays an amount each month", () => {
  const target: Target = {
    cadence: "loan",
    behavior: "contribution",
    amount: 12_000,
    startMonth: "2026-10",
    snoozedMonths: [],
  };
  assert.deepEqual(build("loan", { amount: "120" }), { ok: true, target });
  assert.deepEqual(budget()("loan", target).target, target);
});

void test("paying a loan off by a date needs no amount", () => {
  const target: Target = {
    cadence: "loan",
    behavior: "contribution",
    amount: 0,
    startMonth: "2026-10",
    snoozedMonths: [],
    dueDate: "2027-09-30",
  };
  assert.deepEqual(
    build("loan", { schedule: "loan-payoff", dueDate: "2027-09-30" }),
    { ok: true, target },
  );
  const category = budget()("loan", target);
  assert.deepEqual(category.target, target);
  // $1,200.00 at no interest over the twelve months to September 2027.
  assert.equal(category.targetProgress?.needed, 10_000);
});

void test("editing a target keeps its start month and snoozed months", () => {
  const existing: Target = {
    cadence: "monthly",
    behavior: "contribution",
    amount: 5_000,
    startMonth: "2026-08",
    snoozedMonths: ["2026-09"],
  };
  assert.deepEqual(build("spending", { amount: "75" }, existing), {
    ok: true,
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: 7_500,
      startMonth: "2026-08",
      snoozedMonths: ["2026-09"],
    },
  });
});

void test("reopening a saved target shows the choices it was saved with", () => {
  const base = {
    behavior: "contribution" as const,
    startMonth: "2026-10",
    snoozedMonths: [],
  };
  const saved: [TargetKind, Target][] = [
    [
      "spending",
      {
        ...base,
        cadence: "weekly",
        behavior: "refill",
        amount: 2_000,
        weekday: 2,
      },
    ],
    ["spending", { ...base, cadence: "monthly", amount: 15_000, monthDay: 15 }],
    [
      "spending",
      { ...base, cadence: "yearly", amount: 60_000, dueDate: "2027-03-01" },
    ],
    [
      "spending",
      {
        ...base,
        cadence: "custom",
        behavior: "refill",
        amount: 9_000,
        dueDate: "2027-01-15",
        repeatEvery: 2,
        repeatUnit: "years",
      },
    ],
    [
      "spending",
      { ...base, cadence: "custom", behavior: "balance", amount: 500_000 },
    ],
    [
      "spending",
      {
        ...base,
        cadence: "custom",
        behavior: "balance",
        amount: 500_000,
        dueDate: "2027-06-30",
      },
    ],
    ["card", { ...base, cadence: "card-monthly", amount: 20_000 }],
    [
      "card",
      { ...base, cadence: "card-payoff", amount: 0, dueDate: "2027-04-30" },
    ],
    ["loan", { ...base, cadence: "loan", amount: 12_000 }],
    ["loan", { ...base, cadence: "loan", amount: 0, dueDate: "2027-09-30" }],
  ];
  for (const [kind, target] of saved)
    assert.deepEqual(build(kind, {}, target), { ok: true, target });
});

void test("a one-time due date can't fall before the month being planned", () => {
  const tooEarly = {
    ok: false,
    field: "dueDate",
    message: "Choose a date in October 2026 or later.",
  };
  // A card target that has been running since January.
  const existing: Target = {
    cadence: "card-monthly",
    behavior: "contribution",
    amount: 20_000,
    startMonth: "2026-01",
    snoozedMonths: [],
  };
  const payoff = (dueDate: string) =>
    build("card", { schedule: "card-payoff", dueDate }, existing);
  assert.deepEqual(payoff("2026-09-15"), tooEarly);
  assert.equal(payoff("2026-10-31").ok, true);
  assert.deepEqual(
    build("spending", {
      schedule: "custom",
      amount: "300",
      dueDate: "2026-09-15",
    }),
    tooEarly,
  );
  assert.deepEqual(
    build("spending", {
      schedule: "custom",
      behavior: "balance",
      amount: "5000",
      balanceDue: true,
      dueMonth: "2026-09",
    }),
    { ok: false, field: "dueMonth", message: "Choose October 2026 or later." },
  );
});

void test("a yearly or repeating due date can be any day since the target started", () => {
  const existing: Target = {
    cadence: "monthly",
    behavior: "contribution",
    amount: 5_000,
    startMonth: "2026-01",
    snoozedMonths: [],
  };
  const edit = (changes: Partial<TargetDraft>) =>
    build(
      "spending",
      { amount: "600", dueDate: "2026-03-01", ...changes },
      existing,
    );
  assert.equal(edit({ schedule: "yearly" }).ok, true);
  assert.equal(edit({ schedule: "custom", repeat: true }).ok, true);
  assert.deepEqual(edit({ schedule: "yearly", dueDate: "2025-12-01" }), {
    ok: false,
    field: "dueDate",
    message: "Choose a date in January 2026 or later.",
  });
});

// Every target in these descriptions starts this month and has never been
// snoozed.
const fresh = { startMonth: "2026-10", snoozedMonths: [] };

void test("a monthly target reads as what to set aside or refill, and by when", () => {
  const monthly = { ...fresh, cadence: "monthly", amount: 15_000 } as const;
  assert.deepEqual(describeTarget({ ...monthly, behavior: "contribution" }), {
    action: "Set aside another $150.00 each month",
    when: "By the last day of the month",
  });
  assert.deepEqual(
    describeTarget({ ...monthly, behavior: "refill", monthDay: 22 }),
    {
      action: "Refill up to $150.00 each month",
      when: "By the 22nd of the month",
    },
  );
});

void test("weekly and yearly targets read with their own period", () => {
  assert.deepEqual(
    describeTarget({
      ...fresh,
      cadence: "weekly",
      behavior: "contribution",
      amount: 2_000,
      weekday: 6,
    }),
    { action: "Set aside another $20.00 each week", when: "Every Saturday" },
  );
  assert.deepEqual(
    describeTarget({
      ...fresh,
      cadence: "yearly",
      behavior: "refill",
      amount: 60_000,
      dueDate: "2027-03-01",
    }),
    { action: "Refill up to $600.00 each year", when: "By March 1, 2027" },
  );
});

void test("a custom target reads as YNAB words it, with how it repeats", () => {
  const custom = {
    ...fresh,
    cadence: "custom",
    amount: 9_000,
    dueDate: "2027-01-15",
  } as const;
  const when = "By January 15, 2027";
  assert.deepEqual(describeTarget({ ...custom, behavior: "contribution" }), {
    action: "Set aside $90.00",
    when,
  });
  assert.deepEqual(
    describeTarget({
      ...custom,
      behavior: "contribution",
      repeatEvery: 1,
      repeatUnit: "years",
    }),
    { action: "Set aside $90.00 every year", when },
  );
  assert.deepEqual(
    describeTarget({
      ...custom,
      behavior: "refill",
      repeatEvery: 3,
      repeatUnit: "months",
    }),
    { action: "Fill up to $90.00 every 3 months", when },
  );
});

void test("a balance goal reads by its month, or as having no due date", () => {
  const goal = {
    ...fresh,
    cadence: "custom",
    behavior: "balance",
    amount: 500_000,
  } as const;
  assert.deepEqual(describeTarget(goal), {
    action: "Have a balance of $5,000.00",
    when: "No due date",
  });
  assert.deepEqual(describeTarget({ ...goal, dueDate: "2027-06-30" }), {
    action: "Have a balance of $5,000.00",
    when: "By June 2027",
  });
});

void test("card and loan targets read as payments", () => {
  const paid = { ...fresh, behavior: "contribution" } as const;
  assert.deepEqual(
    describeTarget({ ...paid, cadence: "card-monthly", amount: 20_000 }),
    { action: "Pay $200.00 each month", when: "Every month" },
  );
  assert.deepEqual(
    describeTarget({
      ...paid,
      cadence: "card-payoff",
      amount: 0,
      dueDate: "2027-04-30",
    }),
    { action: "Pay off the balance", when: "By April 30, 2027" },
  );
  assert.deepEqual(
    describeTarget({ ...paid, cadence: "loan", amount: 12_000 }),
    { action: "Pay $120.00 each month", when: "Every month" },
  );
  assert.deepEqual(
    describeTarget({
      ...paid,
      cadence: "loan",
      amount: 0,
      dueDate: "2027-09-30",
    }),
    { action: "Pay off the loan", when: "By September 30, 2027" },
  );
});
