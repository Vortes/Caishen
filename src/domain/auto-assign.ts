import type { Target } from "~/domain/engine";

// Auto-Assign, following YNAB's documented behavior:
// https://support.ynab.com/en_us/auto-assign-a-guide-r1gBNbBJo
// https://support.ynab.com/en_us/underfunded-a-guide-BJwPhQO09
// Unlike YNAB, a plan never takes Ready to Assign below zero and never takes back money
// a category already spent, matching the engine's assign rules.

export type AutoAssignCategory = {
  id: string;
  assigned: number;
  available: number;
  target?: Target;
  // required: what the target asks to assign this month, regardless of what's assigned.
  targetProgress?: {
    needed: number;
    required: number;
    snoozed: boolean;
    dueMonth?: string;
  };
  pairedAccountId?: string;
  // Up to 12 previous months, oldest first. Spent is positive.
  history: { assigned: number[]; spent: number[] };
};

export type AutoAssignOption =
  | "underfunded"
  | "assigned-last-month"
  | "spent-last-month"
  | "average-assigned"
  | "average-spent"
  | "reduce-overfunding"
  | "reset-available"
  | "reset-assigned";

export type AutoAssignChange = { categoryId: string; amount: number };
// short: increases Ready to Assign couldn't pay for. stuck: decreases blocked because
// the category already spent that money.
export type AutoAssignPlan = {
  changes: AutoAssignChange[];
  short: number;
  stuck: number;
};

// Underfunded covers overspending and fully funds the target, whichever needs more.
export function underfunded(category: AutoAssignCategory) {
  return Math.max(
    category.targetProgress?.needed ?? 0,
    -Math.min(0, category.available),
  );
}

// Money assigned beyond what the target asks for this month. Snoozed targets still
// count, and only money the category still holds can go back.
export function overfunded(category: AutoAssignCategory) {
  const progress = category.targetProgress;
  if (!progress) return 0;
  return Math.max(
    0,
    Math.min(category.available, category.assigned - progress.required),
  );
}

export function pastAmounts(category: AutoAssignCategory) {
  const { assigned, spent } = category.history;
  const average = (values: number[]) =>
    values.length
      ? Math.round(
          values.reduce((total, value) => total + value, 0) / values.length,
        )
      : 0;
  // Average assigned starts at the first month money was assigned; average spent at
  // the first month with any assigning or spending.
  const firstAssigned = assigned.findIndex((value) => value !== 0);
  const firstActive = assigned.findIndex(
    (value, index) => value !== 0 || spent[index] !== 0,
  );
  return {
    lastAssigned: assigned.at(-1) ?? 0,
    lastSpent: spent.at(-1) ?? 0,
    averageAssigned:
      firstAssigned < 0 ? 0 : average(assigned.slice(firstAssigned)),
    averageSpent: firstActive < 0 ? 0 : average(spent.slice(firstActive)),
  };
}

// The amount each option shows on its button, summed over the categories in scope.
export function optionAmount(
  option: AutoAssignOption,
  scope: AutoAssignCategory[],
) {
  const total = (pick: (category: AutoAssignCategory) => number) =>
    scope.reduce((sum, category) => sum + pick(category), 0);
  switch (option) {
    case "underfunded":
      return total(underfunded);
    case "assigned-last-month":
      return total((category) => pastAmounts(category).lastAssigned);
    case "spent-last-month":
      return total((category) => pastAmounts(category).lastSpent);
    case "average-assigned":
      return total((category) => pastAmounts(category).averageAssigned);
    case "average-spent":
      return total((category) => pastAmounts(category).averageSpent);
    case "reduce-overfunding":
      return total(overfunded);
    default:
      return 0;
  }
}

type Chunk = { categoryId: string; amount: number; rank: [number, number] };

// YNAB's Underfunded order: overspent categories first, then targets due on a day this
// month by date (weekly targets split per week), then end-of-month targets, then targets
// due in a later month by due date, then credit card payments. Ties go top to bottom.
export function underfundedOrder(
  scope: AutoAssignCategory[],
  month: string,
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const category of scope) {
    const amount = underfunded(category);
    if (amount === 0) continue;
    const target = category.target;
    const push = (rank: [number, number], value = amount) =>
      chunks.push({ categoryId: category.id, amount: value, rank });
    if (category.available < 0 || !target || category.targetProgress?.snoozed)
      push([0, 0]);
    else if (
      category.pairedAccountId ||
      target.cadence === "card-monthly" ||
      target.cadence === "card-payoff"
    )
      push([4, 0]);
    else if (target.cadence === "weekly") {
      // Earlier weeks are funded first, so what's already assigned covers them.
      let covered = Math.max(0, category.assigned);
      let left = amount;
      for (const day of weekdaysIn(month, target.weekday ?? 0)) {
        const short = Math.min(left, Math.max(0, target.amount - covered));
        covered = Math.max(0, covered - target.amount);
        if (short === 0) continue;
        push([1, day], short);
        left -= short;
      }
      if (left > 0) push([2, 0], left);
    } else if (target.cadence === "monthly")
      push(target.monthDay ? [1, target.monthDay] : [2, 0]);
    else if (target.cadence === "loan")
      push(target.dueDate ? [1, Number(target.dueDate.slice(8, 10))] : [2, 0]);
    else {
      // Repeating targets roll their due month forward; the day stays the same.
      const dueMonth =
        category.targetProgress?.dueMonth ?? target.dueDate?.slice(0, 7);
      const day = Number(target.dueDate?.slice(8, 10) ?? 31);
      if (!dueMonth) push([2, 0]);
      else if (dueMonth <= month) push([1, day]);
      else push([3, Number(dueMonth.replace("-", "")) * 100 + day]);
    }
  }
  const position = new Map(
    scope.map((category, index) => [category.id, index]),
  );
  return chunks.sort(
    (a, b) =>
      a.rank[0] - b.rank[0] ||
      a.rank[1] - b.rank[1] ||
      position.get(a.categoryId)! - position.get(b.categoryId)!,
  );
}

export function weekdaysIn(month: string, weekday: number) {
  const days: number[] = [];
  const date = new Date(`${month}-01T00:00:00Z`);
  while (date.toISOString().startsWith(month)) {
    if (date.getUTCDay() === weekday) days.push(date.getUTCDate());
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return days;
}

// What one option would change for the categories in scope. Releases happen before
// increases so freed money can fund them.
export function planAutoAssign({
  option,
  scope,
  readyToAssign,
  month,
}: {
  option: AutoAssignOption;
  scope: AutoAssignCategory[];
  readyToAssign: number;
  month: string;
}): AutoAssignPlan {
  let cash = readyToAssign;
  let short = 0;
  let stuck = 0;
  const changes = new Map<string, number>();
  const byId = new Map(scope.map((category) => [category.id, category]));
  const add = (categoryId: string, amount: number) => {
    const held = Math.max(
      0,
      byId.get(categoryId)!.available + (changes.get(categoryId) ?? 0),
    );
    const allowed =
      amount > 0
        ? Math.min(amount, Math.max(0, cash))
        : -Math.min(-amount, held);
    if (amount > 0) short += amount - allowed;
    else stuck += allowed - amount;
    if (allowed === 0) return;
    cash -= allowed;
    changes.set(categoryId, (changes.get(categoryId) ?? 0) + allowed);
  };
  if (option === "underfunded")
    for (const chunk of underfundedOrder(scope, month))
      add(chunk.categoryId, chunk.amount);
  else {
    const goal = (category: AutoAssignCategory) => {
      const past = pastAmounts(category);
      switch (option) {
        case "assigned-last-month":
          return past.lastAssigned;
        case "spent-last-month":
          return past.lastSpent;
        case "average-assigned":
          return past.averageAssigned;
        case "average-spent":
          return past.averageSpent;
        case "reduce-overfunding":
          return category.assigned - overfunded(category);
        case "reset-available":
          return category.assigned - Math.max(0, category.available);
        case "reset-assigned":
          return 0;
      }
    };
    // History options leave alone categories with no earlier month to copy, rather
    // than treating a missing month as $0 and emptying them.
    const fromHistory =
      option !== "reduce-overfunding" &&
      option !== "reset-available" &&
      option !== "reset-assigned";
    const deltas = scope
      .filter(
        (category) => !fromHistory || category.history.assigned.length > 0,
      )
      .map((category) => ({
        category,
        delta: goal(category) - category.assigned,
      }))
      .filter(({ delta }) => delta !== 0);
    for (const { category, delta } of deltas)
      if (delta < 0) add(category.id, delta);
    for (const { category, delta } of deltas)
      if (delta > 0) add(category.id, delta);
  }
  return {
    changes: [...changes]
      .filter(([, amount]) => amount !== 0)
      .map(([categoryId, amount]) => ({ categoryId, amount })),
    short,
    stuck,
  };
}
