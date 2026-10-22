import {
  bookSchema,
  splitAmount,
  type Account,
  type Assignment,
  type Audit,
  type Book,
  type Budget,
  type Category,
  type Obligation,
  type Settlement,
  type Target,
  type Transaction,
} from "../../../src/domain/engine";

// Deterministic synthetic households for engine benchmarks and equivalence
// tests. "heavy" books are realistic and internally consistent (no positive
// card balances, Ready to Assign stays positive), so commands against them
// succeed. "edge" books add cross-month cases: back-dated and shuffled
// transactions, expense months that differ from the date month, pending and
// removed rows, card refunds, statement credits, card-to-card transfers,
// overspending, pre-assigned future months, and every target cadence.
export type SyntheticOptions = {
  seed: number;
  startMonth: string;
  months: number;
  transactionsPerMonth: number;
  assignmentsPerMonth: number;
  edge?: boolean;
};

export const MEMBERS = ["alex", "jordan"] as const;

export function monthAfter(month: string, count: number): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + count);
  return date.toISOString().slice(0, 7);
}

function random(seed: number) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  return {
    next,
    int: (min: number, max: number) =>
      min + Math.floor(next() * (max - min + 1)),
    chance: (probability: number) => next() < probability,
    pick: <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)]!,
  };
}

const spendingCategories = [
  "rent",
  "utilities",
  "groceries",
  "dining",
  "transport",
  "subscriptions",
  "health",
  "shopping",
  "insurance",
  "registration",
  "travel",
  "emergency",
  "gifts",
  "pets",
  "kids",
  "education",
  "fitness",
  "books",
  "hobbies",
  "charity",
  "phone",
  "internet",
  "haircuts",
  "household",
  "furniture",
  "electronics",
  "car-repair",
  "parking",
  "vacation",
  "taxes",
];

function targetFor(
  index: number,
  startMonth: string,
  edge: boolean,
): Target | undefined {
  const dueIn = (months: number) => `${monthAfter(startMonth, months)}-15`;
  const base = { startMonth, snoozedMonths: [] as string[] };
  switch (index % (edge ? 9 : 5)) {
    case 0:
      return {
        ...base,
        cadence: "monthly",
        behavior: "refill",
        amount: 40_000,
        snoozedMonths: edge ? [monthAfter(startMonth, 2)] : [],
      };
    case 1:
      return {
        ...base,
        cadence: "yearly",
        behavior: "contribution",
        amount: 120_000,
        dueDate: dueIn(7),
      };
    case 2:
      return {
        ...base,
        cadence: "weekly",
        behavior: "contribution",
        amount: 5_000,
        weekday: 1,
      };
    case 3:
      return {
        ...base,
        cadence: "custom",
        behavior: "refill",
        amount: 60_000,
        dueDate: dueIn(3),
        repeatEvery: 4,
        repeatUnit: "months",
      };
    case 4:
      return undefined;
    case 5:
      return {
        ...base,
        cadence: "custom",
        behavior: "balance",
        amount: 500_000,
        dueDate: dueIn(20),
      };
    case 6:
      return {
        ...base,
        cadence: "custom",
        behavior: "contribution",
        amount: 90_000,
        dueDate: dueIn(5),
        repeatEvery: 1,
        repeatUnit: "years",
      };
    case 7:
      return {
        ...base,
        startMonth: monthAfter(startMonth, 2),
        cadence: "monthly",
        behavior: "contribution",
        amount: 25_000,
        monthDay: 10,
      };
    default:
      return {
        ...base,
        cadence: "yearly",
        behavior: "refill",
        amount: 80_000,
        dueDate: dueIn(1),
      };
  }
}

export function syntheticBook(options: SyntheticOptions): Book {
  const rng = random(options.seed);
  const edge = options.edge ?? false;
  const { startMonth } = options;
  const months = Array.from({ length: options.months }, (_, index) =>
    monthAfter(startMonth, index),
  );
  const audit: Audit[] = [];
  const record = (actorId: string, type: string, payload: unknown) =>
    audit.push({
      id: `op-${audit.length + 1}`,
      actorId,
      source: "user",
      type,
      sequence: audit.length + 1,
      fingerprint: JSON.stringify(payload),
    });
  const obligations: Obligation[] = [];
  const settlements: Settlement[] = [];
  const budgets: Record<string, Budget> = {};
  const sharedPurchases = new Map<string, Transaction[]>();

  for (const userId of MEMBERS) {
    const later = (count: number) => `${monthAfter(startMonth, count)}-01`;
    const accounts: Account[] = [
      {
        id: "checking",
        name: "Checking",
        kind: "cash",
        openingBalance: 800_000,
        date: `${startMonth}-01`,
      },
      {
        id: "savings",
        name: "Savings",
        kind: "cash",
        openingBalance: 2_000_000,
        date: edge ? later(1) : `${startMonth}-01`,
      },
      {
        id: "amex",
        name: "Amex",
        kind: "credit",
        openingBalance: -45_000,
        date: `${startMonth}-01`,
      },
      {
        id: "visa",
        name: "Visa",
        kind: "credit",
        openingBalance: 0,
        date: edge ? later(2) : `${startMonth}-01`,
      },
      {
        id: "brokerage",
        name: "Brokerage",
        kind: "tracking",
        openingBalance: 5_000_000,
        date: `${startMonth}-01`,
      },
    ];
    const categories: Category[] = spendingCategories.map((id, index) => ({
      id,
      name: id,
      group: index < 10 ? "Bills" : index < 20 ? "Everyday" : "Goals",
      target: targetFor(index, startMonth, edge),
    }));
    categories.push(
      { id: "shared-home", name: "Shared home", group: "Shared" },
      {
        id: "card:amex",
        name: "Amex payment",
        group: "Credit card payments",
        pairedAccountId: "amex",
        target: edge
          ? {
              cadence: "card-payoff",
              behavior: "contribution",
              amount: 0,
              startMonth,
              dueDate: `${monthAfter(startMonth, 6)}-01`,
              snoozedMonths: [],
            }
          : undefined,
      },
      {
        id: "card:visa",
        name: "Visa payment",
        group: "Credit card payments",
        pairedAccountId: "visa",
      },
    );
    const transactions: Transaction[] = [];
    const assignments: Assignment[] = [];
    const add = (
      transaction: Omit<
        Transaction,
        "revision" | "reviewed" | "history" | "expenseMonth"
      > & { expenseMonth?: string },
    ) => {
      const full: Transaction = {
        expenseMonth: transaction.date.slice(0, 7),
        ...transaction,
        revision: 1,
        reviewed: true,
        history: [
          {
            revision: 1,
            amount: transaction.amount,
            status: transaction.status,
            date: transaction.date,
            payee: transaction.payee,
            operationId: `${transaction.id}:op`,
            reason: "created",
          },
        ],
      };
      transactions.push(full);
      record(userId, "transaction.upsert", {
        id: full.id,
        amount: full.amount,
        date: full.date,
        payee: full.payee,
      });
      return full;
    };
    const cardSpend = new Map<string, number>([
      ["amex", 0],
      ["visa", 0],
    ]);
    const shared: Transaction[] = [];
    months.forEach((month, monthIndex) => {
      const day = (value: number) =>
        `${month}-${String(value).padStart(2, "0")}`;
      const visaOpen = !edge || monthIndex >= 2;
      // Income lands early in the month.
      for (const [index, amount] of [
        [0, 800_000],
        [1, 800_000],
      ] as const)
        add({
          id: `${userId}-${month}-income-${index}`,
          accountId: "checking",
          date: day(1 + index * 14),
          amount,
          payee: "Payroll",
          status: "posted",
          kind: "income",
        });
      // Last month's card spending is paid in full on the 20th.
      for (const [cardId, spent] of cardSpend) {
        if (spent <= 0) continue;
        const linkedId = `${userId}-${month}-pay-${cardId}`;
        const amount = edge && rng.chance(0.3) ? Math.ceil(spent / 2) : spent;
        add({
          id: `${linkedId}:cash`,
          accountId: "checking",
          date: day(20),
          amount: -amount,
          payee: "Credit card payment",
          status: "posted",
          kind: "card-payment",
          linkedId,
        });
        add({
          id: `${linkedId}:card`,
          accountId: cardId,
          date: day(20),
          amount,
          payee: "Credit card payment",
          status: "posted",
          kind: "card-payment",
          linkedId,
        });
      }
      cardSpend.set("amex", 0);
      cardSpend.set("visa", 0);
      for (let index = 0; index < options.transactionsPerMonth; index++) {
        const accountId = rng.pick(
          visaOpen
            ? (["checking", "amex", "amex", "visa"] as const)
            : (["checking", "amex"] as const),
        );
        const isShared = rng.chance(0.06);
        const categoryId = isShared
          ? "shared-home"
          : rng.pick(spendingCategories);
        let amount = -rng.int(300, edge ? 60_000 : 9_000);
        let kind: Transaction["kind"] = "purchase";
        if (!isShared && accountId !== "checking" && rng.chance(0.03)) {
          amount = rng.int(300, 4_000);
          kind = "refund";
        }
        const date = day(rng.int(1, 28));
        const expenseMonth =
          edge && rng.chance(0.08)
            ? monthAfter(month, rng.pick([-1, 1]))
            : month;
        const pending = edge && rng.chance(0.03);
        const transaction = add({
          id: `${userId}-${month}-${String(index).padStart(4, "0")}`,
          accountId,
          date,
          amount,
          payee: `Merchant ${rng.int(1, 400)}`,
          status: pending ? "pending" : "posted",
          categoryId,
          expenseMonth,
          kind,
          ...(isShared
            ? {
                sharedCategoryId: "home",
                shares: splitAmount(-amount, { alex: 1, jordan: 1 }),
                splitWeights: { alex: 1, jordan: 1 },
              }
            : {}),
          ...(edge && rng.chance(0.01) ? { removed: true } : {}),
        });
        if (isShared && !transaction.removed) shared.push(transaction);
        if (
          accountId !== "checking" &&
          !transaction.removed &&
          !(pending && amount > 0)
        )
          cardSpend.set(accountId, cardSpend.get(accountId)! - amount);
      }
      if (edge) {
        // A statement credit, a card-to-card balance transfer, tracking
        // activity, and a transfer between cash accounts.
        if (monthIndex % 3 === 1) {
          add({
            id: `${userId}-${month}-credit`,
            accountId: "amex",
            date: day(25),
            amount: 1_500,
            payee: "Posted statement credit",
            status: "posted",
            kind: "statement-credit",
          });
          cardSpend.set("amex", cardSpend.get("amex")! - 1_500);
        }
        if (visaOpen && monthIndex % 4 === 3) {
          const linkedId = `${userId}-${month}-balance-transfer`;
          add({
            id: `${linkedId}:from`,
            accountId: "amex",
            date: day(26),
            amount: 10_000,
            payee: "Transfer to Visa",
            status: "posted",
            kind: "transfer",
            linkedId,
          });
          add({
            id: `${linkedId}:to`,
            accountId: "visa",
            date: day(26),
            amount: -10_000,
            payee: "Transfer from Amex",
            status: "posted",
            kind: "transfer",
            linkedId,
          });
          cardSpend.set("amex", cardSpend.get("amex")! - 10_000);
          cardSpend.set("visa", cardSpend.get("visa")! + 10_000);
        }
        add({
          id: `${userId}-${month}-tracking`,
          accountId: "brokerage",
          date: day(28),
          amount: rng.int(-50_000, 50_000),
          payee: "Market change",
          status: "posted",
          kind: "adjustment",
        });
        if (monthIndex >= 1) {
          const linkedId = `${userId}-${month}-savings`;
          add({
            id: `${linkedId}:out`,
            accountId: "checking",
            date: day(5),
            amount: -50_000,
            payee: "Transfer to Savings",
            status: "posted",
            kind: "transfer",
            linkedId,
          });
          add({
            id: `${linkedId}:in`,
            accountId: "savings",
            date: day(5),
            amount: 50_000,
            payee: "Transfer from Checking",
            status: "posted",
            kind: "transfer",
            linkedId,
          });
        }
      }
      for (let index = 0; index < options.assignmentsPerMonth; index++) {
        // Heavy books fund every category generously so card spending is
        // covered and each payment has a reserve; edge books scatter
        // assignments, including releases and card payment categories.
        const categoryId = !edge
          ? spendingCategories[index % spendingCategories.length]!
          : index === 0
            ? rng.pick(["card:amex", "card:visa"])
            : rng.pick(spendingCategories);
        const amount =
          edge && rng.chance(0.1)
            ? -rng.int(100, 2_000)
            : rng.int(edge ? 15_000 : 35_000, edge ? 35_000 : 45_000);
        assignments.push({
          id: `${userId}-${month}-assign-${index}`,
          categoryId,
          month,
          amount,
        });
        record(userId, "assign", { categoryId, month, amount });
      }
    });
    if (edge)
      // Money already assigned in months beyond the last recorded activity.
      for (let ahead = 1; ahead <= 3; ahead++)
        assignments.push({
          id: `${userId}-future-${ahead}`,
          categoryId: "travel",
          month: monthAfter(startMonth, options.months - 1 + ahead),
          amount: 30_000,
        });
    if (edge)
      for (let index = transactions.length - 1; index > 0; index--) {
        const other = Math.floor(rng.next() * (index + 1));
        [transactions[index], transactions[other]] = [
          transactions[other]!,
          transactions[index]!,
        ];
      }
    sharedPurchases.set(userId, shared);
    budgets[userId] = {
      userId,
      name: `${userId} budget`,
      startMonth,
      accounts,
      categories,
      transactions,
      assignments,
      loans: [],
      reimbursements: [],
      settings: {
        timezone: "America/Los_Angeles",
        emailEnabled: true,
        emailHour: 8,
      },
      expectedIncome: { [startMonth]: 1_050_000 },
    };
  }

  for (const [payerId, purchases] of sharedPurchases)
    for (const purchase of purchases)
      for (const [debtorId, amount] of Object.entries(purchase.shares!))
        if (debtorId !== payerId && amount > 0)
          obligations.push({
            id: `shared:${payerId}:${purchase.id}:${debtorId}`,
            sharedCategoryId: "home",
            debtorId,
            creditorId: payerId,
            amount,
            expenseMonth: purchase.expenseMonth,
            transactionId: purchase.id,
            payerId,
            payee: purchase.payee,
            date: purchase.date,
            opening: false,
          });

  const settledAmounts = new Map<string, number>();
  // Each month after the first, whoever owes more on balance settles what
  // they owed through the previous month, offsetting what the other owed.
  months.slice(1).forEach((month, index) => {
    const date = `${month}-03`;
    const settled = (obligation: Obligation) =>
      settledAmounts.get(obligation.id) ?? 0;
    const open = obligations
      .filter((obligation) => obligation.date! < `${month}-01`)
      .map((obligation) => ({
        obligation,
        remaining: obligation.amount - settled(obligation),
      }))
      .filter((item) => item.remaining > 0);
    const owedBy = (debtorId: string) =>
      open.filter((item) => item.obligation.debtorId === debtorId);
    const total = (items: typeof open) =>
      items.reduce((amount, item) => amount + item.remaining, 0);
    const [payerId, recipientId] =
      total(owedBy("jordan")) >= total(owedBy("alex"))
        ? ["jordan", "alex"]
        : ["alex", "jordan"];
    const owed = owedBy(payerId);
    const owing = owedBy(recipientId);
    const offset = total(owing);
    const debt = total(owed);
    if (!debt) return;
    const allocations: Settlement["allocations"] = [];
    let offsetLeft = offset;
    for (const item of owed) {
      const offsetAmount = Math.min(offsetLeft, item.remaining);
      offsetLeft -= offsetAmount;
      if (offsetAmount)
        allocations.push({
          obligationId: item.obligation.id,
          amount: offsetAmount,
          kind: "offset",
        });
      if (item.remaining - offsetAmount)
        allocations.push({
          obligationId: item.obligation.id,
          amount: item.remaining - offsetAmount,
          kind: "payment",
        });
    }
    for (const item of owing)
      allocations.push({
        obligationId: item.obligation.id,
        amount: item.remaining,
        kind: "offset",
      });
    for (const allocation of allocations)
      settledAmounts.set(
        allocation.obligationId,
        (settledAmounts.get(allocation.obligationId) ?? 0) + allocation.amount,
      );
    const id = `settlement-${index}`;
    const amount = debt - offset;
    settlements.push({
      id,
      payerId,
      recipientId,
      date,
      amount,
      received: true,
      allocations,
    });
    const payer = budgets[payerId]!;
    const recipient = budgets[recipientId]!;
    const history = (transaction: Omit<Transaction, "history">) => ({
      ...transaction,
      history: [
        {
          revision: 1,
          amount: transaction.amount,
          status: transaction.status,
          date: transaction.date,
          payee: transaction.payee,
          operationId: transaction.id,
          reason: "created" as const,
        },
      ],
    });
    if (amount) {
      payer.transactions.push(
        history({
          id: `${id}:payment`,
          accountId: "checking",
          date,
          amount: -amount,
          payee: `Settlement with ${recipientId}`,
          status: "posted",
          expenseMonth: month,
          kind: "settlement",
          linkedId: id,
          revision: 1,
          reviewed: true,
        }),
      );
      recipient.transactions.push(
        history({
          id: `${id}:receipt`,
          accountId: "checking",
          date: `${month}-04`,
          amount,
          payee: "Shared settlement received",
          status: "posted",
          expenseMonth: month,
          kind: "reimbursement",
          linkedId: id,
          revision: 1,
          reviewed: true,
        }),
      );
    }
  });

  return bookSchema.parse({
    version: 1,
    budgets,
    sharedCategories: [
      {
        id: "home",
        participants: [...MEMBERS],
        weights: { alex: 1, jordan: 1 },
        categoryIds: { alex: "shared-home", jordan: "shared-home" },
      },
    ],
    obligations,
    settlements,
    audit,
  });
}
