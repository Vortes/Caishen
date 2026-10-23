import {
  addMember,
  createBook,
  executeWithChanges,
  projectBook,
  withCounterpartyAccounts,
  type Book,
  type Command,
  type CommandSource,
} from "../../../src/domain/engine";
import type { ChangeSet } from "../../../src/domain/rows";

// A two-partner household driven through every command type, including the
// changes that reach far from the command: reconciling marks every cleared
// row, editing a loan payment re-adds it under the same id, changing a
// transfer's destination retires the old counterpart, and partner entries
// update both sides of the ledger.

type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;
export type CorpusStep = {
  actorId: string;
  command: Command;
  source: CommandSource;
  before: Book;
  after: Book;
  changeSet: ChangeSet;
};

const start = "2026-01";

export function buildCommandCorpus(): { book: Book; steps: CorpusStep[] } {
  let book = withCounterpartyAccounts(
    addMember(createBook("alex", "Alex", start), "jordan", "Jordan", start),
  );
  const steps: CorpusStep[] = [];
  let sequence = 0;
  const run = (
    actorId: string,
    command: WithoutId<Command> | ((book: Book) => WithoutId<Command>),
    source: CommandSource = "user",
  ) => {
    const input: Command = {
      ...(typeof command === "function" ? command(book) : command),
      id: `corpus-${++sequence}`,
    };
    const { book: after, changeSet } = executeWithChanges(
      book,
      actorId,
      input,
      source,
    );
    steps.push({
      actorId,
      command: input,
      source,
      before: book,
      after,
      changeSet,
    });
    book = after;
    return input.id;
  };
  const alex = (command: Parameters<typeof run>[1], source?: CommandSource) =>
    run("alex", command, source);
  const jordan = (command: Parameters<typeof run>[1]) => run("jordan", command);
  const revision = (userId: string, transactionId: string) =>
    book.budgets[userId]!.transactions.find(
      (transaction) => transaction.id === transactionId,
    )!.revision;
  const purchase = (
    transactionId: string,
    amount: number,
    categoryId: string,
    extra: Partial<Extract<Command, { type: "transaction.upsert" }>> = {},
  ) =>
    ({
      type: "transaction.upsert",
      transactionId,
      accountId: "checking",
      date: "2026-01-05",
      amount,
      payee: transactionId,
      categoryId,
      ...extra,
    }) as const;

  alex({
    type: "account.add",
    accountId: "checking",
    name: "Checking",
    kind: "cash",
    openingBalance: 900_000,
  });
  alex({
    type: "account.add",
    accountId: "savings",
    name: "Savings",
    kind: "cash",
    openingBalance: 50_000,
  });
  alex({
    type: "account.add",
    accountId: "visa",
    name: "Visa",
    kind: "credit",
    openingBalance: -20_000,
  });
  alex({
    type: "account.add",
    accountId: "brokerage",
    name: "Brokerage",
    kind: "tracking",
    openingBalance: 100_000,
  });
  alex({ type: "group.add", name: "Bills" });
  alex({ type: "group.add", name: "Fun" });
  alex({
    type: "category.add",
    categoryId: "rent",
    name: "Rent",
    group: "Bills",
  });
  alex({ type: "category.add", categoryId: "food", name: "Food" });
  alex({
    type: "category.import",
    categories: [
      { categoryId: "dining", name: "Dining", group: "Fun" },
      { categoryId: "travel", name: "Travel", group: "Fun" },
      { categoryId: "food", name: "Food again", group: "Fun" },
    ],
  });
  alex({ type: "assign", categoryId: "rent", month: start, amount: 100_000 });
  alex({
    type: "assign.batch",
    month: start,
    changes: [
      { categoryId: "food", amount: 50_000 },
      { categoryId: "dining", amount: 40_000 },
      { categoryId: "card:visa", amount: 20_000 },
    ],
  });
  alex({
    type: "assign.set",
    categoryId: "food",
    month: start,
    amount: 60_000,
  });
  alex({ type: "assign", categoryId: "rent", month: "2026-02", amount: 5_000 });
  alex({
    type: "target.set",
    categoryId: "rent",
    target: {
      cadence: "monthly",
      behavior: "refill",
      amount: 100_000,
      startMonth: start,
    },
  });
  alex({
    type: "target.set",
    categoryId: "food",
    target: {
      cadence: "monthly",
      behavior: "contribution",
      amount: 30_000,
      startMonth: start,
    },
  });
  alex({
    type: "target.snooze",
    categoryId: "food",
    month: start,
    currentMonth: start,
    snoozed: true,
  });
  alex({ type: "target.set", categoryId: "rent", target: null });
  alex(purchase("groceries", -12_000, "food"));
  alex(purchase("groceries-copy", -12_000, "food"));
  alex({
    ...purchase("cafe", -8_000, "dining"),
    accountId: "visa",
    date: "2026-01-06",
  });
  alex({
    type: "transaction.categorize",
    transactionId: "groceries",
    categoryId: "rent",
  });
  alex({
    type: "transaction.categorize.batch",
    transactionIds: ["groceries", "groceries"],
    categoryId: "food",
  });
  alex({
    type: "transaction.merge",
    transactionId: "groceries",
    duplicateId: "groceries-copy",
  });
  // A receipt split across two categories.
  alex({
    ...purchase("warehouse", -9_000, "food"),
    recordedAt: "2026-01-05T12:00:00Z",
    categoryId: undefined,
    lines: [
      {
        lineId: "warehouse-food",
        categoryId: "food",
        amount: -6_000,
        counterpartyShare: {
          accountId: "counterparty:reimbursements",
          amount: 1_000,
          counterpartyName: "Employer",
        },
      },
      { lineId: "warehouse-fun", categoryId: "dining", amount: -3_000 },
    ],
  });
  alex(purchase("unreviewed", -3_000, "food"), "agent");
  alex({ type: "transaction.approve", transactionIds: ["unreviewed"] });
  alex(purchase("rejected", -2_000, "food"), "provider");
  alex({ type: "transaction.reject", transactionIds: ["rejected"] });
  alex(purchase("mistake", -1_000, "food"));
  alex({ type: "transaction.remove", transactionId: "mistake" });
  alex({
    ...purchase("paycheck", 200_000, "food"),
    categoryId: undefined,
    date: "2026-01-02",
  });
  // A transfer, moved to another account, then made a plain purchase.
  alex({
    type: "transaction.save",
    transactionId: "move",
    accountId: "checking",
    date: "2026-01-07",
    amount: -5_000,
    payee: "Move",
    transferAccountId: "savings",
  });
  alex(() => ({
    type: "transaction.save",
    transactionId: "move",
    accountId: "checking",
    date: "2026-01-07",
    amount: -5_000,
    payee: "Move",
    transferAccountId: "brokerage",
    categoryId: "dining",
    revision: revision("alex", "move") + 1,
  }));
  alex(() => ({
    type: "transaction.save",
    transactionId: "move",
    accountId: "checking",
    date: "2026-01-07",
    amount: -5_000,
    payee: "Move",
    categoryId: "dining",
    revision: revision("alex", "move") + 1,
  }));
  alex({
    type: "card.payment",
    cashAccountId: "checking",
    cardAccountId: "visa",
    date: "2026-01-20",
    amount: 8_000,
  });
  alex({
    type: "card.credit",
    accountId: "visa",
    date: "2026-01-21",
    amount: 500,
  });
  alex({
    type: "card.credit",
    accountId: "visa",
    date: "2026-01-21",
    amount: 500,
    posted: false,
  });
  alex({
    type: "loan.add",
    loanId: "car",
    categoryId: "car-loan",
    name: "Car",
    principal: 1_000_000,
    annualRateBps: 500,
    minimumPayment: 30_000,
    variable: true,
    effectiveDate: "2026-01-01",
  });
  alex({
    type: "loan.rate",
    loanId: "car",
    annualRateBps: 600,
    effectiveDate: "2026-02-01",
  });
  alex({
    type: "assign",
    categoryId: "car-loan",
    month: start,
    amount: 70_000,
  });
  alex({
    type: "loan.payment",
    loanId: "car",
    accountId: "checking",
    date: "2026-01-10",
    principal: 25_000,
    interest: 5_000,
  });
  // A loan payment from the register, then edited, which re-adds it.
  alex({
    type: "transaction.save",
    transactionId: "car-payment",
    accountId: "checking",
    date: "2026-01-12",
    amount: -30_000,
    payee: "Car",
    categoryId: "car-loan",
    loanId: "car",
    interest: 4_000,
  });
  alex({
    type: "loan.payment",
    loanId: "car",
    accountId: "checking",
    date: "2026-01-14",
    principal: 1_000,
    interest: 0,
  });
  alex(() => ({
    type: "transaction.save",
    transactionId: "car-payment",
    accountId: "checking",
    date: "2026-01-12",
    amount: -31_000,
    payee: "Car",
    categoryId: "car-loan",
    loanId: "car",
    interest: 4_000,
    revision: revision("alex", "car-payment") + 1,
  }));
  alex({
    type: "cover",
    fromCategoryId: "dining",
    toCategoryId: "food",
    month: start,
    amount: 1_000,
  });
  alex({ type: "income.expect", month: "2026-02", amount: 300_000 });
  alex({ type: "income.expect", month: "2026-03", amount: 1 });
  alex({ type: "income.expect", month: "2026-03", amount: null });
  alex({
    type: "settings.update",
    name: "Alex B",
    timezone: "America/New_York",
    emailEnabled: false,
    emailHour: 9,
  });
  alex((current) => ({
    type: "account.reconcile",
    accountId: "checking",
    date: "2026-01-31",
    balance: projectBook(current, "alex", start).accounts.find(
      (account) => account.id === "checking",
    )!.cleared,
  }));
  alex((current) => ({
    type: "account.reconcile",
    accountId: "savings",
    date: "2026-01-31",
    balance:
      projectBook(current, "alex", start).accounts.find(
        (account) => account.id === "savings",
      )!.cleared + 100,
    adjustmentId: "savings-interest",
  }));

  // The partner.
  jordan({
    type: "account.add",
    accountId: "checking",
    name: "Joint",
    kind: "cash",
    openingBalance: 400_000,
  });
  jordan({ type: "category.add", categoryId: "household", name: "Household" });
  alex({
    type: "partner.record",
    entryId: "shared-market",
    recordedAt: "2026-01-20T12:00:00Z",
    payerId: "alex",
    date: "2026-01-20",
    payee: "Market",
    amount: 4_000,
    share: 2_000,
    categoryId: "food",
  });
  jordan({
    type: "partner.categorize",
    entryId: "shared-market",
    categoryId: "household",
  });
  jordan({
    type: "partner.edit",
    entryId: "shared-market",
    share: 1_500,
    recordedAt: "2026-01-20T13:00:00Z",
  });
  alex({
    type: "partner.match",
    recordedAt: "2026-01-20T14:00:00Z",
    entryId: "shared-market",
    transactionId: "market-import",
    accountId: "checking",
    date: "2026-01-20",
    amount: -4_000,
    status: "posted",
    providerId: "market-bank-import",
  });
  alex({
    type: "partner.request",
    requestId: "market-request",
    date: "2026-01-20",
    amount: 1_500,
  });
  jordan({
    type: "partner.settle",
    settlementId: "market-settlement",
    method: "Bank transfer",
    legs: [
      {
        userId: "jordan",
        accountId: "checking",
        date: "2026-01-21",
        amount: -1_500,
        payee: "Alex",
      },
      {
        userId: "alex",
        accountId: "checking",
        date: "2026-01-21",
        amount: 1_500,
        payee: "Jordan",
      },
    ],
  });
  alex({
    type: "partner.settlement.confirm",
    settlementId: "market-settlement",
    recordedAt: "2026-01-21T12:00:00Z",
  });
  alex({
    ...purchase("work-supplies", -2_000, "food"),
    recordedAt: "2026-01-22T12:00:00Z",
    date: "2026-01-22",
    counterpartyShare: {
      accountId: "counterparty:reimbursements",
      amount: 1_000,
      counterpartyName: "Employer",
    },
  });
  alex({
    type: "counterparty.receive",
    recordedAt: "2026-01-23T12:00:00Z",
    counterpartyAccountId: "counterparty:reimbursements",
    cashAccountId: "checking",
    date: "2026-01-23",
    amount: 1_000,
    counterpartyName: "Employer",
  });
  return { book, steps };
}
