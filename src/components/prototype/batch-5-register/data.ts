// Hardcoded data for the Batch 5 prototype: register history and bank
// import match and reject. Nothing here reads or writes the
// budget; every action changes this page's state only.

export type AccountId = "chase" | "savings" | "amex" | "discover";

export const accounts: {
  id: AccountId;
  name: string;
  kind: "cash" | "credit";
  institution: string;
  balance: number;
}[] = [
  {
    id: "chase",
    name: "Chase Total Checking",
    kind: "cash",
    institution: "Chase",
    balance: 2105514,
  },
  {
    id: "savings",
    name: "Discover Savings",
    kind: "cash",
    institution: "Discover",
    balance: 1257461,
  },
  {
    id: "amex",
    name: "American Express",
    kind: "credit",
    institution: "American Express",
    balance: -169798,
  },
  {
    id: "discover",
    name: "Discover It",
    kind: "credit",
    institution: "Discover",
    balance: -40078,
  },
];

export const accountName = (id: AccountId) =>
  accounts.find((item) => item.id === id)!.name;

// Who made a change: the person, their bank, or Caishen on its own (an
// automatic match).
export type Actor = "you" | "bank" | "caishen";

export type HistoryEvent = {
  id: string;
  at: string; // "2026-10-19T09:12"
  actor: Actor;
  kind:
    | "imported"
    | "entered"
    | "renamed"
    | "categorized"
    | "amount"
    | "posted"
    | "date"
    | "approved"
    | "matched"
    | "unmatched";
  // What changed, in plain words, and the value before and after when
  // there is one.
  text: string;
  from?: string;
  to?: string;
};

export type Transaction = {
  id: string;
  accountId: AccountId;
  date: string;
  payee: string;
  // How the bank named it, when it came from the bank.
  bankPayee?: string;
  amount: number;
  status: "pending" | "posted";
  category: string;
  needsReview: boolean;
  // A bank import that isn't in the budget yet.
  source: "budget" | "bank";
  // The bank removed this import before it was confirmed.
  removedByBank?: boolean;
  // Transactions this import was unmatched from, so they aren't suggested
  // again.
  notWith?: string[];
  // The budget transaction this one is matched with: for a budget row, the
  // import it absorbed; kept so Unmatch can split them again.
  matched?: {
    importId: string;
    bankPayee: string;
    bankDate: string;
    bankAmount: number;
    // What the person entered before the bank's amount replaced it.
    enteredAmount: number;
    automatic: boolean;
  };
  history: HistoryEvent[];
};

export const TODAY = "2026-10-21";

const t = (
  id: string,
  accountId: AccountId,
  date: string,
  payee: string,
  amount: number,
  category: string,
  extra: Partial<Transaction> = {},
): Transaction => ({
  id,
  accountId,
  date,
  payee,
  amount,
  category,
  status: "posted",
  needsReview: false,
  source: "budget",
  history: [
    {
      id: `${id}-entered`,
      at: `${date}T12:00`,
      actor: "you",
      kind: "entered",
      text: "You entered it",
    },
  ],
  ...extra,
});

// Every import starts its story the same way.
export function importedEvent(item: Transaction): HistoryEvent {
  return {
    id: `${item.id}-imported`,
    at: `${item.date}T20:00`,
    actor: "bank",
    kind: "imported",
    text: `Imported from ${accountName(item.accountId)}${item.status === "pending" ? ", pending" : ""}`,
    to: money(Math.abs(item.amount)),
  };
}

export function initialTransactions(): Transaction[] {
  return importedFirst([
    // ---------- Pending ----------
    t(
      "t-traderjoes",
      "amex",
      "2026-10-21",
      "Trader Joe’s",
      -4218,
      "Groceries",
      {
        status: "pending",
        bankPayee: "TRADER JOE S #236",
        history: [
          {
            id: "tj-1",
            at: "2026-10-21T08:40",
            actor: "bank",
            kind: "imported",
            text: "Imported from American Express, pending",
            to: "$42.18",
          },
          {
            id: "tj-2",
            at: "2026-10-21T08:40",
            actor: "caishen",
            kind: "categorized",
            text: "Categorized like your last Trader Joe’s purchase",
            to: "Groceries",
          },
        ],
      },
    ),

    // ---------- Bank imports waiting for review ----------
    {
      id: "i-tartine",
      accountId: "amex",
      date: "2026-10-20",
      payee: "Tartine Bakery",
      bankPayee: "SQ *TARTINE BAKERY SF",
      amount: -1314,
      status: "posted",
      category: "Dining & coffee",
      needsReview: true,
      source: "budget",
      history: [
        {
          id: "tb-1",
          at: "2026-10-19T09:12",
          actor: "bank",
          kind: "imported",
          text: "Imported from American Express, pending",
          to: "$10.95",
        },
        {
          id: "tb-2",
          at: "2026-10-19T09:12",
          actor: "caishen",
          kind: "renamed",
          text: "Payee renamed the way you named it last time",
          from: "SQ *TARTINE BAKERY SF",
          to: "Tartine Bakery",
        },
        {
          id: "tb-3",
          at: "2026-10-19T09:12",
          actor: "caishen",
          kind: "categorized",
          text: "Categorized like your last Tartine Bakery purchase",
          to: "Dining & coffee",
        },
        {
          id: "tb-4",
          at: "2026-10-20T06:05",
          actor: "bank",
          kind: "posted",
          text: "Posted with the tip added",
          from: "$10.95",
          to: "$13.14",
        },
        {
          id: "tb-5",
          at: "2026-10-20T06:05",
          actor: "bank",
          kind: "date",
          text: "Date moved to when it posted",
          from: "Oct 19",
          to: "Oct 20",
        },
      ],
    },
    {
      id: "i-safeway",
      accountId: "amex",
      date: "2026-10-18",
      payee: "Safeway",
      bankPayee: "SAFEWAY #1507",
      amount: -6107,
      status: "posted",
      category: "",
      needsReview: true,
      source: "bank",
      history: [],
    },
    {
      id: "i-pge",
      accountId: "chase",
      date: "2026-10-14",
      payee: "PG&E",
      bankPayee: "PGANDE WEB ONLINE",
      amount: -7619,
      status: "posted",
      category: "",
      needsReview: true,
      source: "bank",
      history: [],
    },
    {
      id: "i-bart",
      accountId: "chase",
      date: "2026-10-14",
      payee: "BART",
      bankPayee: "BART CLIPPER SFO",
      amount: -2450,
      status: "posted",
      category: "",
      needsReview: true,
      source: "bank",
      history: [],
    },
    {
      id: "i-uber",
      accountId: "discover",
      date: "2026-10-09",
      payee: "Uber",
      bankPayee: "UBER *TRIP HELP.UBER.COM",
      amount: -1820,
      status: "pending",
      category: "",
      needsReview: true,
      source: "bank",
      removedByBank: true,
      history: [],
    },

    // ---------- Budget transactions ----------
    t("t-safeway", "amex", "2026-10-18", "Safeway", -5823, "Groceries"),
    t(
      "t-bluebottle",
      "chase",
      "2026-10-16",
      "Blue Bottle Coffee",
      -650,
      "Dining & coffee",
      {
        bankPayee: "BLUE BOTTLE COFFEE 0042",
        matched: {
          importId: "i-bluebottle",
          bankPayee: "BLUE BOTTLE COFFEE 0042",
          bankDate: "2026-10-17",
          bankAmount: -650,
          enteredAmount: -650,
          automatic: true,
        },
        history: [
          {
            id: "bb-1",
            at: "2026-10-16T08:02",
            actor: "you",
            kind: "entered",
            text: "You entered it",
            to: "$6.50",
          },
          {
            id: "bb-2",
            at: "2026-10-17T06:10",
            actor: "caishen",
            kind: "matched",
            text: "Matched with the bank import from Oct 17. Your date and payee were kept",
          },
        ],
      },
    ),
    t("t-chevron", "chase", "2026-10-15", "Chevron", -5287, "Gas & transit"),
    t(
      "t-payroll",
      "chase",
      "2026-10-15",
      "Cedar Labs · payroll",
      325000,
      "Ready to Assign",
      { bankPayee: "CEDAR LABS INC PAYROLL" },
    ),
    t(
      "t-pge",
      "chase",
      "2026-10-14",
      "PG&E autopay",
      -7619,
      "Utilities & internet",
    ),
    t(
      "t-onemedical",
      "chase",
      "2026-10-14",
      "One Medical · urgent care",
      -14300,
      "Medical & pharmacy",
    ),
    t(
      "t-bart",
      "chase",
      "2026-10-13",
      "BART · Clipper",
      -2450,
      "Gas & transit",
    ),
    t("t-rei", "amex", "2026-10-11", "REI", -14800, "Clothing & home", {
      bankPayee: "REI #0071 SAN FRANCISCO",
    }),
    t(
      "t-nopalito",
      "amex",
      "2026-10-08",
      "Nopalito",
      -8640,
      "Dining & coffee",
      {
        bankPayee: "NOPALITO 9TH AVE",
      },
    ),
    t("t-hotel", "amex", "2026-10-06", "Hotel Kabuki", -31240, "Travel", {
      bankPayee: "HOTEL KABUKI SAN FRANCISCO",
    }),
  ]);
}

function importedFirst(items: Transaction[]) {
  return items.map((item) =>
    item.source === "bank" && !item.history.length
      ? { ...item, history: [importedEvent(item)] }
      : item,
  );
}

export const categoryNames = [
  "Groceries",
  "Dining & coffee",
  "Gas & transit",
  "Utilities & internet",
  "Travel",
  "Clothing & home",
  "Medical & pharmacy",
];

// YNAB's matching window: a bank import and an entered transaction match
// when they're in the same account, within 10 days, for the same amount.
const MATCH_DAYS = 10;

const daysBetween = (a: string, b: string) =>
  Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

// The transactions an import could duplicate.
export function candidatesFor(
  item: Transaction,
  transactions: Transaction[],
): Transaction[] {
  if (item.source !== "bank" || item.removedByBank) return [];
  return transactions.filter(
    (other) =>
      other.source === "budget" &&
      !other.matched &&
      !item.notWith?.includes(other.id) &&
      !other.bankPayee &&
      other.accountId === item.accountId &&
      other.amount === item.amount &&
      daysBetween(other.date, item.date) <= MATCH_DAYS,
  );
}

export const money = (cents: number) =>
  (cents < 0 ? "-$" : "$") +
  (Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const day = (date: string) =>
  new Date(`${date.slice(0, 10)}T12:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

export const time = (at: string) =>
  new Date(at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
