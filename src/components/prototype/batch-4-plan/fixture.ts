import { moveMonth, monthName } from "~/components/budget/format";
import type { Target } from "~/domain/engine";
import type { Category, Funding, ShellData } from "../app-shell/model";
import { describeTarget } from "../app-shell/target-draft";

// Hardcoded budget for the Batch 4 prototype: Alex's plan in October 2026,
// with a budget that started in March 2024. Nothing here reads or writes the
// real budget.

export const TODAY = "2026-10-21";
export const CURRENT_MONTH = "2026-10";
export const START_MONTH = "2024-03";
// The picker reaches five years past this one, so far-future months exist.
export const LAST_MONTH = "2031-12";

type Spec = {
  id: string;
  name: string;
  group: string;
  // This month's numbers; other months derive from them.
  assigned: number;
  activity: number;
  carryover: number;
  target?: Pick<Target, "cadence" | "behavior" | "amount"> & {
    dueDate?: string;
  };
  card?: { id: string; name: string };
  // Overspending went on a card, so it's credit, not cash.
  onCredit?: boolean;
  share?: number;
};

const dollars = (value: number) => Math.round(value * 100);

const specs: Spec[] = [
  {
    id: "amex-payment",
    name: "American Express payment",
    group: "Credit card payments",
    assigned: dollars(200),
    activity: dollars(1068.19),
    carryover: dollars(429.79),
    target: {
      cadence: "card-monthly",
      behavior: "contribution",
      amount: dollars(200),
    },
    card: { id: "amex", name: "American Express" },
  },
  {
    id: "discover-payment",
    name: "Discover It payment",
    group: "Credit card payments",
    assigned: dollars(80),
    activity: dollars(75),
    carryover: dollars(207.78),
    card: { id: "discover", name: "Discover It" },
  },
  {
    id: "rent",
    name: "Rent",
    group: "Home",
    assigned: dollars(1300),
    activity: dollars(-417.85),
    carryover: 0,
    target: { cadence: "monthly", behavior: "refill", amount: dollars(1300) },
    share: 50,
  },
  {
    id: "utilities",
    name: "Utilities & internet",
    group: "Home",
    assigned: dollars(250),
    activity: dollars(-265.61),
    carryover: 0,
    target: { cadence: "monthly", behavior: "refill", amount: dollars(250) },
    share: 60,
  },
  {
    id: "home-maintenance",
    name: "Home maintenance",
    group: "Home",
    assigned: dollars(75),
    activity: 0,
    carryover: dollars(310),
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: dollars(75),
    },
  },
  {
    id: "groceries",
    name: "Groceries",
    group: "Everyday",
    assigned: dollars(600),
    activity: dollars(-529.11),
    carryover: dollars(893.08),
    target: { cadence: "monthly", behavior: "refill", amount: dollars(600) },
    share: 40,
  },
  {
    id: "dining",
    name: "Dining & coffee",
    group: "Everyday",
    assigned: dollars(495.74),
    activity: dollars(-684.92),
    carryover: dollars(189.18),
  },
  {
    id: "gas",
    name: "Gas & transit",
    group: "Everyday",
    assigned: dollars(200),
    activity: dollars(-108.85),
    carryover: dollars(233.52),
  },
  {
    id: "subscriptions",
    name: "Subscriptions",
    group: "Everyday",
    assigned: dollars(80),
    activity: dollars(-32.97),
    carryover: dollars(94.06),
    target: { cadence: "monthly", behavior: "refill", amount: dollars(80) },
  },
  {
    id: "pet-care",
    name: "Pet care",
    group: "Everyday",
    assigned: dollars(60),
    activity: dollars(-41.3),
    carryover: dollars(18.4),
    target: { cadence: "monthly", behavior: "refill", amount: dollars(90) },
  },
  {
    id: "medical",
    name: "Medical & pharmacy",
    group: "True expenses",
    assigned: dollars(50),
    activity: dollars(-167.86),
    carryover: dollars(10.28),
  },
  {
    id: "clothing",
    name: "Clothing & home",
    group: "True expenses",
    assigned: dollars(150),
    activity: dollars(-418),
    carryover: dollars(170),
    onCredit: true,
  },
  {
    id: "insurance",
    name: "Annual insurance",
    group: "True expenses",
    assigned: dollars(100),
    activity: 0,
    carryover: dollars(200),
    target: {
      cadence: "yearly",
      behavior: "balance",
      amount: dollars(1440),
      dueDate: "2027-03-01",
    },
  },
  {
    id: "car-registration",
    name: "Car registration",
    group: "True expenses",
    assigned: dollars(60),
    activity: 0,
    carryover: dollars(120),
    target: {
      cadence: "yearly",
      behavior: "balance",
      amount: dollars(360),
      dueDate: "2027-02-01",
    },
  },
  {
    id: "gifts",
    name: "Gifts",
    group: "True expenses",
    assigned: dollars(50),
    activity: 0,
    carryover: dollars(52.22),
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: dollars(50),
    },
  },
  {
    id: "travel",
    name: "Travel",
    group: "Goals",
    assigned: 0,
    activity: 0,
    carryover: dollars(700),
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: dollars(350),
    },
  },
  {
    id: "emergency",
    name: "Emergency fund",
    group: "Goals",
    assigned: dollars(254.26),
    activity: 0,
    carryover: dollars(1000),
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: dollars(500),
    },
  },
  {
    id: "new-laptop",
    name: "New laptop",
    group: "Goals",
    assigned: dollars(100),
    activity: 0,
    carryover: dollars(400),
    target: {
      cadence: "custom",
      behavior: "balance",
      amount: dollars(1800),
      dueDate: "2027-06-01",
    },
  },
  {
    id: "work-reimbursements",
    name: "Work reimbursements",
    group: "Reimbursements",
    assigned: dollars(600),
    activity: dollars(-565),
    carryover: dollars(1200),
  },
  {
    id: "weekend-projects",
    name: "Weekend projects",
    group: "Shared",
    assigned: 0,
    activity: 0,
    carryover: 0,
    share: 50,
  },
];

// A month's numbers. Past months repeat October's with their own spending;
// months after October have nothing assigned or spent yet and start from
// what rolled over.
function monthNumbers(spec: Spec, month: string) {
  if (month === CURRENT_MONTH) return spec;
  if (month > CURRENT_MONTH) {
    const rolled = Math.max(0, spec.carryover + spec.assigned + spec.activity);
    return { ...spec, assigned: 0, activity: 0, carryover: rolled };
  }
  // A stable wobble per category and month, so past months differ.
  const seed = [...`${spec.id}${month}`].reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  );
  const factor = 0.7 + (seed % 50) / 100;
  return {
    ...spec,
    activity: Math.round(spec.activity * factor),
    carryover: Math.round(spec.carryover * (0.6 + (seed % 30) / 100)),
  };
}

function toTarget(spec: Spec, snoozedMonths: string[]): Target | undefined {
  if (!spec.target) return undefined;
  return {
    ...spec.target,
    startMonth: START_MONTH,
    snoozedMonths,
  };
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function buildCategory(
  spec: Spec,
  month: string,
  snoozed: ReadonlySet<string>,
): Category {
  const numbers = monthNumbers(spec, month);
  const { assigned, activity, carryover } = numbers;
  const available = carryover + assigned + activity;
  const snoozedMonths = [...snoozed]
    .filter((key) => key.startsWith(`${spec.id}:`))
    .map((key) => key.split(":")[1]!);
  const isSnoozed = snoozedMonths.includes(month);
  const rule = toTarget(spec, snoozedMonths);

  let progress:
    | { funded: number; total: number; needed: number; required: number }
    | undefined;
  if (spec.target) {
    const amount = spec.target.amount;
    if (spec.target.behavior === "refill") {
      const funded = Math.min(amount, Math.max(0, carryover + assigned));
      progress = {
        funded,
        total: amount,
        needed: amount - funded,
        required: Math.max(0, amount - carryover),
      };
    } else if (spec.target.behavior === "balance") {
      // Spread what's left over the months until it's due.
      const due = spec.target.dueDate!.slice(0, 7);
      const months = Math.max(
        1,
        (Number(due.slice(0, 4)) - Number(month.slice(0, 4))) * 12 +
          Number(due.slice(5)) -
          Number(month.slice(5)),
      );
      const required = Math.max(
        0,
        Math.ceil((amount - carryover) / months / 100) * 100,
      );
      const funded = Math.min(required, Math.max(0, assigned));
      progress = {
        funded,
        total: required,
        needed: required - funded,
        required,
      };
    } else {
      const funded = Math.min(amount, Math.max(0, assigned));
      progress = {
        funded,
        total: amount,
        needed: amount - funded,
        required: amount,
      };
    }
    if (isSnoozed) progress = { ...progress, needed: 0 };
  }

  const spent = -Math.min(0, activity);
  const funds = Math.max(0, carryover + assigned);
  const funding: Funding =
    available < 0
      ? spec.onCredit
        ? "credit"
        : "overspent"
      : isSnoozed
        ? "snoozed"
        : (progress?.needed ?? 0) > 0
          ? "underfunded"
          : available > 0 || spec.target
            ? "funded"
            : "empty";
  const status =
    funding === "overspent"
      ? `Overspent. ${money(spent)} of ${money(funds)}`
      : funding === "credit"
        ? `Overspent on credit. ${money(spent)} of ${money(funds)}`
        : funding === "snoozed"
          ? "Snoozed"
          : funding === "underfunded"
            ? `${money(progress!.needed)} more needed this month`
            : spent > 0 && available === 0
              ? "Fully spent"
              : spent > 0
                ? `Spent ${money(spent)} of ${money(funds)}`
                : spec.target
                  ? "Funded"
                  : "";

  const described = rule ? describeTarget(rule) : undefined;
  return {
    id: spec.id,
    name: spec.name,
    group: spec.group,
    assigned,
    activity,
    available,
    carryover,
    funding,
    fundedRatio: progress
      ? progress.total > 0
        ? Math.min(1, progress.funded / progress.total)
        : 1
      : available > 0
        ? 1
        : 0,
    status,
    target:
      described && progress
        ? {
            ...described,
            funded: progress.funded,
            total: progress.total,
            needed: progress.needed,
            sections: [progress.total],
          }
        : undefined,
    rule,
    pays: spec.card ? { type: "card", ...spec.card } : undefined,
    reserved: 0,
    spendable: available,
    sharePercents: spec.share ? [spec.share] : [],
    autoAssign: {
      id: spec.id,
      assigned,
      available,
      target: rule,
      targetProgress: progress && {
        needed: progress.needed,
        required: progress.required,
        snoozed: isSnoozed,
      },
      pairedAccountId: spec.card?.id,
      history: {
        assigned: Array.from({ length: 12 }, () => spec.assigned),
        spent: Array.from({ length: 12 }, () => Math.max(0, -spec.activity)),
      },
    },
  };
}

export type PrototypeState = {
  month: string;
  // "categoryId:YYYY-MM" for each snoozed target month.
  snoozed: ReadonlySet<string>;
  // Expected income by month, in cents.
  income: Readonly<Record<string, number>>;
};

export const initialState: PrototypeState = {
  month: CURRENT_MONTH,
  // Travel is snoozed this month; Gifts was snoozed last month.
  snoozed: new Set(["travel:2026-10", "gifts:2026-09"]),
  // September has an expected income; October doesn't yet.
  income: { "2026-08": dollars(6200), "2026-09": dollars(6200) },
};

export function canSnooze(category: Category) {
  return Boolean(category.rule) && !category.pays;
}

export function buildShellData(state: PrototypeState): ShellData {
  const { month } = state;
  const categories = specs.map((spec) =>
    buildCategory(spec, month, state.snoozed),
  );
  const groups: ShellData["groups"] = [];
  for (const category of categories) {
    const group = groups.find((entry) => entry.name === category.group);
    if (group) group.categories.push(category);
    else
      groups.push({
        id: category.group,
        name: category.group,
        categories: [category],
      });
  }
  const costToBeMe = categories.reduce(
    (sum, item) =>
      sum +
      (item.autoAssign.targetProgress
        ? Math.max(0, item.assigned) + item.autoAssign.targetProgress.needed
        : 0),
    0,
  );
  return {
    budgetName: "Alex's budget",
    month: {
      key: month,
      current: CURRENT_MONTH,
      start: START_MONTH,
      label: monthName(month),
      short: monthName(month).split(" ")[0]!,
      canGoBack: moveMonth(month, -1) >= START_MONTH,
    },
    today: TODAY,
    readyToAssign: month === CURRENT_MONTH ? dollars(25258.82) : 0,
    groups,
    categories,
    accounts: [
      {
        id: "checking",
        name: "Chase Total Checking",
        kind: "cash",
        balance: dollars(21055.14),
        pending: 0,
        cleared: dollars(21055.14),
      },
      {
        id: "savings",
        name: "Discover savings",
        kind: "cash",
        balance: dollars(12574.61),
        pending: 0,
        cleared: dollars(12574.61),
      },
      {
        id: "amex",
        name: "American Express",
        kind: "credit",
        balance: dollars(-1697.98),
        pending: 0,
        cleared: dollars(-1697.98),
      },
      {
        id: "discover",
        name: "Discover It",
        kind: "credit",
        balance: dollars(-400.78),
        pending: 0,
        cleared: dollars(-400.78),
      },
    ],
    loans: [
      {
        id: "nelnet",
        name: "Nelnet student loan",
        balance: dollars(23923.25),
        principal: dollars(32000),
        rate: "5.50%",
        variable: false,
        payment: dollars(320),
        payoff: "Jun 2033",
        interest: dollars(4810),
        funded: dollars(320),
        payments: 41,
      },
      {
        id: "sofi",
        name: "SoFi personal loan",
        balance: dollars(6256.25),
        principal: dollars(12000),
        rate: "9.99%",
        variable: false,
        payment: dollars(245),
        payoff: "Dec 2028",
        interest: dollars(690),
        funded: dollars(245),
        payments: 22,
      },
    ],
    transactions: [],
    costToBeMe,
    expectedIncome: state.income[month] ?? null,
    partner: { name: "Sam", youOwe: dollars(312.4), owedToYou: dollars(88.1) },
    reimbursements: [
      {
        id: "conference",
        name: "Conference hotel",
        amount: dollars(565),
        outstanding: dollars(565),
        kind: "cash",
      },
    ],
  };
}

// The month before this one that has an expected income, if any.
export function lastIncome(
  income: PrototypeState["income"],
  month: string,
): { month: string; amount: number } | null {
  const earlier = Object.keys(income)
    .filter((key) => key < month)
    .sort();
  const key = earlier.at(-1);
  return key ? { month: key, amount: income[key]! } : null;
}
