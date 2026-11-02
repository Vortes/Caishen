import type { Account } from "~/components/app-shell/model";
import type { ShareBasis } from "~/components/transactions/transaction-share";
import type { CounterpartyShare } from "~/domain/engine";

// The people and lines each data set puts in front of the share picker.

export type Line = {
  id: string;
  date: string;
  payee: string;
  category: string;
  // Each line's amount, unsigned, in cents; more than one is a split.
  amounts: number[];
  share: CounterpartyShare | null;
  basis: ShareBasis;
};

export type DataSet = "demo" | "worst" | "partner" | "empty";

export const dataSets: { value: DataSet; label: string }[] = [
  { value: "demo", label: "Demo" },
  { value: "worst", label: "Worst case" },
  { value: "partner", label: "Partner only" },
  { value: "empty", label: "Empty" },
];

const person = (
  id: string,
  name: string,
  balance: number,
  linked = false,
): Account => ({
  id: `person:${id}`,
  name,
  kind: "person",
  linkedUserId: linked ? "user:partner" : undefined,
  balance,
  uncleared: 0,
  cleared: 0,
});

const mei = person("mei", "Mei Chen", 12_050, true);
const aleksandra = person(
  "aleksandra",
  "Aleksandra Wiśniewska-Kowalczyk",
  1_234_567_890,
  true,
);
const northwind = person(
  "northwind",
  "Northwind Industries Holdings LLC",
  -120_000_000,
);

// Forty more, so the list scrolls and the filter earns its place.
const crowd = [
  "Abebe Bikila",
  "Ada Lovelace",
  "Amara Okafor",
  "Ana Lucía Fernández de Córdoba",
  "Ari",
  "Bao Nguyen",
  "Beatriz Souza",
  "Book club",
  "Chidi Anagonye",
  "Dad",
  "Dmitri Ivanovich Sokolov-Petrenko",
  "Elif Şahin",
  "Farah Haddad",
  "Grandma Rose",
  "Hiroshi Tanaka",
  "Ingrid Johansson",
  "Jamal Wright",
  "Karin",
  "Landlord (Unit 4B)",
  "Liam O’Connor",
  "Lukas Müller",
  "Maya Patel",
  "Mom",
  "Nadia Benali",
  "Noah",
  "Olusegun Adeyemi",
  "Pita & Co. Catering",
  "Priya Raghunathan",
  "Quinn",
  "Rafael Gómez",
  "Saoirse Ní Bhriain",
  "Sven",
  "Tomás",
  "Uncle Ken",
  "Valentina Rossi",
  "Wen Li",
  "Xochitl",
  "Yusuf",
  "Zainab",
  "Ziggy’s Soccer Team Carpool Fund",
].map((name, index) =>
  person(
    `crowd-${index}`,
    name,
    // A spread of owed, owing and even.
    index % 5 === 0 ? 0 : (index % 2 ? 1 : -1) * (index * 1_337 + 99),
  ),
);

export const peopleIn: Record<DataSet, Account[]> = {
  demo: [
    mei,
    person("mom", "Mom", -4_000),
    person("jordan", "Jordan", 2_350),
    person("sam", "Sam", 0),
  ],
  worst: [
    aleksandra,
    person("jo", "Jo", 400),
    northwind,
    person("wang", "王小明", 2_500),
    person("mohammed", "محمد عبد الله", -1_999),
    person("panda", "🐼 Panda Kitchen 🍜", 0),
    ...crowd,
  ],
  partner: [mei],
  empty: [],
};

const demoLines = (partnerId?: string): Line[] => [
  {
    id: "tj",
    date: "Oct 30",
    payee: "Trader Joe’s",
    category: "Groceries",
    amounts: [3_742],
    share: partnerId ? { accountId: partnerId, amount: 1_871 } : null,
    basis: "half",
  },
  {
    id: "coffee",
    date: "Oct 29",
    payee: "Blue Bottle Coffee",
    category: "Dining out",
    amounts: [1_250],
    share: null,
    basis: "fixed",
  },
  {
    id: "rent",
    date: "Oct 28",
    payee: "Greystar Properties",
    category: "Rent",
    amounts: [185_000],
    share: null,
    basis: "fixed",
  },
  {
    id: "costco",
    date: "Oct 27",
    payee: "Costco Wholesale",
    category: "Split (4 lines)",
    amounts: [8_400, 2_350, 1_999, 4_500],
    share: null,
    basis: "fixed",
  },
];

export const linesIn: Record<DataSet, Line[]> = {
  demo: demoLines(mei.id),
  worst: [
    {
      id: "coop",
      date: "Oct 30",
      payee:
        "The Very Long Organic Neighborhood Grocery Cooperative of Greater Portland",
      category: "Groceries",
      amounts: [3_742],
      share: { accountId: aleksandra.id, amount: 1_000 },
      basis: "fixed",
    },
    {
      id: "zero",
      date: "Oct 29",
      payee: "Shell",
      category: "Gas",
      amounts: [0],
      share: null,
      basis: "fixed",
    },
    {
      id: "huge",
      date: "Oct 28",
      payee: "Northwind Industries Holdings LLC",
      category: "Business",
      amounts: [1_234_567_890],
      share: { accountId: northwind.id, amount: 1_234_567_890 },
      basis: "full",
    },
    {
      id: "split",
      date: "Oct 27",
      payee: "Costco Wholesale",
      category: "Split (4 lines)",
      amounts: [1, 1_234_567_890, 3_742, 0],
      share: null,
      basis: "fixed",
    },
  ],
  partner: demoLines(mei.id),
  empty: demoLines(),
};
