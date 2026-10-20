export type Funding = "funded" | "underfunded" | "overspent" | "empty";

export type Category = {
  id: string;
  name: string;
  assigned: number;
  activity: number;
  carryover: number;
  target?: { amount: number; cadence: string; due?: string };
  note?: string;
};

type CategoryGroup = {
  id: string;
  name: string;
  categories: Category[];
};

export type Account = {
  id: string;
  name: string;
  kind: "cash" | "credit";
  cleared: number;
  uncleared: number;
  institution: string;
  syncedAgo: string;
};

export type Loan = {
  id: string;
  name: string;
  balance: number;
  rate: string;
  payment: number;
  payoff: string;
};

export type Transaction = {
  id: string;
  day: string;
  date: string;
  payee: string;
  categoryId: string | null;
  accountId: string;
  amount: number;
  memo?: string;
  status: "pending" | "cleared" | "reconciled";
  needsReview?: boolean;
};

export const month = { label: "October 2026", short: "October" };

export const groups: CategoryGroup[] = [
  {
    id: "bills",
    name: "Bills",
    categories: [
      {
        id: "rent",
        name: "Rent",
        assigned: 240000,
        activity: -240000,
        carryover: 0,
        target: { amount: 240000, cadence: "Monthly", due: "Oct 1" },
      },
      {
        id: "electric",
        name: "Electric",
        assigned: 9000,
        activity: -11842,
        carryover: 4210,
        target: { amount: 9000, cadence: "Monthly" },
      },
      {
        id: "internet",
        name: "Internet",
        assigned: 7000,
        activity: -6999,
        carryover: 0,
        target: { amount: 7000, cadence: "Monthly", due: "Oct 14" },
      },
      {
        id: "phone",
        name: "Phone",
        assigned: 4500,
        activity: 0,
        carryover: 0,
        target: { amount: 8500, cadence: "Monthly", due: "Oct 28" },
      },
    ],
  },
  {
    id: "everyday",
    name: "Everyday",
    categories: [
      {
        id: "groceries",
        name: "Groceries",
        assigned: 65000,
        activity: -41288,
        carryover: 3120,
        target: { amount: 80000, cadence: "Monthly" },
        note: "Costco run is usually the first weekend.",
      },
      {
        id: "dining",
        name: "Dining out",
        assigned: 20000,
        activity: -24218,
        carryover: 0,
        target: { amount: 20000, cadence: "Monthly" },
      },
      {
        id: "transport",
        name: "Transportation",
        assigned: 18000,
        activity: -9312,
        carryover: 1540,
        target: { amount: 18000, cadence: "Monthly" },
      },
      {
        id: "household",
        name: "Household",
        assigned: 0,
        activity: 0,
        carryover: 0,
      },
    ],
  },
  {
    id: "cards",
    name: "Credit card payments",
    categories: [
      {
        id: "sapphire-payment",
        name: "Sapphire Preferred",
        assigned: 0,
        activity: 184277,
        carryover: 0,
      },
      {
        id: "apple-payment",
        name: "Apple Card",
        assigned: 0,
        activity: 31004,
        carryover: 0,
      },
    ],
  },
  {
    id: "true-expenses",
    name: "True expenses",
    categories: [
      {
        id: "car-insurance",
        name: "Car insurance",
        assigned: 14000,
        activity: 0,
        carryover: 56000,
        target: { amount: 84000, cadence: "Every 6 months", due: "Jan 12" },
      },
      {
        id: "medical",
        name: "Medical",
        assigned: 10000,
        activity: -3500,
        carryover: 41250,
        target: { amount: 10000, cadence: "Monthly" },
      },
      {
        id: "gifts",
        name: "Gifts",
        assigned: 5000,
        activity: 0,
        carryover: 18000,
        target: { amount: 60000, cadence: "By Dec 15", due: "Dec 15" },
      },
      {
        id: "japan",
        name: "Japan trip",
        assigned: 50000,
        activity: -128000,
        carryover: 310000,
        target: { amount: 600000, cadence: "By Mar 2027", due: "Mar 1" },
        note: "Flights booked. Ryokan deposit due in January.",
      },
    ],
  },
  {
    id: "fun",
    name: "Fun",
    categories: [
      {
        id: "hobbies",
        name: "Hobbies",
        assigned: 7500,
        activity: -2199,
        carryover: 0,
        target: { amount: 7500, cadence: "Monthly" },
      },
      {
        id: "subscriptions",
        name: "Subscriptions",
        assigned: 6200,
        activity: -6197,
        carryover: 0,
        target: { amount: 6200, cadence: "Monthly" },
      },
    ],
  },
];

export const accounts: Account[] = [
  {
    id: "checking",
    name: "Chase Checking",
    kind: "cash",
    cleared: 841233,
    uncleared: -12460,
    institution: "Chase",
    syncedAgo: "4 min ago",
  },
  {
    id: "savings",
    name: "Ally Savings",
    kind: "cash",
    cleared: 2415000,
    uncleared: 0,
    institution: "Ally Bank",
    syncedAgo: "1 hr ago",
  },
  {
    id: "wallet",
    name: "Cash wallet",
    kind: "cash",
    cleared: 12000,
    uncleared: 0,
    institution: "Manual",
    syncedAgo: "Updated Oct 16",
  },
  {
    id: "sapphire",
    name: "Sapphire Preferred",
    kind: "credit",
    cleared: -170811,
    uncleared: -13466,
    institution: "Chase",
    syncedAgo: "4 min ago",
  },
  {
    id: "apple",
    name: "Apple Card",
    kind: "credit",
    cleared: -31004,
    uncleared: 0,
    institution: "Apple",
    syncedAgo: "Needs reconnect",
  },
];

export const loans: Loan[] = [
  {
    id: "mortgage",
    name: "Mortgage",
    balance: 41288012,
    rate: "6.125%",
    payment: 312400,
    payoff: "Aug 2053",
  },
  {
    id: "car",
    name: "Car loan",
    balance: 1421000,
    rate: "4.9%",
    payment: 48200,
    payoff: "Jun 2029",
  },
];

export const transactions: Transaction[] = [
  {
    id: "t1",
    day: "Today",
    date: "Oct 19",
    payee: "Trader Joe's",
    categoryId: "groceries",
    accountId: "sapphire",
    amount: -8412,
    status: "pending",
    needsReview: true,
  },
  {
    id: "t2",
    day: "Today",
    date: "Oct 19",
    payee: "Blue Bottle Coffee",
    categoryId: null,
    accountId: "sapphire",
    amount: -1150,
    status: "pending",
    needsReview: true,
  },
  {
    id: "t3",
    day: "Today",
    date: "Oct 19",
    payee: "Shell",
    categoryId: "transport",
    accountId: "checking",
    amount: -5260,
    status: "pending",
  },
  {
    id: "t4",
    day: "Yesterday",
    date: "Oct 18",
    payee: "Nopa",
    categoryId: "dining",
    accountId: "sapphire",
    amount: -13466,
    memo: "Dinner with the Parks, split later",
    status: "cleared",
    needsReview: true,
  },
  {
    id: "t5",
    day: "Yesterday",
    date: "Oct 18",
    payee: "PG&E",
    categoryId: "electric",
    accountId: "checking",
    amount: -11842,
    status: "cleared",
  },
  {
    id: "t6",
    day: "Yesterday",
    date: "Oct 18",
    payee: "Amazon",
    categoryId: null,
    accountId: "apple",
    amount: -4799,
    status: "cleared",
    needsReview: true,
  },
  {
    id: "t7",
    day: "Thursday",
    date: "Oct 16",
    payee: "Payroll - Northwind",
    categoryId: null,
    accountId: "checking",
    amount: 512840,
    memo: "Ready to Assign",
    status: "cleared",
  },
  {
    id: "t8",
    day: "Thursday",
    date: "Oct 16",
    payee: "Spotify",
    categoryId: "subscriptions",
    accountId: "apple",
    amount: -1199,
    status: "reconciled",
  },
  {
    id: "t9",
    day: "Wednesday",
    date: "Oct 15",
    payee: "Comcast Xfinity",
    categoryId: "internet",
    accountId: "checking",
    amount: -6999,
    status: "reconciled",
  },
  {
    id: "t10",
    day: "Wednesday",
    date: "Oct 15",
    payee: "Safeway",
    categoryId: "groceries",
    accountId: "checking",
    amount: -6721,
    status: "reconciled",
  },
  {
    id: "t11",
    day: "Wednesday",
    date: "Oct 15",
    payee: "ANA Airlines",
    categoryId: "japan",
    accountId: "sapphire",
    amount: -128000,
    memo: "SFO - HND, 2 seats",
    status: "reconciled",
  },
];

export const allCategories = groups.flatMap((group) =>
  group.categories.map((category) => ({ ...category, group: group.name })),
);

export function available(category: Category) {
  return category.carryover + category.assigned + category.activity;
}

export function funding(category: Category): Funding {
  const value = available(category);
  if (value < 0) return "overspent";
  if (!category.target) return value > 0 ? "funded" : "empty";
  const needed = category.target.amount - category.assigned;
  return needed > 0 ? "underfunded" : "funded";
}

export function fundedRatio(category: Category) {
  if (!category.target) return available(category) > 0 ? 1 : 0;
  return Math.min(1, category.assigned / category.target.amount);
}

export function balance(account: Account) {
  return account.cleared + account.uncleared;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const signedCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  signDisplay: "exceptZero",
});

export function money(cents: number, signed = false) {
  return (signed ? signedCurrency : currency).format(cents / 100);
}
