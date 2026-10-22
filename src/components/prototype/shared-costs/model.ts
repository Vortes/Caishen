import type { Category, Funding, ShellData } from "../app-shell/model";

// Hardcoded data for the shared costs prototype: Alan and Anna's two private
// budgets, linked through one partner ledger, in October 2026. Everything is
// derived from the facts below the way the model says: money moved (bank),
// purpose (category), consumption (a share on a line), and settlements.
// Nothing here reads or writes a real budget.

export type Person = "alan" | "anna";
export const PARTNER = "partner";

export const PEOPLE: Record<Person, { name: string; full: string }> = {
  alan: { name: "Alan", full: "Alan Wu" },
  anna: { name: "Anna", full: "Anna Li" },
};

export const other = (person: Person): Person =>
  person === "alan" ? "anna" : "alan";

export const TODAY = "2026-10-22";
export const MONTH = "2026-10";
export const RTA = "rta";

const d = (value: number) => Math.round(value * 100);

// ---------- Facts ----------

// The share on a line: who consumed part of it, and how much. `who` is
// PARTNER or a named person or organization in the reimbursements account.
export type Share = { who: string; amount: number };

// Amounts are outflows in cents; a refund or inflow is negative.
export type Line = {
  id: string;
  categoryId: string | null;
  amount: number;
  share?: Share;
};

export type Edit = {
  who: Person;
  what: string;
  from: number;
  to: number;
  when: string;
};

export type Txn = {
  id: string;
  owner: Person;
  // Null while only the ledger has it: recorded by the partner before the
  // payer's bank import arrived.
  accountId: string | null;
  date: string;
  payee: string;
  lines: Line[];
  recordedBy: Person;
  imported: boolean;
  reviewed: boolean;
  pending?: boolean;
  // What filled the category and share in.
  prefill?: "memory" | "schedule";
  history: Edit[];
};

// A transfer between the partners: any amount, either way. Both banks import
// it; one confirmation clears both sides.
export type PartnerTransfer = {
  id: string;
  date: string;
  from: Person;
  to: Person;
  amount: number;
  payee: Record<Person, string>;
  accountId: Record<Person, string>;
  confirmed: boolean;
};

// Money from someone in the reimbursements account. Private to its owner.
export type ReimbursementTransfer = {
  id: string;
  owner: Person;
  date: string;
  who: string;
  amount: number;
  payee: string;
  accountId: string;
  confirmed: boolean;
};

export type Request = {
  id: string;
  askedBy: Person;
  amount: number;
  date: string;
};

export type Scheduled = {
  id: string;
  owner: Person;
  accountId: string;
  date: string;
  payee: string;
  categoryId: string;
  amount: number;
  share?: Share;
};

// The non-payer's side of a partner entry: their own category for their
// share, which the payer never sees.
export type Side = {
  categoryId: string | null;
  reviewed: boolean;
  prefill?: boolean;
};

export type World = {
  partnered: boolean;
  // What "split equally" means for this couple, in percent.
  split: Record<Person, number>;
  txns: Txn[];
  transfers: PartnerTransfer[];
  reimbursements: ReimbursementTransfer[];
  opening?: { owedTo: Person; amount: number; date: string; by: Person };
  requests: Request[];
  scheduled: Scheduled[];
  side: Record<string, Side>;
  // This month's assigned amount per category, per budget.
  assigned: Record<Person, Record<string, number>>;
  // The float each paired envelope held before this month.
  floatBefore: Record<Person, Record<"env-partner" | "env-reimb", number>>;
  // Who changed the split setting, for its own history line.
  splitEdit?: { who: Person; when: string };
};

// ---------- Static budget shape ----------

export type AccountDef = {
  id: string;
  name: string;
  kind: "cash" | "credit" | "tracking";
  // Balance on September 1, before any transaction here.
  start: number;
};

type CategoryDef = {
  id: string;
  name: string;
  group: string;
  // Available at the start of October, outside the shared mechanics.
  carry: number;
  pays?: string;
  // A paired envelope.
  paired?: "partner" | "reimbursements";
};

export const SHARED_GROUP = "Shared costs";

export const ACCOUNTS: Record<Person, AccountDef[]> = {
  alan: [
    { id: "checking", name: "Chase Checking", kind: "cash", start: d(9240) },
    { id: "amex", name: "Amex Gold", kind: "credit", start: 0 },
    {
      id: "vanguard",
      name: "Vanguard 401(k)",
      kind: "tracking",
      start: d(48210.77),
    },
  ],
  anna: [
    { id: "ally", name: "Ally Checking", kind: "cash", start: d(6120) },
    { id: "sapphire", name: "Chase Sapphire", kind: "credit", start: 0 },
  ],
};

const CATEGORIES: Record<Person, CategoryDef[]> = {
  alan: [
    {
      id: "pay-amex",
      name: "Amex Gold payment",
      group: "Credit card payments",
      carry: 0,
      pays: "amex",
    },
    { id: "rent", name: "Rent", group: "Bills", carry: 0 },
    { id: "electric", name: "Electric & internet", group: "Bills", carry: 0 },
    { id: "groceries", name: "Groceries", group: "Food", carry: d(12.4) },
    { id: "dining", name: "Dining out", group: "Food", carry: 0 },
    { id: "household", name: "Household", group: "Personal", carry: 0 },
    { id: "concerts", name: "Concerts & fun", group: "Personal", carry: 0 },
    { id: "work", name: "Work travel", group: "Personal", carry: 0 },
    {
      id: "env-partner",
      name: "Anna",
      group: SHARED_GROUP,
      carry: 0,
      paired: "partner",
    },
    {
      id: "env-reimb",
      name: "Reimbursements",
      group: SHARED_GROUP,
      carry: 0,
      paired: "reimbursements",
    },
  ],
  anna: [
    {
      id: "pay-sapphire",
      name: "Chase Sapphire payment",
      group: "Credit card payments",
      carry: 0,
      pays: "sapphire",
    },
    { id: "a-rent", name: "Rent", group: "Housing", carry: 0 },
    { id: "a-utilities", name: "Utilities", group: "Housing", carry: 0 },
    { id: "a-groceries", name: "Groceries", group: "Food", carry: 0 },
    { id: "a-restaurants", name: "Restaurants", group: "Food", carry: 0 },
    { id: "a-home", name: "Home goods", group: "Life", carry: d(40) },
    { id: "a-health", name: "Health insurance", group: "Life", carry: 0 },
    {
      id: "env-partner",
      name: "Alan",
      group: SHARED_GROUP,
      carry: 0,
      paired: "partner",
    },
    {
      id: "env-reimb",
      name: "Reimbursements",
      group: SHARED_GROUP,
      carry: 0,
      paired: "reimbursements",
    },
  ],
};

// Ready to Assign with this month's seeded assignments already taken out.
const RTA_BASE: Record<Person, number> = { alan: d(1184.52), anna: d(2046.1) };

const SEED_ASSIGNED: Record<Person, Record<string, number>> = {
  alan: {
    rent: d(1350),
    electric: d(120),
    groceries: d(400),
    dining: d(150),
    household: d(100),
    concerts: d(150),
  },
  anna: {
    "a-rent": d(1350),
    "a-utilities": d(90),
    "a-groceries": d(350),
    "a-restaurants": d(150),
    "a-health": d(210),
  },
};

// Each person's payee memory from before September: the last
// categorization of a payee, share included.
const MEMORY: Record<
  Person,
  Record<string, { categoryId: string; share?: { who: string; ratio: number } }>
> = {
  alan: {
    "Greystar Rent": {
      categoryId: "rent",
      share: { who: PARTNER, ratio: 0.5 },
    },
    "Trader Joe's": {
      categoryId: "groceries",
      share: { who: PARTNER, ratio: 0.5 },
    },
    Nopa: { categoryId: "dining" },
    "Blue Bottle Coffee": { categoryId: "dining" },
    Ticketmaster: { categoryId: "concerts" },
    "United Airlines": {
      categoryId: "work",
      share: { who: "Acme Corp", ratio: 1 },
    },
    Costco: { categoryId: "household" },
    Target: { categoryId: "household", share: { who: PARTNER, ratio: 0.5 } },
    "Whole Foods": { categoryId: "groceries" },
    "PG&E": { categoryId: "electric" },
  },
  anna: {
    "Greystar Rent": { categoryId: "a-rent" },
    "Trader Joe's": { categoryId: "a-groceries" },
    Nopa: {
      categoryId: "a-restaurants",
      share: { who: PARTNER, ratio: 0.5 },
    },
    Target: { categoryId: "a-home" },
    "PG&E": {
      categoryId: "a-utilities",
      share: { who: PARTNER, ratio: 0.5 },
    },
    "Whole Foods": {
      categoryId: "a-groceries",
      share: { who: PARTNER, ratio: 0.5 },
    },
    Sweetgreen: { categoryId: "a-restaurants" },
  },
};

// ---------- Seed ----------

const txn = (
  value: Omit<Txn, "recordedBy" | "imported" | "reviewed" | "history"> &
    Partial<Pick<Txn, "recordedBy" | "imported" | "reviewed" | "history">>,
): Txn => ({
  recordedBy: value.owner,
  imported: true,
  reviewed: true,
  history: [],
  ...value,
});

const partnerShare = (amount: number) => ({ who: PARTNER, amount });

export function seedWorld(): World {
  return {
    partnered: true,
    split: { alan: 50, anna: 50 },
    opening: { owedTo: "alan", amount: d(240), date: "2026-08-31", by: "alan" },
    txns: [
      // September, before this month: settled by Anna's Zelle on the 30th.
      txn({
        id: "t-rent-sep",
        owner: "alan",
        accountId: "checking",
        date: "2026-09-01",
        payee: "Greystar Rent",
        lines: [
          {
            id: "l1",
            categoryId: "rent",
            amount: d(2700),
            share: partnerShare(d(1350)),
          },
        ],
        prefill: "schedule",
      }),
      txn({
        id: "t-target-sep",
        owner: "alan",
        accountId: "amex",
        date: "2026-09-06",
        payee: "Target",
        lines: [
          {
            id: "l1",
            categoryId: "household",
            amount: d(80),
            share: partnerShare(d(40)),
          },
        ],
      }),
      txn({
        id: "t-wholefoods-sep",
        owner: "anna",
        accountId: "sapphire",
        date: "2026-09-20",
        payee: "Whole Foods",
        lines: [
          {
            id: "l1",
            categoryId: "a-groceries",
            amount: d(60),
            share: partnerShare(d(30)),
          },
        ],
      }),
      // October, Alan.
      txn({
        id: "t-rent-oct",
        owner: "alan",
        accountId: "checking",
        date: "2026-10-01",
        payee: "Greystar Rent",
        lines: [
          {
            id: "l1",
            categoryId: "rent",
            amount: d(2700),
            share: partnerShare(d(1350)),
          },
        ],
        prefill: "schedule",
      }),
      txn({
        id: "t-tj",
        owner: "alan",
        accountId: "amex",
        date: "2026-10-03",
        payee: "Trader Joe's",
        lines: [
          {
            id: "l1",
            categoryId: "groceries",
            amount: d(86.4),
            share: partnerShare(d(43.2)),
          },
        ],
        prefill: "memory",
      }),
      txn({
        id: "t-costco",
        owner: "alan",
        accountId: "amex",
        date: "2026-10-05",
        payee: "Costco",
        lines: [
          { id: "l1", categoryId: "household", amount: d(72.37) },
          {
            id: "l2",
            categoryId: "groceries",
            amount: d(140),
            share: partnerShare(d(70)),
          },
        ],
        history: [
          {
            who: "alan",
            what: "Anna's share",
            from: d(106.19),
            to: d(70),
            when: "2026-10-06",
          },
        ],
      }),
      txn({
        id: "t-ticket",
        owner: "alan",
        accountId: "amex",
        date: "2026-10-10",
        payee: "Ticketmaster",
        lines: [
          {
            id: "l1",
            categoryId: "concerts",
            amount: d(240),
            share: { who: "Sam Ortiz", amount: d(120) },
          },
        ],
      }),
      txn({
        id: "t-united",
        owner: "alan",
        accountId: "amex",
        date: "2026-10-12",
        payee: "United Airlines",
        lines: [
          {
            id: "l1",
            categoryId: "work",
            amount: d(412.18),
            share: { who: "Acme Corp", amount: d(412.18) },
          },
        ],
        prefill: "memory",
      }),
      txn({
        id: "t-payroll",
        owner: "alan",
        accountId: "checking",
        date: "2026-10-15",
        payee: "Acme Corp payroll",
        lines: [{ id: "l1", categoryId: RTA, amount: -d(4210) }],
      }),
      txn({
        id: "t-target-refund",
        owner: "alan",
        accountId: "amex",
        date: "2026-10-16",
        payee: "Target",
        lines: [
          {
            id: "l1",
            categoryId: "household",
            amount: -d(30),
            share: partnerShare(-d(15)),
          },
        ],
        prefill: "memory",
      }),
      txn({
        id: "t-bluebottle",
        owner: "alan",
        accountId: "amex",
        date: "2026-10-18",
        payee: "Blue Bottle Coffee",
        lines: [{ id: "l1", categoryId: "dining", amount: d(6.5) }],
      }),
      txn({
        id: "t-safeway",
        owner: "alan",
        accountId: "amex",
        date: "2026-10-21",
        payee: "Safeway",
        lines: [{ id: "l1", categoryId: null, amount: d(64.18) }],
        reviewed: false,
      }),
      txn({
        id: "t-tj2",
        owner: "alan",
        accountId: "amex",
        date: "2026-10-22",
        payee: "Trader Joe's",
        lines: [
          {
            id: "l1",
            categoryId: "groceries",
            amount: d(52.1),
            share: partnerShare(d(26.05)),
          },
        ],
        pending: true,
        reviewed: false,
        prefill: "memory",
      }),
      // October, Anna.
      txn({
        id: "t-sweetgreen",
        owner: "anna",
        accountId: "sapphire",
        date: "2026-10-02",
        payee: "Sweetgreen",
        lines: [{ id: "l1", categoryId: "a-restaurants", amount: d(15.75) }],
      }),
      txn({
        id: "t-blueshield",
        owner: "anna",
        accountId: "ally",
        date: "2026-10-07",
        payee: "Blue Shield",
        lines: [{ id: "l1", categoryId: "a-health", amount: d(210) }],
      }),
      txn({
        id: "t-nopa",
        owner: "anna",
        accountId: "sapphire",
        date: "2026-10-08",
        payee: "Nopa",
        lines: [
          {
            id: "l1",
            categoryId: "a-restaurants",
            amount: d(96),
            share: partnerShare(d(48)),
          },
        ],
        prefill: "memory",
      }),
      // Alan recorded the bill Anna paid; her bank hasn't sent it yet.
      txn({
        id: "t-pge",
        owner: "anna",
        accountId: null,
        date: "2026-10-09",
        payee: "PG&E",
        lines: [
          {
            id: "l1",
            categoryId: null,
            amount: d(132.5),
            share: partnerShare(d(66.25)),
          },
        ],
        recordedBy: "alan",
        imported: false,
      }),
      txn({
        id: "t-ally-paycheck",
        owner: "anna",
        accountId: "ally",
        date: "2026-10-15",
        payee: "Kaiser payroll",
        lines: [{ id: "l1", categoryId: RTA, amount: -d(3890) }],
      }),
    ],
    transfers: [
      {
        id: "s-sep",
        date: "2026-09-30",
        from: "anna",
        to: "alan",
        amount: d(1600),
        payee: { alan: "Zelle from Anna Li", anna: "Zelle to Alan Wu" },
        accountId: { alan: "checking", anna: "ally" },
        confirmed: true,
      },
      {
        id: "s-zelle",
        date: "2026-10-14",
        from: "anna",
        to: "alan",
        amount: d(500),
        payee: { alan: "Zelle from Anna Li", anna: "Zelle to Alan Wu" },
        accountId: { alan: "checking", anna: "ally" },
        confirmed: true,
      },
      // Anna paid Alan's card directly.
      {
        id: "s-card",
        date: "2026-10-19",
        from: "anna",
        to: "alan",
        amount: d(300),
        payee: { alan: "Payment received, thank you", anna: "AMEX EPAYMENT" },
        accountId: { alan: "amex", anna: "ally" },
        confirmed: true,
      },
      {
        id: "s-venmo",
        date: "2026-10-21",
        from: "anna",
        to: "alan",
        amount: d(200),
        payee: { alan: "Venmo cashout, Anna Li", anna: "Venmo, Alan Wu" },
        accountId: { alan: "checking", anna: "ally" },
        confirmed: false,
      },
    ],
    reimbursements: [
      {
        id: "r-sam",
        owner: "alan",
        date: "2026-10-18",
        who: "Sam Ortiz",
        amount: d(60),
        payee: "Venmo cashout, Sam Ortiz",
        accountId: "checking",
        confirmed: true,
      },
    ],
    requests: [
      { id: "q-rent", askedBy: "alan", amount: d(1350), date: "2026-10-02" },
    ],
    scheduled: [
      {
        id: "sch-rent",
        owner: "alan",
        accountId: "checking",
        date: "2026-11-01",
        payee: "Greystar Rent",
        categoryId: "rent",
        amount: d(2700),
        share: partnerShare(d(1350)),
      },
      {
        id: "sch-comcast",
        owner: "anna",
        accountId: "ally",
        date: "2026-11-12",
        payee: "Comcast",
        categoryId: "a-utilities",
        amount: d(80),
        share: partnerShare(d(40)),
      },
    ],
    side: {
      "t-rent-sep": { categoryId: "a-rent", reviewed: true },
      "t-target-sep": { categoryId: "a-home", reviewed: true },
      "t-wholefoods-sep": { categoryId: "groceries", reviewed: true },
      "t-rent-oct": { categoryId: "a-rent", reviewed: true },
      "t-tj": { categoryId: "a-groceries", reviewed: true },
      // Anna has never categorized a Costco run: it waits on her side.
      "t-costco": { categoryId: null, reviewed: false },
      "t-target-refund": {
        categoryId: "a-home",
        reviewed: false,
        prefill: true,
      },
      "t-tj2": { categoryId: "a-groceries", reviewed: false, prefill: true },
      "t-nopa": { categoryId: "dining", reviewed: false, prefill: true },
      "t-pge": { categoryId: "electric", reviewed: true },
    },
    assigned: {
      alan: { ...SEED_ASSIGNED.alan },
      anna: { ...SEED_ASSIGNED.anna },
    },
    floatBefore: {
      alan: { "env-partner": d(500), "env-reimb": d(300) },
      anna: { "env-partner": 0, "env-reimb": 0 },
    },
  };
}

// A budget before partnering: no partner, and nobody owes anything yet.
export function newWorld(): World {
  const seed = seedWorld();
  return {
    ...seed,
    partnered: false,
    opening: undefined,
    txns: seed.txns
      .filter((item) => item.owner === "alan" && item.imported)
      .map((item) => ({
        ...item,
        history: [],
        lines: item.lines.map(({ share: _share, ...line }) => line),
      })),
    transfers: [],
    reimbursements: [],
    requests: [],
    scheduled: seed.scheduled
      .filter((item) => item.owner === "alan")
      .map(({ share: _share, ...item }) => item),
    side: {},
    floatBefore: {
      alan: { "env-partner": 0, "env-reimb": 0 },
      anna: { "env-partner": 0, "env-reimb": 0 },
    },
  };
}

// ---------- Derived ----------

export const isPartner = (share?: Share) => share?.who === PARTNER;

export const sharedLines = (item: Txn) =>
  item.lines.filter((line) => isPartner(line.share));

export const partnerShareOf = (item: Txn) =>
  sharedLines(item).reduce((sum, line) => sum + line.share!.amount, 0);

const accountKind = (person: Person, accountId: string | null) =>
  ACCOUNTS[person].find((item) => item.id === accountId)?.kind;

export type LedgerEntry = {
  id: string;
  kind: "purchase" | "refund" | "settlement" | "opening" | "expected";
  date: string;
  payee: string;
  // The sum of lines that carry a share, never the whole receipt.
  shared: number;
  shares: Record<Person, number>;
  paidBy: Person;
  recordedBy: Person;
  matched: boolean;
  // Signed for the viewer: what the partner owes them grows when positive.
  effect: number;
  // How the viewer's cash moved, when they paid: decides red or amber.
  via?: "cash" | "credit";
  txn?: Txn;
  transfer?: PartnerTransfer;
  history: Edit[];
};

export function ledger(world: World, viewer: Person): LedgerEntry[] {
  if (!world.partnered) return [];
  const entries: LedgerEntry[] = [];
  if (world.opening) {
    const { owedTo, amount, date, by } = world.opening;
    entries.push({
      id: "opening",
      kind: "opening",
      date,
      payee: "Opening balance",
      shared: amount,
      shares: { alan: 0, anna: 0, [other(owedTo)]: amount },
      paidBy: owedTo,
      recordedBy: by,
      matched: true,
      effect: owedTo === viewer ? amount : -amount,
      history: [],
    });
  }
  for (const item of world.txns) {
    const lines = sharedLines(item);
    if (!lines.length) continue;
    const shared = lines.reduce((sum, line) => sum + line.amount, 0);
    const theirs = partnerShareOf(item);
    const payer = item.owner;
    entries.push({
      id: item.id,
      kind: shared < 0 ? "refund" : "purchase",
      date: item.date,
      payee: item.payee,
      shared,
      shares: { [payer]: shared - theirs, [other(payer)]: theirs } as Record<
        Person,
        number
      >,
      paidBy: payer,
      recordedBy: item.recordedBy,
      matched: item.imported,
      effect: payer === viewer ? theirs : -theirs,
      via:
        payer === viewer
          ? accountKind(payer, item.accountId) === "credit"
            ? "credit"
            : "cash"
          : undefined,
      txn: item,
      history: item.history,
    });
  }
  for (const transfer of world.transfers) {
    entries.push({
      id: transfer.id,
      kind: "settlement",
      date: transfer.date,
      payee:
        accountKind(transfer.to, transfer.accountId[transfer.to]) === "credit"
          ? `${PEOPLE[transfer.from].name} paid ${PEOPLE[transfer.to].name}'s card`
          : `${PEOPLE[transfer.from].name} paid ${PEOPLE[transfer.to].name}`,
      shared: transfer.amount,
      shares: { alan: 0, anna: 0 },
      paidBy: transfer.from,
      recordedBy: transfer.from,
      matched: transfer.confirmed,
      effect: transfer.from === viewer ? transfer.amount : -transfer.amount,
      via: transfer.from === viewer ? "cash" : undefined,
      transfer,
      history: [],
    });
  }
  return entries.sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
}

// Scheduled shared transactions, as the entries they'll make.
export function expected(world: World, viewer: Person): LedgerEntry[] {
  if (!world.partnered) return [];
  return world.scheduled
    .filter((item) => isPartner(item.share))
    .map((item) => {
      const theirs = item.share!.amount;
      return {
        id: item.id,
        kind: "expected" as const,
        date: item.date,
        payee: item.payee,
        shared: item.amount,
        shares: {
          [item.owner]: item.amount - theirs,
          [other(item.owner)]: theirs,
        } as Record<Person, number>,
        paidBy: item.owner,
        recordedBy: item.owner,
        matched: false,
        effect: item.owner === viewer ? theirs : -theirs,
        history: [],
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);

export const partnerBalance = (world: World, viewer: Person) =>
  sum(ledger(world, viewer).map((entry) => entry.effect));

export type ReimbursementEntry = {
  id: string;
  kind: "purchase" | "refund" | "received";
  date: string;
  payee: string;
  who: string;
  lineAmount: number;
  effect: number;
  via?: "cash" | "credit";
  confirmed: boolean;
  txn?: Txn;
  transfer?: ReimbursementTransfer;
};

export function reimbursementLedger(
  world: World,
  viewer: Person,
): ReimbursementEntry[] {
  const entries: ReimbursementEntry[] = [];
  for (const item of world.txns) {
    if (item.owner !== viewer) continue;
    for (const line of item.lines) {
      if (!line.share || isPartner(line.share)) continue;
      entries.push({
        id: `${item.id}:${line.id}`,
        kind: line.amount < 0 ? "refund" : "purchase",
        date: item.date,
        payee: item.payee,
        who: line.share.who,
        lineAmount: line.amount,
        effect: line.share.amount,
        via:
          accountKind(viewer, item.accountId) === "credit" ? "credit" : "cash",
        confirmed: true,
        txn: item,
      });
    }
  }
  for (const transfer of world.reimbursements) {
    if (transfer.owner !== viewer) continue;
    entries.push({
      id: transfer.id,
      kind: "received",
      date: transfer.date,
      payee: transfer.payee,
      who: transfer.who,
      lineAmount: transfer.amount,
      effect: -transfer.amount,
      confirmed: transfer.confirmed,
      transfer,
    });
  }
  return entries.sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
}

// Everyone the viewer has named on a share, with what each owes.
export function reimbursementPeople(world: World, viewer: Person) {
  const totals = new Map<string, number>();
  for (const entry of reimbursementLedger(world, viewer))
    totals.set(entry.who, (totals.get(entry.who) ?? 0) + entry.effect);
  return [...totals.entries()].map(([name, balance]) => ({ name, balance }));
}

export function knownNames(world: World, viewer: Person) {
  const names = new Set(["Sam Ortiz", "Acme Corp"]);
  for (const person of reimbursementPeople(world, viewer))
    names.add(person.name);
  return [...names];
}

// A request is paid by the settlements toward the asker since it was made.
export function requestProgress(world: World, request: Request) {
  const paid = sum(
    world.transfers
      .filter(
        (item) => item.to === request.askedBy && item.date >= request.date,
      )
      .map((item) => item.amount),
  );
  return { paid, open: paid < request.amount };
}

export type PayeeMemory = {
  categoryId: string | null;
  share?: Share;
  source: "memory" | "none";
};

// The payee's last categorization in this budget, share included. The share
// carries over as a proportion of the new amount, so a $52 Trader Joe's
// proposes $26.05, not last week's $43.20.
export function payeeMemory(
  world: World,
  viewer: Person,
  payee: string,
  amount: number,
  excludeId?: string,
): PayeeMemory {
  const key = payee.trim().toLowerCase();
  if (!key) return { categoryId: null, source: "none" };
  const last = world.txns
    .filter(
      (item) =>
        item.owner === viewer &&
        item.id !== excludeId &&
        item.payee.toLowerCase() === key &&
        item.lines.length === 1 &&
        item.lines[0]!.categoryId,
    )
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (last) {
    const line = last.lines[0]!;
    return {
      categoryId: line.categoryId,
      share: line.share && {
        who: line.share.who,
        amount: Math.round((amount * line.share.amount) / line.amount),
      },
      source: "memory",
    };
  }
  const seeded = Object.entries(MEMORY[viewer]).find(
    ([name]) => name.toLowerCase() === key,
  )?.[1];
  if (!seeded) return { categoryId: null, source: "none" };
  return {
    categoryId: seeded.categoryId,
    share: seeded.share && {
      who: seeded.share.who,
      amount: Math.round(amount * seeded.share.ratio),
    },
    source: "memory",
  };
}

// The non-payer's own memory for the category of their share.
export function sideMemory(world: World, viewer: Person, payee: string) {
  const fromSide = world.txns
    .filter(
      (item) =>
        item.owner !== viewer &&
        item.payee === payee &&
        world.side[item.id]?.categoryId &&
        world.side[item.id]?.reviewed,
    )
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (fromSide) return world.side[fromSide.id]!.categoryId;
  return MEMORY[viewer][payee]?.categoryId ?? null;
}

export const payees = (viewer: Person) => Object.keys(MEMORY[viewer]);

export const categoryName = (viewer: Person, id: string | null) =>
  id === RTA
    ? "Ready to Assign"
    : (CATEGORIES[viewer].find((item) => item.id === id)?.name ?? null);

export const spendingCategories = (viewer: Person) =>
  CATEGORIES[viewer].filter((item) => !item.paired && !item.pays);

export const accountName = (viewer: Person, id: string | null) =>
  ACCOUNTS[viewer].find((item) => item.id === id)?.name ?? null;

export const isInOctober = (date: string) => date.startsWith(MONTH);

// ---------- One budget, as its owner sees it ----------

export type Budget = {
  viewer: Person;
  partner: Person;
  shell: ShellData;
  balances: Record<string, number>;
  partnerBalance: number;
  reimbursementBalance: number;
  uncategorized: number;
  envelope: Record<
    "partner" | "reimbursements",
    {
      category: Category;
      float: number;
      balance: number;
      cashOver: number;
      creditOver: number;
    }
  >;
};

export const money = (cents: number, signed = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(cents / 100);

export function buildBudget(world: World, viewer: Person): Budget {
  const partner = other(viewer);
  const accounts = ACCOUNTS[viewer];
  const defs = CATEGORIES[viewer].filter(
    (item) => world.partnered || item.paired !== "partner",
  );
  const balances: Record<string, number> = {};
  const pending: Record<string, number> = {};
  for (const account of accounts) {
    balances[account.id] = account.start;
    pending[account.id] = 0;
  }
  const activity: Record<string, number> = {};
  // Outflows by how they were paid, so overspending shows red or amber.
  const cardOut: Record<string, number> = {};
  const add = (record: Record<string, number>, key: string, value: number) => {
    record[key] = (record[key] ?? 0) + value;
  };
  let uncategorized = 0;
  let cardMovement = 0;

  for (const item of world.txns) {
    if (item.owner !== viewer || !item.accountId) continue;
    const total = sum(item.lines.map((line) => line.amount));
    balances[item.accountId] = (balances[item.accountId] ?? 0) - total;
    if (item.pending) add(pending, item.accountId, -total);
    if (!isInOctober(item.date)) continue;
    const credit = accountKind(viewer, item.accountId) === "credit";
    for (const line of item.lines) {
      if (line.categoryId === RTA) continue;
      const personal = line.amount - (line.share?.amount ?? 0);
      if (line.categoryId) {
        add(activity, line.categoryId, -personal);
        if (credit) {
          add(cardOut, line.categoryId, personal);
          cardMovement += personal;
        }
      } else uncategorized += personal;
      if (line.share && credit) {
        const envelope = isPartner(line.share) ? "env-partner" : "env-reimb";
        add(cardOut, envelope, line.share.amount);
        cardMovement += line.share.amount;
      }
    }
  }
  // The non-payer's side: their share, in their own category.
  for (const item of world.txns) {
    if (item.owner === viewer || !isInOctober(item.date)) continue;
    const mine = partnerShareOf(item);
    if (!mine) continue;
    const side = world.side[item.id];
    if (side?.categoryId) add(activity, side.categoryId, -mine);
    else uncategorized += mine;
  }
  for (const transfer of world.transfers) {
    const account = transfer.accountId[viewer];
    const signed = transfer.to === viewer ? transfer.amount : -transfer.amount;
    balances[account] = (balances[account] ?? 0) + signed;
    // Paid onto the viewer's card: the card's reserve drops by as much.
    if (
      isInOctober(transfer.date) &&
      transfer.to === viewer &&
      accountKind(viewer, account) === "credit"
    )
      cardMovement -= transfer.amount;
  }
  for (const transfer of world.reimbursements) {
    if (transfer.owner !== viewer) continue;
    balances[transfer.accountId] =
      (balances[transfer.accountId] ?? 0) + transfer.amount;
  }

  const entries = ledger(world, viewer);
  const owed = sum(entries.map((entry) => entry.effect));
  const owedBefore = sum(
    entries.filter((entry) => entry.date < `${MONTH}-01`).map((e) => e.effect),
  );
  const reimbursements = reimbursementLedger(world, viewer);
  const reimbursed = sum(reimbursements.map((entry) => entry.effect));
  const reimbursedBefore = sum(
    reimbursements
      .filter((entry) => entry.date < `${MONTH}-01`)
      .map((entry) => entry.effect),
  );
  // Paired envelope activity is the account's movement, reversed.
  activity["env-partner"] = -(owed - owedBefore);
  activity["env-reimb"] = -(reimbursed - reimbursedBefore);

  const assigned = world.assigned[viewer];
  const envelopes = {} as Budget["envelope"];
  const built = defs
    .filter((def) => !def.pays)
    .map((def): Category => {
      const own = assigned[def.id] ?? 0;
      const before = def.paired
        ? world.floatBefore[viewer][def.id as "env-partner" | "env-reimb"]
        : 0;
      const carry = def.paired
        ? before - (def.paired === "partner" ? owedBefore : reimbursedBefore)
        : def.carry;
      const act = activity[def.id] ?? 0;
      const available = carry + own + act;
      const over = Math.max(0, -available);
      const creditOver = Math.min(over, cardOut[def.id] ?? 0);
      const cashOver = over - creditOver;
      const funding: Funding =
        available < 0
          ? cashOver > 0
            ? "overspent"
            : "credit"
          : available > 0 || own > 0
            ? "funded"
            : "empty";
      const category: Category = {
        id: def.id,
        name: def.name,
        group: def.group,
        assigned: own,
        activity: act,
        available,
        carryover: carry,
        funding,
        fundedRatio: available > 0 ? 1 : 0,
        status:
          available < 0
            ? cashOver > 0 && creditOver > 0
              ? `${money(cashOver)} overspent in cash, ${money(creditOver)} on credit`
              : cashOver > 0
                ? `${money(cashOver)} overspent in cash`
                : `${money(creditOver)} overspent on credit`
            : "",
        reserved: 0,
        spendable: available,
        sharePercents: [],
        autoAssign: {
          id: def.id,
          assigned: own,
          available,
          history: { assigned: [], spent: [] },
        },
      };
      if (def.paired) {
        const balance = def.paired === "partner" ? owed : reimbursed;
        envelopes[def.paired] = {
          category,
          float: before + own,
          balance,
          cashOver,
          creditOver,
        };
      }
      return category;
    });

  // A card's payment category gets what was spent on it, less what the
  // categories couldn't cover (credit overspending), less what someone else
  // paid onto the card.
  const creditOverspent = sum(
    built.map((category) =>
      category.funding === "credit" ? -category.available : 0,
    ),
  );
  const payments = defs
    .filter((def) => def.pays)
    .map((def): Category => {
      const own = assigned[def.id] ?? 0;
      const act = cardMovement - creditOverspent;
      const available = def.carry + own + act;
      return {
        id: def.id,
        name: def.name,
        group: def.group,
        assigned: own,
        activity: act,
        available,
        carryover: def.carry,
        funding: available > 0 ? "funded" : "empty",
        fundedRatio: 1,
        status: "",
        pays: {
          type: "card",
          id: def.pays!,
          name: accountName(viewer, def.pays!) ?? "Card",
        },
        reserved: 0,
        spendable: available,
        sharePercents: [],
        autoAssign: {
          id: def.id,
          assigned: own,
          available,
          pairedAccountId: def.pays,
          history: { assigned: [], spent: [] },
        },
      };
    });

  const categories = [...payments, ...built];
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
  const seeded = sum(Object.values(SEED_ASSIGNED[viewer]));
  const readyToAssign =
    RTA_BASE[viewer] - (sum(Object.values(assigned)) - seeded);

  const shell: ShellData = {
    budgetName: `${PEOPLE[viewer].name}'s budget`,
    month: {
      key: MONTH,
      current: MONTH,
      start: "2026-09",
      label: "October 2026",
      short: "October",
      canGoBack: true,
    },
    today: TODAY,
    readyToAssign,
    groups,
    categories,
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      kind: account.kind,
      balance: balances[account.id]!,
      pending: pending[account.id]!,
      cleared: balances[account.id]! - pending[account.id]!,
    })),
    loans: [],
    transactions: [],
    costToBeMe: 0,
    expectedIncome: null,
    reimbursements: [],
  };
  return {
    viewer,
    partner,
    shell,
    balances,
    partnerBalance: owed,
    reimbursementBalance: reimbursed,
    uncategorized,
    envelope: envelopes,
  };
}
