import {
  READY_TO_ASSIGN,
  registerPayee,
  isTransfer,
  transferCounterparts,
  transferNeedsCategory,
} from "~/domain/transfers";
import {
  categoryStatus,
  statusLine,
} from "~/components/budget/category-row-status";
import {
  currentMonth,
  monthName,
  moveMonth,
  today,
} from "~/components/budget/format";
import type { State, View } from "~/components/budget/types";
import { partnerOf } from "~/components/partner/partner";
import { transactionCategory } from "~/components/transactions/transaction-category";
import { canShare } from "~/components/transactions/transaction-share";
import { weekdaysIn, type AutoAssignCategory } from "~/domain/auto-assign";
import { isCounterparty, type Target } from "~/domain/engine";

export { isCounterparty };
import { bankImportNeedsReview } from "~/lib/bank-import-review";
import { namesPerson } from "~/lib/settlement-recognition";
import {
  canEditImport,
  importCategory,
  importRowId,
  partnerMatchesOf,
} from "~/components/transactions/import-draft";
import { describeTarget } from "./target-draft";

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
    // The progress bar's sections, in cents, before any extra section for
    // money past the target. See targetSections.
    sections: number[];
  };
  // The target as the engine stores it, for the target editor.
  rule?: Target;
  pays?: { type: "card" | "loan"; id: string; name: string };
  // A paired envelope's counterparty account: available is the float set
  // aside minus what the account says is owed to you.
  pairs?: { accountId: string; name: string; balance: number };
  autoAssign: AutoAssignCategory;
};

type CategoryGroup = { id: string; name: string; categories: Category[] };

export type Account = {
  id: string;
  name: string;
  kind: "cash" | "credit" | "tracking" | "partner" | "reimbursements";
  balance: number;
  pending: number;
  // Today's cleared balance, whatever month is showing: what reconciling
  // compares with the bank's.
  cleared: number;
  // The last time it matched the bank's.
  reconciled?: { date: string; balance: number };
  // Entries wait for the user: the partner's purchases still to categorize.
  toReview?: boolean;
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
  reconciled: boolean;
  source: "budget" | "bank";
  editableImport?: boolean;
  shareable: boolean;
  needsReview: boolean;
  counterpart?: {
    id: string;
    accountId: string;
    accountName: string;
    date: string;
  };
  // Why a bank import is waiting, when it is.
  reviewReason?: string;
  categoryId?: string;
  categoryLabel: string;
  needsCategory: boolean;
  categoryNotNeeded: boolean;
  forMonth?: string;
  // Who owes a share of it, for search.
  shareLabel?: string;
  // Money someone paid back, or a payment between the partners: who, the
  // counterparty account it moved, and the settlement it is one leg of.
  repayment?: {
    from: string;
    account: string;
    settlementId?: string;
  };
  history: { reason: string; amount: number }[];
};

export type ShellData = {
  budgetName: string;
  preferences?: View["budget"]["settings"];
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
  partner?: { name: string };
};

const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

export function syncedLabel(date: Date | null, error: string | null) {
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

function importReviewReason(item: State["imports"][number]) {
  if (item.quarantined) return "Not imported from your bank";
  if (item.loanId) return "Confirm this loan activity with your lender";
  if (!item.accountId) return "Connect this bank account to a budget account";
  if (item.removed || item.error) return "The bank changed this transaction";
  if (item.needsMatchReview) return "Check that this matches the right entry";
  if (partnerMatchesOf(item).length)
    return "Match it to the purchase it was recorded as";
  if (!item.pending) return "Imported from your bank";
  return undefined;
}

// A waiting import's category: its own, or what its payee's memory
// prefills, which reads like any other.
function importCategoryLabel(
  view: View,
  item: State["imports"][number],
  categoryName: Map<string, string>,
) {
  const categoryId = importCategory(view, item);
  const label =
    categoryId === READY_TO_ASSIGN
      ? transactionCategory("income", item.amount)
      : categoryId
        ? (item.categoryName ?? categoryName.get(categoryId))
        : undefined;
  return label
    ? { categoryId, categoryLabel: label, needsCategory: false }
    : { categoryLabel: "Needs category", needsCategory: true };
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
  undone: "Undone",
  redone: "Redone",
};

// YNAB's progress bar sections (support.ynab.com, "Progress Bars"): weekly
// targets get a section per week; "set aside another" targets also get a
// first section for money that rolled over. Otherwise one section is the
// month or the target period.
function targetSections(
  target: Target,
  total: number,
  rollover: number,
  month: string,
): number[] {
  const setAside = target.behavior === "contribution" && rollover > 0;
  if (target.cadence === "weekly") {
    const weeks = weekdaysIn(month, target.weekday ?? 0).map(
      () => target.amount,
    );
    return setAside ? [rollover, ...weeks] : weeks;
  }
  if (target.cadence === "monthly" && setAside) return [rollover, total];
  return [total];
}

// What the shell is drawn from: the month as the budget shows it, and the
// bank connections with their inbox.
export type ShellSource = {
  view: View;
  connections: State["connections"];
  imports: State["imports"];
  // The partner's first name from their profile, which names the partner
  // account; a member's own name is their budget's.
  partnerFirstName?: string;
};

export function toShellData(
  state: ShellSource,
  activeMonth = currentMonth(),
): ShellData {
  const view = state.view;
  const month = view.month;
  const accountName = new Map(
    view.accounts.map((item) => [item.id, item.name]),
  );
  const loanName = new Map(view.loans.map((item) => [item.id, item.name]));
  // Counterparty accounts go by who they are with: the partner's first name,
  // or Reimbursements for everyone else.
  const displayName = (account: { kind: string; name: string }) =>
    (account.kind === "partner" ? state.partnerFirstName : undefined) ??
    account.name;
  const partnerAccount = view.accounts.find((item) => item.kind === "partner");
  const partnerName = partnerAccount && displayName(partnerAccount);
  const counterparty = new Map(
    view.accounts
      .filter(
        (item) => item.kind === "partner" || item.kind === "reimbursements",
      )
      .map((item) => [item.id, item]),
  );
  const categoryName = new Map(
    view.categories.map((item) => {
      const pair = item.counterpartyAccountId
        ? counterparty.get(item.counterpartyAccountId)
        : undefined;
      return [item.id, pair ? displayName(pair) : item.name];
    }),
  );

  const categories = view.categories.map((item): Category => {
    const card = item.pairedAccountId
      ? view.accounts.find((account) => account.id === item.pairedAccountId)
      : undefined;
    const paymentNeeded =
      card && !item.target && month === activeMonth
        ? Math.max(0, -card.balance - item.available)
        : 0;
    const funding =
      card && item.available < 0
        ? "overspent"
        : paymentNeeded > 0
          ? "underfunded"
          : categoryStatus(item);
    const progress = item.targetProgress;
    const pair = item.counterpartyAccountId
      ? counterparty.get(item.counterpartyAccountId)
      : undefined;
    return {
      id: item.id,
      name: categoryName.get(item.id)!,
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
      status:
        paymentNeeded > 0 && item.available >= 0
          ? `${money(paymentNeeded)} more needed to pay in full`
          : statusLine(item, funding),
      target:
        item.target && progress
          ? {
              ...describeTarget(item.target),
              funded: progress.funded,
              total: progress.total,
              needed: progress.needed,
              sections: targetSections(
                item.target,
                progress.total,
                item.opening,
                month,
              ),
            }
          : undefined,
      rule: item.target,
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
      pairs: pair && {
        accountId: pair.id,
        name: displayName(pair),
        balance: pair.balance,
      },
      autoAssign: item,
    };
  });

  // Groups added with group.add lead, newest first; the rest follow in the
  // order their categories were added.
  const groups: CategoryGroup[] = (view.budget.groups ?? []).map((name) => ({
    id: name,
    name,
    categories: [],
  }));
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
  // People, which holds the paired envelopes, leads the plan.
  const people = groups.findIndex((group) =>
    group.categories.some((category) => category.pairs),
  );
  if (people > 0) groups.unshift(...groups.splice(people, 1));
  // The partner leads People, as in the sidebar.
  if (people >= 0) {
    const isPartner = (category: Category) =>
      category.pairs !== undefined &&
      counterparty.get(category.pairs.accountId)?.kind === "partner";
    groups[0]!.categories.sort(
      (a, b) => Number(isPartner(b)) - Number(isPartner(a)),
    );
  }

  const active = view.budget.transactions.filter((item) => !item.removed);
  const confirmed = new Set(
    view.partnerSettlements
      .filter((settlement) => settlement.confirmed)
      .map((settlement) => settlement.id),
  );
  const accounts = view.accounts.map((item): Account => {
    const connection = state.connections.find((entry) =>
      Object.values(
        (entry.accountMappings ?? {}) as Record<string, { accountId?: string }>,
      ).some((mapping) => mapping.accountId === item.id),
    );
    return {
      id: item.id,
      name: displayName(item),
      kind: item.kind,
      balance: item.balance,
      // The engine leaves pending inflows out of the balance until they
      // post, so only pending outflows are uncleared money in it.
      pending: active
        .filter(
          (entry) =>
            entry.accountId === item.id &&
            entry.status === "pending" &&
            entry.amount < 0 &&
            entry.date <= `${month}-31`,
        )
        .reduce((sum, entry) => sum + entry.amount, 0),
      cleared: item.cleared,
      reconciled: item.reconciled,
      toReview:
        item.kind === "partner" &&
        view.partnerLedger.some(
          (row) => row.needsCategory || row.confirmed === false,
        ),
      connection: connection && {
        institution: connection.institutionName ?? "Connected bank",
        synced: syncedLabel(connection.lastSyncedAt, connection.error),
        needsAttention: Boolean(connection.error),
      },
    };
  });

  const transactions: Transaction[] = [
    ...active.map((item): Transaction => {
      const account = view.budget.accounts.find(
        (account) => account.id === item.accountId,
      )!;
      const counterpart = transferCounterparts(view.budget, item)[0];
      const other = view.budget.accounts.find(
        (account) => account.id === counterpart?.accountId,
      );
      const boundary = other && transferNeedsCategory(account, other);
      // Only a cash account's adjustment reaches Ready to Assign; on a card
      // or tracking account it just corrects the balance.
      const categoryNotNeeded =
        (isTransfer(item) ||
          account.kind === "tracking" ||
          (item.kind === "adjustment" && account.kind !== "cash")) &&
        !boundary;
      const needsCategory =
        item.kind === "purchase" &&
        !item.categoryId &&
        !item.lines &&
        account.kind !== "tracking";
      // A repayment moves money out of a counterparty account, like a
      // transfer, rather than earning it.
      const repaidFrom =
        item.linkedCounterpartyAccountId &&
        counterparty.get(item.linkedCounterpartyAccountId);
      const shareNames = [
        ...new Set(
          (item.lines ?? [item])
            .map((line) => line.counterpartyShare)
            .filter((share) => share?.amount)
            .map(
              (share) =>
                share!.counterpartyName ??
                view.budget.accounts.find(
                  (account) => account.id === share!.accountId,
                )?.name,
            ),
        ),
      ];
      return {
        id: item.id,
        date: item.date,
        payee: registerPayee(view.budget, item),
        accountId: item.accountId,
        amount: item.amount,
        status: item.status,
        reconciled: Boolean(item.reconciled),
        source: "budget",
        shareable: canShare(view, item),
        counterpart:
          counterpart && other
            ? {
                id: counterpart.id,
                accountId: other.id,
                accountName: other.name,
                date: counterpart.date,
              }
            : undefined,
        // A settlement leg waits until either partner confirms it.
        needsReview:
          !item.reviewed ||
          Boolean(
            item.partnerSettlementId &&
            !confirmed.has(item.partnerSettlementId),
          ),
        categoryId: item.categoryId,
        categoryLabel: categoryNotNeeded
          ? "Category not needed"
          : needsCategory
            ? "Needs category"
            : item.lines?.length === 1
              ? (categoryName.get(item.lines[0]!.categoryId) ??
                "Needs category")
              : item.lines
                ? `Split (${item.lines.length})`
                : ((item.categoryId && categoryName.get(item.categoryId)) ??
                  (boundary
                    ? "Inflow: Ready to Assign"
                    : repaidFrom
                      ? `Transfer: ${displayName(repaidFrom)}`
                      : transactionCategory(item.kind, item.amount))),
        needsCategory,
        categoryNotNeeded,
        forMonth:
          item.expenseMonth !== item.date.slice(0, 7)
            ? monthName(item.expenseMonth)
            : undefined,
        shareLabel: shareNames.join(" ") || undefined,
        repayment: repaidFrom
          ? {
              from: item.counterpartyName ?? displayName(repaidFrom),
              account: displayName(repaidFrom),
              settlementId: item.partnerSettlementId,
            }
          : undefined,
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
      reconciled: false,
      source: "bank",
      shareable: canShare(view, item),
      editableImport: canEditImport(item),
      needsReview: bankImportNeedsReview(item),
      reviewReason: importReviewReason(item),
      ...importCategoryLabel(view, item, categoryName),
      // Money to or from the partner waits for the partner's import of it,
      // then both become one settlement.
      ...(partnerName &&
      item.accountId &&
      !item.transactionId &&
      !importCategory(view, item) &&
      namesPerson(item.payee, partnerName)
        ? {
            categoryLabel: `Transfer: ${partnerName}`,
            needsCategory: false,
            reviewReason: `Waiting for ${partnerName}’s import to match`,
          }
        : {}),
      categoryNotNeeded: false,
      history: [],
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  const partner = partnerOf(view);
  const todayKey = today(view.budget.settings.timezone);
  return {
    budgetName: view.budget.name,
    preferences: view.budget.settings,
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
    partner: partner && { name: partner.name },
  };
}

export const shortDay = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

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
