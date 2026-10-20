import {
  categoryStatus,
  statusLine,
} from "~/components/budget/category-row-status";
import { monthName, moveMonth, today } from "~/components/budget/format";
import { describeTarget } from "~/components/budget/target-section";
import type { State, View } from "~/components/budget/types";
import { partnerOf, sharePercent } from "~/components/shared-expenses/split";
import { transactionCategory } from "~/components/transactions/transaction-row";
import type { AutoAssignCategory } from "~/domain/auto-assign";
import { bankImportNeedsReview } from "~/lib/bank-import-review";

// The shell's read-only view of one budget month, built from the same
// `budget.state` query the production app uses.

export type Funding =
  "funded" | "underfunded" | "overspent" | "credit" | "snoozed" | "empty";

export type Category = {
  id: string;
  name: string;
  group: string;
  assigned: number;
  activity: number;
  available: number;
  carryover: number;
  funding: Funding;
  fundedRatio: number;
  status: string;
  target?: {
    action: string;
    when: string;
    funded: number;
    total: number;
    needed: number;
  };
  pays?: { type: "card" | "loan"; id: string; name: string };
  reserved: number;
  spendable: number;
  sharePercents: number[];
  autoAssign: AutoAssignCategory;
};

type CategoryGroup = { id: string; name: string; categories: Category[] };

export type Account = {
  id: string;
  name: string;
  kind: "cash" | "credit";
  balance: number;
  pending: number;
  connection?: {
    institution: string;
    synced: string;
    needsAttention: boolean;
  };
};

export type Loan = {
  id: string;
  name: string;
  balance: number;
  principal: number;
  rate: string | null;
  variable: boolean;
  payment: number;
  payoff: string;
  interest: number | null;
  funded: number;
  payments: number;
};

export type Transaction = {
  id: string;
  date: string;
  payee: string;
  accountId: string | null;
  amount: number;
  status: "pending" | "posted";
  source: "budget" | "bank";
  needsReview: boolean;
  // Why a bank import is waiting, when it is.
  reviewReason?: string;
  categoryId?: string;
  categoryLabel: string;
  needsCategory: boolean;
  forMonth?: string;
  shared: boolean;
  history: { reason: string; amount: number }[];
};

export type ShellData = {
  budgetName: string;
  month: {
    key: string;
    current: string;
    start: string;
    label: string;
    short: string;
    canGoBack: boolean;
  };
  today: string;
  readyToAssign: number;
  groups: CategoryGroup[];
  categories: Category[];
  accounts: Account[];
  loans: Loan[];
  transactions: Transaction[];
  costToBeMe: number;
  expectedIncome: number | null;
  partner?: { name: string; youOwe: number; owedToYou: number };
  reimbursements: {
    id: string;
    name: string;
    amount: number;
    outstanding: number;
    kind: "cash" | "statement-credit";
  }[];
};

const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

function syncedLabel(date: Date | null, error: string | null) {
  if (error) return "Needs attention";
  if (!date) return "Not synced yet";
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (minutes > -60) return relative.format(minutes, "minute");
  if (minutes > -60 * 24)
    return relative.format(Math.round(minutes / 60), "hour");
  return relative.format(Math.round(minutes / (60 * 24)), "day");
}

function rateLabel(loan: View["loans"][number], month: string) {
  const current = loan.rates
    .filter((rate) => rate.effectiveDate <= `${month}-31`)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    .at(-1);
  return current ? `${(current.annualRateBps / 100).toFixed(2)}%` : null;
}

function importRowId(item: State["imports"][number]) {
  return `bank:${JSON.stringify([item.connectionId, item.logicalId])}`;
}

function importReviewReason(item: State["imports"][number]) {
  if (!item.accountId) return "Connect this bank account to a budget account";
  if (item.removed || item.error) return "The bank changed this transaction";
  if (item.needsMatchReview) return "Check that this matches the right entry";
  if (!item.pending) return "Imported from your bank";
  return undefined;
}

const historyReason: Record<
  View["budget"]["transactions"][number]["history"][number]["reason"],
  string
> = {
  created: "Created",
  updated: "Updated",
  categorized: "Categorized",
  merged: "Merged",
  removed: "Removed",
};

export function toShellData(state: State): ShellData {
  const view = state.view!;
  const month = view.month;
  const userId = view.budget.userId;
  const accountName = new Map(
    view.accounts.map((item) => [item.id, item.name]),
  );
  const loanName = new Map(view.loans.map((item) => [item.id, item.name]));
  const categoryName = new Map(
    view.categories.map((item) => [item.id, item.name]),
  );
  const shares = new Map<string, number[]>();
  for (const shared of view.sharedCategories) {
    const id = shared.categoryIds[userId];
    if (id)
      shares.set(id, [
        ...(shares.get(id) ?? []),
        sharePercent(shared.weights, userId),
      ]);
  }

  const categories = view.categories.map((item): Category => {
    const funding = categoryStatus(item);
    const progress = item.targetProgress;
    return {
      id: item.id,
      name: item.name,
      group: item.group,
      assigned: item.assigned,
      activity: item.activity,
      available: item.available,
      carryover: item.opening,
      funding,
      fundedRatio: progress
        ? progress.total > 0
          ? Math.min(1, progress.funded / progress.total)
          : 1
        : item.available > 0
          ? 1
          : 0,
      status: statusLine(item, funding),
      target:
        item.target && progress
          ? {
              ...describeTarget(item.target),
              funded: progress.funded,
              total: progress.total,
              needed: progress.needed,
            }
          : undefined,
      pays: item.pairedAccountId
        ? {
            type: "card",
            id: item.pairedAccountId,
            name: accountName.get(item.pairedAccountId) ?? "Credit card",
          }
        : item.pairedLoanId
          ? {
              type: "loan",
              id: item.pairedLoanId,
              name: loanName.get(item.pairedLoanId) ?? "Loan",
            }
          : undefined,
      reserved: item.reserved,
      spendable: item.spendable,
      sharePercents: shares.get(item.id) ?? [],
      autoAssign: item,
    };
  });

  const groups: CategoryGroup[] = [];
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

  const active = view.budget.transactions.filter((item) => !item.removed);
  const accounts = view.accounts.map((item): Account => {
    const connection = state.connections.find((entry) =>
      Object.values(
        (entry.accountMappings ?? {}) as Record<string, { accountId?: string }>,
      ).some((mapping) => mapping.accountId === item.id),
    );
    return {
      id: item.id,
      name: item.name,
      kind: item.kind,
      balance: item.balance,
      pending: active
        .filter(
          (entry) =>
            entry.accountId === item.id &&
            entry.status === "pending" &&
            entry.date <= `${month}-31`,
        )
        .reduce((sum, entry) => sum + entry.amount, 0),
      connection: connection && {
        institution: connection.institutionName ?? "Connected bank",
        synced: syncedLabel(connection.lastSyncedAt, connection.error),
        needsAttention: Boolean(connection.error),
      },
    };
  });

  const transactions: Transaction[] = [
    ...active.map((item): Transaction => {
      const needsCategory = item.kind === "purchase" && !item.categoryId;
      return {
        id: item.id,
        date: item.date,
        payee: item.payee,
        accountId: item.accountId,
        amount: item.amount,
        status: item.status,
        source: "budget",
        needsReview: !item.reviewed,
        categoryId: item.categoryId,
        categoryLabel: needsCategory
          ? "Needs category"
          : ((item.categoryId && categoryName.get(item.categoryId)) ??
            transactionCategory(item.kind, item.amount)),
        needsCategory,
        forMonth:
          item.expenseMonth !== item.date.slice(0, 7)
            ? monthName(item.expenseMonth)
            : undefined,
        shared: Boolean(item.sharedCategoryId),
        history: item.history.map((entry) => ({
          reason: historyReason[entry.reason],
          amount: entry.amount,
        })),
      };
    }),
    ...state.imports.map((item): Transaction => ({
      id: importRowId(item),
      date: item.date,
      payee: item.payee,
      accountId: item.accountId,
      amount: item.amount,
      status: item.pending ? "pending" : "posted",
      source: "bank",
      needsReview: bankImportNeedsReview(item),
      reviewReason: importReviewReason(item),
      categoryLabel: item.categoryName ?? "Needs category",
      needsCategory: !item.categoryName,
      shared: false,
      history: [],
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  const partner = partnerOf(view);
  const todayKey = today(view.budget.settings.timezone);
  return {
    budgetName: view.budget.name,
    month: {
      key: month,
      start: view.budget.startMonth,
      // Before the budget starts, "this month" means its first month.
      current:
        todayKey.slice(0, 7) < view.budget.startMonth
          ? view.budget.startMonth
          : todayKey.slice(0, 7),
      label: monthName(month),
      short: monthName(month).split(" ")[0]!,
      canGoBack: moveMonth(month, -1) >= view.budget.startMonth,
    },
    today: todayKey,
    readyToAssign: view.readyToAssign,
    groups,
    categories,
    accounts,
    loans: view.loans.map((item) => ({
      id: item.id,
      name: item.name,
      balance: item.balance,
      principal: item.principal,
      rate: rateLabel(item, month),
      variable: item.variable,
      payment: item.minimumPayment,
      payoff: item.forecast.payoffMonth
        ? new Date(
            `${item.forecast.payoffMonth}-15T12:00:00`,
          ).toLocaleDateString("en-US", { month: "short", year: "numeric" })
        : "Not on track to pay off",
      interest: item.forecast.interest,
      funded: item.funded,
      payments: item.payments.length,
    })),
    transactions,
    costToBeMe: view.costToBeMe,
    expectedIncome: view.expectedIncome,
    partner: partner && {
      name: partner.name,
      youOwe: view.settlement.youOwe,
      owedToYou: view.settlement.owedToYou,
    },
    reimbursements: view.reimbursements.map((item) => ({
      id: item.id,
      name: item.name,
      amount: item.amount,
      outstanding: item.outstanding,
      kind: item.kind,
    })),
  };
}

const longDay = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
  });

export const shortDay = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

// "Today", "Yesterday", a weekday within the last week, then the date.
export function dayLabel(date: string, todayKey: string) {
  const days = Math.round(
    (new Date(`${todayKey}T12:00:00`).getTime() -
      new Date(`${date}T12:00:00`).getTime()) /
      86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return longDay(date);
  return shortDay(date);
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const signedCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  signDisplay: "exceptZero",
});

export function money(cents: number, signed = false) {
  return (signed ? signedCurrency : currency).format(cents / 100);
}
