import type {
  Audit,
  Book,
  Budget,
  Obligation,
  Settlement,
  SharedCategory,
} from "./engine";

export type SharedPurchaseFact = {
  id: string;
  payerId: string;
  sharedCategoryId: string;
  date: string;
  expenseMonth: string;
  amount: number;
  payee: string;
  status: "pending" | "posted";
  shares: Record<string, number>;
};

export type SharedLedgerFacts = {
  version: 1;
  obligations: Obligation[];
  settlements: Settlement[];
  partnerPurchases: SharedPurchaseFact[];
  partnerReceiptDates: Record<string, string>;
  partnerActivityCategoryIds: string[];
};

export type PersonalLedger = SharedLedgerFacts & {
  kind: "personal";
  budget: Budget;
  members: { userId: string; name: string }[];
  sharedCategories: SharedCategory[];
  audit: Audit[];
};

export type AccountingState = Book | PersonalLedger;

export function isPersonalLedger(
  state: AccountingState,
): state is PersonalLedger {
  return "kind" in state && state.kind === "personal";
}

export function ledgerMembers(state: AccountingState) {
  return isPersonalLedger(state)
    ? state.members.map((member) => ({
        userId: member.userId,
        name:
          member.userId === state.budget.userId
            ? state.budget.name
            : member.name,
      }))
    : Object.values(state.budgets).map((budget) => ({
        userId: budget.userId,
        name: budget.name,
      }));
}

function budgetSharedPurchases(budget: Budget): SharedPurchaseFact[] {
  return budget.transactions.flatMap((transaction) =>
    !transaction.removed &&
    transaction.sharedCategoryId &&
    transaction.shares &&
    transaction.amount < 0
      ? [
          {
            id: transaction.id,
            payerId: budget.userId,
            sharedCategoryId: transaction.sharedCategoryId,
            date: transaction.date,
            expenseMonth: transaction.expenseMonth,
            amount: transaction.amount,
            payee: transaction.payee,
            status: transaction.status,
            shares: transaction.shares,
          },
        ]
      : [],
  );
}

export function ledgerSharedPurchases(
  state: AccountingState,
): SharedPurchaseFact[] {
  return isPersonalLedger(state)
    ? state.members.flatMap((member) =>
        member.userId === state.budget.userId
          ? budgetSharedPurchases(state.budget)
          : state.partnerPurchases.filter(
              (purchase) => purchase.payerId === member.userId,
            ),
      )
    : Object.values(state.budgets).flatMap(budgetSharedPurchases);
}

// Reads when settlements were received, indexing each recipient's
// receipts once rather than searching every transaction per settlement.
export function ledgerReceiptDates(
  state: AccountingState,
): (settlement: Settlement) => string | undefined {
  const receipts = new Map<Budget, Map<string, string>>();
  const receiptDate = (budget: Budget, settlementId: string) => {
    let dates = receipts.get(budget);
    if (!dates) {
      dates = new Map();
      for (const transaction of budget.transactions)
        if (
          !transaction.removed &&
          transaction.kind === "reimbursement" &&
          transaction.linkedId !== undefined &&
          !dates.has(transaction.linkedId)
        )
          dates.set(transaction.linkedId, transaction.date);
      receipts.set(budget, dates);
    }
    return dates.get(settlementId);
  };
  return (settlement) => {
    if (settlement.amount === 0) return settlement.date;
    if (
      isPersonalLedger(state) &&
      settlement.recipientId !== state.budget.userId
    )
      return Object.hasOwn(state.partnerReceiptDates, settlement.id)
        ? state.partnerReceiptDates[settlement.id]
        : undefined;
    const budget = isPersonalLedger(state)
      ? state.budget
      : state.budgets[settlement.recipientId];
    return budget && receiptDate(budget, settlement.id);
  };
}

export function ledgerHasSharedActivity(
  state: AccountingState,
  sharedCategoryId: string,
) {
  const ownActivity = (budget: Budget) =>
    budget.transactions.some(
      (transaction) => transaction.sharedCategoryId === sharedCategoryId,
    );
  return isPersonalLedger(state)
    ? ownActivity(state.budget) ||
        state.partnerActivityCategoryIds.includes(sharedCategoryId)
    : Object.values(state.budgets).some(ownActivity);
}

export function projectSharedLedger(
  state: AccountingState,
  userId: string,
): SharedLedgerFacts {
  const sharedIds = new Set(
    state.sharedCategories
      .filter((category) => category.participants.includes(userId))
      .map((category) => category.id),
  );
  const obligations = state.obligations.filter(
    (obligation) =>
      sharedIds.has(obligation.sharedCategoryId) &&
      (obligation.debtorId === userId || obligation.creditorId === userId),
  );
  const obligationIds = new Set(obligations.map((obligation) => obligation.id));
  const settlements = state.settlements.filter(
    (settlement) =>
      settlement.payerId === userId || settlement.recipientId === userId,
  );
  const receiptDate = ledgerReceiptDates(state);
  const partnerActivityCategoryIds = isPersonalLedger(state)
    ? state.partnerActivityCategoryIds
    : Object.values(state.budgets)
        .filter((budget) => budget.userId !== userId)
        .flatMap((budget) =>
          budget.transactions.flatMap((transaction) =>
            transaction.sharedCategoryId ? [transaction.sharedCategoryId] : [],
          ),
        );
  return {
    version: 1,
    obligations: obligations.map((obligation) => ({
      id: obligation.id,
      sharedCategoryId: obligation.sharedCategoryId,
      debtorId: obligation.debtorId,
      creditorId: obligation.creditorId,
      amount: obligation.amount,
      expenseMonth: obligation.expenseMonth,
      transactionId: obligation.transactionId,
      payerId: obligation.payerId,
      payee: obligation.payee,
      date: obligation.date,
      opening: obligation.opening,
    })),
    settlements: settlements.map((settlement) => ({
      id: settlement.id,
      payerId: settlement.payerId,
      recipientId: settlement.recipientId,
      date: settlement.date,
      amount: settlement.amount,
      received: settlement.received,
      allocations: settlement.allocations
        .filter((allocation) => obligationIds.has(allocation.obligationId))
        .map((allocation) => ({
          obligationId: allocation.obligationId,
          amount: allocation.amount,
          kind: allocation.kind,
        })),
    })),
    partnerPurchases: ledgerSharedPurchases(state)
      .filter(
        (purchase) =>
          purchase.payerId !== userId &&
          sharedIds.has(purchase.sharedCategoryId),
      )
      .map((purchase) => ({
        id: purchase.id,
        payerId: purchase.payerId,
        sharedCategoryId: purchase.sharedCategoryId,
        date: purchase.date,
        expenseMonth: purchase.expenseMonth,
        amount: purchase.amount,
        payee: purchase.payee,
        status: purchase.status,
        shares: { ...purchase.shares },
      })),
    partnerReceiptDates: Object.fromEntries(
      settlements.flatMap((settlement) => {
        if (settlement.recipientId === userId) return [];
        const date = receiptDate(settlement);
        return date ? [[settlement.id, date]] : [];
      }),
    ),
    partnerActivityCategoryIds: [
      ...new Set(partnerActivityCategoryIds.filter((id) => sharedIds.has(id))),
    ],
  };
}
