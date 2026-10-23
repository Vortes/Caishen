// Batch 3 prototype: hardcoded loans, accounts, and register rows. Forecasts
// come from the engine's own forecastLoan, so payoff dates and interest match
// what the shell would show; nothing here reaches a budget.

import { forecastLoan, type Loan as EngineLoan } from "~/domain/engine";

export const TODAY = "2026-10-21";
export const THIS_MONTH = "2026-10";

export type AccountKind = "cash" | "credit";
export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  // The working balance before any change made in the prototype.
  opening: number;
};

export type Loan = EngineLoan & {
  // Cash already set aside in the payment category this month.
  funded: number;
  // The account its payments usually come from.
  payFrom: string;
};

export type Row = {
  id: string;
  accountId: string;
  date: string;
  payee: string;
  category: string;
  amount: number;
  loanId?: string;
};

export type Category = { id: string; name: string; group: string };

export type State = {
  loans: Loan[];
  accounts: Account[];
  rows: Row[];
  // Unpaired categories a new loan can take as its payment category.
  categories: Category[];
};

// The engine's monthly interest: principal × annual rate ÷ 12, rounded to
// the cent.
export function monthlyInterest(principal: number, rateBps: number) {
  return Math.round((principal * rateBps) / 120000);
}

export function rateOn(loan: EngineLoan, date: string) {
  return (
    [...loan.rates]
      .filter((rate) => rate.effectiveDate <= date)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] ??
    loan.rates[0]!
  );
}

export function balanceOn(loan: EngineLoan, date: string) {
  return Math.max(
    0,
    loan.principal -
      loan.payments
        .filter((payment) => payment.date <= date)
        .reduce((sum, payment) => sum + payment.principal, 0),
  );
}

export const endOf = (month: string) => `${month}-31`;

export function addMonths(month: string, count: number) {
  const [year, index] = month.split("-").map(Number) as [number, number];
  const total = year * 12 + (index - 1) + count;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function monthsBetween(from: string, to: string) {
  const [a, b] = [from, to].map((value) => {
    const [year, month] = value.split("-").map(Number) as [number, number];
    return year * 12 + month;
  }) as [number, number];
  return b - a;
}

const monthFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const longMonthFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const dayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const shortDayFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export const monthLabel = (month: string) =>
  monthFormat.format(new Date(`${month}-15T12:00:00Z`));
export const longMonthLabel = (month: string) =>
  longMonthFormat.format(new Date(`${month}-15T12:00:00Z`));
export const dayLabel = (date: string) =>
  dayFormat.format(new Date(`${date}T12:00:00Z`));
export const shortDayLabel = (date: string) =>
  shortDayFormat.format(new Date(`${date}T12:00:00Z`));

export function durationLabel(months: number) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(`${years} yr`);
  if (rest || !years) parts.push(`${rest} mo`);
  return parts.join(" ");
}

export const percent = (bps: number) => `${(bps / 100).toFixed(2)}%`;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
// -0 reads as "-$0.00"; a cleared balance is plain zero.
export const money = (cents: number) => currency.format(cents / 100 || 0);

export function parseAmount(input: string): number | null {
  const value = input.replace(/[$,\s]/g, "");
  if (!value) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(value)) return Number.NaN;
  return Math.round(Number(value) * 100);
}

export function parseRate(input: string): number | null {
  const value = input.replace(/[%\s]/g, "");
  if (!value) return null;
  if (!/^\d+(\.\d{0,3})?$/.test(value)) return Number.NaN;
  return Math.round(Number(value) * 100);
}

export const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());

export type Forecast = ReturnType<typeof forecastLoan>;

// The loan's payoff as the shell forecasts it for a month, optionally with a
// one-time extra payment now and a larger payment every month.
export function forecast(
  loan: EngineLoan,
  month: string,
  extra: { once?: number; monthly?: number } = {},
): Forecast {
  return forecastLoan(
    { ...loan, minimumPayment: loan.minimumPayment + (extra.monthly ?? 0) },
    month,
    extra.once ?? 0,
  );
}

// The month-by-month balance behind a forecast, for the payoff chart. It
// walks the same amortization forecastLoan does.
export function schedule(
  loan: EngineLoan,
  month: string,
  extra: { once?: number; monthly?: number } = {},
): number[] {
  const rate = rateOn(loan, endOf(month)).annualRateBps;
  const payment = loan.minimumPayment + (extra.monthly ?? 0);
  let balance = Math.max(0, balanceOn(loan, endOf(month)) - (extra.once ?? 0));
  const points = [balance];
  while (balance > 0 && points.length < 1200) {
    const interest = monthlyInterest(balance, rate);
    if (payment <= interest) break;
    balance = Math.max(0, balance - (payment - interest));
    points.push(balance);
  }
  return points;
}

// A variable rate is due for confirming once the latest one is over six
// months old. Lenders reset most variable student loans monthly or
// quarterly; the threshold is a placeholder for the owner to decide.
export function rateDue(loan: EngineLoan, today = TODAY) {
  if (!loan.variable || balanceOn(loan, today) === 0) return false;
  const latest = rateOn(loan, today).effectiveDate;
  return monthsBetween(latest.slice(0, 7), today.slice(0, 7)) >= 6;
}

export function paidOffOn(loan: EngineLoan, date = TODAY) {
  if (balanceOn(loan, date) > 0) return null;
  return [...loan.payments].sort((a, b) => b.date.localeCompare(a.date))[0]
    ?.date;
}

// Monthly payments from the loan's start until `until`, with interest at the
// rate in effect each month: the lender's statements, as the prototype
// imagines them.
function history(
  loan: Omit<EngineLoan, "payments">,
  day: number,
  until: string,
): EngineLoan["payments"] {
  const payments: EngineLoan["payments"] = [];
  let balance = loan.principal;
  let month = addMonths(loan.rates[0]!.effectiveDate.slice(0, 7), 1);
  while (balance > 0) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (date > until) break;
    const interest = monthlyInterest(
      balance,
      rateOn({ ...loan, payments: [] }, date).annualRateBps,
    );
    const principal = Math.min(balance, loan.minimumPayment - interest);
    payments.push({ id: `${loan.id}-${date}`, date, principal, interest });
    balance -= principal;
    month = addMonths(month, 1);
  }
  return payments;
}

function loan(
  base: Omit<EngineLoan, "payments">,
  extra: { day: number; until: string; funded: number; payFrom: string },
): Loan {
  return {
    ...base,
    payments: history(base, extra.day, extra.until),
    funded: extra.funded,
    payFrom: extra.payFrom,
  };
}

const accounts: Account[] = [
  { id: "chase", name: "Chase Total Checking", kind: "cash", opening: 841255 },
  { id: "ally", name: "Ally savings", kind: "cash", opening: 1257461 },
  { id: "amex", name: "American Express", kind: "credit", opening: -169798 },
];

const nelnet = loan(
  {
    id: "nelnet",
    name: "Nelnet student loan",
    categoryId: "cat-nelnet",
    principal: 3140000,
    minimumPayment: 34000,
    variable: false,
    rates: [{ effectiveDate: "2024-07-01", annualRateBps: 550 }],
  },
  // October's payment isn't due until the 25th.
  { day: 25, until: "2026-09-30", funded: 34000, payFrom: "chase" },
);

const toyota = loan(
  {
    id: "toyota",
    name: "Toyota auto loan",
    categoryId: "cat-toyota",
    principal: 2860000,
    minimumPayment: 55800,
    variable: false,
    rates: [{ effectiveDate: "2025-03-10", annualRateBps: 629 }],
  },
  { day: 12, until: TODAY, funded: 0, payFrom: "chase" },
);

const sofiRates = [
  { effectiveDate: "2025-02-01", annualRateBps: 840 },
  { effectiveDate: "2025-08-01", annualRateBps: 805 },
  { effectiveDate: "2026-02-01", annualRateBps: 762 },
];

const sofi = loan(
  {
    id: "sofi",
    name: "SoFi private student loan",
    categoryId: "cat-sofi",
    principal: 1850000,
    minimumPayment: 22500,
    variable: true,
    rates: sofiRates,
  },
  { day: 18, until: TODAY, funded: 0, payFrom: "chase" },
);

const honda = loan(
  {
    id: "honda",
    name: "Honda auto loan",
    categoryId: "cat-honda",
    principal: 1200000,
    minimumPayment: 35500,
    variable: false,
    rates: [{ effectiveDate: "2022-06-01", annualRateBps: 390 }],
  },
  { day: 6, until: TODAY, funded: 0, payFrom: "chase" },
);

const rows: Row[] = [
  {
    id: "r1",
    accountId: "chase",
    date: "2026-10-20",
    payee: "Trader Joe's",
    category: "Groceries",
    amount: -8642,
  },
  {
    id: "r2",
    accountId: "chase",
    date: "2026-10-15",
    payee: "Cedar Labs · payroll",
    category: "Inflow: Ready to Assign",
    amount: 325000,
  },
  {
    id: "r3",
    accountId: "chase",
    date: "2026-10-09",
    payee: "PG&E",
    category: "Utilities",
    amount: -14218,
  },
  {
    id: "r4",
    accountId: "chase",
    date: "2026-10-03",
    payee: "Parkline Apartments",
    category: "Rent",
    amount: -215000,
  },
  {
    id: "r5",
    accountId: "chase",
    date: "2026-10-01",
    payee: "Cedar Labs · payroll",
    category: "Inflow: Ready to Assign",
    amount: 325000,
  },
  {
    id: "r6",
    accountId: "amex",
    date: "2026-10-19",
    payee: "Blue Bottle Coffee",
    category: "Dining & coffee",
    amount: -650,
  },
  {
    id: "r7",
    accountId: "amex",
    date: "2026-10-14",
    payee: "Costco",
    category: "Groceries",
    amount: -21233,
  },
  {
    id: "r8",
    accountId: "ally",
    date: "2026-10-01",
    payee: "Ally Bank · interest",
    category: "Inflow: Ready to Assign",
    amount: 1204,
  },
];

const categories: Category[] = [
  { id: "cat-car", name: "Car payment", group: "Bills" },
  { id: "cat-mortgage", name: "Mortgage", group: "Bills" },
];

export type ScenarioId = "household" | "empty" | "underwater";

export const scenarios: Record<
  ScenarioId,
  { label: string; detail: string; state: () => State }
> = {
  household: {
    label: "Four loans",
    detail:
      "Fixed student and auto loans, a variable SoFi loan due for a rate check, and a paid-off Honda.",
    state: () => ({
      loans: [nelnet, toyota, sofi, honda],
      accounts,
      rows,
      categories,
    }),
  },
  empty: {
    label: "No loans",
    detail: "A budget with accounts and no loans yet.",
    state: () => ({ loans: [], accounts, rows, categories }),
  },
  underwater: {
    label: "Payment below interest",
    detail:
      "SoFi's rate reset to 17.25% on Oct 19, so its $225 payment no longer covers the monthly interest.",
    state: () => ({
      loans: [
        nelnet,
        toyota,
        {
          ...sofi,
          rates: [
            ...sofiRates,
            { effectiveDate: "2026-10-19", annualRateBps: 1725 },
          ],
        },
        honda,
      ],
      accounts,
      rows,
      categories,
    }),
  },
};

// Register rows for the loan payments: one outflow per recorded payment,
// from the account that paid it.
export function paymentRows(state: State) {
  return state.loans.flatMap((item) =>
    item.payments.map<Row>((payment) => ({
      id: payment.id,
      accountId: item.payFrom,
      date: payment.date,
      payee: `Payment to ${item.name}`,
      category: `${item.name} payment`,
      amount: -(payment.principal + payment.interest),
      loanId: item.id,
    })),
  );
}
