// What each loan editor holds while it's open, and why it can't save yet.
// The rules follow the engine's loan.add and loan.rate checks,
// with the words a person would want next to the field.

import {
  dayLabel,
  isDay,
  parseAmount,
  parseRate,
  percent,
  TODAY,
  type Category,
  type Loan,
} from "./data";

export type LoanDraft = {
  name: string;
  variable: boolean;
  balance: string;
  rate: string;
  payment: string;
  asOf: string;
  // "new" pairs a new category named after the loan.
  categoryId: string;
};

export type LoanField = "name" | "balance" | "rate" | "payment" | "asOf";

export const emptyLoan = (): LoanDraft => ({
  name: "",
  variable: false,
  balance: "",
  rate: "",
  payment: "",
  asOf: TODAY,
  categoryId: "new",
});

export function checkLoan(
  draft: LoanDraft,
  loans: Loan[],
): Partial<Record<LoanField, string>> {
  const errors: Partial<Record<LoanField, string>> = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Name the loan, like “Chase mortgage”.";
  else if (loans.some((loan) => loan.name.toLowerCase() === name.toLowerCase()))
    errors.name = `You already have a loan called ${name}.`;
  const balance = parseAmount(draft.balance);
  if (balance === null || balance === 0)
    errors.balance = "Enter what you still owe, from your latest statement.";
  else if (Number.isNaN(balance))
    errors.balance = "Enter an amount like 18,500.00.";
  const rate = parseRate(draft.rate);
  if (rate === null) errors.rate = "Enter the annual rate, like 6.5.";
  else if (Number.isNaN(rate) || rate >= 100000)
    errors.rate = "Enter a rate like 6.5, under 1,000%.";
  const payment = parseAmount(draft.payment);
  if (payment === null || payment === 0)
    errors.payment = "Enter the monthly payment your lender asks for.";
  else if (Number.isNaN(payment))
    errors.payment = "Enter an amount like 340.00.";
  if (!isDay(draft.asOf)) errors.asOf = "Enter a date like 10/21/2026.";
  else if (draft.asOf > TODAY)
    errors.asOf = "Use the date of a statement you already have.";
  return errors;
}

export function categoryLabel(draft: LoanDraft, categories: Category[]) {
  if (draft.categoryId !== "new")
    return categories.find((item) => item.id === draft.categoryId)?.name ?? "";
  return `${draft.name.trim() || "Loan"} payment`;
}

export type RateDraft = { rate: string; date: string };
export type RateField = "rate" | "date";

export function checkRate(
  draft: RateDraft,
  loan: Loan,
): Partial<Record<RateField, string>> {
  const errors: Partial<Record<RateField, string>> = {};
  const rate = parseRate(draft.rate);
  if (rate === null) errors.rate = "Enter the rate your lender confirmed.";
  else if (Number.isNaN(rate) || rate >= 100000)
    errors.rate = "Enter a rate like 7.25, under 1,000%.";
  const start = loan.rates[0]!.effectiveDate;
  const same = loan.rates.find((item) => item.effectiveDate === draft.date);
  if (!isDay(draft.date)) errors.date = "Enter a date like 10/21/2026.";
  else if (draft.date < start)
    errors.date = `This loan starts ${dayLabel(start)}. Pick that day or later.`;
  else if (same)
    errors.date = `${percent(same.annualRateBps)} is already confirmed from ${dayLabel(same.effectiveDate)}. Pick another day.`;
  return errors;
}
