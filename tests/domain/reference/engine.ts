// The engine's month replay as it was before rows were indexed: every
// month filters the full transaction and assignment lists, and every assignment re-replays each later month. Kept
// only as the reference the equivalence tests compare the engine against.
import { z } from "zod";
import {
  AccountingError,
  type Account,
  type Book,
  type Budget,
  type Category,
  type Command,
  type Transaction,
} from "../../../src/domain/engine";
import {
  isPersonalLedger,
  type AccountingState,
} from "../../../src/domain/shared-ledger";
import { transferCounterparts } from "../../../src/domain/transfers";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const fail = (message: string): never => {
  throw new AccountingError(message);
};
const safe = (amount: number): number =>
  Number.isSafeInteger(amount)
    ? amount
    : fail("Amount exceeds safe integer cents");
const sum = (values: number[]): number =>
  values.reduce((total, value) => safe(total + value), 0);
const monthOf = (day: string): string => day.slice(0, 7);
const endOf = (month: string): string => `${month}-31`;
const nextMonth = (month: string, count = 1): string => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 7);
};
const monthDistance = (start: string, end: string): number => {
  const a = start.split("-").map(Number);
  const b = end.split("-").map(Number);
  return (b[0]! - a[0]!) * 12 + b[1]! - a[1]!;
};
const ownBudget = (book: AccountingState, userId: string): Budget =>
  (isPersonalLedger(book)
    ? book.budget.userId === userId
      ? book.budget
      : undefined
    : Object.hasOwn(book.budgets, userId)
      ? book.budgets[userId]
      : undefined) ?? fail("Budget access denied");
const getAccount = (budget: Budget, id: string): Account =>
  budget.accounts.find((account) => account.id === id) ??
  fail("Account access denied");
const getCategory = (budget: Budget, id: string): Category =>
  budget.categories.find((category) => category.id === id) ??
  fail("Category access denied");
const active = (transaction: Transaction): boolean => !transaction.removed;
type CategoryMonth = {
  assigned: number;
  activity: number;
  available: number;
  opening: number;
  cashOverspending: number;
  cashActivity: number;
};
type AccountMonth = {
  balance: number;
  reserve: number;
  shortfall: number;
  priorBalance: number;
  outflows: number;
  inflows: number;
  fundedSpending: number;
  paymentsMade: number;
  creditsReleased: number;
};
export type Materialized = {
  cash: number;
  readyToAssign: number;
  accounts: Map<string, AccountMonth>;
  categories: Map<string, CategoryMonth>;
  snapshots: Map<string, Map<string, CategoryMonth>>;
  startingBalances: Map<string, number>;
};

export function referenceMaterialize(
  book: AccountingState,
  userId: string,
  month: string,
  cutoff = endOf(month),
): Materialized {
  monthSchema.parse(month);
  const budget = ownBudget(book, userId);
  if (month < budget.startMonth) fail("Month precedes the budget start");
  if (monthDistance(budget.startMonth, month) > 1200)
    fail("Budget date is too far in the future");
  const accounts = new Map<string, AccountMonth>(
    budget.accounts.map((account) => [
      account.id,
      {
        balance: 0,
        reserve: 0,
        shortfall: 0,
        priorBalance: 0,
        outflows: 0,
        inflows: 0,
        fundedSpending: 0,
        paymentsMade: 0,
        creditsReleased: 0,
      },
    ]),
  );
  const categories = new Map<string, CategoryMonth>(
    budget.categories.map((category) => [
      category.id,
      {
        assigned: 0,
        activity: 0,
        available: 0,
        opening: 0,
        cashOverspending: 0,
        cashActivity: 0,
      },
    ]),
  );
  const snapshots = new Map<string, Map<string, CategoryMonth>>();
  const startingBalances = new Map<string, number>();
  for (
    let cursor = budget.startMonth;
    cursor <= month;
    cursor = nextMonth(cursor)
  ) {
    for (const state of categories.values()) {
      state.opening = Math.max(0, state.available);
      state.available = state.opening;
      state.assigned = 0;
      state.activity = 0;
      state.cashOverspending = 0;
      state.cashActivity = 0;
    }
    for (const account of budget.accounts.filter(
      (item) => monthOf(item.date) === cursor && item.date <= cutoff,
    ))
      accounts.get(account.id)!.balance = account.openingBalance;
    for (const [accountId, state] of accounts) {
      startingBalances.set(accountId, state.balance);
      state.priorBalance = state.balance;
      state.outflows = 0;
      state.inflows = 0;
      state.fundedSpending = 0;
      state.paymentsMade = 0;
      state.creditsReleased = 0;
    }
    const creditByCategory = new Map<string, Map<string, number>>();
    const cashByCategory = new Map<string, number>();
    const credits: Transaction[] = [];
    const payments: Transaction[] = [];
    const debtTransfers: { from: string; to: string; amount: number }[] = [];
    for (const assignment of budget.assignments.filter(
      (item) => item.month === cursor,
    )) {
      const state = categories.get(assignment.categoryId)!;
      state.assigned = safe(state.assigned + assignment.amount);
      state.available = safe(state.available + assignment.amount);
      const category = getCategory(budget, assignment.categoryId);
      if (category.pairedAccountId)
        accounts.get(category.pairedAccountId)!.reserve = safe(
          accounts.get(category.pairedAccountId)!.reserve + assignment.amount,
        );
    }
    for (const transaction of budget.transactions
      .filter(
        (item) =>
          active(item) && monthOf(item.date) === cursor && item.date <= cutoff,
      )
      .sort(
        (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
      )) {
      const account = getAccount(budget, transaction.accountId);
      if (transaction.status === "pending" && transaction.amount > 0) continue;
      const accountState = accounts.get(account.id)!;
      accountState.balance = safe(accountState.balance + transaction.amount);
      if (transaction.amount < 0)
        accountState.outflows = safe(
          accountState.outflows + transaction.amount,
        );
      else
        accountState.inflows = safe(accountState.inflows + transaction.amount);
      if (account.kind === "tracking") continue;
      if (
        transaction.kind === "transfer" &&
        account.kind === "credit" &&
        transaction.amount > 0
      ) {
        const other = transferCounterparts(budget, transaction)[0];
        if (other && getAccount(budget, other.accountId).kind === "credit")
          debtTransfers.push({
            from: account.id,
            to: other.accountId,
            amount: transaction.amount,
          });
      }
      if (transaction.kind === "statement-credit") {
        credits.push(transaction);
        continue;
      }
      if (transaction.kind === "card-payment") {
        if (account.kind === "credit") payments.push(transaction);
        continue;
      }
      if (transaction.kind === "reimbursement" || transaction.kind === "income")
        continue;
      if (!transaction.categoryId) continue;
      const state = categories.get(transaction.categoryId)!;
      state.activity = safe(state.activity + transaction.amount);
      state.available = safe(state.available + transaction.amount);
      if (account.kind === "cash") {
        state.cashActivity = safe(state.cashActivity + transaction.amount);
        cashByCategory.set(
          transaction.categoryId,
          safe(
            (cashByCategory.get(transaction.categoryId) ?? 0) +
              transaction.amount,
          ),
        );
      } else {
        const cards =
          creditByCategory.get(transaction.categoryId) ??
          new Map<string, number>();
        cards.set(
          account.id,
          safe((cards.get(account.id) ?? 0) - transaction.amount),
        );
        creditByCategory.set(transaction.categoryId, cards);
      }
    }
    const paymentNeeds = new Map<string, number>();
    for (const payment of payments)
      paymentNeeds.set(
        payment.accountId,
        safe((paymentNeeds.get(payment.accountId) ?? 0) + payment.amount),
      );
    const paymentTotals = new Map(paymentNeeds);
    for (const [cardId, needed] of paymentNeeds)
      paymentNeeds.set(
        cardId,
        Math.max(0, needed - accounts.get(cardId)!.reserve),
      );
    const liquidity = new Map<string, number>();
    const purchases: {
      categoryId: string;
      cardId: string;
      remaining: number;
    }[] = [];
    const refunds: { categoryId: string; cardId: string; remaining: number }[] =
      [];
    for (const [categoryId, state] of categories) {
      if (getCategory(budget, categoryId).pairedAccountId) continue;
      liquidity.set(
        categoryId,
        safe(
          state.opening +
            state.assigned +
            (cashByCategory.get(categoryId) ?? 0),
        ),
      );
      for (const [cardId, amount] of creditByCategory.get(categoryId) ?? []) {
        if (amount > 0)
          purchases.push({ categoryId, cardId, remaining: amount });
        if (amount < 0)
          refunds.push({ categoryId, cardId, remaining: -amount });
      }
    }
    let moved = true;
    let pass = 0;
    while (moved) {
      moved = false;
      if (++pass > (purchases.length + refunds.length + 1) * 2)
        fail("Complex circular card refunds require investigation");
      purchases.sort(
        (a, b) =>
          (paymentNeeds.get(b.cardId) ?? 0) -
            (paymentNeeds.get(a.cardId) ?? 0) ||
          a.cardId.localeCompare(b.cardId) ||
          a.categoryId.localeCompare(b.categoryId),
      );
      for (const purchase of purchases) {
        const amount = Math.min(
          purchase.remaining,
          Math.max(0, liquidity.get(purchase.categoryId) ?? 0),
        );
        if (!amount) continue;
        const card = accounts.get(purchase.cardId)!;
        card.reserve = safe(card.reserve + amount);
        card.fundedSpending = safe(card.fundedSpending + amount);
        liquidity.set(
          purchase.categoryId,
          safe(liquidity.get(purchase.categoryId)! - amount),
        );
        purchase.remaining -= amount;
        paymentNeeds.set(
          purchase.cardId,
          Math.max(0, (paymentNeeds.get(purchase.cardId) ?? 0) - amount),
        );
        moved = true;
      }
      for (const refund of refunds) {
        const amount = Math.min(
          refund.remaining,
          Math.max(
            0,
            accounts.get(refund.cardId)!.reserve -
              (paymentTotals.get(refund.cardId) ?? 0),
          ),
        );
        if (!amount) continue;
        const card = accounts.get(refund.cardId)!;
        card.reserve -= amount;
        card.fundedSpending = safe(card.fundedSpending - amount);
        liquidity.set(
          refund.categoryId,
          safe(liquidity.get(refund.categoryId)! + amount),
        );
        refund.remaining -= amount;
        moved = true;
      }
    }
    for (const refund of refunds)
      categories.get(refund.categoryId)!.available = safe(
        categories.get(refund.categoryId)!.available - refund.remaining,
      );
    for (const [categoryId, amount] of liquidity)
      categories.get(categoryId)!.cashOverspending = Math.max(0, -amount);
    for (const transfer of debtTransfers) {
      const from = accounts.get(transfer.from)!;
      const to = accounts.get(transfer.to)!;
      const moved = Math.min(Math.max(0, from.reserve), transfer.amount);
      from.reserve -= moved;
      to.reserve = safe(to.reserve + moved);
    }
    const reserveBeforePayments = new Map(
      [...accounts].map(([id, state]) => [id, state.reserve]),
    );
    for (const payment of payments)
      accounts.get(payment.accountId)!.reserve = safe(
        accounts.get(payment.accountId)!.reserve - payment.amount,
      );
    let paidCashShortfall = 0;
    for (const account of budget.accounts.filter(
      (item) => item.kind === "credit",
    )) {
      const state = accounts.get(account.id)!;
      if (state.reserve < 0) {
        paidCashShortfall = safe(paidCashShortfall - state.reserve);
        state.reserve = 0;
      }
      state.paymentsMade = safe(
        state.reserve - reserveBeforePayments.get(account.id)!,
      );
    }
    for (const [categoryId, state] of categories) {
      if (getCategory(budget, categoryId).pairedAccountId) continue;
      const amount = Math.min(
        paidCashShortfall,
        Math.max(0, -state.available - state.cashOverspending),
      );
      state.cashOverspending = safe(state.cashOverspending + amount);
      paidCashShortfall -= amount;
    }
    for (const credit of credits) {
      const state = accounts.get(credit.accountId)!;
      const reserve = Math.min(state.reserve, Math.max(0, -state.balance));
      state.creditsReleased = safe(
        state.creditsReleased + reserve - state.reserve,
      );
      state.reserve = reserve;
    }
    for (const category of budget.categories)
      if (category.pairedAccountId) {
        const state = categories.get(category.id)!;
        const account = accounts.get(category.pairedAccountId)!;
        state.available = account.reserve;
        state.activity = safe(state.available - state.opening - state.assigned);
      }
    snapshots.set(
      cursor,
      new Map([...categories].map(([id, state]) => [id, { ...state }])),
    );
  }
  for (const account of budget.accounts) {
    const state = accounts.get(account.id)!;
    state.shortfall =
      account.kind === "credit"
        ? Math.max(0, -state.balance - state.reserve)
        : 0;
  }
  const cash = sum(
    budget.accounts
      .filter((account) => account.kind === "cash")
      .map((account) => accounts.get(account.id)!.balance),
  );
  const allocated = sum(
    [...categories.values()].map((state) => Math.max(0, state.available)),
  );
  const currentCashOverspending = sum(
    [...categories.values()].map((state) => state.cashOverspending),
  );
  return {
    cash,
    readyToAssign: safe(cash - allocated + currentCashOverspending),
    accounts,
    categories,
    snapshots,
    startingBalances,
  };
}

// The assign and assign.batch checks, applied to a copy of the book. Returns
// the actor's assignments afterwards.
export function referenceAssign(
  original: Book,
  actorId: string,
  command: Extract<Command, { type: "assign" | "assign.batch" }>,
) {
  const book = structuredClone(original);
  const budget = ownBudget(book, actorId);
  const materialize = referenceMaterialize;
  if (command.type === "assign") {
    getCategory(budget, command.categoryId);
    const state = materialize(book, actorId, command.month);
    if (command.amount > 0 && command.amount > state.readyToAssign)
      fail("Assignments require existing Ready to Assign cash");
    if (
      command.amount < 0 &&
      -command.amount >
        Math.max(0, state.categories.get(command.categoryId)!.available)
    )
      fail("Cannot unassign cash the category does not hold");
    budget.assignments.push({
      id: command.id,
      categoryId: command.categoryId,
      month: command.month,
      amount: command.amount,
    });
    if (command.amount > 0)
      for (const laterMonth of new Set(
        budget.assignments
          .filter((assignment) => assignment.month > command.month)
          .map((assignment) => assignment.month),
      )) {
        if (materialize(book, actorId, laterMonth).readyToAssign < 0)
          fail("This cash is already assigned in a future month");
      }
  } else {
    // Auto-Assign applies every change or none, under the same rules as "assign":
    // money released by the batch can fund its increases, but Ready to Assign
    // never goes negative and no category gives back cash it does not hold.
    const ids = command.changes.map((change) => change.categoryId);
    if (new Set(ids).size !== ids.length)
      fail("Each category can appear only once");
    for (const id of ids) getCategory(budget, id);
    const state = materialize(book, actorId, command.month);
    for (const change of command.changes)
      if (
        change.amount < 0 &&
        -change.amount >
          Math.max(0, state.categories.get(change.categoryId)!.available)
      )
        fail("Cannot unassign cash the category does not hold");
    const increases = command.changes.some((change) => change.amount > 0);
    if (
      increases &&
      state.readyToAssign < sum(command.changes.map((change) => change.amount))
    )
      fail("Assignments require existing Ready to Assign cash");
    command.changes.forEach((change, index) =>
      budget.assignments.push({
        id: `${command.id}:${index}`,
        categoryId: change.categoryId,
        month: command.month,
        amount: change.amount,
      }),
    );
    if (increases)
      for (const laterMonth of new Set(
        budget.assignments
          .filter((assignment) => assignment.month > command.month)
          .map((assignment) => assignment.month),
      )) {
        if (materialize(book, actorId, laterMonth).readyToAssign < 0)
          fail("This cash is already assigned in a future month");
      }
  }
  return budget.assignments;
}
