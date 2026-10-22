// Hardcoded data for the shared costs prototype: Alan's and Anna's linked
// budgets in October 2026. Amounts are in cents. Nothing here is saved.

export type Person = "alan" | "anna";

export const names: Record<Person, string> = { alan: "Alan", anna: "Anna" };

export const partnerOf = (person: Person): Person =>
  person === "alan" ? "anna" : "alan";

// A line's share goes to the partner, or to a named person or organization
// tracked in the reimbursements account.
export const PARTNER = "partner";

export type Share = { with: string; amount: number };

export type Line = {
  id: string;
  // The payer's own category. Private to the payer.
  categoryId: string | null;
  // Positive cents; the transaction's sign says which way the money moved.
  amount: number;
  share: Share | null;
  // The non-payer's own category for their part of a partner share. Private
  // to the non-payer, and empty until they categorize it.
  partnerCategoryId?: string | null;
};

export type Change = { at: string; by: Person; text: string };

export type Txn = {
  id: string;
  // Whose money moved.
  owner: Person;
  // Null while only the partner has recorded it and the payer's bank import
  // hasn't arrived.
  accountId: string | null;
  date: string;
  payee: string;
  // Signed cents: negative is money out.
  amount: number;
  kind: "spend" | "income" | "reimbursement";
  // For a reimbursement: who paid it back.
  from?: string;
  lines: Line[];
  status: "pending" | "posted";
  reviewed: boolean;
  recordedBy: Person;
  // Matched to an entry the partner recorded first.
  matched?: boolean;
  // The share came from payee memory.
  remembered?: boolean;
  history: Change[];
};

// A transfer between the partners. Both banks import it; one confirmation
// clears both sides.
export type Settlement = {
  id: string;
  from: Person;
  amount: number;
  date: string;
  method: string;
  confirmed: boolean;
};

export type Request = { id: string; by: Person; amount: number; date: string };

export type Scheduled = {
  id: string;
  owner: Person;
  date: string;
  payee: string;
  amount: number;
  categoryId: string;
  share: number;
};

export type AccountDef = {
  id: string;
  owner: Person;
  name: string;
  kind: "cash" | "credit" | "partner" | "reimbursements";
  // The balance before October's transactions.
  start: number;
};

export type CategoryDef = {
  id: string;
  owner: Person;
  name: string;
  group: string;
  assigned: number;
  // Paired envelopes and the card payment reserve are made by the system.
  paired?: "partner" | "reimbursements" | "card";
};

export type State = {
  txns: Txn[];
  settlements: Settlement[];
  requests: Request[];
  scheduled: Scheduled[];
  // Owed when the partnership started, from Alan's side: positive means
  // Anna owed Alan.
  opening: { amount: number; date: string; by: Person };
  // The assigned float in each paired envelope.
  floats: Record<Person, { partner: number; reimbursements: number }>;
};

export const TODAY = "2026-10-22";
export const MONTH = "October 2026";

export const accounts: AccountDef[] = [
  {
    id: "alan-chase",
    owner: "alan",
    name: "Chase Checking",
    kind: "cash",
    start: 742_310,
  },
  {
    id: "alan-sapphire",
    owner: "alan",
    name: "Sapphire Preferred",
    kind: "credit",
    start: 0,
  },
  {
    id: "alan-partner",
    owner: "alan",
    name: "Anna",
    kind: "partner",
    start: 0,
  },
  {
    id: "alan-reimbursements",
    owner: "alan",
    name: "Reimbursements",
    kind: "reimbursements",
    start: 0,
  },
  {
    id: "anna-ally",
    owner: "anna",
    name: "Ally Checking",
    kind: "cash",
    start: 486_455,
  },
  {
    id: "anna-amex",
    owner: "anna",
    name: "Amex Gold",
    kind: "credit",
    start: 0,
  },
  {
    id: "anna-partner",
    owner: "anna",
    name: "Alan",
    kind: "partner",
    start: 0,
  },
  {
    id: "anna-reimbursements",
    owner: "anna",
    name: "Reimbursements",
    kind: "reimbursements",
    start: 0,
  },
];

const category = (
  owner: Person,
  id: string,
  name: string,
  group: string,
  assigned: number,
  paired?: CategoryDef["paired"],
): CategoryDef => ({ id, owner, name, group, assigned, paired });

export const categories: CategoryDef[] = [
  category("alan", "a-rent", "Rent", "Bills", 135_000),
  category("alan", "a-utilities", "Utilities", "Bills", 6_000),
  category("alan", "a-internet", "Internet", "Bills", 4_000),
  category("alan", "a-groceries", "Groceries", "Everyday", 35_000),
  category("alan", "a-dining", "Dining out", "Everyday", 20_000),
  category("alan", "a-household", "Household", "Everyday", 15_000),
  category("alan", "a-transport", "Transport", "Everyday", 12_000),
  category("alan", "a-fun", "Fun money", "Personal", 15_000),
  category("alan", "a-travel", "Travel", "Personal", 40_000),
  category("alan", "a-gym", "Gym", "Personal", 4_500),
  category("alan", "a-env-partner", "Anna", "People", 0, "partner"),
  category(
    "alan",
    "a-env-reimbursements",
    "Reimbursements",
    "People",
    0,
    "reimbursements",
  ),
  category(
    "alan",
    "a-card",
    "Sapphire Preferred",
    "Credit Card Payments",
    0,
    "card",
  ),
  category("anna", "n-rent", "Rent", "Home", 135_000),
  category("anna", "n-utilities", "Utilities", "Home", 5_000),
  category("anna", "n-internet", "Internet", "Home", 4_000),
  category("anna", "n-household", "Household", "Home", 10_000),
  category("anna", "n-groceries", "Groceries", "Food", 30_000),
  category("anna", "n-dining", "Dining out", "Food", 18_000),
  category("anna", "n-rideshare", "Rideshare", "Getting around", 6_000),
  category("anna", "n-yoga", "Yoga", "Me", 15_000),
  category("anna", "n-fun", "Fun money", "Me", 12_000),
  category("anna", "n-env-partner", "Alan", "People", 0, "partner"),
  category(
    "anna",
    "n-env-reimbursements",
    "Reimbursements",
    "People",
    0,
    "reimbursements",
  ),
  category("anna", "n-card", "Amex Gold", "Credit Card Payments", 0, "card"),
];

// Ready to Assign before anything here moves it. Receivables never add to it.
export const readyToAssign: Record<Person, number> = {
  alan: 34_000,
  anna: 12_500,
};

// The couple's one setting: what an equal split means.
export const EQUAL_SPLIT = 0.5;

const line = (
  id: string,
  categoryId: string | null,
  amount: number,
  share: Share | null = null,
  partnerCategoryId?: string | null,
): Line => ({ id, categoryId, amount, share, partnerCategoryId });

const spend = (
  txn: Omit<Txn, "kind" | "status" | "reviewed" | "history" | "recordedBy"> &
    Partial<Pick<Txn, "status" | "reviewed" | "history" | "recordedBy">>,
): Txn => ({
  kind: "spend",
  status: "posted",
  reviewed: true,
  history: [],
  recordedBy: txn.owner,
  ...txn,
});

const partner = (amount: number): Share => ({ with: PARTNER, amount });

export const initialState: State = {
  opening: { amount: 23_000, date: "2026-09-30", by: "alan" },
  floats: {
    alan: { partner: 135_000, reimbursements: 0 },
    anna: { partner: 0, reimbursements: 0 },
  },
  requests: [{ id: "r1", by: "alan", amount: 158_000, date: "2026-10-02" }],
  settlements: [
    {
      id: "s1",
      from: "anna",
      amount: 50_000,
      date: "2026-10-12",
      method: "Zelle",
      confirmed: true,
    },
  ],
  scheduled: [
    {
      id: "sch-rent",
      owner: "alan",
      date: "2026-11-01",
      payee: "Parkline Apartments",
      amount: 270_000,
      categoryId: "a-rent",
      share: 135_000,
    },
  ],
  txns: [
    // Alan's checking and card.
    {
      id: "t-payroll",
      owner: "alan",
      accountId: "alan-chase",
      date: "2026-10-01",
      payee: "Northwind Payroll",
      amount: 486_000,
      kind: "income",
      lines: [],
      status: "posted",
      reviewed: true,
      recordedBy: "alan",
      history: [],
    },
    spend({
      id: "t-rent",
      owner: "alan",
      accountId: "alan-chase",
      date: "2026-10-01",
      payee: "Parkline Apartments",
      amount: -270_000,
      lines: [line("l1", "a-rent", 270_000, partner(135_000), "n-rent")],
      history: [
        {
          at: "2026-10-01",
          by: "alan",
          text: "Shared with Anna, $1,350.00 each (scheduled)",
        },
      ],
    }),
    spend({
      id: "t-bluebottle",
      owner: "alan",
      accountId: "alan-sapphire",
      date: "2026-10-02",
      payee: "Blue Bottle Coffee",
      amount: -650,
      lines: [line("l2", "a-dining", 650)],
    }),
    spend({
      id: "t-wholefoods-1",
      owner: "alan",
      accountId: "alan-sapphire",
      date: "2026-10-03",
      payee: "Whole Foods Market",
      amount: -12_840,
      lines: [line("l3", "a-groceries", 12_840, partner(6_420), "n-groceries")],
      history: [
        { at: "2026-10-03", by: "alan", text: "Split with Anna 50/50" },
      ],
    }),
    spend({
      id: "t-pge",
      owner: "alan",
      accountId: "alan-chase",
      date: "2026-10-05",
      payee: "PG&E",
      amount: -9_600,
      lines: [line("l4", "a-utilities", 9_600, partner(4_800), "n-utilities")],
      history: [
        { at: "2026-10-05", by: "alan", text: "Split with Anna 50/50" },
      ],
    }),
    spend({
      id: "t-delta",
      owner: "alan",
      accountId: "alan-sapphire",
      date: "2026-10-09",
      payee: "Delta Air Lines",
      amount: -41_200,
      lines: [
        line("l5", "a-travel", 41_200, { with: "Northwind", amount: 41_200 }),
      ],
    }),
    spend({
      id: "t-costco",
      owner: "alan",
      accountId: "alan-sapphire",
      date: "2026-10-11",
      payee: "Costco",
      amount: -21_237,
      lines: [
        line("l6", "a-household", 14_000, partner(7_000), "n-household"),
        line("l7", "a-fun", 7_237),
      ],
      history: [
        {
          at: "2026-10-11",
          by: "alan",
          text: "Split into 2 lines; shared $140.00 of household items with Anna",
        },
      ],
    }),
    spend({
      id: "t-comcast",
      owner: "alan",
      accountId: "alan-chase",
      date: "2026-10-16",
      payee: "Comcast",
      amount: -8_000,
      lines: [line("l8", "a-internet", 8_000, partner(4_000), "n-internet")],
      history: [
        { at: "2026-10-16", by: "alan", text: "Split with Anna 50/50" },
      ],
    }),
    spend({
      id: "t-tartine",
      owner: "alan",
      accountId: "alan-chase",
      date: "2026-10-17",
      payee: "Tartine Bakery",
      amount: -6_000,
      lines: [line("l9", "a-dining", 6_000, { with: "Priya", amount: 3_000 })],
    }),
    {
      id: "t-venmo-priya",
      owner: "alan",
      accountId: "alan-chase",
      date: "2026-10-19",
      payee: "Venmo from Priya",
      amount: 3_000,
      kind: "reimbursement",
      from: "Priya",
      lines: [],
      status: "posted",
      reviewed: true,
      recordedBy: "alan",
      history: [],
    },
    spend({
      id: "t-target",
      owner: "alan",
      accountId: "alan-sapphire",
      date: "2026-10-19",
      payee: "Target",
      amount: -9_000,
      lines: [line("l10", "a-household", 9_000, partner(3_000), null)],
      history: [
        { at: "2026-10-19", by: "alan", text: "Split with Anna 50/50" },
        {
          at: "2026-10-20",
          by: "anna",
          text: "Changed Anna's share from $45.00 to $30.00",
        },
      ],
    }),
    spend({
      id: "t-shell",
      owner: "alan",
      accountId: "alan-sapphire",
      date: "2026-10-20",
      payee: "Shell",
      amount: -5_212,
      lines: [line("l11", "a-transport", 5_212)],
    }),
    spend({
      id: "t-wholefoods-2",
      owner: "alan",
      accountId: "alan-sapphire",
      date: "2026-10-21",
      payee: "Whole Foods Market",
      amount: -9_630,
      status: "pending",
      reviewed: false,
      remembered: true,
      lines: [line("l12", "a-groceries", 9_630, partner(4_815), "n-groceries")],
    }),
    spend({
      id: "t-airbnb",
      owner: "alan",
      accountId: "alan-sapphire",
      date: "2026-10-21",
      payee: "Airbnb",
      amount: -64_000,
      status: "pending",
      reviewed: false,
      lines: [line("l13", null, 64_000)],
    }),
    spend({
      id: "t-sweetgreen",
      owner: "alan",
      accountId: "alan-sapphire",
      date: "2026-10-22",
      payee: "Sweetgreen",
      amount: -1_840,
      status: "pending",
      reviewed: false,
      remembered: true,
      lines: [line("l14", "a-dining", 1_840)],
    }),

    // Anna's checking and card.
    {
      id: "u-payroll",
      owner: "anna",
      accountId: "anna-ally",
      date: "2026-10-01",
      payee: "Lumen Health Payroll",
      amount: 412_000,
      kind: "income",
      lines: [],
      status: "posted",
      reviewed: true,
      recordedBy: "anna",
      history: [],
    },
    spend({
      id: "u-lyft",
      owner: "anna",
      accountId: "anna-amex",
      date: "2026-10-04",
      payee: "Lyft",
      amount: -2_350,
      lines: [line("m1", "n-rideshare", 2_350)],
    }),
    spend({
      id: "u-traderjoes",
      owner: "anna",
      accountId: "anna-amex",
      date: "2026-10-08",
      payee: "Trader Joe's",
      amount: -7_418,
      lines: [line("m2", "n-groceries", 7_418, partner(3_709), "a-groceries")],
      history: [
        { at: "2026-10-08", by: "anna", text: "Split with Alan 50/50" },
      ],
    }),
    spend({
      id: "u-nopa",
      owner: "anna",
      accountId: "anna-amex",
      date: "2026-10-14",
      payee: "Nopa",
      amount: -16_400,
      lines: [line("m3", "n-dining", 16_400, partner(8_200), null)],
      history: [
        { at: "2026-10-14", by: "anna", text: "Split with Alan 50/50" },
      ],
    }),
    spend({
      id: "u-corepower",
      owner: "anna",
      accountId: "anna-amex",
      date: "2026-10-15",
      payee: "CorePower Yoga",
      amount: -14_900,
      lines: [line("m4", "n-yoga", 14_900)],
    }),
    spend({
      id: "u-rainbow",
      owner: "anna",
      accountId: "anna-ally",
      date: "2026-10-18",
      payee: "Rainbow Grocery",
      amount: -4_630,
      lines: [line("m5", "n-groceries", 4_630)],
    }),
    // Anna paid; Alan recorded it at the till. Her import hasn't arrived.
    spend({
      id: "u-birite",
      owner: "anna",
      accountId: null,
      date: "2026-10-21",
      payee: "Bi-Rite Market",
      amount: -5_400,
      recordedBy: "alan",
      reviewed: false,
      lines: [line("m6", null, 5_400, partner(2_700), "a-groceries")],
      history: [
        {
          at: "2026-10-21",
          by: "alan",
          text: "Recorded: Anna paid $54.00, Alan's share $27.00",
        },
      ],
    }),
  ],
};
