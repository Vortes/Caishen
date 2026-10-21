import { moveMonth } from "~/components/budget/format";
import type { SpendingEntry } from "~/domain/spending";

// YNAB's Reflect spending reports: Spending Breakdown and Spending Trends share
// one set of filters and drill from category groups to categories to
// transactions. Spending is personal spending: each entry is already your share.

export type ReportKind = "breakdown" | "trends";

// YNAB's Categories / Groups switch: every category at once, or category
// groups that drill into their categories.
export type Grouping = "categories" | "groups";

export type Preset =
  | "this-month"
  | "latest-3"
  | "latest-6"
  | "latest-12"
  | "this-year"
  | "last-year"
  | "all";

export type DateRange =
  { preset: Preset } | { preset: "custom"; from: string; to: string };

export type ReflectFilters = {
  range: DateRange;
  // null means everything, including categories and accounts added later.
  categoryIds: string[] | null;
  accountIds: string[] | null;
};

export type DrillPath = { group?: string; categoryId?: string };

export const defaultFilters: ReflectFilters = {
  range: { preset: "latest-6" },
  categoryIds: null,
  accountIds: null,
};

export const presets: { id: Preset; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "latest-3", label: "Latest 3 months" },
  { id: "latest-6", label: "Latest 6 months" },
  { id: "latest-12", label: "Latest 12 months" },
  { id: "this-year", label: "This year" },
  { id: "last-year", label: "Last year" },
  { id: "all", label: "All dates" },
];

// Purchases without a category still count as spending.
export const UNCATEGORIZED = "uncategorized";
// Shared expenses a partner paid have no account of yours.
export const PARTNER_ACCOUNT = "partner";

export function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  for (let month = from; month <= to; month = moveMonth(month, 1))
    months.push(month);
  return months;
}

// Preset ranges include the current month, even though it isn't over, and
// never reach back before the budget started.
export function resolveRange(range: DateRange, current: string, start: string) {
  const year = current.slice(0, 4);
  const [from, to] =
    range.preset === "custom"
      ? [range.from, range.to]
      : range.preset === "this-month"
        ? [current, current]
        : range.preset === "latest-3"
          ? [moveMonth(current, -2), current]
          : range.preset === "latest-6"
            ? [moveMonth(current, -5), current]
            : range.preset === "latest-12"
              ? [moveMonth(current, -11), current]
              : range.preset === "this-year"
                ? [`${year}-01`, current]
                : range.preset === "last-year"
                  ? [`${Number(year) - 1}-01`, `${Number(year) - 1}-12`]
                  : [start, current];
  const clamped = from < start ? start : from;
  return { from: clamped, to, months: monthsBetween(clamped, to) };
}

const monthYear = (month: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", options);

// The date filter's arrows: the same number of months, one span earlier or
// later. Null when that span would leave the budget's months entirely.
export function shiftRange(
  range: DateRange,
  direction: -1 | 1,
  current: string,
  start: string,
): DateRange | null {
  const { from, to } = resolveRange(range, current, start);
  if (from > to) return null;
  const span = monthsBetween(from, to).length * direction;
  const next = { from: moveMonth(from, span), to: moveMonth(to, span) };
  if (next.to < start || next.from > current) return null;
  return {
    preset: "custom",
    from: next.from < start ? start : next.from,
    to: next.to > current ? current : next.to,
  };
}

const daysIn = (month: string) =>
  new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();

export function rangeLabel(from: string, to: string) {
  if (from === to) return monthYear(from, { month: "short", year: "numeric" });
  if (from.slice(0, 4) === to.slice(0, 4))
    return `${monthYear(from, { month: "short" })} – ${monthYear(to, { month: "short", year: "numeric" })}`;
  return `${monthYear(from, { month: "short", year: "numeric" })} – ${monthYear(to, { month: "short", year: "numeric" })}`;
}

export type CategoryRef = { id: string; name: string; group: string };

// Card payments are never spending, so their categories are left out of the
// category filter; Uncategorized is offered as one more choice.
export function filterableCategories<T extends { pays?: { type: string } }>(
  categories: T[],
) {
  return categories.filter((item) => item.pays?.type !== "card");
}

export type ReportItem = {
  id: string;
  name: string;
  total: number;
  average: number;
  share: number;
  // Categorical slot, or null when folded into "Other" on the chart.
  slot: number | null;
  drill: DrillPath;
};

export type ChartItem = {
  id: string;
  name: string;
  total: number;
  slot: number | null;
  drill?: DrillPath;
};

// What the report lists, which the drill path and grouping decide before any
// spending loads.
export function levelOf(path: DrillPath, grouping: Grouping): Report["level"] {
  if (path.categoryId) return "transactions";
  return path.group || grouping === "categories" ? "categories" : "groups";
}

export type Report = {
  level: "groups" | "categories" | "transactions";
  months: string[];
  total: number;
  average: number;
  // Per day so far: the current month counts only the days that have passed.
  dailyAverage: number;
  // Most transactions in scope: a category, or a payee inside one category.
  frequent: { name: string; count: number } | null;
  largest: { payee: string; amount: number; date: string } | null;
  items: ReportItem[];
  chartItems: ChartItem[];
  trend: { month: string; total: number; values: Record<string, number> }[];
  inflows: { id: string; name: string; group: string; total: number }[];
  entries: SpendingEntry[];
  // Each chart item's transactions, newest first, for the slice popover.
  itemEntries: Record<string, SpendingEntry[]>;
};

export const OTHER = "other";

export function buildReport({
  entries,
  categories,
  filters,
  path,
  grouping,
  today,
  start,
  slots,
}: {
  entries: SpendingEntry[];
  categories: CategoryRef[];
  filters: ReflectFilters;
  path: DrillPath;
  grouping: Grouping;
  // YYYY-MM-DD in the budget's timezone.
  today: string;
  start: string;
  // Categorical hues available; past that, the smallest items fold into
  // "Other" rather than reusing a hue.
  slots: number;
}): Report {
  const current = today.slice(0, 7);
  const { months } = resolveRange(filters.range, current, start);
  const inRange = new Set(months);
  const known = new Map(categories.map((item) => [item.id, item]));
  const categoryOf = (entry: SpendingEntry): CategoryRef =>
    (entry.categoryId ? known.get(entry.categoryId) : undefined) ?? {
      id: UNCATEGORIZED,
      name: "Uncategorized",
      group: "Uncategorized",
    };
  const categoryIds = filters.categoryIds && new Set(filters.categoryIds);
  const accountIds = filters.accountIds && new Set(filters.accountIds);
  const scoped = entries.filter(
    (entry) =>
      inRange.has(entry.month) &&
      (!categoryIds || categoryIds.has(categoryOf(entry).id)) &&
      (!accountIds || accountIds.has(entry.accountId ?? PARTNER_ACCOUNT)),
  );

  // Net spending per category across the range. Categories whose refunds and
  // reimbursements outweigh their spending are listed apart, as positive inflow.
  const net = new Map<string, number>();
  const monthly = new Map<string, Map<string, number>>();
  for (const entry of scoped) {
    const id = categoryOf(entry).id;
    net.set(id, (net.get(id) ?? 0) + entry.amount);
    const byMonth = monthly.get(id) ?? new Map<string, number>();
    byMonth.set(entry.month, (byMonth.get(entry.month) ?? 0) + entry.amount);
    monthly.set(id, byMonth);
  }
  const allCategories = [
    ...categories,
    { id: UNCATEGORIZED, name: "Uncategorized", group: "Uncategorized" },
  ];
  const spending = allCategories.filter((item) => (net.get(item.id) ?? 0) > 0);
  const inflows = allCategories
    .filter(
      (item) =>
        (net.get(item.id) ?? 0) < 0 &&
        !path.categoryId &&
        (!path.group || item.group === path.group),
    )
    .map((item) => ({ ...item, total: -(net.get(item.id) ?? 0) }))
    .sort((a, b) => b.total - a.total);

  const level = levelOf(path, grouping);
  // Siblings in budget order, so an item keeps its color as amounts change.
  const groupNames = [...new Set(allCategories.map((item) => item.group))];
  const siblings: { id: string; name: string; members: string[] }[] =
    level === "groups"
      ? groupNames.map((group) => ({
          id: group,
          name: group,
          members: allCategories
            .filter((item) => item.group === group)
            .map((item) => item.id),
        }))
      : level === "categories"
        ? allCategories
            .filter((item) => !path.group || item.group === path.group)
            .map((item) => ({
              id: item.id,
              name: item.name,
              members: [item.id],
            }))
        : allCategories
            .filter((item) => item.id === path.categoryId)
            .map((item) => ({
              id: item.id,
              name: item.name,
              members: [item.id],
            }));
  const counted = new Set(spending.map((item) => item.id));
  const totalOf = (members: string[]) =>
    members.reduce(
      (sum, id) =>
        sum +
        (level === "transactions" || counted.has(id) ? (net.get(id) ?? 0) : 0),
      0,
    );
  const ranked = siblings
    .map((item) => ({ ...item, total: totalOf(item.members) }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
  const shown =
    ranked.length <= slots
      ? new Set(ranked.map((item) => item.id))
      : new Set(ranked.slice(0, slots - 1).map((item) => item.id));
  const order = siblings.filter((item) => shown.has(item.id));
  const slotOf = (id: string) => {
    const index = order.findIndex((item) => item.id === id);
    return index === -1 ? null : index;
  };
  const total = ranked.reduce((sum, item) => sum + item.total, 0);
  const average = months.length ? Math.round(total / months.length) : 0;
  const drillFor = (id: string): DrillPath =>
    level === "groups" ? { group: id } : { group: path.group, categoryId: id };
  const items: ReportItem[] = ranked.map((item) => ({
    id: item.id,
    name: item.name,
    total: item.total,
    average: months.length ? Math.round(item.total / months.length) : 0,
    share: total ? item.total / total : 0,
    slot: slotOf(item.id),
    drill: drillFor(item.id),
  }));

  const folded = items.filter((item) => item.slot === null);
  const chartItems: ChartItem[] = [
    ...items
      .filter((item) => item.slot !== null)
      .map(({ id, name, total, slot, drill }) => ({
        id,
        name,
        total,
        slot,
        drill: level === "transactions" ? undefined : drill,
      })),
    ...(folded.length
      ? [
          {
            id: OTHER,
            name: `${folded.length} more`,
            total: folded.reduce((sum, item) => sum + item.total, 0),
            slot: null,
          },
        ]
      : []),
  ];
  const membersOf = new Map(siblings.map((item) => [item.id, item.members]));
  // A month where a category was refunded more than it spent draws nothing,
  // rather than a segment below the baseline.
  const trend = months.map((month) => {
    const values: Record<string, number> = {};
    for (const item of chartItems) {
      const members =
        item.id === OTHER
          ? folded.flatMap((entry) => membersOf.get(entry.id) ?? [])
          : (membersOf.get(item.id) ?? []);
      values[item.id] = Math.max(
        0,
        members.reduce(
          (sum, id) =>
            sum +
            (level === "transactions" || counted.has(id)
              ? (monthly.get(id)?.get(month) ?? 0)
              : 0),
          0,
        ),
      );
    }
    return {
      month,
      values,
      total: Object.values(values).reduce((sum, value) => sum + value, 0),
    };
  });

  const itemOf = new Map<string, string>();
  for (const item of chartItems) {
    const members =
      item.id === OTHER
        ? folded.flatMap((entry) => membersOf.get(entry.id) ?? [])
        : (membersOf.get(item.id) ?? []);
    for (const id of members) itemOf.set(id, item.id);
  }
  const itemEntries: Record<string, SpendingEntry[]> = {};
  for (const entry of [...scoped].sort((a, b) =>
    b.date.localeCompare(a.date),
  )) {
    const id = categoryOf(entry).id;
    const item = itemOf.get(id);
    if (item && (level === "transactions" || counted.has(id)))
      (itemEntries[item] ??= []).push(entry);
  }

  // The stats under the chart describe exactly what the chart shows.
  const scopeIds = new Set(
    ranked
      .flatMap((item) => item.members)
      .filter((id) => level === "transactions" || counted.has(id)),
  );
  const outflows = scoped.filter(
    (entry) => entry.amount > 0 && scopeIds.has(categoryOf(entry).id),
  );
  const counts = new Map<string, number>();
  for (const entry of outflows) {
    const name =
      level === "transactions" ? entry.payee : categoryOf(entry).name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const [frequentName, frequentCount] = [...counts].sort(
    (a, b) => b[1] - a[1],
  )[0] ?? [null, 0];
  const biggest = outflows.reduce<SpendingEntry | null>(
    (best, entry) => (!best || entry.amount > best.amount ? entry : best),
    null,
  );
  const days = months.reduce(
    (sum, month) =>
      sum + (month === current ? Number(today.slice(8, 10)) : daysIn(month)),
    0,
  );

  return {
    level,
    months,
    total,
    average,
    dailyAverage: days ? Math.round(total / days) : 0,
    frequent: frequentName
      ? { name: frequentName, count: frequentCount }
      : null,
    largest: biggest && {
      payee: biggest.payee,
      amount: biggest.amount,
      date: biggest.date,
    },
    items,
    chartItems,
    trend,
    inflows,
    itemEntries,
    entries:
      level === "transactions"
        ? scoped
            .filter((entry) => categoryOf(entry).id === path.categoryId)
            .sort((a, b) => b.date.localeCompare(a.date))
        : [],
  };
}
