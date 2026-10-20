import { z } from "zod";
import {
  isPersonalLedger,
  ledgerHasSharedActivity,
  ledgerMembers,
  ledgerReceiptDate,
  ledgerSharedPurchases,
  projectSharedLedger,
  type AccountingState,
  type PersonalLedger,
} from "./shared-ledger";

const identifier = z.string().min(1).max(160);
const cents = z.number().int().safe();
const positiveCents = cents.refine(
  (value) => value > 0,
  "Amount must be positive",
);
const nonnegativeCents = cents.refine(
  (value) => value >= 0,
  "Amount cannot be negative",
);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const daySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  .refine(
    (value) =>
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
    "Invalid calendar date",
  );

export const targetSchema = z
  .object({
    cadence: z.enum([
      "weekly",
      "monthly",
      "yearly",
      "custom",
      "card-monthly",
      "card-payoff",
      "loan",
    ]),
    behavior: z.enum(["contribution", "refill", "balance"]),
    amount: nonnegativeCents,
    startMonth: monthSchema,
    dueDate: daySchema.optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    monthDay: z.number().int().min(1).max(31).optional(),
    repeatEvery: z.number().int().min(1).max(120).optional(),
    repeatUnit: z.enum(["months", "years"]).optional(),
    snoozedMonths: z.array(monthSchema).default([]),
  })
  .superRefine((target, context) => {
    if (target.dueDate && monthOf(target.dueDate) < target.startMonth)
      context.addIssue({
        code: "custom",
        message: "Target due date precedes its start month",
      });
    if (
      target.cadence === "custom" &&
      target.behavior !== "balance" &&
      !target.dueDate
    )
      context.addIssue({
        code: "custom",
        message: "Custom spending and contribution targets require a due date",
      });
    if (
      (target.cadence.startsWith("card-") || target.cadence === "loan") &&
      target.behavior !== "contribution"
    )
      context.addIssue({
        code: "custom",
        message: "Paired debt targets use a monthly contribution",
      });
    if (
      (target.cadence === "yearly" || target.cadence === "card-payoff") &&
      !target.dueDate
    )
      context.addIssue({
        code: "custom",
        message: "This target requires a due date",
      });
    if (target.monthDay !== undefined && target.cadence !== "monthly")
      context.addIssue({
        code: "custom",
        message: "Only monthly targets use a day of the month",
      });
    if (target.cadence === "weekly" && target.weekday === undefined)
      context.addIssue({
        code: "custom",
        message: "Weekly targets require a weekday",
      });
    if (target.behavior === "balance" && target.cadence !== "custom")
      context.addIssue({
        code: "custom",
        message: "Balance goals use a custom schedule",
      });
    if (target.behavior === "balance" && target.repeatEvery)
      context.addIssue({
        code: "custom",
        message: "Balance goals cannot repeat",
      });
    if (
      target.repeatEvery &&
      (!target.repeatUnit || target.cadence !== "custom")
    )
      context.addIssue({
        code: "custom",
        message: "Custom repetition requires a month or year interval",
      });
  });
export type Target = z.infer<typeof targetSchema>;

const transactionInput = {
  transactionId: identifier,
  accountId: identifier,
  date: daySchema,
  amount: cents,
  payee: z.string().min(1).max(240),
  categoryId: identifier.optional(),
  status: z.enum(["pending", "posted"]).default("posted"),
  expenseMonth: monthSchema.optional(),
  sharedCategoryId: identifier.optional(),
  shares: z.record(nonnegativeCents).optional(),
  providerId: identifier.optional(),
  revision: z.number().int().nonnegative().optional(),
  reviewed: z.boolean().optional(),
};

export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("account.add"),
    id: identifier,
    accountId: identifier,
    name: z.string().min(1).max(120),
    kind: z.enum(["cash", "credit"]),
    openingBalance: cents,
    date: daySchema.optional(),
  }),
  z.object({
    type: z.literal("category.add"),
    id: identifier,
    categoryId: identifier,
    name: z.string().min(1).max(120),
    group: z.string().max(120).default("Everyday"),
  }),
  z.object({
    type: z.literal("category.import"),
    id: identifier,
    categories: z
      .array(
        z.object({
          categoryId: identifier,
          name: z.string().min(1).max(120),
          group: z.string().max(120).default("Imported"),
        }),
      )
      .max(500),
  }),
  z.object({
    type: z.literal("assign"),
    id: identifier,
    categoryId: identifier,
    month: monthSchema,
    amount: cents,
  }),
  z.object({
    type: z.literal("assign.batch"),
    id: identifier,
    month: monthSchema,
    changes: z
      .array(z.object({ categoryId: identifier, amount: cents }))
      .min(1)
      .max(500),
  }),
  z.object({
    type: z.literal("cover"),
    id: identifier,
    fromCategoryId: identifier,
    toCategoryId: identifier,
    month: monthSchema,
    amount: positiveCents,
    ruleId: identifier.optional(),
  }),
  z.object({
    type: z.literal("rule.set"),
    id: identifier,
    ruleId: identifier,
    fromCategoryId: identifier,
    toCategoryId: identifier,
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal("target.set"),
    id: identifier,
    categoryId: identifier,
    target: targetSchema.nullable(),
  }),
  z.object({
    type: z.literal("target.snooze"),
    id: identifier,
    categoryId: identifier,
    month: monthSchema,
    currentMonth: monthSchema,
    snoozed: z.boolean(),
  }),
  z.object({
    type: z.literal("transaction.upsert"),
    id: identifier,
    ...transactionInput,
  }),
  z.object({
    type: z.literal("transaction.remove"),
    id: identifier,
    transactionId: identifier,
  }),
  z.object({
    type: z.literal("transaction.approve"),
    id: identifier,
    transactionIds: z.array(identifier).min(1).max(500),
  }),
  z.object({
    type: z.literal("transaction.categorize"),
    id: identifier,
    transactionId: identifier,
    categoryId: identifier,
  }),
  z.object({
    type: z.literal("transaction.merge"),
    id: identifier,
    transactionId: identifier,
    duplicateId: identifier,
  }),
  z.object({
    type: z.literal("shared.create"),
    id: identifier,
    sharedCategoryId: identifier,
    participants: z.array(identifier).length(2),
    weights: z.record(z.number().int().min(0).max(10000)),
    categoryIds: z.record(identifier),
  }),
  z.object({
    type: z.literal("shared.rule"),
    id: identifier,
    sharedCategoryId: identifier,
    weights: z.record(z.number().int().min(0).max(10000)),
  }),
  z.object({
    type: z.literal("shared.remove"),
    id: identifier,
    sharedCategoryId: identifier,
  }),
  z.object({
    type: z.literal("opening.add"),
    id: identifier,
    obligationId: identifier,
    sharedCategoryId: identifier,
    debtorId: identifier,
    creditorId: identifier,
    amount: positiveCents,
  }),
  z.object({
    type: z.literal("settlement.record"),
    id: identifier,
    settlementId: identifier,
    otherUserId: identifier,
    date: daySchema,
    accountId: identifier.optional(),
    amount: nonnegativeCents,
  }),
  z.object({
    type: z.literal("settlement.receive"),
    id: identifier,
    settlementId: identifier,
    accountId: identifier,
    date: daySchema,
  }),
  z.object({
    type: z.literal("reimbursement.expect"),
    id: identifier,
    reimbursementId: identifier,
    transactionId: identifier,
    name: z.string().min(1).max(120),
    amount: positiveCents,
    kind: z.enum(["cash", "statement-credit"]),
  }),
  z.object({
    type: z.literal("reimbursement.receive"),
    id: identifier,
    reimbursementId: identifier,
    accountId: identifier,
    date: daySchema,
    amount: positiveCents,
  }),
  z.object({
    type: z.literal("card.payment"),
    id: identifier,
    cashAccountId: identifier,
    cardAccountId: identifier,
    date: daySchema,
    amount: positiveCents,
  }),
  z.object({
    type: z.literal("card.credit"),
    id: identifier,
    accountId: identifier,
    date: daySchema,
    amount: positiveCents,
    reimbursementId: identifier.optional(),
    posted: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("loan.add"),
    id: identifier,
    loanId: identifier,
    categoryId: identifier,
    name: z.string().min(1).max(120),
    principal: nonnegativeCents,
    annualRateBps: z.number().int().min(0).max(100000),
    minimumPayment: positiveCents,
    variable: z.boolean(),
    effectiveDate: daySchema,
  }),
  z.object({
    type: z.literal("loan.rate"),
    id: identifier,
    loanId: identifier,
    annualRateBps: z.number().int().min(0).max(100000),
    effectiveDate: daySchema,
  }),
  z.object({
    type: z.literal("loan.payment"),
    id: identifier,
    loanId: identifier,
    accountId: identifier,
    date: daySchema,
    principal: nonnegativeCents,
    interest: nonnegativeCents,
  }),
  z.object({
    type: z.literal("income.expect"),
    id: identifier,
    month: monthSchema,
    amount: nonnegativeCents.nullable(),
  }),
  z.object({
    type: z.literal("settings.update"),
    id: identifier,
    name: z.string().min(1).max(120).optional(),
    timezone: z.string().min(1).max(100).optional(),
    emailEnabled: z.boolean().optional(),
    emailHour: z.number().int().min(0).max(23).optional(),
  }),
]);
export type Command = z.input<typeof commandSchema>;
type ParsedCommand = z.output<typeof commandSchema>;

export type Account = {
  id: string;
  name: string;
  kind: "cash" | "credit";
  openingBalance: number;
  date: string;
};
export type Category = {
  id: string;
  name: string;
  group: string;
  target?: Target;
  pairedAccountId?: string;
  pairedLoanId?: string;
};
export type TransactionHistory = {
  revision: number;
  amount: number;
  status: "pending" | "posted";
  date: string;
  payee: string;
  operationId: string;
  reason:
    | "created"
    | "updated"
    | "categorized"
    | "merged"
    | "removed"
    | "undone"
    | "redone";
  combinedId?: string;
};
export type Transaction = {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  payee: string;
  status: "pending" | "posted";
  categoryId?: string;
  expenseMonth: string;
  sharedCategoryId?: string;
  shares?: Record<string, number>;
  splitWeights?: Record<string, number>;
  providerId?: string;
  revision: number;
  reviewed: boolean;
  kind:
    | "purchase"
    | "income"
    | "refund"
    | "card-payment"
    | "loan-payment"
    | "reimbursement"
    | "settlement"
    | "statement-credit";
  linkedId?: string;
  removed?: boolean;
  history: TransactionHistory[];
};
export type Assignment = {
  id: string;
  categoryId: string;
  month: string;
  amount: number;
};
export type Loan = {
  id: string;
  name: string;
  categoryId: string;
  principal: number;
  minimumPayment: number;
  variable: boolean;
  rates: { effectiveDate: string; annualRateBps: number }[];
  payments: { id: string; date: string; principal: number; interest: number }[];
};
export type Reimbursement = {
  id: string;
  transactionId: string;
  name: string;
  amount: number;
  kind: "cash" | "statement-credit";
  receipts: { id: string; date: string; amount: number }[];
};
export type Budget = {
  userId: string;
  name: string;
  startMonth: string;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  assignments: Assignment[];
  loans: Loan[];
  reimbursements: Reimbursement[];
  rules: {
    id: string;
    fromCategoryId: string;
    toCategoryId: string;
    enabled: boolean;
  }[];
  settings: { timezone: string; emailEnabled: boolean; emailHour: number };
  expectedIncome: Record<string, number>;
};
export type SharedCategory = {
  id: string;
  participants: string[];
  weights: Record<string, number>;
  categoryIds: Record<string, string>;
};
export type Obligation = {
  id: string;
  sharedCategoryId: string;
  debtorId: string;
  creditorId: string;
  amount: number;
  expenseMonth?: string;
  transactionId?: string;
  payerId?: string;
  payee?: string;
  date?: string;
  opening: boolean;
};
export type Settlement = {
  id: string;
  payerId: string;
  recipientId: string;
  date: string;
  amount: number;
  received: boolean;
  allocations: {
    obligationId: string;
    amount: number;
    kind: "payment" | "offset";
  }[];
};
export type Audit = {
  id: string;
  actorId: string;
  source: "user" | "agent";
  type: string;
  sequence: number;
  fingerprint: string;
};
export type Book = {
  version: 1;
  budgets: Record<string, Budget>;
  sharedCategories: SharedCategory[];
  obligations: Obligation[];
  settlements: Settlement[];
  audit: Audit[];
};

const storedIdentifier = z.string().min(1).max(1024);
const historySchema = z.object({
  revision: z.number().int().nonnegative(),
  amount: cents,
  status: z.enum(["pending", "posted"]),
  date: daySchema,
  payee: z.string(),
  operationId: storedIdentifier,
  reason: z.enum([
    "created",
    "updated",
    "categorized",
    "merged",
    "removed",
    "undone",
    "redone",
  ]),
  combinedId: storedIdentifier.optional(),
});
const transactionSchema = z.object({
  id: storedIdentifier,
  accountId: storedIdentifier,
  date: daySchema,
  amount: cents,
  payee: z.string(),
  status: z.enum(["pending", "posted"]),
  categoryId: storedIdentifier.optional(),
  expenseMonth: monthSchema,
  sharedCategoryId: storedIdentifier.optional(),
  shares: z.record(nonnegativeCents).optional(),
  splitWeights: z.record(nonnegativeCents).optional(),
  providerId: storedIdentifier.optional(),
  revision: z.number().int().nonnegative(),
  reviewed: z.boolean(),
  kind: z.enum([
    "purchase",
    "income",
    "refund",
    "card-payment",
    "loan-payment",
    "reimbursement",
    "settlement",
    "statement-credit",
  ]),
  linkedId: storedIdentifier.optional(),
  removed: z.boolean().optional(),
  history: z.array(historySchema),
});
const loanSchema = z.object({
  id: storedIdentifier,
  name: z.string(),
  categoryId: storedIdentifier,
  principal: nonnegativeCents,
  minimumPayment: positiveCents,
  variable: z.boolean(),
  rates: z
    .array(
      z.object({
        effectiveDate: daySchema,
        annualRateBps: z.number().int().min(0).max(100000),
      }),
    )
    .min(1),
  payments: z.array(
    z.object({
      id: storedIdentifier,
      date: daySchema,
      principal: nonnegativeCents,
      interest: nonnegativeCents,
    }),
  ),
});
const budgetSchema = z.object({
  userId: storedIdentifier,
  name: z.string(),
  startMonth: monthSchema,
  accounts: z.array(
    z.object({
      id: storedIdentifier,
      name: z.string(),
      kind: z.enum(["cash", "credit"]),
      openingBalance: cents,
      date: daySchema,
    }),
  ),
  categories: z.array(
    z.object({
      id: storedIdentifier,
      name: z.string(),
      group: z.string(),
      target: targetSchema.optional(),
      pairedAccountId: storedIdentifier.optional(),
      pairedLoanId: storedIdentifier.optional(),
    }),
  ),
  transactions: z.array(transactionSchema),
  assignments: z.array(
    z.object({
      id: storedIdentifier,
      categoryId: storedIdentifier,
      month: monthSchema,
      amount: cents,
    }),
  ),
  loans: z.array(loanSchema),
  reimbursements: z.array(
    z.object({
      id: storedIdentifier,
      transactionId: storedIdentifier,
      name: z.string(),
      amount: positiveCents,
      kind: z.enum(["cash", "statement-credit"]),
      receipts: z.array(
        z.object({
          id: storedIdentifier,
          date: daySchema,
          amount: positiveCents,
        }),
      ),
    }),
  ),
  rules: z.array(
    z.object({
      id: storedIdentifier,
      fromCategoryId: storedIdentifier,
      toCategoryId: storedIdentifier,
      enabled: z.boolean(),
    }),
  ),
  settings: z.object({
    timezone: z.string(),
    emailEnabled: z.boolean(),
    emailHour: z.number().int().min(0).max(23),
  }),
  expectedIncome: z.record(monthSchema, nonnegativeCents).default({}),
});
export const bookSchema: z.ZodType<Book, z.ZodTypeDef, unknown> = z
  .object({
    version: z.literal(1),
    budgets: z.record(budgetSchema),
    sharedCategories: z.array(
      z.object({
        id: storedIdentifier,
        participants: z.array(storedIdentifier).length(2),
        weights: z.record(nonnegativeCents),
        categoryIds: z.record(storedIdentifier),
      }),
    ),
    obligations: z.array(
      z.object({
        id: storedIdentifier,
        sharedCategoryId: storedIdentifier,
        debtorId: storedIdentifier,
        creditorId: storedIdentifier,
        amount: positiveCents,
        expenseMonth: monthSchema.optional(),
        transactionId: storedIdentifier.optional(),
        payerId: storedIdentifier.optional(),
        payee: z.string().optional(),
        date: daySchema.optional(),
        opening: z.boolean(),
      }),
    ),
    settlements: z.array(
      z.object({
        id: storedIdentifier,
        payerId: storedIdentifier,
        recipientId: storedIdentifier,
        date: daySchema,
        amount: nonnegativeCents,
        received: z.boolean(),
        allocations: z.array(
          z.object({
            obligationId: storedIdentifier,
            amount: positiveCents,
            kind: z.enum(["payment", "offset"]),
          }),
        ),
      }),
    ),
    audit: z.array(
      z.object({
        id: storedIdentifier,
        actorId: storedIdentifier,
        source: z.enum(["user", "agent"]),
        type: z.string(),
        sequence: z.number().int().positive(),
        fingerprint: z.string(),
      }),
    ),
  })
  .superRefine((book, context) => {
    const members = Object.entries(book.budgets);
    if (
      members.length < 1 ||
      members.length > 2 ||
      members.some(([id, budget]) => budget.userId !== id)
    )
      context.addIssue({
        code: "custom",
        message: "Invalid household membership",
      });
    for (const [, budget] of members) {
      for (const collection of [
        budget.accounts,
        budget.categories,
        budget.transactions,
        budget.loans,
        budget.reimbursements,
      ])
        if (
          new Set(collection.map((item) => item.id)).size !== collection.length
        )
          context.addIssue({
            code: "custom",
            message: "Duplicate ledger storedIdentifier",
          });
      if (
        budget.transactions.some(
          (transaction) =>
            !transaction.removed &&
            (!budget.accounts.some(
              (account) => account.id === transaction.accountId,
            ) ||
              (transaction.categoryId &&
                !budget.categories.some(
                  (category) => category.id === transaction.categoryId,
                ))),
        )
      )
        context.addIssue({
          code: "custom",
          message: "Invalid transaction reference",
        });
      if (
        budget.assignments.some(
          (assignment) =>
            !budget.categories.some(
              (category) => category.id === assignment.categoryId,
            ),
        )
      )
        context.addIssue({
          code: "custom",
          message: "Invalid assignment reference",
        });
    }
    if (
      book.sharedCategories.some((shared) =>
        shared.participants.some(
          (id) =>
            !book.budgets[id]?.categories.some(
              (category) => category.id === shared.categoryIds[id],
            ),
        ),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Invalid shared category reference",
      });
  });
export const parseBook = (input: unknown): Book => bookSchema.parse(input);
export class AccountingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountingError";
  }
}
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
const memberName = (book: AccountingState, userId: string): string =>
  ledgerMembers(book).find((member) => member.userId === userId)?.name ??
  fail("Household member access denied");
const getAccount = (budget: Budget, id: string): Account =>
  budget.accounts.find((account) => account.id === id) ??
  fail("Account access denied");
const getCategory = (budget: Budget, id: string): Category =>
  budget.categories.find((category) => category.id === id) ??
  fail("Category access denied");
const getTransaction = (budget: Budget, id: string): Transaction =>
  budget.transactions.find(
    (transaction) => transaction.id === id && !transaction.removed,
  ) ?? fail("Transaction access denied");

export function createBook(userId: string, name: string, month: string): Book {
  identifier.parse(userId);
  monthSchema.parse(month);
  return {
    version: 1,
    budgets: {
      [userId]: {
        userId,
        name,
        startMonth: month,
        accounts: [],
        categories: [],
        transactions: [],
        assignments: [],
        loans: [],
        reimbursements: [],
        rules: [],
        settings: {
          timezone: "America/Los_Angeles",
          emailEnabled: true,
          emailHour: 8,
        },
        expectedIncome: {},
      },
    },
    sharedCategories: [],
    obligations: [],
    settlements: [],
    audit: [],
  };
}

export function addMember(
  book: Book,
  userId: string,
  name: string,
  month: string,
): Book {
  if (book.budgets[userId]) return structuredClone(book);
  if (Object.keys(book.budgets).length >= 2)
    fail("A household supports two members");
  return {
    ...structuredClone(book),
    budgets: {
      ...structuredClone(book.budgets),
      ...createBook(userId, name, month).budgets,
    },
  };
}

export function mergeBooks(
  book: Book,
  joining: Book,
  userId = Object.keys(joining.budgets)[0] ?? "",
): Book {
  if (Object.keys(joining.budgets).length !== 1 || !joining.budgets[userId])
    fail("Only a personal budget can join a household");
  if (Object.keys(book.budgets).length >= 2 || book.budgets[userId])
    fail("Household is already full");
  if (
    joining.sharedCategories.length ||
    joining.obligations.length ||
    joining.settlements.length
  )
    fail("Resolve the existing household before joining another");
  const result = structuredClone(book);
  result.budgets[userId] = structuredClone(ownBudget(joining, userId));
  result.audit.push(
    ...joining.audit.map((entry) => ({
      ...entry,
      sequence: result.audit.length + entry.sequence,
    })),
  );
  return result;
}

export function splitAmount(
  amount: number,
  weights: Record<string, number>,
): Record<string, number> {
  nonnegativeCents.parse(amount);
  const entries = Object.entries(weights).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (
    !entries.length ||
    entries.some(([, weight]) => !Number.isSafeInteger(weight) || weight < 0)
  )
    fail("Invalid split weights");
  const denominator = sum(entries.map(([, weight]) => weight));
  if (denominator <= 0) fail("At least one split weight must be positive");
  const parts = entries.map(([id, weight]) => {
    const numerator = BigInt(amount) * BigInt(weight);
    return {
      id,
      value: Number(numerator / BigInt(denominator)),
      remainder: numerator % BigInt(denominator),
    };
  });
  let remaining = amount - sum(parts.map((part) => part.value));
  const byRemainder = [...parts].sort((a, b) =>
    a.remainder === b.remainder
      ? a.id.localeCompare(b.id)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const part of byRemainder) if (remaining-- > 0) part.value += 1;
  return Object.fromEntries(parts.map((part) => [part.id, part.value]));
}

const active = (transaction: Transaction): boolean => !transaction.removed;
function sharedAccess(
  book: AccountingState,
  actorId: string,
  sharedId: string,
): SharedCategory {
  const shared = book.sharedCategories.find(
    (category) => category.id === sharedId,
  );
  return shared?.participants.includes(actorId)
    ? shared
    : fail("Shared category access denied");
}
function validateWeights(
  participants: string[],
  weights: Record<string, number>,
): void {
  if (
    new Set(participants).size !== 2 ||
    Object.keys(weights).length !== 2 ||
    participants.some((id) => weights[id] === undefined) ||
    sum(Object.values(weights)) <= 0
  )
    fail("A split must include both participants and positive total weight");
}

function synchronizeObligations(book: AccountingState): void {
  const generated: Obligation[] = [];
  for (const transaction of ledgerSharedPurchases(book))
    for (const [debtorId, amount] of Object.entries(transaction.shares))
      if (debtorId !== transaction.payerId && amount > 0)
        generated.push({
          id: `shared:${transaction.payerId}:${transaction.id}:${debtorId}`,
          sharedCategoryId: transaction.sharedCategoryId,
          debtorId,
          creditorId: transaction.payerId,
          amount,
          expenseMonth: transaction.expenseMonth,
          transactionId: transaction.id,
          payerId: transaction.payerId,
          payee: transaction.payee,
          date: transaction.date,
          opening: false,
        });
  const all = [
    ...book.obligations.filter((obligation) => obligation.opening),
    ...generated,
  ];
  for (const settlement of book.settlements)
    for (const allocation of settlement.allocations) {
      const obligation =
        all.find((item) => item.id === allocation.obligationId) ??
        fail(
          "A settled expense cannot be removed; investigate the correction first",
        );
      if (obligation.date && obligation.date > settlement.date)
        fail("A settled expense cannot move after its recorded settlement");
      if (
        sum(
          book.settlements.flatMap((item) =>
            item.allocations
              .filter((part) => part.obligationId === obligation.id)
              .map((part) => part.amount),
          ),
        ) > obligation.amount
      )
        fail("The corrected expense would invalidate a recorded settlement");
    }
  book.obligations = all;
}

export function outstanding(
  book: AccountingState,
  obligation: Obligation,
  cutoff?: string,
): number {
  return safe(
    obligation.amount -
      sum(
        book.settlements
          .filter((settlement) => !cutoff || settlement.date <= cutoff)
          .flatMap((settlement) =>
            settlement.allocations
              .filter((allocation) => allocation.obligationId === obligation.id)
              .map((allocation) => allocation.amount),
          ),
      ),
  );
}

type CategoryMonth = {
  assigned: number;
  activity: number;
  available: number;
  opening: number;
  cashOverspending: number;
  cashActivity: number;
  settlementActivity: number;
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
type Materialized = {
  cash: number;
  readyToAssign: number;
  accounts: Map<string, AccountMonth>;
  categories: Map<string, CategoryMonth>;
  snapshots: Map<string, Map<string, CategoryMonth>>;
  startingBalances: Map<string, number>;
};

function materialize(
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
        settlementActivity: 0,
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
      state.settlementActivity = 0;
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
      if (transaction.kind === "settlement") continue;
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
    for (const settlement of book.settlements.filter(
      (item) => monthOf(item.date) === cursor && item.date <= cutoff,
    ))
      for (const allocation of settlement.allocations) {
        const obligation = book.obligations.find(
          (item) => item.id === allocation.obligationId,
        )!;
        if (obligation.debtorId !== userId) continue;
        const categoryId = sharedAccess(
          book,
          userId,
          obligation.sharedCategoryId,
        ).categoryIds[userId]!;
        const state = categories.get(categoryId)!;
        const consumed =
          allocation.kind === "offset"
            ? Math.min(allocation.amount, Math.max(0, state.available))
            : allocation.amount;
        state.activity = safe(state.activity - consumed);
        state.available = safe(state.available - consumed);
        state.settlementActivity = safe(state.settlementActivity - consumed);
        if (allocation.kind === "payment")
          cashByCategory.set(
            categoryId,
            safe((cashByCategory.get(categoryId) ?? 0) - consumed),
          );
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

// Up to 12 budget months before this one, oldest first, for Auto-Assign's last-month
// and average options. Empty in a budget's first month. Spent counts outflows net of
// refunds, never below zero.
function categoryHistory(
  snapshots: Map<string, Map<string, CategoryMonth>>,
  categoryId: string,
  month: string,
) {
  const months = [...snapshots]
    .filter(([key]) => key < month)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, categories]) => categories.get(categoryId) ?? [])
    .slice(-12);
  return {
    assigned: months.map((state) => state.assigned),
    spent: months.map((state) => Math.max(0, -state.activity)),
  };
}

export type TargetProgress = {
  needed: number;
  // What the target asks to assign this month, regardless of what's assigned. Auto-Assign
  // reads overfunding from it.
  required: number;
  funded: number;
  total: number;
  snoozed: boolean;
  dueMonth?: string;
  monthsRemaining: number;
};
function targetProgress(
  target: Target,
  category: Category,
  state: CategoryMonth,
  month: string,
  currentMonth: string,
  snapshots: Map<string, Map<string, CategoryMonth>>,
  balance: number,
  startingBalance: number,
  loan?: Loan,
): TargetProgress {
  const snoozed = target.snoozedMonths.includes(month);
  let total = target.amount;
  let funded = Math.max(0, state.assigned);
  let monthsRemaining = 1;
  let dueMonth = target.dueDate ? monthOf(target.dueDate) : undefined;
  let periodStart = target.startMonth;
  if (month < target.startMonth)
    return {
      needed: 0,
      required: 0,
      funded: 0,
      total,
      snoozed,
      dueMonth,
      monthsRemaining: 0,
    };
  if (target.cadence === "weekly") {
    const date = new Date(`${month}-01T00:00:00Z`);
    let days = 0;
    while (monthOf(date.toISOString()) === month) {
      if (date.getUTCDay() === target.weekday) days++;
      date.setUTCDate(date.getUTCDate() + 1);
    }
    total = safe(total * days);
  }
  if (target.cadence === "yearly" || target.cadence === "custom") {
    const interval =
      target.cadence === "yearly"
        ? 12
        : target.repeatEvery
          ? target.repeatEvery * (target.repeatUnit === "years" ? 12 : 1)
          : 0;
    while (dueMonth && month > dueMonth && interval > 0) {
      periodStart = nextMonth(dueMonth);
      dueMonth = nextMonth(dueMonth, interval);
    }
    if (dueMonth && month > dueMonth)
      return {
        needed: 0,
        required: 0,
        funded,
        total,
        snoozed,
        dueMonth,
        monthsRemaining: 0,
      };
    monthsRemaining = dueMonth
      ? Math.max(1, monthDistance(month, dueMonth) + 1)
      : 1;
    const previousAssigned = sum(
      [...snapshots]
        .filter(([key]) => key >= periodStart && key < month)
        .map(([, categories]) => categories.get(category.id)?.assigned ?? 0),
    );
    const openingOfPeriod =
      snapshots.get(periodStart)?.get(category.id)?.opening ?? 0;
    const carried =
      target.behavior === "refill" && month <= currentMonth
        ? Math.max(0, openingOfPeriod)
        : 0;
    if (target.behavior === "balance") {
      funded = Math.max(0, state.available);
      const required = Math.max(
        0,
        Math.ceil(
          (total - Math.max(0, state.available - state.assigned)) /
            monthsRemaining,
        ),
      );
      const needed = Math.max(0, required - state.assigned);
      return {
        needed: snoozed ? 0 : needed,
        required,
        funded,
        total,
        snoozed,
        dueMonth,
        monthsRemaining,
      };
    }
    const remainingAtStart = Math.max(0, total - previousAssigned - carried);
    const required = Math.ceil(remainingAtStart / monthsRemaining);
    const needed = Math.max(0, required - state.assigned);
    funded = Math.max(0, safe(previousAssigned + state.assigned + carried));
    return {
      needed: snoozed ? 0 : needed,
      required,
      funded,
      total,
      snoozed,
      dueMonth,
      monthsRemaining,
    };
  }
  if (target.cadence === "card-payoff") {
    monthsRemaining = dueMonth
      ? Math.max(1, monthDistance(month, dueMonth) + 1)
      : 1;
    total = Math.max(0, -balance);
    funded = Math.max(0, state.available);
    const required = Math.ceil(
      Math.max(0, -startingBalance - state.opening) / monthsRemaining,
    );
    return {
      needed: Math.max(0, required - state.assigned),
      required,
      funded,
      total,
      snoozed: false,
      dueMonth,
      monthsRemaining,
    };
  }
  if (target.cadence === "loan" && loan)
    total = plannedLoanPayment(loan, month, target);
  if (target.behavior === "refill")
    funded = Math.max(
      0,
      state.assigned + (month <= currentMonth ? state.opening : 0),
    );
  return {
    needed: snoozed ? 0 : Math.max(0, total - funded),
    // Refill targets count money carried in, so only the rest must be assigned.
    required: Math.max(0, safe(total - funded + Math.max(0, state.assigned))),
    funded,
    total,
    snoozed,
    dueMonth,
    monthsRemaining,
  };
}

export type Forecast = {
  months: number | null;
  payoffMonth: string | null;
  interest: number | null;
  payment: number;
  rateBps: number;
  assumption: string;
};
function monthlyInterest(principal: number, rateBps: number): number {
  return safe(Number((BigInt(principal) * BigInt(rateBps) + 60000n) / 120000n));
}
export function plannedLoanPayment(
  loan: Loan,
  month: string,
  target?: Target,
): number {
  if (target?.cadence !== "loan") return loan.minimumPayment;
  if (!target.dueDate) return target.amount;
  const months = Math.max(1, monthDistance(month, monthOf(target.dueDate)) + 1);
  if (months > 1200) fail("Payoff date is too far in the future");
  const rate =
    [...loan.rates]
      .filter((entry) => entry.effectiveDate <= endOf(month))
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]
      ?.annualRateBps ?? 0;
  const principal = Math.max(
    0,
    loan.principal -
      sum(
        loan.payments
          .filter((payment) => monthOf(payment.date) < month)
          .map((payment) => payment.principal),
      ),
  );
  let lower = 0;
  let upper = safe(principal + monthlyInterest(principal, rate));
  while (lower < upper) {
    const payment = lower + Math.floor((upper - lower) / 2);
    let remaining = principal;
    for (let period = 0; period < months && remaining > 0; period++) {
      const interest = monthlyInterest(remaining, rate);
      if (payment <= interest) break;
      remaining = Math.max(0, safe(remaining - (payment - interest)));
    }
    if (remaining === 0) upper = payment;
    else lower = payment + 1;
  }
  return lower;
}
export function forecastLoan(loan: Loan, month: string, extra = 0): Forecast {
  nonnegativeCents.parse(extra);
  const rate =
    [...loan.rates]
      .filter((item) => item.effectiveDate <= endOf(month))
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]
      ?.annualRateBps ?? 0;
  let principal = Math.max(
    0,
    loan.principal -
      sum(
        loan.payments
          .filter((payment) => payment.date <= endOf(month))
          .map((payment) => payment.principal),
      ) -
      extra,
  );
  let interestTotal = 0;
  let months = 0;
  while (principal > 0 && months < 1200) {
    const interest = monthlyInterest(principal, rate);
    if (loan.minimumPayment <= interest)
      return {
        months: null,
        payoffMonth: null,
        interest: null,
        payment: loan.minimumPayment,
        rateBps: rate,
        assumption: "Payment does not cover estimated monthly interest",
      };
    const principalPayment = Math.min(
      principal,
      loan.minimumPayment - interest,
    );
    principal -= principalPayment;
    interestTotal = safe(interestTotal + interest);
    months++;
  }
  return {
    months: principal > 0 ? null : months,
    payoffMonth: principal > 0 ? null : nextMonth(month, months),
    interest: principal > 0 ? null : interestTotal,
    payment: loan.minimumPayment,
    rateBps: rate,
    assumption: loan.variable
      ? "Latest confirmed variable rate held constant; monthly amortization estimate, not lender charges"
      : "Fixed confirmed rate; monthly amortization estimate, not lender charges",
  };
}

/**
 * The month's shared balance as a statement built from recorded activity.
 * Every effect is signed from the viewer's side: positive adds to what they
 * owe their partner, negative adds to what their partner owes them. Offsets
 * inside a settlement cancel out, so the carried balance plus the month's
 * purchases and repayments always equals the net settlement at month end.
 */
export function sharedStatement(
  book: AccountingState,
  userId: string,
  month: string,
) {
  const budget = ownBudget(book, userId);
  const cutoff = endOf(month);
  const shared = book.sharedCategories.filter((category) =>
    category.participants.includes(userId),
  );
  const obligations = book.obligations.filter(
    (obligation) =>
      obligation.debtorId === userId || obligation.creditorId === userId,
  );
  const signed = (obligation: Obligation, amount: number) =>
    obligation.debtorId === userId ? amount : -amount;
  const balanceAt = (day: string) =>
    sum(
      obligations
        .filter((obligation) => !obligation.date || obligation.date <= day)
        .map((obligation) =>
          signed(obligation, outstanding(book, obligation, day)),
        ),
    );
  const nameOf = (sharedCategoryId: string) =>
    getCategory(
      budget,
      shared.find((category) => category.id === sharedCategoryId)!.categoryIds[
        userId
      ]!,
    ).name;
  const opening = obligations
    .filter((obligation) => obligation.opening)
    .map((obligation) => ({
      obligationId: obligation.id,
      sharedCategoryId: obligation.sharedCategoryId,
      name: nameOf(obligation.sharedCategoryId),
      effect: signed(obligation, obligation.amount),
    }));
  const monthStart = `${month}-01`;
  const carried = balanceAt(endOf(nextMonth(month, -1)));
  const earlierActivity =
    obligations.some(
      (obligation) => obligation.date && obligation.date < monthStart,
    ) ||
    book.settlements.some(
      (settlement) =>
        (settlement.payerId === userId || settlement.recipientId === userId) &&
        settlement.date < monthStart,
    );
  const sharedPurchases = ledgerSharedPurchases(book);
  const categories = shared.map((category) => {
    const purchases = sharedPurchases
      .filter(
        (transaction) =>
          transaction.sharedCategoryId === category.id &&
          monthOf(transaction.date) === month,
      )
      .map((transaction) => {
        const paidByYou = transaction.payerId === userId;
        const amountPaid = -transaction.amount;
        const yourShare = transaction.shares[userId] ?? 0;
        const partnerShare = safe(amountPaid - yourShare);
        const ruleShares = splitAmount(amountPaid, category.weights);
        return {
          transactionId: transaction.id,
          payee: transaction.payee,
          date: transaction.date,
          expenseMonth: transaction.expenseMonth,
          status: transaction.status,
          paidByYou,
          amountPaid,
          yourShare,
          partnerShare,
          effect: paidByYou ? -partnerShare : yourShare,
          splitDiffersFromRule: (ruleShares[userId] ?? 0) !== yourShare,
        };
      })
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.transactionId.localeCompare(b.transactionId),
      );
    return {
      sharedCategoryId: category.id,
      name: getCategory(budget, category.categoryIds[userId]!).name,
      weights: structuredClone(category.weights),
      purchases,
      effect: sum(purchases.map((purchase) => purchase.effect)),
    };
  });
  const settlements = book.settlements
    .filter(
      (settlement) =>
        (settlement.payerId === userId || settlement.recipientId === userId) &&
        settlement.date <= cutoff,
    )
    .map((settlement) => {
      const receivedOn = ledgerReceiptDate(book, settlement);
      return {
        settlementId: settlement.id,
        date: settlement.date,
        amount: settlement.amount,
        paidByYou: settlement.payerId === userId,
        effect:
          settlement.payerId === userId
            ? -settlement.amount
            : settlement.amount,
        receivedOn: receivedOn && receivedOn <= cutoff ? receivedOn : undefined,
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.settlementId.localeCompare(b.settlementId),
    );
  const repayments = settlements.filter(
    (settlement) => monthOf(settlement.date) === month,
  );
  return {
    month,
    carried: {
      amount: carried,
      from: earlierActivity
        ? ("earlier-months" as const)
        : opening.length
          ? ("opening" as const)
          : ("nothing" as const),
      opening,
    },
    categories,
    repayments,
    awaitingYourConfirmation: settlements.filter(
      (settlement) => !settlement.paidByYou && !settlement.receivedOn,
    ),
    balance: sum([
      carried,
      ...categories.map((category) => category.effect),
      ...repayments.map((repayment) => repayment.effect),
    ]),
  };
}
export type SharedStatement = ReturnType<typeof sharedStatement>;

export function projectBook(
  book: Book,
  userId: string,
  month: string,
  currentMonth = month,
) {
  return projectAccountingState(book, userId, month, currentMonth);
}

function projectAccountingState(
  book: AccountingState,
  userId: string,
  month: string,
  currentMonth: string,
) {
  const budget = ownBudget(book, userId);
  const calculated = materialize(book, userId, month);
  const cutoff = endOf(month);
  const obligations = book.obligations
    .filter(
      (obligation) =>
        (obligation.debtorId === userId || obligation.creditorId === userId) &&
        (!obligation.date || obligation.date <= cutoff),
    )
    .map((obligation) => ({
      ...obligation,
      outstanding: outstanding(book, obligation, cutoff),
    }));
  const sharedCategories = book.sharedCategories.filter((category) =>
    category.participants.includes(userId),
  );
  const youOwe = sum(
    obligations
      .filter((item) => item.debtorId === userId)
      .map((item) => item.outstanding),
  );
  const owedToYou = sum(
    obligations
      .filter((item) => item.creditorId === userId)
      .map((item) => item.outstanding),
  );
  let personalSpending = 0;
  let amountPaid = 0;
  let earnings = 0;
  const sharedPurchases = ledgerSharedPurchases(book);
  for (const owner of ledgerMembers(book)) {
    if (owner.userId !== userId) {
      for (const transaction of sharedPurchases)
        if (
          transaction.payerId === owner.userId &&
          transaction.expenseMonth === month &&
          transaction.shares[userId]
        )
          personalSpending = safe(
            personalSpending + transaction.shares[userId],
          );
      continue;
    }
    for (const transaction of budget.transactions.filter(active)) {
      if (transaction.expenseMonth !== month) continue;
      if (transaction.kind === "income" && transaction.status === "posted")
        earnings = safe(earnings + transaction.amount);
      if (transaction.kind === "purchase" || transaction.kind === "refund") {
        amountPaid = safe(amountPaid - transaction.amount);
        personalSpending = safe(
          personalSpending +
            (transaction.shares?.[userId] ?? -transaction.amount),
        );
      }
      if (transaction.kind === "loan-payment")
        personalSpending = safe(
          personalSpending +
            (budget.loans
              .flatMap((loan) => loan.payments)
              .find((payment) => payment.id === transaction.linkedId)
              ?.interest ?? 0),
        );
    }
  }
  const result = {
    budget: structuredClone(budget),
    month,
    readyToAssign: calculated.readyToAssign,
    cash: calculated.cash,
    categories: budget.categories.map((category) => {
      const state = calculated.categories.get(category.id)!;
      const reserved = sum(
        obligations
          .filter(
            (obligation) =>
              obligation.debtorId === userId &&
              sharedCategories.find(
                (shared) => shared.id === obligation.sharedCategoryId,
              )?.categoryIds[userId] === category.id,
          )
          .map((obligation) => obligation.outstanding),
      );
      return {
        ...structuredClone(category),
        ...state,
        // Card purchases plus any card refunds the payment reserve could not
        // return, so the breakdown always adds up to Available.
        creditActivity: category.pairedAccountId
          ? 0
          : safe(
              state.available -
                state.opening -
                state.assigned -
                state.cashActivity -
                state.settlementActivity,
            ),
        reserved,
        spendable: safe(state.available - reserved),
        history: categoryHistory(calculated.snapshots, category.id, month),
        targetProgress: category.target
          ? targetProgress(
              category.target,
              category,
              state,
              month,
              currentMonth,
              calculated.snapshots,
              category.pairedAccountId
                ? calculated.accounts.get(category.pairedAccountId)!.balance
                : 0,
              category.pairedAccountId
                ? calculated.startingBalances.get(category.pairedAccountId)!
                : 0,
              category.pairedLoanId
                ? budget.loans.find((loan) => loan.id === category.pairedLoanId)
                : undefined,
            )
          : undefined,
      };
    }),
    accounts: budget.accounts.map((account) => ({
      ...account,
      ...calculated.accounts.get(account.id)!,
    })),
    personalSpending,
    amountPaid,
    earnings,
    sharedCategories: sharedCategories.map((shared) => ({
      ...structuredClone(shared),
      name: getCategory(budget, shared.categoryIds[userId] ?? "").name,
    })),
    settlement: { youOwe, owedToYou, net: safe(youOwe - owedToYou) },
    sharedStatement: sharedStatement(book, userId, month),
    sharedLedger: projectSharedLedger(book, userId),
    reimbursements: budget.reimbursements.map((claim) => ({
      ...structuredClone(claim),
      outstanding: safe(
        claim.amount -
          sum(
            claim.receipts
              .filter((receipt) => receipt.date <= cutoff)
              .map((receipt) => receipt.amount),
          ),
      ),
    })),
    members: ledgerMembers(book),
    loans: budget.loans.map((loan) => ({
      ...structuredClone(loan),
      balance: safe(
        loan.principal -
          sum(
            loan.payments
              .filter((payment) => payment.date <= cutoff)
              .map((payment) => payment.principal),
          ),
      ),
      funded: Math.max(
        0,
        calculated.categories.get(loan.categoryId)!.available,
      ),
      forecast: forecastLoan(
        {
          ...loan,
          minimumPayment: plannedLoanPayment(
            loan,
            month,
            getCategory(budget, loan.categoryId).target,
          ),
        },
        month,
      ),
    })),
    audit: structuredClone(
      book.audit.filter((entry) => entry.actorId === userId),
    ),
  };
  return {
    ...result,
    // Cost to Be Me: what this month's targets ask for in total, assigned or not.
    costToBeMe: sum(
      result.categories.map((category) =>
        category.targetProgress
          ? Math.max(0, category.assigned) + category.targetProgress.needed
          : 0,
      ),
    ),
    expectedIncome: budget.expectedIncome[month] ?? null,
  };
}
export type BudgetProjection = ReturnType<typeof projectBook>;
export type ProjectedBook = BudgetProjection;

export function previewBudgetProjection(
  view: BudgetProjection,
  command: Command,
  currentMonth = view.month,
): BudgetProjection {
  if (
    view.sharedLedger.version !== 1 ||
    !view.members.some((member) => member.userId === view.budget.userId)
  )
    fail("Budget access denied");
  const ledger: PersonalLedger = {
    ...view.sharedLedger,
    kind: "personal",
    budget: view.budget,
    members: view.members,
    sharedCategories: view.sharedCategories,
    audit: view.audit,
  };
  const next = executeAccountingState(ledger, view.budget.userId, command);
  return projectAccountingState(
    next,
    view.budget.userId,
    view.month,
    currentMonth,
  );
}

function appendTransaction(
  budget: Budget,
  operationId: string,
  input: Omit<Transaction, "revision" | "history" | "reviewed">,
): void {
  if (budget.transactions.some((transaction) => transaction.id === input.id))
    fail("Transaction ID already exists");
  budget.transactions.push({
    ...input,
    revision: 1,
    reviewed: true,
    history: [
      {
        revision: 1,
        amount: input.amount,
        status: input.status,
        date: input.date,
        payee: input.payee,
        operationId,
        reason: "created",
      },
    ],
  });
}

function accountAtDate(
  budget: Budget,
  accountId: string,
  date: string,
): Account {
  const account = getAccount(budget, accountId);
  if (date < account.date)
    fail("Activity predates the account's confirmed opening balance");
  return account;
}
function requireCash(
  budget: Budget,
  accountId: string,
  date?: string,
): Account {
  const account = date
    ? accountAtDate(budget, accountId, date)
    : getAccount(budget, accountId);
  return account.kind === "cash" ? account : fail("Select a cash account");
}
function requireDate(budget: Budget, date: string): void {
  if (monthOf(date) < budget.startMonth)
    fail("Activity predates the budget start");
}
function ensureNoClaimInvalidation(
  budget: Budget,
  transaction: Transaction,
): void {
  if (
    sum(
      budget.reimbursements
        .filter((claim) => claim.transactionId === transaction.id)
        .map((claim) => claim.amount),
    ) > Math.max(0, -transaction.amount)
  )
    fail("Expense cannot be less than its reimbursement claims");
  if (
    budget.reimbursements.some(
      (claim) =>
        claim.transactionId === transaction.id &&
        claim.receipts.some((receipt) => receipt.date < transaction.date),
    )
  )
    fail("Expense cannot move after its recorded reimbursement receipt");
}

function ensureSupportedCardBalances(budget: Budget): void {
  for (const account of budget.accounts.filter(
    (item) => item.kind === "credit",
  )) {
    const activity = new Map<string, number>();
    for (const transaction of budget.transactions.filter(
      (item) =>
        active(item) &&
        item.accountId === account.id &&
        !(item.status === "pending" && item.amount > 0),
    )) {
      const month = monthOf(transaction.date);
      activity.set(
        month,
        safe((activity.get(month) ?? 0) + transaction.amount),
      );
    }
    let balance = account.openingBalance;
    for (const month of [...activity.keys()].sort()) {
      balance = safe(balance + activity.get(month)!);
      if (balance > 0)
        fail(
          "This change would create a positive card balance; investigate recorded credits and payments first",
        );
    }
  }
}

export function execute(
  original: Book,
  actorId: string,
  input: Command,
  source: "user" | "agent" = "user",
): Book {
  return executeAccountingState(original, actorId, input, source);
}

function executeAccountingState<T extends AccountingState>(
  original: T,
  actorId: string,
  input: Command,
  source: "user" | "agent" = "user",
): T {
  const command = commandSchema.parse(input);
  ownBudget(original, actorId);
  const fingerprint = JSON.stringify(command);
  const previous = original.audit.find(
    (entry) => entry.id === command.id && entry.actorId === actorId,
  );
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      fail("Operation ID was already used with different data");
    return structuredClone(original);
  }
  const userOnly = [
    "assign",
    "assign.batch",
    "rule.set",
    "target.set",
    "target.snooze",
    "shared.create",
    "shared.rule",
    "shared.remove",
    "opening.add",
    "settlement.record",
    "settlement.receive",
    "account.add",
    "category.add",
    "category.import",
    "settings.update",
    "income.expect",
    "loan.add",
    "loan.rate",
    "transaction.approve",
  ];
  if (source === "agent" && userOnly.includes(command.type))
    fail("This decision requires a user action");
  const book = structuredClone(original);
  const budget = ownBudget(book, actorId);
  applyCommand(book, budget, command, source);
  if (
    [
      "transaction.upsert",
      "transaction.remove",
      "transaction.merge",
      "card.payment",
      "card.credit",
    ].includes(command.type)
  )
    ensureSupportedCardBalances(budget);
  synchronizeObligations(book);
  book.audit.push({
    id: command.id,
    actorId,
    source,
    type: command.type,
    sequence: book.audit.length + 1,
    fingerprint,
  });
  return book;
}

function applyCommand(
  book: AccountingState,
  budget: Budget,
  command: ParsedCommand,
  source: "user" | "agent",
): void {
  const actorId = budget.userId;
  switch (command.type) {
    case "account.add": {
      if (budget.accounts.some((account) => account.id === command.accountId))
        fail("Account ID already exists");
      const date = command.date ?? `${budget.startMonth}-01`;
      requireDate(budget, date);
      if (command.kind === "credit" && command.openingBalance > 0)
        fail(
          "Positive credit-card balances require bank evidence and are not supported by manual setup",
        );
      budget.accounts.push({
        id: command.accountId,
        name: command.name,
        kind: command.kind,
        openingBalance: command.openingBalance,
        date,
      });
      if (command.kind === "credit")
        budget.categories.push({
          id: `card:${command.accountId}`,
          name: `${command.name} payment`,
          group: "Credit card payments",
          pairedAccountId: command.accountId,
        });
      break;
    }
    case "category.add": {
      if (
        budget.categories.some((category) => category.id === command.categoryId)
      )
        fail("Category ID already exists");
      budget.categories.push({
        id: command.categoryId,
        name: command.name,
        group: command.group,
      });
      break;
    }
    case "category.import": {
      for (const category of command.categories) {
        if (budget.categories.some((item) => item.id === category.categoryId))
          continue;
        budget.categories.push({
          id: category.categoryId,
          name: category.name,
          group: category.group,
        });
      }
      break;
    }
    case "assign": {
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
      break;
    }
    case "assign.batch": {
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
        state.readyToAssign <
          sum(command.changes.map((change) => change.amount))
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
      break;
    }
    case "cover": {
      if (command.fromCategoryId === command.toCategoryId)
        fail("Choose a different source category");
      getCategory(budget, command.fromCategoryId);
      getCategory(budget, command.toCategoryId);
      if (
        source === "agent" &&
        !budget.rules.some(
          (rule) =>
            rule.id === command.ruleId &&
            rule.enabled &&
            rule.fromCategoryId === command.fromCategoryId &&
            rule.toCategoryId === command.toCategoryId,
        )
      )
        fail("Agent coverage requires an explicit standing rule");
      const state = materialize(book, actorId, command.month);
      if (
        source === "agent" &&
        command.amount >
          Math.max(0, -state.categories.get(command.toCategoryId)!.available)
      )
        fail("A standing rule may only cover existing overspending");
      if (
        state.categories.get(command.fromCategoryId)!.available < command.amount
      )
        fail("Source category has insufficient funds");
      budget.assignments.push(
        {
          id: `${command.id}:from`,
          categoryId: command.fromCategoryId,
          month: command.month,
          amount: -command.amount,
        },
        {
          id: `${command.id}:to`,
          categoryId: command.toCategoryId,
          month: command.month,
          amount: command.amount,
        },
      );
      break;
    }
    case "rule.set": {
      getCategory(budget, command.fromCategoryId);
      getCategory(budget, command.toCategoryId);
      budget.rules = budget.rules.filter((rule) => rule.id !== command.ruleId);
      budget.rules.push({
        id: command.ruleId,
        fromCategoryId: command.fromCategoryId,
        toCategoryId: command.toCategoryId,
        enabled: command.enabled,
      });
      break;
    }
    case "target.set": {
      const category = getCategory(budget, command.categoryId);
      if (command.target) {
        const cardTarget = command.target.cadence.startsWith("card-");
        if (Boolean(category.pairedAccountId) !== cardTarget)
          fail("Credit-card categories require a paired card target");
        if (
          Boolean(category.pairedLoanId) !==
          (command.target.cadence === "loan")
        )
          fail("Loan categories require a paired loan target");
        if (command.target.startMonth < budget.startMonth)
          fail("Target predates the budget");
        category.target = {
          ...command.target,
          snoozedMonths: category.target?.snoozedMonths ?? [],
        };
      } else delete category.target;
      break;
    }
    case "target.snooze": {
      const category = getCategory(budget, command.categoryId);
      const target = category.target ?? fail("This category has no target");
      if (command.month !== command.currentMonth)
        fail("Only the current month can be snoozed");
      if (category.pairedAccountId)
        fail("Credit-card targets cannot be snoozed");
      target.snoozedMonths = target.snoozedMonths.filter(
        (month) => month !== command.month,
      );
      if (command.snoozed) target.snoozedMonths.push(command.month);
      break;
    }
    case "transaction.upsert": {
      requireDate(budget, command.date);
      const account = accountAtDate(budget, command.accountId, command.date);
      const existing = budget.transactions.find(
        (transaction) => transaction.id === command.transactionId,
      );
      if (existing && !["purchase", "refund", "income"].includes(existing.kind))
        fail("Use the dedicated operation for transfers and repayments");
      if (existing && existing.accountId !== command.accountId)
        fail("A transaction cannot move between accounts");
      if (
        command.providerId &&
        budget.transactions.some(
          (transaction) =>
            active(transaction) &&
            transaction.providerId === command.providerId &&
            transaction.id !== command.transactionId,
        )
      )
        fail("Provider transaction already exists");
      if (
        existing &&
        command.revision !== undefined &&
        command.revision <= existing.revision
      ) {
        if (
          existing.amount === command.amount &&
          existing.status === command.status &&
          existing.date === command.date
        )
          break;
        fail("Stale transaction revision requires review");
      }
      const categoryId = command.categoryId ?? existing?.categoryId;
      if (account.kind === "credit" && command.amount > 0 && !categoryId)
        fail("Use a card payment or posted statement credit for card inflows");
      if (categoryId) {
        const category = getCategory(budget, categoryId);
        if (category.pairedAccountId || category.pairedLoanId)
          fail("Use the paired payment operation");
      }
      const sharedCategoryId =
        command.sharedCategoryId ?? existing?.sharedCategoryId;
      let weights: Record<string, number> | undefined;
      let shares: Record<string, number> | undefined;
      if (sharedCategoryId) {
        const shared = sharedAccess(book, actorId, sharedCategoryId);
        if (categoryId !== shared.categoryIds[actorId])
          fail("Shared expense must use its paired personal category");
        if (command.amount >= 0)
          fail(
            "Shared merchant refunds require manual investigation in this version",
          );
        weights = existing?.splitWeights ?? shared.weights;
        shares = command.shares ?? splitAmount(-command.amount, weights);
        if (
          Object.keys(shares).length !== shared.participants.length ||
          shared.participants.some((id) => shares?.[id] === undefined) ||
          sum(Object.values(shares)) !== -command.amount
        )
          fail("Personal shares must conserve the full expense amount");
        if (command.shares) weights = command.shares;
      } else if (command.shares)
        fail("Personal-share overrides require a shared category");
      const revision = existing
        ? Math.max(existing.revision + 1, command.revision ?? 0)
        : (command.revision ?? 1);
      const expenseMonth =
        command.expenseMonth ?? existing?.expenseMonth ?? monthOf(command.date);
      const sameAllocation = (
        before: Record<string, number> | undefined,
        after: Record<string, number> | undefined,
      ) =>
        before === undefined || after === undefined
          ? before === after
          : Object.keys(before).length === Object.keys(after).length &&
            Object.entries(before).every(
              ([id, amount]) => after[id] === amount,
            );
      const reviewedPosting = Boolean(
        existing?.reviewed &&
        existing.status === "pending" &&
        command.status === "posted" &&
        existing.accountId === account.id &&
        existing.date === command.date &&
        existing.amount === command.amount &&
        existing.categoryId === categoryId &&
        existing.expenseMonth === expenseMonth &&
        existing.sharedCategoryId === sharedCategoryId &&
        sameAllocation(existing.shares, shares) &&
        sameAllocation(existing.splitWeights, weights),
      );
      const transaction: Transaction = {
        id: command.transactionId,
        accountId: account.id,
        date: command.date,
        amount: command.amount,
        payee: command.payee,
        status: command.status,
        categoryId,
        expenseMonth,
        sharedCategoryId,
        shares,
        splitWeights: weights,
        providerId: command.providerId ?? existing?.providerId,
        revision,
        reviewed:
          source === "user"
            ? (command.reviewed ?? existing?.reviewed ?? true)
            : reviewedPosting,
        kind:
          command.amount < 0 ? "purchase" : categoryId ? "refund" : "income",
        history: [
          ...(existing?.history ?? []),
          {
            revision,
            amount: command.amount,
            status: command.status,
            date: command.date,
            payee: command.payee,
            operationId: command.id,
            reason: existing ? "updated" : "created",
          },
        ],
      };
      ensureNoClaimInvalidation(budget, transaction);
      if (existing)
        budget.transactions[budget.transactions.indexOf(existing)] =
          transaction;
      else budget.transactions.push(transaction);
      if (
        account.kind === "credit" &&
        materialize(book, actorId, monthOf(command.date)).accounts.get(
          account.id,
        )!.balance > 0
      )
        fail(
          "Positive card balances require bank evidence and manual investigation",
        );
      break;
    }
    case "transaction.remove": {
      const transaction = getTransaction(budget, command.transactionId);
      if (!["purchase", "refund", "income"].includes(transaction.kind))
        fail(
          "Dedicated payment records cannot be deleted through transaction removal",
        );
      if (
        budget.reimbursements.some(
          (claim) => claim.transactionId === transaction.id,
        )
      )
        fail("Resolve linked reimbursements before removing the expense");
      transaction.removed = true;
      transaction.history.push({
        revision: ++transaction.revision,
        amount: transaction.amount,
        date: transaction.date,
        payee: transaction.payee,
        status: transaction.status,
        operationId: command.id,
        reason: "removed",
      });
      break;
    }
    case "transaction.approve": {
      for (const id of command.transactionIds) {
        const transaction = getTransaction(budget, id);
        if (
          transaction.amount < 0 &&
          !transaction.categoryId &&
          transaction.kind === "purchase"
        )
          fail("Categorize purchases before approval");
        transaction.reviewed = true;
      }
      break;
    }
    case "transaction.categorize": {
      const transaction = getTransaction(budget, command.transactionId);
      if (!["purchase", "income", "refund"].includes(transaction.kind))
        fail("Use the dedicated operation for transfers and repayments");
      const category = getCategory(budget, command.categoryId);
      if (category.pairedAccountId || category.pairedLoanId)
        fail("Payment categories cannot categorize purchases");
      if (
        transaction.sharedCategoryId &&
        sharedAccess(book, actorId, transaction.sharedCategoryId).categoryIds[
          actorId
        ] !== category.id
      )
        fail("Change the shared expense classification explicitly");
      transaction.categoryId = category.id;
      if (transaction.amount > 0) transaction.kind = "refund";
      transaction.reviewed = source === "user";
      transaction.history.push({
        revision: ++transaction.revision,
        amount: transaction.amount,
        date: transaction.date,
        payee: transaction.payee,
        status: transaction.status,
        operationId: command.id,
        reason: "categorized",
      });
      break;
    }
    case "transaction.merge": {
      if (command.transactionId === command.duplicateId)
        fail("Choose two distinct transactions");
      const target = getTransaction(budget, command.transactionId);
      const duplicate = getTransaction(budget, command.duplicateId);
      if (target.accountId !== duplicate.accountId)
        fail("Transactions from different accounts cannot be merged");
      if (target.kind !== "purchase" || duplicate.kind !== "purchase")
        fail("Only purchase records can be combined");
      if (source === "agent")
        fail("Uncertain matches require explicit user review");
      if (
        budget.reimbursements.some(
          (claim) => claim.transactionId === duplicate.id,
        )
      )
        fail("Resolve linked claims before combining records");
      duplicate.removed = true;
      target.history.push(...duplicate.history, {
        revision: ++target.revision,
        amount: target.amount,
        date: target.date,
        payee: target.payee,
        status: target.status,
        operationId: command.id,
        reason: "merged",
        combinedId: duplicate.id,
      });
      break;
    }
    case "shared.create": {
      if (
        book.sharedCategories.some(
          (category) => category.id === command.sharedCategoryId,
        )
      )
        fail("Shared category ID already exists");
      if (!command.participants.includes(actorId))
        fail("You must participate in a shared category");
      validateWeights(command.participants, command.weights);
      if (Object.keys(command.categoryIds).length !== 2)
        fail("Each participant needs a paired category");
      if (
        book.sharedCategories.some((existing) =>
          command.participants.some(
            (id) =>
              existing.participants.includes(id) &&
              existing.categoryIds[id] === command.categoryIds[id],
          ),
        )
      )
        fail("This category is already shared");
      const source = getCategory(
        ownBudget(book, actorId),
        command.categoryIds[actorId] ??
          fail("Each participant needs a paired category"),
      );
      for (const id of command.participants) {
        if (isPersonalLedger(book) && id !== actorId) {
          if (!command.categoryIds[id])
            fail("Each participant needs a paired category");
          memberName(book, id);
          // The server validates the peer's private category before committing.
          continue;
        }
        const member = ownBudget(book, id);
        const categoryId =
          command.categoryIds[id] ??
          fail("Each participant needs a paired category");
        if (
          id !== actorId &&
          !member.categories.some((category) => category.id === categoryId)
        )
          member.categories.push({
            id: categoryId,
            name: source.name,
            group: "Shared",
          });
        const category = getCategory(member, categoryId);
        if (category.pairedAccountId || category.pairedLoanId)
          fail("Payment categories cannot be shared expenses");
      }
      book.sharedCategories.push({
        id: command.sharedCategoryId,
        participants: command.participants,
        weights: command.weights,
        categoryIds: command.categoryIds,
      });
      break;
    }
    case "shared.rule": {
      const shared = sharedAccess(book, actorId, command.sharedCategoryId);
      validateWeights(shared.participants, command.weights);
      shared.weights = command.weights;
      break;
    }
    case "shared.remove": {
      const shared = sharedAccess(book, actorId, command.sharedCategoryId);
      if (
        book.obligations.some(
          (obligation) => obligation.sharedCategoryId === shared.id,
        ) ||
        ledgerHasSharedActivity(book, shared.id)
      )
        fail(
          "Shared categories with recorded activity cannot be deleted. Their expense and settlement history must be preserved.",
        );
      book.sharedCategories = book.sharedCategories.filter(
        (category) => category.id !== shared.id,
      );
      break;
    }
    case "opening.add": {
      const shared = sharedAccess(book, actorId, command.sharedCategoryId);
      if (
        command.debtorId === command.creditorId ||
        !shared.participants.includes(command.debtorId) ||
        !shared.participants.includes(command.creditorId)
      )
        fail("Opening direction must identify both participants");
      if (
        book.obligations.some(
          (obligation) => obligation.id === command.obligationId,
        )
      )
        fail("Opening obligation ID already exists");
      book.obligations.push({
        id: command.obligationId,
        sharedCategoryId: shared.id,
        debtorId: command.debtorId,
        creditorId: command.creditorId,
        amount: command.amount,
        opening: true,
      });
      break;
    }
    case "settlement.record": {
      requireDate(budget, command.date);
      if (
        book.settlements.some(
          (settlement) => settlement.id === command.settlementId,
        )
      )
        fail("Settlement ID already exists");
      memberName(book, command.otherUserId);
      if (actorId === command.otherUserId) fail("Select the other member");
      const eligible = book.obligations
        .filter(
          (obligation) =>
            (!obligation.date || obligation.date <= command.date) &&
            ((obligation.debtorId === actorId &&
              obligation.creditorId === command.otherUserId) ||
              (obligation.debtorId === command.otherUserId &&
                obligation.creditorId === actorId)),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      const ownDebt = eligible.filter(
        (obligation) => obligation.debtorId === actorId,
      );
      const otherDebt = eligible.filter(
        (obligation) => obligation.debtorId !== actorId,
      );
      const ownTotal = sum(
        ownDebt.map((obligation) => outstanding(book, obligation)),
      );
      const otherTotal = sum(
        otherDebt.map((obligation) => outstanding(book, obligation)),
      );
      if (ownTotal < otherTotal) fail("The other member owes the net payment");
      if (command.amount > ownTotal - otherTotal)
        fail("Recorded payment exceeds the current net settlement");
      if (command.amount > 0)
        requireCash(
          budget,
          command.accountId ?? fail("Select the paying cash account"),
          command.date,
        );
      const allocations: Settlement["allocations"] = [];
      let offset = otherTotal;
      let paymentRemaining = command.amount;
      for (const obligation of ownDebt) {
        const amount = outstanding(book, obligation);
        const offsetAmount = Math.min(offset, amount);
        offset -= offsetAmount;
        if (offsetAmount)
          allocations.push({
            obligationId: obligation.id,
            amount: offsetAmount,
            kind: "offset",
          });
        const paidAmount = Math.min(amount - offsetAmount, paymentRemaining);
        paymentRemaining -= paidAmount;
        if (paidAmount)
          allocations.push({
            obligationId: obligation.id,
            amount: paidAmount,
            kind: "payment",
          });
      }
      for (const obligation of otherDebt) {
        const amount = outstanding(book, obligation);
        if (amount)
          allocations.push({
            obligationId: obligation.id,
            amount,
            kind: "offset",
          });
      }
      book.settlements.push({
        id: command.settlementId,
        payerId: actorId,
        recipientId: command.otherUserId,
        date: command.date,
        amount: command.amount,
        received: command.amount === 0,
        allocations,
      });
      if (command.amount > 0)
        appendTransaction(budget, command.id, {
          id: `${command.id}:payment`,
          accountId: command.accountId!,
          date: command.date,
          amount: -command.amount,
          payee: `Settlement with ${memberName(book, command.otherUserId)}`,
          status: "posted",
          expenseMonth: monthOf(command.date),
          kind: "settlement",
          linkedId: command.settlementId,
        });
      break;
    }
    case "settlement.receive": {
      const settlement =
        book.settlements.find(
          (item) =>
            item.id === command.settlementId && item.recipientId === actorId,
        ) ?? fail("Settlement receipt access denied");
      if (settlement.received) fail("Settlement receipt already recorded");
      requireDate(budget, command.date);
      if (command.date < settlement.date)
        fail("Receipt predates the recorded settlement payment");
      requireCash(budget, command.accountId, command.date);
      settlement.received = true;
      appendTransaction(budget, command.id, {
        id: `${command.id}:receipt`,
        accountId: command.accountId,
        date: command.date,
        amount: settlement.amount,
        payee: "Shared settlement received",
        status: "posted",
        expenseMonth: monthOf(command.date),
        kind: "reimbursement",
        linkedId: settlement.id,
      });
      break;
    }
    case "reimbursement.expect": {
      if (
        budget.reimbursements.some(
          (claim) => claim.id === command.reimbursementId,
        )
      )
        fail("Reimbursement ID already exists");
      const transaction = getTransaction(budget, command.transactionId);
      if (transaction.amount >= 0 || transaction.kind !== "purchase")
        fail("Reimbursements must link to a purchase");
      if (transaction.sharedCategoryId)
        fail("Partner reimbursements already belong to the shared settlement");
      if (
        command.kind === "statement-credit" &&
        getAccount(budget, transaction.accountId).kind !== "credit"
      )
        fail("Statement-credit claims require a card purchase");
      const claimed = sum(
        budget.reimbursements
          .filter((claim) => claim.transactionId === transaction.id)
          .map((claim) => claim.amount),
      );
      if (claimed + command.amount > -transaction.amount)
        fail("Claims cannot exceed the linked expense");
      budget.reimbursements.push({
        id: command.reimbursementId,
        transactionId: transaction.id,
        name: command.name,
        amount: command.amount,
        kind: command.kind,
        receipts: [],
      });
      break;
    }
    case "reimbursement.receive": {
      const claim =
        budget.reimbursements.find(
          (item) => item.id === command.reimbursementId,
        ) ?? fail("Reimbursement access denied");
      if (claim.kind !== "cash")
        fail("Use a posted statement credit for a card benefit");
      requireDate(budget, command.date);
      if (command.date < getTransaction(budget, claim.transactionId).date)
        fail("Receipt predates the reimbursed expense");
      requireCash(budget, command.accountId, command.date);
      if (
        command.amount >
        claim.amount - sum(claim.receipts.map((receipt) => receipt.amount))
      )
        fail("Receipt exceeds the outstanding claim");
      claim.receipts.push({
        id: command.id,
        date: command.date,
        amount: command.amount,
      });
      appendTransaction(budget, command.id, {
        id: `${command.id}:receipt`,
        accountId: command.accountId,
        date: command.date,
        amount: command.amount,
        payee: claim.name,
        status: "posted",
        expenseMonth: monthOf(command.date),
        kind: "reimbursement",
        linkedId: claim.id,
      });
      break;
    }
    case "card.payment": {
      requireDate(budget, command.date);
      requireCash(budget, command.cashAccountId, command.date);
      if (
        accountAtDate(budget, command.cardAccountId, command.date).kind !==
        "credit"
      )
        fail("Select a credit-card account");
      const calculated = materialize(
        book,
        actorId,
        monthOf(command.date),
        command.date,
      );
      const state = calculated.accounts.get(command.cardAccountId)!;
      const remaining = materialize(
        book,
        actorId,
        monthOf(command.date),
      ).accounts.get(command.cardAccountId)!;
      if (
        command.amount > Math.min(state.reserve, remaining.reserve) ||
        command.amount > Math.min(-state.balance, -remaining.balance)
      )
        fail("Card payment exceeds existing reserve or card debt");
      if (
        command.amount > calculated.accounts.get(command.cashAccountId)!.balance
      )
        fail("Card payment requires cash already received by its payment date");
      appendTransaction(budget, command.id, {
        id: `${command.id}:cash`,
        accountId: command.cashAccountId,
        date: command.date,
        amount: -command.amount,
        payee: "Credit card payment",
        status: "posted",
        expenseMonth: monthOf(command.date),
        kind: "card-payment",
        linkedId: command.id,
      });
      appendTransaction(budget, command.id, {
        id: `${command.id}:card`,
        accountId: command.cardAccountId,
        date: command.date,
        amount: command.amount,
        payee: "Credit card payment",
        status: "posted",
        expenseMonth: monthOf(command.date),
        kind: "card-payment",
        linkedId: command.id,
      });
      break;
    }
    case "card.credit": {
      requireDate(budget, command.date);
      if (
        accountAtDate(budget, command.accountId, command.date).kind !== "credit"
      )
        fail("Select a credit-card account");
      const claim = command.reimbursementId
        ? (budget.reimbursements.find(
            (item) => item.id === command.reimbursementId,
          ) ?? fail("Reimbursement access denied"))
        : undefined;
      if (claim) {
        if (claim.kind !== "statement-credit") fail("This claim expects cash");
        if (command.date < getTransaction(budget, claim.transactionId).date)
          fail("Credit predates the reimbursed expense");
        if (
          getTransaction(budget, claim.transactionId).accountId !==
          command.accountId
        )
          fail("Credit must post to the original card");
        if (
          command.amount >
          claim.amount - sum(claim.receipts.map((receipt) => receipt.amount))
        )
          fail("Credit exceeds the outstanding claim");
      }
      if (!command.posted) break;
      const state = materialize(
        book,
        actorId,
        monthOf(command.date),
        command.date,
      ).accounts.get(command.accountId)!;
      const remaining = materialize(
        book,
        actorId,
        monthOf(command.date),
      ).accounts.get(command.accountId)!;
      if (command.amount > Math.min(-state.balance, -remaining.balance))
        fail(
          "Credit exceeds card debt; positive card balances require bank evidence",
        );
      if (claim)
        claim.receipts.push({
          id: command.id,
          date: command.date,
          amount: command.amount,
        });
      appendTransaction(budget, command.id, {
        id: `${command.id}:credit`,
        accountId: command.accountId,
        date: command.date,
        amount: command.amount,
        payee: "Posted statement credit",
        status: "posted",
        expenseMonth: monthOf(command.date),
        kind: "statement-credit",
        linkedId: claim?.id,
      });
      break;
    }
    case "loan.add": {
      if (budget.loans.some((loan) => loan.id === command.loanId))
        fail("Loan ID already exists");
      let category = budget.categories.find(
        (item) => item.id === command.categoryId,
      );
      if (!category) {
        category = {
          id: command.categoryId,
          name: `${command.name} payment`,
          group: "Loans",
        };
        budget.categories.push(category);
      }
      if (category.pairedAccountId || category.pairedLoanId)
        fail("Category is already paired");
      category.pairedLoanId = command.loanId;
      category.target = {
        cadence: "loan",
        behavior: "contribution",
        amount: command.minimumPayment,
        startMonth: budget.startMonth,
        snoozedMonths: [],
      };
      budget.loans.push({
        id: command.loanId,
        categoryId: category.id,
        name: command.name,
        principal: command.principal,
        minimumPayment: command.minimumPayment,
        variable: command.variable,
        rates: [
          {
            effectiveDate: command.effectiveDate,
            annualRateBps: command.annualRateBps,
          },
        ],
        payments: [],
      });
      break;
    }
    case "loan.rate": {
      const loan =
        budget.loans.find((item) => item.id === command.loanId) ??
        fail("Loan access denied");
      if (!loan.variable) fail("A fixed-rate loan cannot change rate");
      if (
        loan.rates.some((rate) => rate.effectiveDate === command.effectiveDate)
      )
        fail("A confirmed rate already exists for this date");
      loan.rates.push({
        effectiveDate: command.effectiveDate,
        annualRateBps: command.annualRateBps,
      });
      break;
    }
    case "loan.payment": {
      requireDate(budget, command.date);
      requireCash(budget, command.accountId, command.date);
      const loan =
        budget.loans.find((item) => item.id === command.loanId) ??
        fail("Loan access denied");
      const amount = safe(command.principal + command.interest);
      if (amount <= 0) fail("Payment must be positive");
      if (
        command.principal >
        loan.principal - sum(loan.payments.map((payment) => payment.principal))
      )
        fail("Confirmed principal exceeds the remaining loan balance");
      loan.payments.push({
        id: command.id,
        date: command.date,
        principal: command.principal,
        interest: command.interest,
      });
      appendTransaction(budget, command.id, {
        id: `${command.id}:payment`,
        accountId: command.accountId,
        date: command.date,
        amount: -amount,
        payee: loan.name,
        status: "posted",
        expenseMonth: monthOf(command.date),
        kind: "loan-payment",
        categoryId: loan.categoryId,
        linkedId: command.id,
      });
      break;
    }
    case "settings.update": {
      if (command.name) budget.name = command.name;
      if (command.timezone) {
        try {
          new Intl.DateTimeFormat("en", { timeZone: command.timezone });
        } catch {
          fail("Choose a valid IANA timezone");
        }
        budget.settings.timezone = command.timezone;
      }
      if (command.emailEnabled !== undefined)
        budget.settings.emailEnabled = command.emailEnabled;
      if (command.emailHour !== undefined)
        budget.settings.emailHour = command.emailHour;
      break;
    }
    case "income.expect": {
      if (command.month < budget.startMonth)
        fail("Month precedes the budget start");
      if (command.amount === null) delete budget.expectedIncome[command.month];
      else budget.expectedIncome[command.month] = command.amount;
      break;
    }
  }
}
