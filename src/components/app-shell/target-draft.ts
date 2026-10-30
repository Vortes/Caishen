import { readAmount } from "~/components/budget/amount";
import { moveMonth } from "~/components/budget/format";
import type { Target } from "~/domain/engine";

// The target editor's form state, and how it becomes the engine's Target.
// YNAB's target editor (support.ynab.com, "Targets"): weekly, monthly,
// yearly, and custom schedules for spending categories; monthly or pay off by
// a date for a credit card or a loan's payment category.

export type TargetKind = "spending" | "card" | "loan";
export type Behavior = Target["behavior"];

// A loan's payoff date is its own choice in the editor, though the engine
// stores it as a loan target with a due date.
export type Schedule =
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom"
  | "card-monthly"
  | "card-payoff"
  | "loan-monthly"
  | "loan-payoff";

export const schedules: Record<
  TargetKind,
  { value: Schedule; label: string }[]
> = {
  spending: [
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "yearly", label: "Yearly" },
    { value: "custom", label: "Custom" },
  ],
  card: [
    { value: "card-monthly", label: "Monthly" },
    { value: "card-payoff", label: "Pay off by date" },
  ],
  loan: [
    { value: "loan-monthly", label: "Monthly" },
    { value: "loan-payoff", label: "Pay off by date" },
  ],
};

export type TargetDraft = {
  schedule: Schedule;
  behavior: Behavior;
  // As typed, in dollars.
  amount: string;
  weekday: number;
  monthDay: number | "last";
  // YYYY-MM-DD, or whatever has been typed so far.
  dueDate: string;
  repeat: boolean;
  repeatEvery: string;
  repeatUnit: "months" | "years";
  // A balance goal's due date is a month, and it may have none.
  balanceDue: boolean;
  dueMonth: string;
};

export type TargetField = "amount" | "dueDate" | "repeatEvery" | "dueMonth";

export type TargetResult =
  | { ok: true; target: Target }
  | { ok: false; field: TargetField; message: string };

export const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function ordinal(day: number) {
  const tens = day % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? "th"
      : day % 10 === 1
        ? "st"
        : day % 10 === 2
          ? "nd"
          : day % 10 === 3
            ? "rd"
            : "th";
  return `${day}${suffix}`;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const dollars = (cents: number) => currency.format(cents / 100);

function scheduleOf(target: Target): Schedule {
  if (target.cadence === "loan")
    return target.dueDate ? "loan-payoff" : "loan-monthly";
  return target.cadence;
}

// A new target starts where YNAB's does: monthly, setting aside another
// amount by the last day of the month. Dates default to the start of the
// next month, the soonest a new yearly or custom target is usually due. A
// saved target opens with the choices it was saved with.
export function createTargetDraft(
  kind: TargetKind,
  month: string,
  existing?: Target,
): TargetDraft {
  const next = moveMonth(month, 1);
  const draft: TargetDraft = {
    schedule:
      kind === "card"
        ? "card-monthly"
        : kind === "loan"
          ? "loan-monthly"
          : "monthly",
    behavior: "contribution",
    amount: "",
    weekday: 6,
    monthDay: "last",
    dueDate: `${next}-01`,
    repeat: false,
    repeatEvery: "1",
    repeatUnit: "months",
    balanceDue: false,
    dueMonth: next,
  };
  if (!existing) return draft;
  const balance = existing.behavior === "balance";
  return {
    ...draft,
    schedule: scheduleOf(existing),
    behavior: existing.behavior,
    amount:
      existing.amount > 0 ? (existing.amount / 100).toFixed(2) : draft.amount,
    weekday: existing.weekday ?? draft.weekday,
    monthDay: existing.monthDay ?? "last",
    dueDate: (balance ? undefined : existing.dueDate) ?? draft.dueDate,
    repeat: Boolean(existing.repeatEvery),
    repeatEvery: String(existing.repeatEvery ?? 1),
    repeatUnit: existing.repeatUnit ?? "months",
    balanceDue: balance && Boolean(existing.dueDate),
    dueMonth:
      (balance ? existing.dueDate?.slice(0, 7) : undefined) ?? draft.dueMonth,
  };
}

// Which behaviors a schedule offers. Paired card and loan targets only ever
// set money aside for the payment.
export function behaviorsFor(schedule: Schedule): Behavior[] {
  if (schedule === "custom") return ["contribution", "refill", "balance"];
  if (["weekly", "monthly", "yearly"].includes(schedule))
    return ["contribution", "refill"];
  return [];
}

// The behavior the draft will save: what was picked, if its schedule offers
// it, or else setting money aside.
export function activeBehavior(draft: TargetDraft): Behavior {
  return behaviorsFor(draft.schedule).includes(draft.behavior)
    ? draft.behavior
    : "contribution";
}

export function amountLabel(schedule: Schedule) {
  if (schedule === "custom") return "Amount";
  if (schedule === "card-monthly" || schedule === "loan-monthly")
    return "Pay each month";
  return "I need";
}

export function behaviorLabel(schedule: Schedule) {
  if (schedule === "weekly" || schedule === "monthly")
    return "Next month I want to";
  if (schedule === "yearly") return "Next year I want to";
  return "I want to";
}

// Each behavior as YNAB words it, for an amount: custom targets fill up to
// an amount where the others refill, and set aside without "another".
export function behaviorCopy(
  behavior: Behavior,
  schedule: Schedule,
  amount: number,
) {
  const money = dollars(amount);
  const custom = schedule === "custom";
  const weekly = schedule === "weekly";
  const per = weekly ? "/week" : "";
  // A weekly target is settled by month: its amount for each of that
  // weekday in the month. Leftovers carry to the next month or year.
  const period = schedule === "yearly" ? "year" : "month";
  const each = weekly ? "a week" : `every ${period}`;
  if (behavior === "contribution")
    return {
      title: custom ? `Set aside ${money}` : `Set aside another ${money}${per}`,
      use: "Bills, subscriptions, saving over time",
      detail: custom
        ? `Adds ${money} to this category, whatever it already holds.`
        : `Adds ${money} ${each}, on top of whatever is left from last ${period}.`,
      common: true,
    };
  if (behavior === "refill")
    return {
      title: custom ? `Fill up to ${money}` : `Refill up to ${money}${per}`,
      use: "Gas, fun money, dining out",
      detail: custom
        ? `Counts what is already in this category and fills it up to ${money}.`
        : `Keeps ${money} ${weekly ? "a week" : `each ${period}`} on hand. Whatever you don’t spend counts toward next ${period}.`,
      common: false,
    };
  return {
    title: `Have a balance of ${money}`,
    use: "Long-term savings",
    detail: `Builds up to ${money}, by a date or whenever you get there. Spending from it sets you back.`,
    common: false,
  };
}

// "$1,234.50", "1234.5", "12" and "600+150" all read as dollars; empty
// reads as zero. Returns cents, or null for text that isn't an amount.
export function draftAmount(text: string) {
  const reading = readAmount(text.trim() || "0");
  return reading.ok ? reading.cents : null;
}

// What a target asks for and when, as the inspector's summary shows it.
export function describeTarget(target: Target) {
  const money = dollars(target.amount);
  const verb =
    target.behavior === "refill" ? "Refill up to" : "Set aside another";
  const period =
    target.cadence === "weekly"
      ? "week"
      : target.cadence === "yearly"
        ? "year"
        : "month";
  const repeat = target.repeatEvery
    ? ` every ${target.repeatEvery === 1 ? target.repeatUnit!.slice(0, -1) : `${target.repeatEvery} ${target.repeatUnit}`}`
    : "";
  const schedule = scheduleOf(target);
  const monthlyPayment =
    schedule === "card-monthly" || schedule === "loan-monthly";
  return {
    action: monthlyPayment
      ? `Pay ${money} each month`
      : schedule === "card-payoff"
        ? "Pay off the balance"
        : schedule === "loan-payoff"
          ? "Pay off the loan"
          : schedule === "custom"
            ? `${behaviorCopy(target.behavior, "custom", target.amount).title}${repeat}`
            : `${verb} ${money} each ${period}`,
    when: monthlyPayment
      ? "Every month"
      : schedule === "weekly"
        ? `Every ${weekdays[target.weekday ?? 0]}`
        : target.behavior === "balance"
          ? target.dueDate
            ? `By ${monthLabel(target.dueDate.slice(0, 7))}`
            : "No due date"
          : target.dueDate
            ? `By ${longDate(target.dueDate)}`
            : target.monthDay
              ? `By the ${ordinal(target.monthDay)} of the month`
              : "By the last day of the month",
  };
}

function longDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// The first month a due date can fall in. A yearly or repeating custom
// target's date rolls forward once it passes, so any month since the target
// started works; a date that comes due once can't be before the month being
// planned.
export function earliestDueMonth(
  draft: TargetDraft,
  { month, existing }: { month: string; existing?: Target },
) {
  const startMonth = existing?.startMonth ?? month;
  const repeats =
    draft.schedule === "yearly" ||
    (draft.schedule === "custom" &&
      activeBehavior(draft) !== "balance" &&
      draft.repeat);
  return repeats || startMonth > month ? startMonth : month;
}

function monthLabel(month: string) {
  return new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function lastDay(month: string) {
  const [year, index] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year!, index, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

// Turns the draft into the target the engine stores, or says which field to
// fix. A target keeps its start month and snoozed months when edited; a new
// one starts in the month it was made in.
export function buildTarget(
  draft: TargetDraft,
  { month, existing }: { month: string; existing?: Target },
): TargetResult {
  const fail = (field: TargetField, message: string): TargetResult => ({
    ok: false,
    field,
    message,
  });
  const schedule = draft.schedule;
  const payoff = schedule === "card-payoff" || schedule === "loan-payoff";
  const reading = readAmount(draft.amount.trim() || "0");
  if (!payoff && !reading.ok) return fail("amount", reading.message);
  const amount = payoff || !reading.ok ? 0 : reading.cents;
  if (!payoff && amount <= 0)
    return fail("amount", "Enter an amount above zero.");
  const behavior = activeBehavior(draft);
  const balance = behavior === "balance";
  const dated =
    schedule === "yearly" || payoff || (schedule === "custom" && !balance);
  const earliest = earliestDueMonth(draft, { month, existing });
  if (dated) {
    if (!draft.dueDate.trim()) return fail("dueDate", "Choose a due date.");
    if (!isDate(draft.dueDate))
      return fail("dueDate", "Enter the date as MM/DD/YYYY.");
    if (draft.dueDate.slice(0, 7) < earliest)
      return fail(
        "dueDate",
        `Choose a date in ${monthLabel(earliest)} or later.`,
      );
  }
  if (balance && draft.balanceDue && draft.dueMonth < earliest)
    return fail("dueMonth", `Choose ${monthLabel(earliest)} or later.`);
  const repeat = schedule === "custom" && !balance && draft.repeat;
  const repeatEvery = Number(draft.repeatEvery.trim());
  if (
    repeat &&
    (!Number.isInteger(repeatEvery) || repeatEvery < 1 || repeatEvery > 120)
  )
    return fail("repeatEvery", "Repeat every 1 to 120 months or years.");
  const target: Target = {
    cadence:
      schedule === "loan-monthly" || schedule === "loan-payoff"
        ? "loan"
        : schedule,
    behavior,
    amount,
    startMonth: existing?.startMonth ?? month,
    snoozedMonths: existing?.snoozedMonths ?? [],
  };
  if (dated) target.dueDate = draft.dueDate;
  if (balance && draft.balanceDue) target.dueDate = lastDay(draft.dueMonth);
  if (schedule === "weekly") target.weekday = draft.weekday;
  if (repeat) {
    target.repeatEvery = repeatEvery;
    target.repeatUnit = draft.repeatUnit;
  }
  if (schedule === "monthly" && draft.monthDay !== "last")
    target.monthDay = draft.monthDay;
  return { ok: true, target };
}
