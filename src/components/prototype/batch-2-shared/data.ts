import type { Category, ShellData } from "../app-shell/model";

// Hardcoded two-partner data for the Batch 2 shared-expenses prototype.
// Alex is signed in; Jordan is the partner. Every amount is in cents and
// every statement adds up the way the engine's sharedStatement does: the
// carried balance plus the month's purchases and repayments equals what's
// owed now.

export const PARTNER = "Jordan";
export const TODAY = "2026-10-21";

export type Purchase = {
  id: string;
  payee: string;
  date: string;
  paidBy: "you" | "partner";
  amount: number;
  yourShare: number;
  pending?: boolean;
  // Set when the expense belongs to another month than its date.
  forMonth?: string;
};

export type Opening = { id: string; effect: number };

export type SharedCategory = {
  id: string;
  categoryId: string;
  yourPercent: number;
  purchases: Purchase[];
  opening: Opening[];
  // Recorded activity in earlier months or settlements against it. Either
  // one means the engine refuses shared.remove.
  history: boolean;
};

export type Repayment = {
  id: string;
  date: string;
  amount: number;
  from: "you" | "partner";
  receivedOn?: string;
  into?: string;
};

export type CashAccount = { id: string; name: string; balance: number };

export type ScenarioKey =
  | "owe"
  | "owed"
  | "settled"
  | "first-month"
  | "nothing-shared"
  | "no-partner"
  | "past-month";

export type Scenario = {
  key: ScenarioKey;
  label: string;
  hint: string;
  partner: boolean;
  month: "2026-10" | "2026-09";
  carried: number;
  shared: SharedCategory[];
  repayments: Repayment[];
  // What each side still owes after settlements, before netting.
  youOwe: number;
  owedToYou: number;
};

export const cashAccounts: CashAccount[] = [
  { id: "chase", name: "Chase Total Checking", balance: 2105514 },
  { id: "discover-savings", name: "Discover savings", balance: 1257461 },
];

export const monthLabel = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
export const monthOnly = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
  });

// What a purchase adds to the balance, from Alex's side: positive adds to
// what Alex owes Jordan, negative to what Jordan owes Alex.
export const purchaseEffect = (purchase: Purchase) =>
  purchase.paidBy === "you"
    ? -(purchase.amount - purchase.yourShare)
    : purchase.yourShare;
export const repaymentEffect = (repayment: Repayment) =>
  repayment.from === "you" ? -repayment.amount : repayment.amount;

const rent = (purchases: Purchase[], history = true): SharedCategory => ({
  id: "shared-rent",
  categoryId: "rent",
  yourPercent: 50,
  purchases,
  opening: [],
  history,
});
const utilities = (purchases: Purchase[], history = true): SharedCategory => ({
  id: "shared-utilities",
  categoryId: "utilities",
  yourPercent: 60,
  purchases,
  opening: [],
  history,
});
const groceries = (purchases: Purchase[], history = true): SharedCategory => ({
  id: "shared-groceries",
  categoryId: "groceries",
  yourPercent: 40,
  purchases,
  opening: [],
  history,
});
const weekendProjects: SharedCategory = {
  id: "shared-weekend",
  categoryId: "weekend-projects",
  yourPercent: 50,
  purchases: [],
  opening: [],
  history: false,
};

export const scenarios: Record<ScenarioKey, Scenario> = {
  owe: {
    key: "owe",
    label: "You owe",
    hint: "Jordan paid rent; a repayment from Jordan waits for you to confirm",
    partner: true,
    month: "2026-10",
    carried: -12000,
    shared: [
      rent([
        {
          id: "p-rent",
          payee: "Greystar · October rent",
          date: "2026-10-01",
          paidBy: "partner",
          amount: 260000,
          yourShare: 130000,
        },
      ]),
      utilities([
        {
          id: "p-pge",
          payee: "PG&E",
          date: "2026-10-06",
          paidBy: "you",
          amount: 14230,
          yourShare: 8538,
        },
        {
          id: "p-comcast",
          payee: "Comcast Xfinity",
          date: "2026-10-12",
          paidBy: "partner",
          amount: 8000,
          yourShare: 4800,
        },
      ]),
      groceries([
        {
          id: "p-costco",
          payee: "Costco Wholesale · household stock-up",
          date: "2026-10-04",
          paidBy: "you",
          amount: 28000,
          yourShare: 11200,
        },
        {
          id: "p-tj",
          payee: "Trader Joe's",
          date: "2026-10-09",
          paidBy: "you",
          amount: 12346,
          yourShare: 4938,
        },
        {
          id: "p-wholefoods",
          payee: "Whole Foods Market",
          date: "2026-10-14",
          paidBy: "partner",
          amount: 8793,
          yourShare: 3000,
        },
        {
          id: "p-safeway",
          payee: "Safeway",
          date: "2026-10-19",
          paidBy: "partner",
          amount: 6410,
          yourShare: 2564,
          pending: true,
        },
      ]),
      weekendProjects,
    ],
    repayments: [
      {
        id: "r-jordan-oct3",
        date: "2026-10-03",
        amount: 12000,
        from: "partner",
      },
    ],
    youOwe: 140364,
    owedToYou: 29900,
  },
  owed: {
    key: "owed",
    label: "Owed to you",
    hint: "You paid rent; Jordan sent part of it back",
    partner: true,
    month: "2026-10",
    carried: 25000,
    shared: [
      rent([
        {
          id: "p-rent",
          payee: "Greystar · October rent",
          date: "2026-10-01",
          paidBy: "you",
          amount: 260000,
          yourShare: 130000,
        },
      ]),
      utilities([
        {
          id: "p-pge",
          payee: "PG&E",
          date: "2026-10-06",
          paidBy: "partner",
          amount: 14230,
          yourShare: 8538,
        },
        {
          id: "p-comcast",
          payee: "Comcast Xfinity",
          date: "2026-10-12",
          paidBy: "you",
          amount: 8000,
          yourShare: 4800,
        },
      ]),
      groceries([
        {
          id: "p-costco",
          payee: "Costco Wholesale · household stock-up",
          date: "2026-10-04",
          paidBy: "partner",
          amount: 28000,
          yourShare: 11200,
        },
        {
          id: "p-tj",
          payee: "Trader Joe's",
          date: "2026-10-09",
          paidBy: "you",
          amount: 12346,
          yourShare: 4938,
        },
      ]),
      weekendProjects,
    ],
    repayments: [
      {
        id: "r-you-oct2",
        date: "2026-10-02",
        amount: 25000,
        from: "you",
        receivedOn: "2026-10-03",
      },
      {
        id: "r-jordan-oct18",
        date: "2026-10-18",
        amount: 50000,
        from: "partner",
      },
    ],
    youOwe: 0,
    owedToYou: 70870,
  },
  settled: {
    key: "settled",
    label: "Settled",
    hint: "Jordan paid rent, you paid Jordan back, Jordan confirmed",
    partner: true,
    month: "2026-10",
    carried: 0,
    shared: [
      rent([
        {
          id: "p-rent",
          payee: "Greystar · October rent",
          date: "2026-10-01",
          paidBy: "partner",
          amount: 260000,
          yourShare: 130000,
        },
      ]),
      utilities([]),
      groceries([]),
      weekendProjects,
    ],
    repayments: [
      {
        id: "r-you-oct5",
        date: "2026-10-05",
        amount: 130000,
        from: "you",
        receivedOn: "2026-10-06",
      },
    ],
    youOwe: 0,
    owedToYou: 0,
  },
  "first-month": {
    key: "first-month",
    label: "First month",
    hint: "Just connected: categories shared, nothing recorded yet",
    partner: true,
    month: "2026-10",
    carried: 0,
    shared: [rent([], false), groceries([], false)],
    repayments: [],
    youOwe: 0,
    owedToYou: 0,
  },
  "nothing-shared": {
    key: "nothing-shared",
    label: "Nothing shared",
    hint: "Partner connected, no shared categories",
    partner: true,
    month: "2026-10",
    carried: 0,
    shared: [],
    repayments: [],
    youOwe: 0,
    owedToYou: 0,
  },
  "no-partner": {
    key: "no-partner",
    label: "No partner",
    hint: "No partner connected yet",
    partner: false,
    month: "2026-10",
    carried: 0,
    shared: [],
    repayments: [],
    youOwe: 0,
    owedToYou: 0,
  },
  "past-month": {
    key: "past-month",
    label: "Past month",
    hint: "September: read-only, settled from October",
    partner: true,
    month: "2026-09",
    carried: 0,
    shared: [
      rent([
        {
          id: "p-rent-sep",
          payee: "Greystar · September rent",
          date: "2026-09-01",
          paidBy: "partner",
          amount: 260000,
          yourShare: 130000,
        },
      ]),
      utilities([
        {
          id: "p-pge-sep",
          payee: "PG&E",
          date: "2026-09-07",
          paidBy: "you",
          amount: 15000,
          yourShare: 9000,
        },
      ]),
      groceries([
        {
          id: "p-costco-sep",
          payee: "Costco Wholesale",
          date: "2026-09-05",
          paidBy: "you",
          amount: 31250,
          yourShare: 12500,
        },
        {
          id: "p-tj-sep",
          payee: "Trader Joe's",
          date: "2026-09-16",
          paidBy: "you",
          amount: 10875,
          yourShare: 4350,
        },
        {
          id: "p-sprouts-sep",
          payee: "Sprouts Farmers Market",
          date: "2026-09-28",
          paidBy: "you",
          amount: 20000,
          yourShare: 8000,
        },
      ]),
      weekendProjects,
    ],
    repayments: [
      {
        id: "r-you-sep25",
        date: "2026-09-25",
        amount: 98725,
        from: "you",
        receivedOn: "2026-09-26",
      },
    ],
    youOwe: 0,
    owedToYou: 12000,
  },
};

type Seed = {
  id: string;
  name: string;
  group: string;
  assigned: number;
  activity: number;
  available: number;
  status: string;
  reserved?: number;
  pays?: Category["pays"];
};

const seeds: Seed[] = [
  {
    id: "amex-payment",
    name: "Amex Gold payment",
    group: "Credit card payments",
    assigned: 20000,
    activity: 106819,
    available: 169798,
    status: "Funded",
    pays: { type: "card", id: "amex", name: "Amex Gold" },
  },
  {
    id: "rent",
    name: "Rent",
    group: "Home",
    assigned: 130000,
    activity: 0,
    available: 130000,
    status: "Set aside for Jordan",
    reserved: 130000,
  },
  {
    id: "utilities",
    name: "Utilities & internet",
    group: "Home",
    assigned: 25000,
    activity: -14230,
    available: 10770,
    status: "Spent $142.30 of $250.00",
    reserved: 4800,
  },
  {
    id: "home-insurance",
    name: "Renters insurance",
    group: "Home",
    assigned: 1900,
    activity: 0,
    available: 1900,
    status: "Funded",
  },
  {
    id: "groceries",
    name: "Groceries",
    group: "Everyday",
    assigned: 60000,
    activity: -40346,
    available: 19654,
    status: "Spent $403.46 of $600.00",
    reserved: 5564,
  },
  {
    id: "dining",
    name: "Dining & coffee",
    group: "Everyday",
    assigned: 30000,
    activity: -34118,
    available: -4118,
    status: "Overspent $41.18",
  },
  {
    id: "transit",
    name: "Gas & transit",
    group: "Everyday",
    assigned: 20000,
    activity: -10885,
    available: 9115,
    status: "Spent $108.85 of $200.00",
  },
  {
    id: "subscriptions",
    name: "Subscriptions",
    group: "Everyday",
    assigned: 8000,
    activity: -3297,
    available: 4703,
    status: "Spent $32.97 of $80.00",
  },
  {
    id: "medical",
    name: "Medical & pharmacy",
    group: "True expenses",
    assigned: 5000,
    activity: -16786,
    available: -11786,
    status: "Overspent $117.86",
  },
  {
    id: "weekend-projects",
    name: "Weekend projects",
    group: "True expenses",
    assigned: 0,
    activity: 0,
    available: 0,
    status: "No money assigned",
  },
  {
    id: "gifts",
    name: "Gifts",
    group: "True expenses",
    assigned: 5000,
    activity: 0,
    available: 10222,
    status: "Funded",
  },
];

function toCategory(seed: Seed, sharePercent?: number): Category {
  const funding: Category["funding"] =
    seed.available < 0
      ? "overspent"
      : seed.available === 0 && seed.assigned === 0
        ? "empty"
        : "funded";
  const reserved = sharePercent === undefined ? 0 : (seed.reserved ?? 0);
  return {
    id: seed.id,
    name: seed.name,
    group: seed.group,
    assigned: seed.assigned,
    activity: seed.activity,
    available: seed.available,
    carryover: 0,
    funding,
    fundedRatio: 1,
    // Rent's status only says "set aside" while it's shared.
    status:
      sharePercent === undefined && seed.reserved ? "Funded" : seed.status,
    pays: seed.pays,
    reserved,
    spendable: Math.max(0, seed.available - reserved),
    sharePercents: sharePercent === undefined ? [] : [sharePercent],
    autoAssign: {
      id: seed.id,
      assigned: seed.assigned,
      available: seed.available,
      pairedAccountId: seed.pays?.type === "card" ? seed.pays.id : undefined,
      history: { assigned: [], spent: [] },
    },
  };
}

// The shell's month, drawn from the scenario's shared categories.
export function shellData(
  scenario: Scenario,
  readyToAssign: number,
): ShellData {
  const percentOf = new Map(
    scenario.shared.map((item) => [item.categoryId, item.yourPercent]),
  );
  const categories = seeds.map((seed) =>
    toCategory(seed, percentOf.get(seed.id)),
  );
  const groups: ShellData["groups"] = [];
  for (const category of categories) {
    const group = groups.find((item) => item.name === category.group);
    if (group) group.categories.push(category);
    else
      groups.push({
        id: category.group,
        name: category.group,
        categories: [category],
      });
  }
  const month = scenario.month;
  return {
    budgetName: "Alex's budget",
    month: {
      key: month,
      current: "2026-10",
      start: "2026-08",
      label: monthLabel(month),
      short: monthOnly(month),
      canGoBack: true,
    },
    today: TODAY,
    readyToAssign,
    groups,
    categories,
    accounts: [
      ...cashAccounts.map((item) => ({
        id: item.id,
        name: item.name,
        kind: "cash" as const,
        balance: item.balance,
        pending: 0,
        cleared: item.balance,
      })),
      {
        id: "amex",
        name: "Amex Gold",
        kind: "credit" as const,
        balance: -169798,
        pending: 0,
        cleared: -169798,
      },
    ],
    loans: [],
    transactions: [],
    costToBeMe: 512400,
    expectedIncome: 640000,
    partner: scenario.partner
      ? {
          name: PARTNER,
          youOwe: scenario.youOwe,
          owedToYou: scenario.owedToYou,
        }
      : undefined,
    reimbursements: [],
  };
}
