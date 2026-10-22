// What each loan editor holds while it's open, and why it can't save yet.
// The rules follow the engine's loan.add, loan.rate, and loan payment checks,
// with the words a person would want next to the field.

import {
  balanceOn,
  dayLabel,
  isDay,
  money,
  parseAmount,
  parseRate,
  percent,
  rateOn,
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

export type PaymentDraft = {
  accountId: string;
  date: string;
  amount: string;
  interest: string;
};
export type PaymentField = "accountId" | "date" | "amount" | "interest";

export function paymentDraft(loan: Loan): PaymentDraft {
  return {
    accountId: loan.payFrom,
    date: TODAY,
    amount: (loan.minimumPayment / 100).toFixed(2),
    interest: "",
  };
}

// The payment's split once both amounts read: what reaches principal, and
// the balance after it.
export function split(draft: PaymentDraft, loan: Loan) {
  const amount = parseAmount(draft.amount);
  const interest = parseAmount(draft.interest);
  if (amount === null || Number.isNaN(amount)) return null;
  if (interest === null || Number.isNaN(interest)) return null;
  const principal = amount - interest;
  return {
    amount,
    interest,
    principal,
    after: balanceOn(loan, TODAY) - principal,
  };
}

// What the lender would likely charge on this date, from the rate in effect.
export function estimatedInterest(loan: Loan, date: string) {
  const balance = balanceOn(loan, isDay(date) ? date : TODAY);
  const rate = rateOn(loan, isDay(date) ? date : TODAY).annualRateBps;
  return Math.round((balance * rate) / 120000);
}

export function checkPayment(
  draft: PaymentDraft,
  loan: Loan,
): Partial<Record<PaymentField, string>> {
  const errors: Partial<Record<PaymentField, string>> = {};
  if (!draft.accountId) errors.accountId = "Pick the account that paid.";
  const start = loan.rates[0]!.effectiveDate;
  if (!isDay(draft.date)) errors.date = "Enter a date like 10/21/2026.";
  else if (draft.date < start)
    errors.date = `This loan starts ${dayLabel(start)}. Pick that day or later.`;
  else if (draft.date > TODAY)
    errors.date = "Record a payment once it has posted, today or earlier.";
  const amount = parseAmount(draft.amount);
  if (amount === null || amount === 0)
    errors.amount = "Enter the amount that left your account.";
  else if (Number.isNaN(amount)) errors.amount = "Enter an amount like 340.00.";
  const interest = parseAmount(draft.interest);
  if (interest === null)
    errors.interest =
      "Enter the interest from your lender, even if it’s $0.00.";
  else if (Number.isNaN(interest))
    errors.interest = "Enter an amount like 112.40.";
  else if (amount !== null && !Number.isNaN(amount) && interest > amount)
    errors.interest = `Interest can’t be more than the ${money(amount)} payment.`;
  const parts = split(draft, loan);
  const left = balanceOn(loan, TODAY);
  if (!errors.interest && !errors.amount && parts && parts.principal > left)
    errors.amount = `That puts ${money(parts.principal)} toward principal, more than the ${money(left)} left.`;
  return errors;
}
