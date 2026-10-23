import { z } from "zod";
import {
  linkedRefundIssues,
  proportionalRefundLines,
  refundOrder,
} from "./linked-refunds";
import {
  counterpartyLines,
  counterpartyRegisterEntries,
  shareContribution,
} from "./counterparty";
export { counterpartyRegisterEntries } from "./counterparty";
import {
  isTransfer,
  transferCounterparts,
  transferPayee,
  transferNeedsCategory,
  READY_TO_ASSIGN,
} from "./transfers";
import {
  isPersonalLedger,
  ledgerMembers,
  projectSharedLedger,
  type AccountingState,
  type PersonalLedger,
} from "./shared-ledger";
import { personalSpendingEntries } from "./spending";
import {
  awaitingImport,
  entryCounts,
  lineFacts,
  matchEntry,
  partnerLines,
  mirroredChange,
  mirroredEntries,
  partnerAccountOf,
  partnerEntrySchema,
  partnerLedgerRows,
  partnerSideIssues,
  partnerSideSchema,
  sideCategory,
  spendingCategory,
  synchronizePartnerEntries,
  writeEntry,
  type PartnerEntry,
  type PartnerSide,
} from "./partner-ledger";
import {
  activeSettlements,
  isSettlementLeg,
  openRequest,
  settlementLegId,
  partnerRequestSchema,
  partnerSettlementSchema,
  settlementLegIssues,
  type PartnerRequest,
  type PartnerSettlement,
} from "./partner-settlements";
import { canonicalJson } from "./canonical-json";
import { Changes } from "./changes";
import { payeeKey, rememberCategorizations } from "./payee-memory";
import { foldAssignments, type ChangeSet } from "./rows";

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

const shareInputSchema = z.object({
  accountId: identifier,
  amount: nonnegativeCents,
  counterpartyName: z.string().trim().min(1).max(240).optional(),
});
const transactionInput = {
  counterpartyShare: shareInputSchema.nullable().optional(),
  refundOfTransactionId: identifier.optional(),
  recordedAt: z.string().datetime().optional(),
  transactionId: identifier,
  accountId: identifier,
  date: daySchema,
  amount: cents,
  payee: z.string().min(1).max(240),
  categoryId: identifier.optional(),
  // A split: the transaction's amount across several categories. Absent
  // keeps a saved split, or a single category.
  lines: z
    .array(
      z.object({
        lineId: identifier,
        categoryId: identifier,
        amount: cents,
        counterpartyShare: shareInputSchema.nullable().optional(),
      }),
    )
    .min(2)
    .max(100)
    .optional(),
  status: z.enum(["pending", "posted"]).default("posted"),
  expenseMonth: monthSchema.optional(),
  providerId: identifier.optional(),
  revision: z.number().int().nonnegative().optional(),
  reviewed: z.boolean().optional(),
};

export const commandSchema = z.discriminatedUnion("type", [
  // The partner ledger (src/domain/partner-ledger.ts): the category of your
  // side of your partner's purchase, and changes to a shared entry, which
  // either partner may make.
  z.object({
    type: z.literal("partner.categorize"),
    id: identifier,
    entryId: identifier,
    categoryId: identifier.nullable(),
  }),
  // A shared purchase recorded before its payer's bank import arrives, by
  // either partner, and the payer's import matched to it once it does.
  z.object({
    type: z.literal("partner.record"),
    id: identifier,
    recordedAt: z.string().datetime().optional(),
    entryId: identifier,
    payerId: identifier,
    date: daySchema,
    payee: z.string().trim().min(1).max(240),
    // The total paid, without its sign.
    amount: positiveCents,
    // The part of the partner who didn't pay.
    share: positiveCents,
    // The recorder's category for their part.
    categoryId: identifier.optional(),
  }),
  z.object({
    type: z.literal("partner.match"),
    id: identifier,
    recordedAt: z.string().datetime().optional(),
    entryId: identifier,
    transactionId: identifier,
    accountId: identifier,
    date: daySchema,
    // The import's signed amount, which must be the entry's.
    amount: cents,
    status: z.enum(["pending", "posted"]),
    providerId: identifier.optional(),
    // The payer's category for their part; their side's when absent.
    categoryId: identifier.optional(),
  }),
  z.object({
    type: z.literal("partner.edit"),
    id: identifier,
    entryId: identifier,
    recordedAt: z.string().datetime().optional(),
    share: nonnegativeCents.optional(),
    // The shared amount, without its sign.
    amount: positiveCents.optional(),
    date: daySchema.optional(),
    payee: z.string().trim().min(1).max(240).optional(),
  }),
  // Settling up (src/domain/partner-settlements.ts): a payment between the
  // partners, recorded with both partners' legs at once, and its
  // confirmation, which either partner gives for both.
  z.object({
    type: z.literal("partner.settle"),
    id: identifier,
    settlementId: identifier,
    method: z.string().trim().min(1).max(120),
    legs: z
      .array(
        z.object({
          userId: identifier,
          accountId: identifier,
          date: daySchema,
          // Signed as the leg's account records it.
          amount: cents.refine((value) => value !== 0),
          payee: z.string().trim().min(1).max(240),
          providerId: identifier.optional(),
        }),
      )
      .length(2),
  }),
  // Asking the partner to pay (src/domain/partner-settlements.ts).
  z.object({
    type: z.literal("partner.request"),
    id: identifier,
    requestId: identifier,
    date: daySchema,
    amount: positiveCents,
  }),
  z.object({
    type: z.literal("partner.settlement.confirm"),
    id: identifier,
    settlementId: identifier,
    recordedAt: z.string().datetime().optional(),
  }),
  z.object({
    type: z.literal("partner.settlement.reject"),
    id: identifier,
    settlementId: identifier,
    recordedAt: z.string().datetime().optional(),
  }),
  z.object({
    type: z.literal("counterparty.receive"),
    id: identifier,
    counterpartyAccountId: identifier,
    cashAccountId: identifier,
    date: daySchema,
    amount: positiveCents,
    counterpartyName: z.string().trim().min(1).max(240).optional(),
    recordedAt: z.string().datetime().optional(),
    // A repayment recognized in a bank import: the bank's name for it and
    // its transaction, waiting for the user's review.
    payee: z.string().trim().min(1).max(240).optional(),
    providerId: identifier.optional(),
  }),
  z.object({
    type: z.literal("account.add"),
    id: identifier,
    accountId: identifier,
    name: z.string().min(1).max(120),
    kind: z.enum(["cash", "credit", "tracking"]),
    openingBalance: cents,
    date: daySchema.optional(),
  }),
  z.object({
    type: z.literal("account.reconcile"),
    id: identifier,
    accountId: identifier,
    date: daySchema,
    // The bank's cleared balance, without pending activity.
    balance: cents,
    // Present only when the user chose to create a balance adjustment for
    // the difference.
    adjustmentId: identifier.optional(),
  }),
  z.object({
    type: z.literal("group.add"),
    id: identifier,
    name: z.string().trim().min(1).max(120),
  }),
  // The plan's group order, top first. Groups it leaves out, like one added
  // since, keep their place after the ones it names.
  z.object({
    type: z.literal("group.reorder"),
    id: identifier,
    names: z.array(z.string().max(120)).max(500),
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
  // Sets the month's assigned total for the category, where "assign" adds to
  // it. A retried or rebased command keeps the last total instead of adding
  // its amount again.
  z.object({
    type: z.literal("assign.set"),
    id: identifier,
    categoryId: identifier,
    month: monthSchema,
    amount: cents,
  }),
  z.object({
    type: z.literal("cover"),
    id: identifier,
    fromCategoryId: identifier,
    toCategoryId: identifier,
    month: monthSchema,
    amount: positiveCents,
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
    type: z.literal("transaction.save"),
    id: identifier,
    ...transactionInput,
    transferAccountId: identifier.optional(),
    loanId: identifier.optional(),
    interest: nonnegativeCents.optional(),
  }),
  z.object({
    type: z.literal("transaction.remove"),
    recordedAt: z.string().datetime().optional(),
    id: identifier,
    transactionId: identifier,
  }),
  z.object({
    type: z.literal("transaction.approve"),
    id: identifier,
    transactionIds: z.array(identifier).min(1).max(500),
  }),
  z.object({
    type: z.literal("transaction.reject"),
    recordedAt: z.string().datetime().optional(),
    id: identifier,
    transactionIds: z.array(identifier).min(1).max(500),
  }),
  z.object({
    type: z.literal("transaction.categorize"),
    recordedAt: z.string().datetime().optional(),
    id: identifier,
    transactionId: identifier,
    categoryId: identifier,
  }),
  z.object({
    type: z.literal("transaction.categorize.batch"),
    recordedAt: z.string().datetime().optional(),
    id: identifier,
    transactionIds: z.array(identifier).min(1).max(500),
    categoryId: identifier,
  }),
  z.object({
    type: z.literal("transaction.merge"),
    recordedAt: z.string().datetime().optional(),
    id: identifier,
    transactionId: identifier,
    duplicateId: identifier,
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

/**
 * Restores what a stored operation changed (ADR 0006): undo, and redo as
 * the revert of a revert. The server loads the target's stored change set;
 * executeRevert in change-sets.ts applies it.
 */
export const revertCommandSchema = z.object({
  type: z.literal("revert"),
  id: identifier,
  targetOperationId: identifier,
});
export type RevertCommand = z.input<typeof revertCommandSchema>;
/** Every command the server executes: the engine's commands and revert. */
export const ledgerCommandSchema = z.discriminatedUnion("type", [
  ...commandSchema.options,
  revertCommandSchema,
]);
export type LedgerCommand = z.input<typeof ledgerCommandSchema>;
type ParsedCommand = z.output<typeof commandSchema>;

export type Account = {
  id: string;
  name: string;
  // Partner and reimbursements are the counterparty accounts: what the
  // partner, or anyone else, owes you (positive) or you owe them.
  kind: "cash" | "credit" | "tracking" | "partner" | "reimbursements";
  openingBalance: number;
  date: string;
  // The last time the cleared balance was confirmed against the bank's.
  reconciled?: { date: string; balance: number };
};
export type Category = {
  id: string;
  name: string;
  group: string;
  target?: Target;
  pairedAccountId?: string;
  pairedLoanId?: string;
  // The counterparty account this paired envelope holds the cash of.
  counterpartyAccountId?: string;
};
export type CounterpartyShare = {
  accountId: string;
  amount: number;
  counterpartyName?: string;
};
export type ShareChange = {
  lineId: string;
  previous: CounterpartyShare | null;
  next: CounterpartyShare | null;
};
export type TransactionHistory = {
  actorId?: string;
  at?: string;
  shareChanges?: ShareChange[];
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
export type TransactionLine = {
  counterpartyShare?: CounterpartyShare;
  id: string;
  categoryId: string;
  amount: number;
};
export type Transaction = {
  counterpartyShare?: CounterpartyShare;
  refundOfTransactionId?: string;
  linkedCounterpartyAccountId?: string;
  counterpartyName?: string;
  // This partner's leg of a settlement (src/domain/partner-settlements.ts).
  partnerSettlementId?: string;
  id: string;
  accountId: string;
  date: string;
  amount: number;
  payee: string;
  status: "pending" | "posted";
  categoryId?: string;
  lines?: TransactionLine[];
  expenseMonth: string;
  providerId?: string;
  revision: number;
  reviewed: boolean;
  kind:
    | "purchase"
    | "income"
    | "refund"
    | "transfer"
    | "card-payment"
    | "loan-payment"
    | "reimbursement"
    | "statement-credit"
    | "adjustment";
  linkedId?: string;
  removed?: boolean;
  // Cleared and confirmed against the bank by a reconciliation. Its amount
  // and cleared status are locked from then on.
  reconciled?: boolean;
  history: TransactionHistory[];
};
// The money assigned to one budget category in one month. A budget holds at
// most one per category and month: every assignment command adds to or sets
// its total. Its id is the operation that first assigned to it.
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
// A payee's most recent categorization, which prefills its new imports and
// entries (src/domain/payee-memory.ts). It names a budget category or Ready
// to Assign.
export type PayeeMemory = {
  counterpartyShare?: CounterpartyShare;
  // The payee as it was written when last categorized.
  payee: string;
  kind: "category" | "readyToAssign";
  categoryId?: string;
};
export type Budget = {
  userId: string;
  name: string;
  startMonth: string;
  accounts: Account[];
  // Category groups in plan order, including ones with no categories yet:
  // group.add puts a new one first, and group.reorder sets the order. They
  // lead the plan; a category names its group, and groups known only
  // through their categories follow in category order.
  groups?: string[];
  categories: Category[];
  transactions: Transaction[];
  assignments: Assignment[];
  loans: Loan[];
  settings: { timezone: string; emailEnabled: boolean; emailHour: number };
  expectedIncome: Record<string, number>;
  // By payee key; absent until a payee is first categorized.
  payeeMemory?: Record<string, PayeeMemory>;
  // This partner's private side of each partner ledger entry, by entry id.
  partnerSides?: Record<string, PartnerSide>;
};
/**
 * Who issued a command: the user, the agent on their behalf, or a bank
 * provider update. Only the user may make budgeting decisions.
 */
export type CommandSource = "user" | "agent" | "provider";
export type Audit = {
  id: string;
  actorId: string;
  source: CommandSource;
  type: string;
  sequence: number;
  fingerprint: string;
};
export type Book = {
  version: 1;
  budgets: Record<string, Budget>;
  audit: Audit[];
  // The partner ledger both budgets share (src/domain/partner-ledger.ts).
  partnerEntries?: PartnerEntry[];
  // Settling up between the partners (src/domain/partner-settlements.ts).
  partnerSettlements?: PartnerSettlement[];
  partnerRequests?: PartnerRequest[];
};

export const storedIdentifier = z.string().min(1).max(1024);
export const counterpartyShareSchema = z.object({
  accountId: storedIdentifier,
  amount: nonnegativeCents,
  counterpartyName: z.string().trim().min(1).max(240).optional(),
});
export const transactionHistorySchema = z.object({
  actorId: storedIdentifier.optional(),
  at: z.string().datetime().optional(),
  shareChanges: z
    .array(
      z.object({
        lineId: storedIdentifier,
        previous: counterpartyShareSchema.nullable(),
        next: counterpartyShareSchema.nullable(),
      }),
    )
    .optional(),
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
export const transactionSchema = z.object({
  counterpartyShare: counterpartyShareSchema.optional(),
  refundOfTransactionId: storedIdentifier.optional(),
  linkedCounterpartyAccountId: storedIdentifier.optional(),
  counterpartyName: z.string().optional(),
  partnerSettlementId: storedIdentifier.optional(),
  id: storedIdentifier,
  accountId: storedIdentifier,
  date: daySchema,
  amount: cents,
  payee: z.string(),
  status: z.enum(["pending", "posted"]),
  categoryId: storedIdentifier.optional(),
  lines: z
    .array(
      z.object({
        counterpartyShare: counterpartyShareSchema.optional(),
        id: storedIdentifier,
        categoryId: storedIdentifier,
        amount: cents,
      }),
    )
    .optional(),
  expenseMonth: monthSchema,
  providerId: storedIdentifier.optional(),
  revision: z.number().int().nonnegative(),
  reviewed: z.boolean(),
  kind: z.enum([
    "purchase",
    "income",
    "refund",
    "transfer",
    "card-payment",
    "loan-payment",
    "reimbursement",
    "statement-credit",
    "adjustment",
  ]),
  linkedId: storedIdentifier.optional(),
  removed: z.boolean().optional(),
  reconciled: z.boolean().optional(),
  history: z.array(transactionHistorySchema),
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
export const payeeMemorySchema = z.object({
  counterpartyShare: counterpartyShareSchema.optional(),
  payee: z.string(),
  kind: z.enum(["category", "readyToAssign"]),
  categoryId: storedIdentifier.optional(),
});
export const budgetShape = z.object({
  userId: storedIdentifier,
  name: z.string(),
  startMonth: monthSchema,
  accounts: z.array(
    z.object({
      id: storedIdentifier,
      name: z.string(),
      kind: z.enum(["cash", "credit", "tracking", "partner", "reimbursements"]),
      openingBalance: cents,
      date: daySchema,
      reconciled: z.object({ date: daySchema, balance: cents }).optional(),
    }),
  ),
  groups: z.array(z.string()).optional(),
  categories: z.array(
    z.object({
      id: storedIdentifier,
      name: z.string(),
      group: z.string(),
      target: targetSchema.optional(),
      pairedAccountId: storedIdentifier.optional(),
      pairedLoanId: storedIdentifier.optional(),
      counterpartyAccountId: storedIdentifier.optional(),
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
  settings: z.object({
    timezone: z.string(),
    emailEnabled: z.boolean(),
    emailHour: z.number().int().min(0).max(23),
  }),
  expectedIncome: z.record(monthSchema, nonnegativeCents).default({}),
  payeeMemory: z.record(storedIdentifier, payeeMemorySchema).optional(),
  partnerSides: z.record(storedIdentifier, partnerSideSchema).optional(),
});
// One partner's stored personal budget, with the checks that need only that
// budget, so one partner's budget can be read without the other's.
export const budgetSchema: z.ZodType<Budget, z.ZodTypeDef, unknown> =
  budgetShape.superRefine((budget, context) => {
    for (const message of budgetReferenceIssues(budget))
      context.addIssue({ code: "custom", message });
  });
/**
 * What makes a budget's records inconsistent with each other: duplicate
 * ids, and transactions or assignments that name an account or category the
 * budget doesn't have.
 */
export function budgetReferenceIssues(
  budget: Pick<
    Budget,
    "accounts" | "categories" | "transactions" | "loans" | "assignments"
  > &
    Partial<Pick<Budget, "partnerSides">>,
): string[] {
  const issues: string[] = [];
  for (const collection of [
    budget.accounts,
    budget.categories,
    budget.transactions,
    budget.loans,
  ])
    if (new Set(collection.map((item) => item.id)).size !== collection.length)
      issues.push("Duplicate ledger storedIdentifier");
  const accounts = new Set(budget.accounts.map((account) => account.id));
  const categories = new Set(budget.categories.map((category) => category.id));
  if (
    budget.transactions.some(
      (transaction) =>
        !transaction.removed &&
        (!accounts.has(transaction.accountId) ||
          categoryLines(transaction).some(
            (line) => !categories.has(line.categoryId),
          )),
    )
  )
    issues.push("Invalid transaction reference");
  const counterpartyAccount = (id: string) =>
    budget.accounts.find(
      (account) => account.id === id && isCounterparty(account),
    );
  const hasPairedEnvelope = (id: string) =>
    budget.categories.some((category) => category.counterpartyAccountId === id);
  for (const transaction of budget.transactions) {
    if (transaction.removed) continue;
    const source = budget.accounts.find(
      (account) => account.id === transaction.accountId,
    );
    if (
      transaction.counterpartyShare &&
      (!transaction.categoryId || transaction.lines !== undefined)
    )
      issues.push("Invalid counterparty share reference");
    // A settlement leg reads by its own rules (settlementLegIssues).
    if (
      transaction.linkedCounterpartyAccountId &&
      !isSettlementLeg(transaction)
    ) {
      const counterparty = counterpartyAccount(
        transaction.linkedCounterpartyAccountId,
      );
      if (
        !counterparty ||
        !hasPairedEnvelope(counterparty.id) ||
        transaction.kind !== "reimbursement" ||
        transaction.amount <= 0 ||
        source?.kind !== "cash" ||
        transaction.categoryId ||
        transaction.lines ||
        transaction.counterpartyShare ||
        (counterparty.kind === "reimbursements" &&
          !transaction.counterpartyName?.trim())
      )
        issues.push("Invalid counterparty repayment reference");
    }
    for (const line of counterpartyLines(transaction)) {
      const share = line.counterpartyShare;
      if (!share) continue;
      const counterparty = counterpartyAccount(share.accountId);
      const category = budget.categories.find(
        (item) => item.id === line.categoryId,
      );
      if (
        !counterparty ||
        !hasPairedEnvelope(share.accountId) ||
        share.amount > Math.abs(line.amount) ||
        (source?.kind !== "cash" && source?.kind !== "credit") ||
        !category ||
        category.counterpartyAccountId ||
        category.pairedAccountId ||
        category.pairedLoanId ||
        !["purchase", "refund"].includes(transaction.kind) ||
        (counterparty.kind === "reimbursements" &&
          !share.counterpartyName?.trim())
      )
        issues.push("Invalid counterparty share reference");
    }
  }
  if (
    budget.transactions.some(
      (transaction) =>
        transaction.lines &&
        (transaction.lines.length < 2 ||
          transaction.categoryId !== undefined ||
          new Set(transaction.lines.map((line) => line.id)).size !==
            transaction.lines.length ||
          transaction.lines.some((line) => !line.amount) ||
          transaction.lines.reduce((total, line) => total + line.amount, 0) !==
            transaction.amount),
    )
  )
    issues.push("Invalid stored transaction lines");
  if (
    budget.assignments.some(
      (assignment) => !categories.has(assignment.categoryId),
    )
  )
    issues.push("Invalid assignment reference");
  return [
    ...issues,
    ...linkedRefundIssues(budget),
    ...partnerSideIssues(budget),
    ...settlementLegIssues(budget),
  ];
}
// The stored data both partners share: the partner ledger, settling up,
// and the command audit.
export const householdSchema = z.object({
  audit: z.array(
    z.object({
      id: storedIdentifier,
      actorId: storedIdentifier,
      source: z.enum(["user", "agent", "provider"]),
      type: z.string(),
      sequence: z.number().int().positive(),
      fingerprint: z.string(),
    }),
  ),
  partnerEntries: z.array(partnerEntrySchema).optional(),
  partnerSettlements: z.array(partnerSettlementSchema).optional(),
  partnerRequests: z.array(partnerRequestSchema).optional(),
});
export type Household = z.infer<typeof householdSchema>;
export const bookSchema: z.ZodType<Book, z.ZodTypeDef, unknown> = z
  .object({
    version: z.literal(1),
    budgets: z.record(budgetSchema),
    ...householdSchema.shape,
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
export const ownBudget = (book: AccountingState, userId: string): Budget =>
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
        settings: {
          timezone: "America/Los_Angeles",
          emailEnabled: true,
          emailHour: 8,
        },
        expectedIncome: {},
      },
    },
    audit: [],
  };
}

// The counterparty accounts a budget holds, each with one paired envelope in
// People: reimbursements always, for everyone who is not the partner, and the
// partner account once the household has two members.
const counterparties = [
  { kind: "reimbursements", name: "Reimbursements" },
  { kind: "partner", name: "Partner" },
] as const;
export const counterpartyId = (kind: CounterpartyKind) =>
  `counterparty:${kind}`;
export const pairedEnvelopeId = (kind: CounterpartyKind) => `envelope:${kind}`;
export type CounterpartyKind = (typeof counterparties)[number]["kind"];
export const PEOPLE_GROUP = "People";

// A paired envelope's activity is its counterparty account's, so nothing
// else is categorized into it.
function refusePairedEnvelope(category: Category): void {
  if (category.counterpartyAccountId)
    fail(
      "A paired envelope changes only with its counterparty account. Choose a spending category",
    );
}

/** The partner and reimbursements accounts, which the system keeps. */
export const isCounterparty = (account: Pick<Account, "kind">) =>
  account.kind === "partner" || account.kind === "reimbursements";

// Until shares and settlements write them, a counterparty account holds no
// entries of its own, so its balance stays what its paired envelope shows.
function ensureNoCounterpartyEntries(budget: Budget): void {
  const counterpartyIds = new Set(
    budget.accounts.filter(isCounterparty).map((account) => account.id),
  );
  if (
    budget.transactions.some(
      (transaction) =>
        !transaction.removed && counterpartyIds.has(transaction.accountId),
    )
  )
    fail(
      "Entries on Partner and Reimbursements come from shares and settlements, not from the register",
    );
}

/**
 * The book with every counterparty account and paired envelope its budgets
 * should hold, adding only what is missing. The server runs it when a budget
 * is created, when a partner joins, and on budgets made before these
 * accounts existed.
 */
export function withCounterpartyAccounts(book: Book): Book {
  const result = structuredClone(book);
  const partnered = Object.keys(result.budgets).length === 2;
  for (const budget of Object.values(result.budgets))
    for (const { kind, name } of counterparties) {
      if (kind === "partner" && !partnered) continue;
      const accountId = counterpartyId(kind);
      const existing = budget.accounts.find(
        (account) => account.id === accountId,
      );
      if (existing && existing.kind !== kind)
        fail("A budget account already uses a counterparty account's ID");
      if (!existing)
        budget.accounts.push({
          id: accountId,
          name,
          kind,
          openingBalance: 0,
          date: `${budget.startMonth}-01`,
        });
      const envelopeId = pairedEnvelopeId(kind);
      const envelope = budget.categories.find((item) => item.id === envelopeId);
      if (envelope && envelope.counterpartyAccountId !== accountId)
        fail("A category already uses a paired envelope's ID");
      if (!envelope)
        budget.categories.push({
          id: envelopeId,
          name,
          group: PEOPLE_GROUP,
          counterpartyAccountId: accountId,
        });
    }
  return result;
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

const active = (transaction: Transaction): boolean => !transaction.removed;

function rescaleLines(
  lines: TransactionLine[],
  amount: number,
): TransactionLine[] | undefined {
  const total = sum(lines.map((line) => line.amount));
  if (total === amount) return lines;
  if (!total) return undefined;
  const scaled = lines.map((line) => ({
    ...line,
    amount: Math.round((line.amount * amount) / total),
    ...(line.counterpartyShare
      ? {
          counterpartyShare: {
            ...line.counterpartyShare,
            amount: Math.round(
              line.counterpartyShare.amount * Math.abs(amount / total),
            ),
          },
        }
      : {}),
  }));
  const largest = scaled.reduce((a, b) =>
    Math.abs(b.amount) > Math.abs(a.amount) ? b : a,
  );
  largest.amount = safe(
    largest.amount + amount - sum(scaled.map((line) => line.amount)),
  );
  for (const line of scaled)
    if (line.counterpartyShare)
      line.counterpartyShare.amount = Math.min(
        line.counterpartyShare.amount,
        Math.abs(line.amount),
      );
  return scaled.every((line) => line.amount) ? scaled : undefined;
}

export function categoryLines(
  transaction: Pick<Transaction, "categoryId" | "lines" | "amount">,
): { categoryId: string; amount: number }[] {
  if (transaction.lines) return transaction.lines;
  return transaction.categoryId
    ? [{ categoryId: transaction.categoryId, amount: transaction.amount }]
    : [];
}
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
type Materialized = {
  cash: number;
  readyToAssign: number;
  accounts: Map<string, AccountMonth>;
  categories: Map<string, CategoryMonth>;
  snapshots: Map<string, Map<string, CategoryMonth>>;
  startingBalances: Map<string, number>;
};

// The rows a replay reads, grouped once by the month they fall in so each
// month touches only its own rows, with ID lookups that keep the first match
// as a list search would.
type MonthRows = {
  // Active transactions dated in the month, by date and then ID.
  transactions: Transaction[];
  assignments: Assignment[];
  // The partner's ledger entries dated in the month, by date and then ID.
  mirrored: PartnerEntry[];
};
type ReplayIndex = {
  months: Map<string, MonthRows>;
  account: (id: string) => Account;
  category: (id: string) => Category;
  transferCounterpart: (transaction: Transaction) => Transaction | undefined;
};

function firstById<T extends { id: string }>(items: T[]): Map<string, T> {
  const byId = new Map<string, T>();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  return byId;
}

function indexReplay(book: AccountingState, budget: Budget): ReplayIndex {
  const months = new Map<string, MonthRows>();
  const rows = (month: string): MonthRows => {
    let found = months.get(month);
    if (!found) {
      found = {
        transactions: [],
        assignments: [],
        mirrored: [],
      };
      months.set(month, found);
    }
    return found;
  };
  for (const transaction of budget.transactions)
    if (active(transaction))
      rows(monthOf(transaction.date)).transactions.push(transaction);
  if (partnerAccountOf(budget))
    for (const entry of mirroredEntries(book.partnerEntries, budget.userId))
      rows(monthOf(entry.date)).mirrored.push(entry);
  for (const { transactions, mirrored } of months.values()) {
    transactions.sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    mirrored.sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
  }
  for (const assignment of budget.assignments)
    rows(assignment.month).assignments.push(assignment);
  const accounts = firstById(budget.accounts);
  const categories = firstById(budget.categories);
  let transfers: Map<string, Transaction[]> | undefined;
  return {
    months,
    account: (id) => accounts.get(id) ?? fail("Account access denied"),
    category: (id) => categories.get(id) ?? fail("Category access denied"),
    // The first other active transaction of the same transfer, as
    // transferCounterparts would find it.
    transferCounterpart: (transaction) => {
      if (!isTransfer(transaction) || !transaction.linkedId) return undefined;
      if (!transfers) {
        transfers = new Map();
        for (const item of budget.transactions)
          if (!item.removed && isTransfer(item) && item.linkedId) {
            const linked = transfers.get(item.linkedId) ?? [];
            linked.push(item);
            transfers.set(item.linkedId, linked);
          }
      }
      return transfers
        .get(transaction.linkedId)
        ?.find((item) => item.id !== transaction.id);
    },
  };
}

// The budget whose months can be replayed through the given month.
function budgetThrough(
  book: AccountingState,
  userId: string,
  month: string,
): Budget {
  monthSchema.parse(month);
  const budget = ownBudget(book, userId);
  if (month < budget.startMonth) fail("Month precedes the budget start");
  if (monthDistance(budget.startMonth, month) > 1200)
    fail("Budget date is too far in the future");
  return budget;
}

function cashPosition(
  budget: Budget,
  accounts: Map<string, AccountMonth>,
  categories: Map<string, CategoryMonth>,
): { cash: number; readyToAssign: number } {
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
  };
}

// Adds to the month's assignment for the category, opening it under the
// given id when the category has none that month.
function addAssignment(
  changes: Changes,
  budget: Budget,
  categoryId: string,
  month: string,
  amount: number,
  id: string,
): void {
  const assignment = changes.assignment(budget, categoryId, month);
  if (assignment) assignment.amount = safe(assignment.amount + amount);
  else changes.addAssignment(budget, { id, categoryId, month, amount });
}

// The checks every change to assigned money passes: money released by the
// changes can fund their increases, but Ready to Assign never goes negative
// and no category gives back cash it does not hold.
function checkAssignmentChange(
  book: AccountingState,
  budget: Budget,
  month: string,
  changes: { categoryId: string; amount: number }[],
): void {
  const state = materialize(book, budget.userId, month);
  for (const change of changes)
    if (
      change.amount < 0 &&
      -change.amount >
        Math.max(0, state.categories.get(change.categoryId)!.available)
    )
      fail("Cannot unassign cash the category does not hold");
  if (
    changes.some((change) => change.amount > 0) &&
    state.readyToAssign < sum(changes.map((change) => change.amount))
  )
    fail("Assignments require existing Ready to Assign cash");
}

// Fails if any later month with assignments ends with negative Ready to
// Assign. One replay serves every later month; the months are still checked in
// the order their assignments were made, so the first failure reported is the
// one a separate replay per month would report.
function ensureLaterMonthsFunded(
  book: AccountingState,
  userId: string,
  month: string,
): void {
  const budget = ownBudget(book, userId);
  const laterMonths = [
    ...new Set(
      budget.assignments
        .filter((assignment) => assignment.month > month)
        .map((assignment) => assignment.month),
    ),
  ];
  // Months a replay cannot reach fail on their own turn below.
  const replayable = laterMonths.filter((laterMonth) => {
    try {
      budgetThrough(book, userId, laterMonth);
      return true;
    } catch {
      return false;
    }
  });
  const through = replayable.sort().at(-1);
  const wanted = new Set(laterMonths);
  const outcomes = new Map<string, { ready: number } | { error: unknown }>();
  let replayError: unknown;
  if (through)
    try {
      replay(book, budget, through, endOf(through), (cursor, readyToAssign) => {
        if (!wanted.has(cursor)) return;
        try {
          outcomes.set(cursor, { ready: readyToAssign() });
        } catch (error) {
          outcomes.set(cursor, { error });
        }
      });
    } catch (error) {
      replayError = error;
    }
  for (const laterMonth of laterMonths) {
    budgetThrough(book, userId, laterMonth);
    const outcome = outcomes.get(laterMonth);
    if (!outcome) throw replayError;
    if ("error" in outcome) throw outcome.error;
    if (outcome.ready < 0)
      fail("This cash is already assigned in a future month");
  }
}

// A budget's month-by-month figures through the given month. Exported for the
// equivalence tests; interface code reads them through projectBook.
export function materialize(
  book: AccountingState,
  userId: string,
  month: string,
  cutoff = endOf(month),
): Materialized {
  return replay(book, budgetThrough(book, userId, month), month, cutoff);
}

// A paired envelope's card spending is kept per counterparty, so a repayment
// funds the card its payer's shares were fronted on. Other categories' card
// spending is kept under the category's own ID.
const creditKey = (categoryId: string, counterpartyName = "") =>
  `${categoryId}\u0000${counterpartyName}`;
const creditCategory = (key: string) => key.split("\u0000")[0]!;

// Replays the budget month by month from its start through the given month.
// After each month, afterMonth can read that month's Ready to Assign.
function replay(
  book: AccountingState,
  budget: Budget,
  month: string,
  cutoff: string,
  afterMonth?: (month: string, readyToAssign: () => number) => void,
): Materialized {
  const userId = budget.userId;
  const index = indexReplay(book, budget);
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
  const carriedCounterpartyCredit = new Map<string, Map<string, number>>();
  const empty: MonthRows = {
    transactions: [],
    assignments: [],
    mirrored: [],
  };
  const partnerAccount = partnerAccountOf(budget);
  const partnerEnvelope =
    partnerAccount &&
    budget.categories.find(
      (item) => item.counterpartyAccountId === partnerAccount.id,
    );
  // What the viewer's own recorded purchases, still waiting for their
  // import, add to the Partner account so far.
  let unpaidPartnerEntries = 0;
  for (
    let cursor = budget.startMonth;
    cursor <= month;
    cursor = nextMonth(cursor)
  ) {
    const rows = index.months.get(cursor) ?? empty;
    for (const [categoryId, state] of categories) {
      state.opening = index.category(categoryId).counterpartyAccountId
        ? state.available
        : Math.max(0, state.available);
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
    const creditByCategory = new Map(
      [...carriedCounterpartyCredit].map(([key, cards]) => [
        key,
        new Map(cards),
      ]),
    );
    const priorCounterpartyCredit = new Map<string, number>();
    for (const [key, cards] of carriedCounterpartyCredit)
      priorCounterpartyCredit.set(
        creditCategory(key),
        safe(
          (priorCounterpartyCredit.get(creditCategory(key)) ?? 0) +
            sum([...cards.values()]),
        ),
      );
    carriedCounterpartyCredit.clear();
    const repaidByKey = new Map<string, number>();
    const cashByCategory = new Map<string, number>();
    const credits: Transaction[] = [];
    const payments: Transaction[] = [];
    const positiveCardCreditSpent = new Set<string>();
    const debtTransfers: { from: string; to: string; amount: number }[] = [];
    for (const assignment of rows.assignments) {
      const state = categories.get(assignment.categoryId)!;
      state.assigned = safe(state.assigned + assignment.amount);
      state.available = safe(state.available + assignment.amount);
      const category = index.category(assignment.categoryId);
      if (category.pairedAccountId)
        accounts.get(category.pairedAccountId)!.reserve = safe(
          accounts.get(category.pairedAccountId)!.reserve + assignment.amount,
        );
    }
    for (const transaction of rows.transactions) {
      if (transaction.date > cutoff) continue;
      const account = index.account(transaction.accountId);
      if (transaction.status === "pending" && transaction.amount > 0) continue;
      const accountState = accounts.get(account.id)!;
      if (
        account.kind === "credit" &&
        accountState.balance > 0 &&
        transaction.amount < 0
      )
        positiveCardCreditSpent.add(account.id);
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
        const other = index.transferCounterpart(transaction);
        if (other && index.account(other.accountId).kind === "credit")
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
      if (transaction.linkedCounterpartyAccountId) {
        const counterparty = accounts.get(
          transaction.linkedCounterpartyAccountId,
        )!;
        counterparty.balance = safe(counterparty.balance - transaction.amount);
        const category = budget.categories.find(
          (item) =>
            item.counterpartyAccountId ===
            transaction.linkedCounterpartyAccountId,
        )!;
        const state = categories.get(category.id)!;
        state.activity = safe(state.activity + transaction.amount);
        state.available = safe(state.available + transaction.amount);
        state.cashActivity = safe(state.cashActivity + transaction.amount);
        cashByCategory.set(
          category.id,
          safe((cashByCategory.get(category.id) ?? 0) + transaction.amount),
        );
        const key = creditKey(category.id, transaction.counterpartyName);
        repaidByKey.set(
          key,
          safe((repaidByKey.get(key) ?? 0) + Math.max(0, transaction.amount)),
        );
        // A partner paying your card directly is a repayment you paid
        // straight into the card: it funds the cards their shares were
        // fronted on, and this card's payment spends its reserve.
        if (account.kind === "credit") payments.push(transaction);
      }
      if (transaction.kind === "reimbursement" || transaction.kind === "income")
        continue;
      const accountingLines = counterpartyLines(transaction).flatMap(
        (line): { categoryId: string; amount: number; key?: string }[] => {
          const share = line.counterpartyShare;
          if (!share) return [line];
          const contribution = shareContribution(line.amount, share);
          const counterparty = accounts.get(share.accountId)!;
          counterparty.balance = safe(counterparty.balance + contribution);
          const paired = budget.categories.find(
            (item) => item.counterpartyAccountId === share.accountId,
          )!;
          return [
            {
              categoryId: line.categoryId,
              amount: safe(line.amount + contribution),
            },
            {
              categoryId: paired.id,
              amount: -contribution,
              key: creditKey(paired.id, share.counterpartyName),
            },
          ];
        },
      );
      for (const { categoryId, amount, key } of accountingLines) {
        const state = categories.get(categoryId)!;
        state.activity = safe(state.activity + amount);
        state.available = safe(state.available + amount);
        if (account.kind === "cash") {
          state.cashActivity = safe(state.cashActivity + amount);
          cashByCategory.set(
            categoryId,
            safe((cashByCategory.get(categoryId) ?? 0) + amount),
          );
        } else {
          const cards =
            creditByCategory.get(key ?? categoryId) ??
            new Map<string, number>();
          cards.set(account.id, safe((cards.get(account.id) ?? 0) - amount));
          creditByCategory.set(key ?? categoryId, cards);
        }
      }
    }
    // The partner's purchases: what the viewer owes for them moves their
    // Partner account, and their paired envelope holds it. Their side's
    // category, once chosen, spends the share as cash. The viewer's own
    // purchases still waiting for their import move only the account: no
    // account of theirs has paid them yet, so the envelope lacks nothing
    // for them and no category spends. What the partner pays toward them
    // before the import stays in the envelope for that payment.
    for (const entry of rows.mirrored) {
      if (!partnerAccount || !entryCounts(entry, cutoff)) continue;
      const change = mirroredChange(entry, userId);
      const counterparty = accounts.get(partnerAccount.id)!;
      counterparty.balance = safe(counterparty.balance + change);
      if (entry.payerId === userId) {
        unpaidPartnerEntries = safe(unpaidPartnerEntries + change);
        continue;
      }
      const categoryId = sideCategory(budget, entry.id);
      for (const [id, amount] of [
        [categoryId, change],
        [partnerEnvelope?.id, -change],
      ] as const) {
        if (!id || !amount) continue;
        const state = categories.get(id)!;
        state.activity = safe(state.activity + amount);
        state.available = safe(state.available + amount);
        state.cashActivity = safe(state.cashActivity + amount);
        cashByCategory.set(id, safe((cashByCategory.get(id) ?? 0) + amount));
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
      key: string;
      cardId: string;
      remaining: number;
    }[] = [];
    const refunds: { categoryId: string; cardId: string; remaining: number }[] =
      [];
    for (const [categoryId, state] of categories) {
      if (index.category(categoryId).pairedAccountId) continue;
      liquidity.set(
        categoryId,
        safe(
          state.opening +
            (priorCounterpartyCredit.get(categoryId) ?? 0) +
            state.assigned +
            (cashByCategory.get(categoryId) ?? 0),
        ),
      );
    }
    for (const [key, cards] of creditByCategory) {
      const categoryId = creditCategory(key);
      if (!liquidity.has(categoryId)) continue;
      for (const [cardId, amount] of cards) {
        if (amount > 0)
          purchases.push({ categoryId, key, cardId, remaining: amount });
        if (amount < 0)
          refunds.push({ categoryId, cardId, remaining: -amount });
      }
    }
    const fund = (purchase: (typeof purchases)[number], amount: number) => {
      const card = accounts.get(purchase.cardId)!;
      card.reserve = safe(card.reserve + amount);
      card.fundedSpending = safe(card.fundedSpending + amount);
      liquidity.set(
        purchase.categoryId,
        safe(liquidity.get(purchase.categoryId)! - amount),
      );
      purchase.remaining = safe(purchase.remaining - amount);
      paymentNeeds.set(
        purchase.cardId,
        Math.max(0, (paymentNeeds.get(purchase.cardId) ?? 0) - amount),
      );
    };
    // A repayment first funds the cards its payer's shares were fronted on;
    // only the rest restores the envelope's cash.
    for (const purchase of [...purchases].sort(
      (a, b) => a.key.localeCompare(b.key) || a.cardId.localeCompare(b.cardId),
    )) {
      const repaid = repaidByKey.get(purchase.key) ?? 0;
      const amount = Math.min(purchase.remaining, repaid);
      if (!amount) continue;
      fund(purchase, amount);
      repaidByKey.set(purchase.key, safe(repaid - amount));
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
          a.key.localeCompare(b.key),
      );
      for (const purchase of purchases) {
        const amount = Math.min(
          purchase.remaining,
          Math.max(0, liquidity.get(purchase.categoryId) ?? 0),
        );
        if (!amount) continue;
        fund(purchase, amount);
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
    // Paired envelope card spending still unfunded carries into later months.
    // Card debt that cash paid before a reserve funded it is cash-backed now,
    // so it leaves the carried credit and the payment's shortfall.
    for (const purchase of purchases) {
      if (
        !purchase.remaining ||
        !index.category(purchase.categoryId).counterpartyAccountId
      )
        continue;
      const cards =
        carriedCounterpartyCredit.get(purchase.key) ??
        new Map<string, number>();
      cards.set(
        purchase.cardId,
        safe((cards.get(purchase.cardId) ?? 0) + purchase.remaining),
      );
      carriedCounterpartyCredit.set(purchase.key, cards);
    }
    for (const transfer of debtTransfers) {
      let remaining = transfer.amount;
      for (const cards of carriedCounterpartyCredit.values()) {
        const moved = Math.min(remaining, cards.get(transfer.from) ?? 0);
        if (!moved) continue;
        cards.set(transfer.from, cards.get(transfer.from)! - moved);
        cards.set(transfer.to, safe((cards.get(transfer.to) ?? 0) + moved));
        remaining -= moved;
      }
    }
    for (const account of budget.accounts.filter(
      (item) => item.kind === "credit",
    )) {
      const state = accounts.get(account.id)!;
      let remainingDebt = Math.max(0, -state.balance - state.reserve);
      for (const cards of carriedCounterpartyCredit.values()) {
        const debt = Math.min(cards.get(account.id) ?? 0, remainingDebt);
        paidCashShortfall = Math.max(
          0,
          safe(paidCashShortfall - ((cards.get(account.id) ?? 0) - debt)),
        );
        cards.set(account.id, debt);
        remainingDebt -= debt;
      }
    }
    for (const [categoryId, state] of categories) {
      const category = index.category(categoryId);
      if (category.pairedAccountId || category.counterpartyAccountId) continue;
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
    for (const account of budget.accounts.filter(
      (item) => item.kind === "credit",
    )) {
      const state = accounts.get(account.id)!;
      if (state.balance > 0 || positiveCardCreditSpent.has(account.id)) {
        const reserve = Math.min(state.reserve, Math.max(0, -state.balance));
        state.creditsReleased = safe(
          state.creditsReleased + reserve - state.reserve,
        );
        state.reserve = reserve;
      }
    }
    for (const category of budget.categories)
      if (category.pairedAccountId) {
        const state = categories.get(category.id)!;
        const account = accounts.get(category.pairedAccountId)!;
        state.available = account.reserve;
        state.activity = safe(state.available - state.opening - state.assigned);
      }
    for (const category of budget.categories) {
      if (!category.counterpartyAccountId) continue;
      const state = categories.get(category.id)!;
      const float = sum(
        budget.assignments
          .filter(
            (item) => item.categoryId === category.id && item.month <= cursor,
          )
          .map((item) => item.amount),
      );
      // The viewer's purchases still waiting for their import are owed to
      // them but not yet paid by them, so the envelope holds against the
      // rest of the account.
      const unpaid =
        category.id === partnerEnvelope?.id ? unpaidPartnerEntries : 0;
      state.available = safe(
        float - accounts.get(category.counterpartyAccountId)!.balance + unpaid,
      );
      // Whatever the envelope lacks beyond its unfunded card credit was paid
      // in cash. It stays cash overspending until repaid or covered, since the
      // envelope never clips and a repayment never reaches Ready to Assign.
      const cardCredit = sum(
        [...carriedCounterpartyCredit]
          .filter(([key]) => creditCategory(key) === category.id)
          .flatMap(([, cards]) => [...cards.values()]),
      );
      state.cashOverspending = Math.max(0, safe(-state.available - cardCredit));
    }
    snapshots.set(
      cursor,
      new Map([...categories].map(([id, state]) => [id, { ...state }])),
    );
    afterMonth?.(
      cursor,
      () => cashPosition(budget, accounts, categories).readyToAssign,
    );
  }
  for (const account of budget.accounts) {
    const state = accounts.get(account.id)!;
    state.shortfall =
      account.kind === "credit"
        ? Math.max(0, -state.balance - state.reserve)
        : 0;
  }
  return {
    ...cashPosition(budget, accounts, categories),
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

// A Book, or one partner's personal ledger when the other partner's budget
// can't be read.
export function projectBook(
  book: AccountingState,
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
  const personalSpending = sum(
    personalSpendingEntries(book, userId)
      .filter((entry) => entry.month === month)
      .map((entry) => entry.amount),
  );
  let amountPaid = 0;
  let earnings = 0;
  for (const transaction of budget.transactions.filter(active)) {
    if (
      transaction.expenseMonth !== month ||
      getAccount(budget, transaction.accountId).kind === "tracking"
    )
      continue;
    if (transaction.kind === "income" && transaction.status === "posted")
      earnings = safe(earnings + transaction.amount);
    if (
      transaction.kind === "purchase" ||
      transaction.kind === "refund" ||
      (transaction.kind === "transfer" && transaction.categoryId)
    )
      amountPaid = safe(amountPaid - transaction.amount);
  }
  const result = {
    budget: structuredClone(budget),
    month,
    readyToAssign: calculated.readyToAssign,
    cash: calculated.cash,
    categories: budget.categories.map((category) => {
      const state = calculated.categories.get(category.id)!;
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
                state.cashActivity,
            ),
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
      cleared: isCounterparty(account)
        ? safe(
            sum(
              counterpartyRegisterEntries(budget, {
                accountId: account.id,
                cutoff,
              }).map((entry) => entry.amount),
            ) +
              (account.kind === "partner"
                ? sum(
                    mirroredEntries(book.partnerEntries, userId)
                      .filter((entry) => entryCounts(entry, cutoff))
                      .map((entry) => mirroredChange(entry, userId)),
                  )
                : 0),
          )
        : clearedBalance(budget, account),
    })),
    personalSpending,
    amountPaid,
    earnings,
    sharedLedger: projectSharedLedger(book),
    counterpartyRegister: counterpartyRegisterEntries(budget, { cutoff }),
    partnerLedger: partnerLedgerRows(
      budget,
      book.partnerEntries,
      cutoff,
      activeSettlements(book.partnerSettlements),
    ),
    partnerSettlements: activeSettlements(book.partnerSettlements),
    partnerRequest: openRequest(book.partnerRequests, book.partnerSettlements),
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

/**
 * One partner's personal ledger from the whole household, as the browser
 * builds it from the budget view: their own budget and the household facts
 * their numbers use.
 */
export function personalLedger(book: Book, userId: string): PersonalLedger {
  return {
    ...projectSharedLedger(book),
    kind: "personal",
    budget: structuredClone(ownBudget(book, userId)),
    members: ledgerMembers(book),
    audit: structuredClone(
      book.audit.filter((entry) => entry.actorId === userId),
    ),
  };
}

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
    audit: view.audit,
  };
  const next = executeWithChanges(
    ledger,
    view.budget.userId,
    command,
    "user",
    command,
  ).book;
  return projectAccountingState(
    next,
    view.budget.userId,
    view.month,
    currentMonth,
  );
}

function validateCardPayment(
  book: AccountingState,
  budget: Budget,
  cashAccountId: string,
  cardAccountId: string,
  date: string,
  amount: number,
) {
  requireCash(budget, cashAccountId, date);
  if (accountAtDate(budget, cardAccountId, date).kind !== "credit")
    fail("Select a credit-card account");
  const calculated = materialize(book, budget.userId, monthOf(date), date);
  const state = calculated.accounts.get(cardAccountId)!;
  const remaining = materialize(
    book,
    budget.userId,
    monthOf(date),
  ).accounts.get(cardAccountId)!;
  if (
    amount > Math.min(state.reserve, remaining.reserve) ||
    amount > Math.min(-state.balance, -remaining.balance)
  )
    fail("Card payment exceeds existing reserve or card debt");
  if (amount > calculated.accounts.get(cashAccountId)!.balance)
    fail("Card payment requires cash already received by its payment date");
}

function saveRegisterTransaction(
  book: AccountingState,
  budget: Budget,
  command: Extract<ParsedCommand, { type: "transaction.save" }>,
  source: CommandSource,
  changes: Changes,
) {
  requireDate(budget, command.date);
  const account = accountAtDate(budget, command.accountId, command.date);
  const existing = budget.transactions.find(
    (item) => item.id === command.transactionId,
  );
  if (existing?.removed) fail("This transaction was removed");
  if (
    existing &&
    ![
      "purchase",
      "refund",
      "income",
      "transfer",
      "card-payment",
      "loan-payment",
    ].includes(existing.kind)
  )
    fail("This kind of transaction cannot be edited in the register");
  if (
    existing &&
    (command.accountId !== existing.accountId ||
      command.revision !== existing.revision + 1)
  )
    fail("This transaction changed. Reopen it before saving");
  if (existing) ensureReconciledUnchanged(existing, command);
  if (command.transferAccountId && command.loanId)
    fail("Choose one payment or transfer destination");
  if (
    command.providerId &&
    budget.transactions.some(
      (item) =>
        active(item) &&
        item.id !== command.transactionId &&
        item.providerId === command.providerId,
    )
  )
    fail("Provider transaction already exists");
  if (
    (command.transferAccountId || command.loanId) &&
    existing &&
    budget.transactions.some(
      (item) => active(item) && item.refundOfTransactionId === existing.id,
    )
  )
    fail("Resolve linked refunds before converting their purchase");
  const paired =
    existing && (isTransfer(existing) || existing.kind === "loan-payment");
  if (!paired && !command.transferAccountId && !command.loanId) {
    applyCommand(
      book,
      budget,
      { ...command, type: "transaction.upsert" },
      source,
      changes,
    );
    return;
  }
  if (command.lines) fail("A transfer cannot be split");
  if (
    command.counterpartyShare ||
    existing?.counterpartyShare ||
    existing?.lines?.some((line) => line.counterpartyShare) ||
    command.refundOfTransactionId ||
    existing?.refundOfTransactionId
  )
    fail(
      "Resolve counterparty shares and linked refunds before converting to a transfer",
    );
  if (!command.amount) fail("Enter a nonzero amount");
  const counterparts = existing ? transferCounterparts(budget, existing) : [];
  if (existing && isTransfer(existing) && counterparts.length !== 1)
    fail("The other side of this transfer is missing or ambiguous");
  const previous = existing ? structuredClone(existing) : undefined;
  const otherPrevious = counterparts[0]
    ? structuredClone(counterparts[0])
    : undefined;
  // Exclude the old facts while checking the replacement's cash, reserve and debt.
  if (existing) changes.transaction(budget, existing).removed = true;
  for (const item of counterparts)
    changes.transaction(budget, item).removed = true;
  if (existing?.kind === "loan-payment") {
    const loan =
      budget.loans.find((item) =>
        item.payments.some((payment) => payment.id === existing.linkedId),
      ) ?? fail("The confirmed loan payment could not be found");
    changes.loan(budget, loan).payments = loan.payments.filter(
      (payment) => payment.id !== existing.linkedId,
    );
  }
  const write = (
    facts: Omit<Transaction, "revision" | "history" | "reviewed">,
    before?: Transaction,
  ) => {
    const revision = (before?.revision ?? 0) + 1;
    const saved: Transaction = {
      ...facts,
      reconciled: before?.reconciled,
      revision,
      reviewed:
        source === "user"
          ? (previous?.reviewed ?? command.reviewed ?? true)
          : false,
      history: [
        ...(before?.history ?? []),
        {
          revision,
          amount: facts.amount,
          status: facts.status,
          date: facts.date,
          payee: facts.payee,
          operationId: command.id,
          reason: before ? "updated" : "created",
        },
      ],
    };
    if (!before && budget.transactions.some((item) => item.id === facts.id))
      fail("Transaction ID already exists");
    changes.putTransaction(budget, saved);
  };
  const base = {
    id: command.transactionId,
    accountId: account.id,
    date: command.date,
    amount: command.amount,
    payee: command.payee,
    status: command.status,
    expenseMonth: command.expenseMonth ?? monthOf(command.date),
    providerId: previous?.providerId ?? command.providerId,
  };
  const linkedId = paired ? previous!.linkedId! : command.id;
  let retainedCounterpart: string | undefined;
  if (command.transferAccountId) {
    if (command.transferAccountId === account.id)
      fail("Choose a different account");
    const other = accountAtDate(
      budget,
      command.transferAccountId,
      command.date,
    );
    let categoryId: string | undefined;
    if (transferNeedsCategory(account, other)) {
      const budgetAmount =
        account.kind === "tracking" ? -command.amount : command.amount;
      if (command.categoryId === READY_TO_ASSIGN) {
        if (budgetAmount < 0)
          fail("Choose a spending category for money leaving the budget");
      } else {
        const category = getCategory(budget, command.categoryId ?? "");
        refusePairedEnvelope(category);
        if (category.pairedAccountId || category.pairedLoanId)
          fail("Choose a spending category for this transfer");
        categoryId = category.id;
      }
    }
    const sending = command.amount < 0 ? account : other;
    const receiving = command.amount < 0 ? other : account;
    const kind =
      sending.kind === "cash" && receiving.kind === "credit"
        ? "card-payment"
        : "transfer";
    if (kind === "card-payment")
      validateCardPayment(
        book,
        budget,
        sending.id,
        receiving.id,
        command.date,
        Math.abs(command.amount),
      );
    const reusable =
      otherPrevious?.accountId === other.id ? otherPrevious : undefined;
    if (reusable)
      ensureReconciledUnchanged(reusable, {
        amount: -command.amount,
        status: command.status,
      });
    retainedCounterpart = reusable?.id ?? `${command.id}:counterpart`;
    write(
      {
        ...base,
        kind,
        linkedId,
        categoryId,
        payee: transferPayee(account, other, command.amount),
      },
      previous,
    );
    write(
      {
        ...base,
        id: retainedCounterpart,
        accountId: other.id,
        amount: -command.amount,
        payee: transferPayee(other, account, -command.amount),
        providerId: reusable?.providerId,
        kind,
        linkedId,
        categoryId,
      },
      reusable,
    );
  } else if (command.loanId) {
    requireCash(budget, account.id, command.date);
    const loan =
      budget.loans.find((item) => item.id === command.loanId) ??
      fail("Loan access denied");
    if (command.categoryId !== loan.categoryId)
      fail("Choose the loan's payment category");
    if (
      command.amount >= 0 ||
      command.interest === undefined ||
      command.interest > -command.amount
    )
      fail("Enter the payment outflow and lender-confirmed interest");
    if (command.status !== "posted")
      fail("Loan payments require confirmed posted activity");
    if (command.date < loan.rates[0]!.effectiveDate)
      fail("Payment predates the loan");
    const interest =
      command.interest ?? fail("Enter lender-confirmed interest");
    const principal = -command.amount - interest;
    if (
      principal >
      loan.principal - sum(loan.payments.map((item) => item.principal))
    )
      fail("Confirmed principal exceeds the remaining loan balance");
    changes.loan(budget, loan).payments.push({
      id: linkedId,
      date: command.date,
      principal,
      interest,
    });
    write(
      {
        ...base,
        kind: "loan-payment",
        linkedId,
        categoryId: loan.categoryId,
        payee: `Payment to ${loan.name}`,
      },
      previous,
    );
  } else {
    // The edited side becomes the plain transaction. Its counterpart is retired.
    if (existing) {
      existing.removed = false;
      existing.kind = "purchase";
      delete existing.linkedId;
      delete existing.categoryId;
    }
    applyCommand(
      book,
      budget,
      { ...command, type: "transaction.upsert" },
      source,
      changes,
    );
  }
  for (const item of counterparts) {
    if (item.id === retainedCounterpart) continue;
    item.history.push({
      revision: ++item.revision,
      amount: item.amount,
      status: item.status,
      date: item.date,
      payee: item.payee,
      operationId: command.id,
      reason: "removed",
    });
  }
}

function appendTransaction(
  changes: Changes,
  budget: Budget,
  operationId: string,
  input: Omit<Transaction, "revision" | "history" | "reviewed">,
): void {
  if (budget.transactions.some((transaction) => transaction.id === input.id))
    fail("Transaction ID already exists");
  changes.addTransaction(budget, {
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
// What the bank has finished processing: the opening balance plus every
// cleared transaction, whatever its date.
function clearedBalance(budget: Budget, account: Account): number {
  return budget.transactions
    .filter(
      (item) =>
        active(item) &&
        item.accountId === account.id &&
        item.status === "posted",
    )
    .reduce((total, item) => safe(total + item.amount), account.openingBalance);
}
// Reconciling confirmed these against the bank, so only what doesn't change
// the cleared balance can still change.
function ensureReconciledUnchanged(
  existing: Transaction,
  next: { amount: number; status: "pending" | "posted" },
): void {
  if (
    existing.reconciled &&
    (existing.amount !== next.amount || existing.status !== next.status)
  )
    fail(
      "This transaction is reconciled, so its amount and cleared status can't change",
    );
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
/**
 * The checks a ledger restored by a revert passes before it is saved: every
 * stored reference holds and no card balance turns positive. Restored rows can be
 * ones later changes rely on, so the checks cover the whole ledger.
 */
export function checkRestoredLedger(state: AccountingState): void {
  const readable = isPersonalLedger(state)
    ? budgetSchema.safeParse(state.budget).success &&
      householdSchema.safeParse(state).success
    : bookSchema.safeParse(state).success;
  const budgets = isPersonalLedger(state)
    ? [state.budget]
    : Object.values(state.budgets);
  if (!readable)
    fail("This can't be undone because later changes depend on it");
  for (const budget of budgets) ensureSupportedCardBalances(budget);
}

function isPostedLinkedCardRefund(
  budget: Budget,
  transaction: Transaction,
): boolean {
  if (
    transaction.kind !== "refund" ||
    transaction.amount <= 0 ||
    transaction.status !== "posted" ||
    !transaction.refundOfTransactionId
  )
    return false;
  const original = budget.transactions.find(
    (item) => active(item) && item.id === transaction.refundOfTransactionId,
  );
  return Boolean(
    original?.kind === "purchase" &&
    original.amount < 0 &&
    original.accountId === transaction.accountId &&
    original.date <= transaction.date,
  );
}

function ensureSupportedCardBalances(budget: Budget): void {
  for (const account of budget.accounts.filter(
    (item) => item.kind === "credit",
  )) {
    const activity = new Map<string, number>();
    const linkedCredits = new Map<string, number>();
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
      if (isPostedLinkedCardRefund(budget, transaction))
        linkedCredits.set(
          month,
          safe((linkedCredits.get(month) ?? 0) + transaction.amount),
        );
    }
    let balance = account.openingBalance;
    for (const month of [...activity.keys()].sort()) {
      const priorCredit = Math.max(0, balance);
      balance = safe(balance + activity.get(month)!);
      if (balance > priorCredit + (linkedCredits.get(month) ?? 0))
        fail(
          "This change would create a positive card balance; investigate recorded credits and payments first",
        );
    }
  }
}

/**
 * Applies a command to the actor's budget. `submitted` is the command as its
 * author sent it, before validation or preparation; it identifies retries, so
 * a retry is recognized even when a later release validates it differently.
 */
export function execute<T extends AccountingState>(
  original: T,
  actorId: string,
  input: Command,
  source: CommandSource = "user",
  submitted: unknown = input,
): T {
  return executeWithChanges(original, actorId, input, source, submitted).book;
}

export type ChangeSetObserver = (run: {
  before: AccountingState;
  after: AccountingState;
  actorId: string;
  command: Command;
  changeSet: ChangeSet;
}) => void;
let changeSetObserver: ChangeSetObserver | undefined;

/**
 * Lets the tests check every executed command's change set against a full
 * comparison of the ledger's rows (ADR 0006). Production code never sets it.
 */
export function observeChangeSets(observer?: ChangeSetObserver): void {
  changeSetObserver = observer;
}

/**
 * Applies a command like execute and also returns its change set: every row
 * it added, changed, or removed, with the row's prior content. Revisions are
 * 0 until the server stamps them. A retried operation changes nothing.
 */
export function executeWithChanges<T extends AccountingState>(
  original: T,
  actorId: string,
  input: Command,
  source: CommandSource = "user",
  submitted: unknown = input,
): { book: T; changeSet: ChangeSet } {
  const result = executeAccountingState(
    original,
    actorId,
    input,
    source,
    submitted,
  );
  changeSetObserver?.({
    before: original,
    after: result.book,
    actorId,
    command: input,
    changeSet: result.changeSet,
  });
  return result;
}

function executeAccountingState<T extends AccountingState>(
  original: T,
  actorId: string,
  input: Command,
  source: CommandSource,
  submitted: unknown,
): { book: T; changeSet: ChangeSet } {
  const command = commandSchema.parse(input);
  ownBudget(original, actorId);
  const fingerprint = canonicalJson(submitted);
  const previous = original.audit.find(
    (entry) => entry.id === command.id && entry.actorId === actorId,
  );
  if (previous) {
    // Books saved by earlier releases hold the validated command's JSON.
    if (
      previous.fingerprint !== fingerprint &&
      previous.fingerprint !== JSON.stringify(command)
    )
      fail("Operation ID was already used with different data");
    return {
      book: structuredClone(original),
      changeSet: {
        operationId: command.id,
        revision: 0,
        after: [],
        before: [],
      },
    };
  }
  const userOnly = [
    "assign",
    "assign.set",
    "assign.batch",
    "cover",
    "target.set",
    "target.snooze",
    "account.add",
    "account.reconcile",
    "group.add",
    "group.reorder",
    "category.add",
    "category.import",
    "settings.update",
    "income.expect",
    "loan.add",
    "loan.rate",
    "transaction.approve",
    "transaction.reject",
    "partner.settlement.reject",
  ];
  if (source !== "user" && userOnly.includes(command.type))
    fail("This decision requires a user action");
  const book = structuredClone(original);
  for (const folded of isPersonalLedger(book)
    ? [book.budget]
    : Object.values(book.budgets))
    folded.assignments = foldAssignments(folded.assignments);
  const budget = ownBudget(book, actorId);
  const changes = new Changes(book);
  applyCommand(book, budget, command, source, changes);
  synchronizePartnerEntries(book, changes, {
    actorId,
    operationId: command.id,
    at: "recordedAt" in command ? command.recordedAt : undefined,
  });
  ensureNoCounterpartyEntries(budget);
  if (source === "user")
    rememberCategorizations(
      budget,
      changes,
      command.type === "transaction.categorize" ||
        command.type === "transaction.categorize.batch",
    );
  if (
    [
      "transaction.upsert",
      "transaction.save",
      "transaction.remove",
      "transaction.reject",
      "transaction.merge",
      "card.payment",
      "card.credit",
    ].includes(command.type)
  )
    ensureSupportedCardBalances(budget);
  book.audit.push({
    id: command.id,
    actorId,
    source,
    type: command.type,
    sequence: book.audit.length + 1,
    fingerprint,
  });
  return { book, changeSet: changes.changeSet(command.id) };
}

function recomputeLinkedRefunds(
  book: AccountingState,
  budget: Budget,
  transactionId: string,
  operationId: string,
  recordedAt: string | undefined,
  source: CommandSource,
  changes: Changes,
  savedRefundId?: string,
): void {
  const refunds = budget.transactions
    .filter(
      (item) => active(item) && item.refundOfTransactionId === transactionId,
    )
    .sort(refundOrder);
  if (!refunds.length) return;
  const original = getTransaction(budget, transactionId);
  if (
    original.kind !== "purchase" ||
    sum(refunds.map((item) => item.amount)) > -original.amount
  )
    fail("The corrected purchase cannot be smaller than its linked refunds");
  for (const refund of refunds)
    if (refund.id !== savedRefundId)
      changes.transaction(budget, refund).removed = true;
  for (const refund of refunds) {
    if (refund.id === savedRefundId) continue;
    applyCommand(
      book,
      budget,
      {
        type: "transaction.upsert",
        id: operationId,
        transactionId: refund.id,
        accountId: refund.accountId,
        amount: refund.amount,
        date: refund.date,
        payee: refund.payee,
        status: refund.status,
        expenseMonth: refund.expenseMonth,
        refundOfTransactionId: transactionId,
        recordedAt,
      },
      source,
      changes,
      true,
    );
  }
}

// One partner's category for their side of an entry, which their payee
// memory then remembers for the payee.
function categorizeSide(
  budget: Budget,
  entry: PartnerEntry,
  categoryId: string,
  source: CommandSource,
  changes: Changes,
): void {
  const category = getCategory(budget, categoryId);
  if (!spendingCategory(category))
    fail("Choose a spending category for your share");
  changes.partnerSide(budget, entry.id)[entry.id] = {
    categoryId: category.id,
  };
  const key = payeeKey(entry.payee);
  const remembered = budget.payeeMemory?.[key];
  if (
    source === "user" &&
    key &&
    (remembered?.kind !== "category" ||
      remembered.categoryId !== category.id ||
      remembered.payee !== entry.payee)
  )
    changes.payeeMemory(budget, key)[key] = {
      ...(remembered?.counterpartyShare
        ? { counterpartyShare: remembered.counterpartyShare }
        : {}),
      payee: entry.payee,
      kind: "category",
      categoryId: category.id,
    };
}

// The payer's bank import of a purchase recorded before it arrived: it
// becomes their transaction, sharing the entry's share with their Partner
// account, and the entry's source from then on. The entry keeps its id,
// history, and the other partner's side; the payer's own side becomes the
// transaction's category.
function matchPartnerImport(
  book: AccountingState,
  budget: Budget,
  command: Extract<ParsedCommand, { type: "partner.match" }>,
  source: CommandSource,
  changes: Changes,
): void {
  const entry = partnerEntry(book, command.entryId);
  if (entry.payerId !== budget.userId)
    fail("Only the partner who paid can match their bank import");
  if (!awaitingImport(entry))
    fail("This shared entry is already matched to a bank import");
  if (command.amount !== entry.amount)
    fail("A bank import matches a recorded purchase of the same amount");
  if (budget.transactions.some((item) => item.id === command.transactionId))
    fail("This transaction ID already exists");
  const partner = partnerAccountOf(budget);
  if (!partner) fail("Link your partner's budget first");
  const categoryId =
    command.categoryId ?? budget.partnerSides?.[entry.id]?.categoryId;
  if (!categoryId) fail("Choose a category for your part of it");
  applyCommand(
    book,
    budget,
    {
      type: "transaction.upsert",
      id: command.id,
      recordedAt: command.recordedAt,
      transactionId: command.transactionId,
      accountId: command.accountId,
      date: command.date,
      amount: entry.amount,
      // The name it was recorded under, which both ledgers already show.
      payee: entry.payee,
      status: command.status,
      categoryId,
      counterpartyShare: { accountId: partner!.id, amount: entry.share },
      providerId: command.providerId,
      reviewed: false,
    },
    source,
    changes,
  );
  const transaction = getTransaction(budget, command.transactionId);
  const [line] = partnerLines(budget, transaction);
  matchEntry(changes, entry, lineFacts(budget.userId, transaction, line!), {
    actorId: budget.userId,
    operationId: command.id,
    at: command.recordedAt,
  });
  if (budget.partnerSides?.[entry.id]) {
    const sides = changes.partnerSide(budget, entry.id);
    delete sides[entry.id];
    if (!Object.keys(sides).length) delete budget.partnerSides;
  }
}

function partnerEntry(book: AccountingState, entryId: string): PartnerEntry {
  const entry = book.partnerEntries?.find((item) => item.id === entryId);
  if (!entry || entry.removed) fail("This shared entry was removed");
  return entry!;
}

// A change to a shared entry, from either partner. It changes the payer's
// transaction line, and the entry follows it. A partner's browser holds
// only the entry, so there it changes the entry alone, as the server's
// result will.
function editPartnerEntry(
  book: AccountingState,
  budget: Budget,
  command: Extract<ParsedCommand, { type: "partner.edit" }>,
  source: CommandSource,
  changes: Changes,
): void {
  const entry = partnerEntry(book, command.entryId);
  const amount =
    command.amount === undefined
      ? entry.amount
      : Math.sign(entry.amount) * command.amount;
  const share = command.share ?? Math.min(entry.share, Math.abs(amount));
  if (share > Math.abs(amount))
    fail("A share can't be more than the shared amount");
  if (source === "user" && !command.recordedAt)
    fail("Share edits require their recorded time");
  const payer = isPersonalLedger(book)
    ? book.budget.userId === entry.payerId
      ? book.budget
      : undefined
    : book.budgets[entry.payerId];
  const sourceLine = entry.source;
  if (!payer || !sourceLine) {
    writeEntry(
      book,
      changes,
      entry.id,
      {
        ...entry,
        amount,
        share,
        date: command.date ?? entry.date,
        payee: command.payee ?? entry.payee,
      },
      {
        actorId: budget.userId,
        operationId: command.id,
        at: command.recordedAt,
      },
    );
    return;
  }
  const transaction = getTransaction(payer, sourceLine.transactionId);
  const line = counterpartyLines(transaction).find(
    (item) => item.id === sourceLine.lineId,
  );
  if (transaction.removed || !line?.counterpartyShare)
    fail("This shared entry was removed");
  if (transaction.refundOfTransactionId)
    fail("A linked refund's share follows its purchase. Change the purchase");
  if (transaction.lines && amount !== line!.amount)
    fail("Change a split purchase's amounts on the purchase itself");
  const date = command.date ?? transaction.date;
  requireDate(payer, date);
  const counterpartyShare = { ...line!.counterpartyShare!, amount: share };
  applyCommand(
    book,
    payer,
    {
      type: "transaction.upsert",
      id: command.id,
      recordedAt: command.recordedAt,
      transactionId: transaction.id,
      accountId: transaction.accountId,
      date,
      amount: transaction.lines ? transaction.amount : amount,
      payee: command.payee ?? transaction.payee,
      status: transaction.status,
      expenseMonth:
        transaction.expenseMonth === monthOf(transaction.date)
          ? monthOf(date)
          : transaction.expenseMonth,
      providerId: transaction.providerId,
      revision: transaction.revision + 1,
      reviewed: transaction.reviewed,
      ...(transaction.lines
        ? {
            lines: transaction.lines.map((item) => ({
              lineId: item.id,
              categoryId: item.categoryId,
              amount: item.amount,
              counterpartyShare:
                item.id === line!.id
                  ? counterpartyShare
                  : (item.counterpartyShare ?? null),
            })),
          }
        : { categoryId: transaction.categoryId, counterpartyShare }),
    },
    source,
    changes,
  );
  ensureSupportedCardBalances(payer);
  // The payer's history names who made the change.
  const saved = getTransaction(payer, transaction.id);
  changes.transaction(payer, saved).history.at(-1)!.actorId = budget.userId;
}

// One confirmation, by either partner, resolves both sides.
function confirmSettlement(
  changes: Changes,
  settlement: PartnerSettlement,
  write: { actorId: string; operationId: string; at?: string },
): void {
  if (settlement.confirmed) return;
  const tracked = changes.partnerSettlement(settlement);
  tracked.confirmed = true;
  tracked.history.push({
    actorId: write.actorId,
    operationId: write.operationId,
    ...(write.at ? { at: write.at } : {}),
    reason: "confirmed",
  });
}

// A payment between the partners, with both partners' legs: the payer's
// out of a cash account, the recipient's into a cash account or credit
// card. Only the household's whole book holds both budgets, so a partner's
// browser can't record one.
function recordSettlement(
  book: AccountingState,
  actor: Budget,
  command: Extract<ParsedCommand, { type: "partner.settle" }>,
  changes: Changes,
): void {
  if (isPersonalLedger(book))
    return fail("A settlement is recorded in both partners' budgets at once");
  const members = Object.keys(book.budgets);
  const [paid, received] = [...command.legs].sort(
    (a, b) => a.amount - b.amount,
  );
  if (
    members.length !== 2 ||
    paid!.amount >= 0 ||
    received!.amount !== -paid!.amount ||
    paid!.userId === received!.userId ||
    !members.includes(paid!.userId) ||
    !members.includes(received!.userId) ||
    !command.legs.some((leg) => leg.userId === actor.userId)
  )
    fail(
      "A settlement is one partner's payment out and the other's matching payment in",
    );
  if (book.partnerSettlements?.some((item) => item.id === command.settlementId))
    fail("Settlement ID already exists");
  for (const leg of command.legs) {
    const budget = book.budgets[leg.userId]!;
    requireDate(budget, leg.date);
    const account = accountAtDate(budget, leg.accountId, leg.date);
    if (
      account.kind !== "cash" &&
      !(account.kind === "credit" && leg.amount > 0)
    )
      fail(
        "A settlement leaves a cash account and arrives in a cash account or credit card",
      );
    const partner =
      partnerAccountOf(budget) ?? fail("Both budgets need a Partner account");
    if (
      leg.providerId &&
      budget.transactions.some(
        (transaction) =>
          active(transaction) && transaction.providerId === leg.providerId,
      )
    )
      fail("Provider transaction already exists");
    appendTransaction(changes, budget, command.id, {
      id: settlementLegId(command.settlementId, leg.userId),
      accountId: account.id,
      date: leg.date,
      amount: leg.amount,
      payee: leg.payee,
      status: "posted",
      expenseMonth: monthOf(leg.date),
      kind: "reimbursement",
      linkedCounterpartyAccountId: partner.id,
      partnerSettlementId: command.settlementId,
      ...(leg.providerId ? { providerId: leg.providerId } : {}),
    });
  }
  changes.addPartnerSettlement({
    id: command.settlementId,
    payerId: paid!.userId,
    date: paid!.date,
    amount: received!.amount,
    method: command.method,
    confirmed: false,
    history: [
      { actorId: actor.userId, operationId: command.id, reason: "matched" },
    ],
  });
}

function applyCommand(
  book: AccountingState,
  budget: Budget,
  command: ParsedCommand,
  source: CommandSource,
  changes: Changes,
  reapplyingRefund = false,
): void {
  const actorId = budget.userId;
  switch (command.type) {
    case "partner.categorize": {
      const entry = partnerEntry(book, command.entryId);
      if (entry.payerId === actorId && !awaitingImport(entry))
        fail("Categorize your own purchase on its transaction");
      if (command.categoryId === null) {
        const sides = changes.partnerSide(budget, entry.id);
        delete sides[entry.id];
        if (!Object.keys(sides).length) delete budget.partnerSides;
        break;
      }
      categorizeSide(budget, entry, command.categoryId, source, changes);
      break;
    }
    case "partner.record": {
      const partner = partnerAccountOf(budget);
      if (!partner) fail("Link your partner's budget first");
      const members = isPersonalLedger(book)
        ? book.members.map((member) => member.userId)
        : Object.keys(book.budgets);
      if (!members.includes(command.payerId))
        fail("Choose you or your partner as who paid");
      if (book.partnerEntries?.some((entry) => entry.id === command.entryId))
        fail("This shared entry already exists");
      if (command.share > command.amount)
        fail("A share can't be more than the shared amount");
      if (source === "user" && !command.recordedAt)
        fail("Recorded purchases require their recorded time");
      requireDate(budget, command.date);
      const entry: PartnerEntry = {
        id: command.entryId,
        payerId: command.payerId,
        date: command.date,
        payee: command.payee,
        status: "posted",
        amount: -command.amount,
        share: command.share,
        history: [
          {
            actorId,
            operationId: command.id,
            ...(command.recordedAt ? { at: command.recordedAt } : {}),
            reason: "recorded",
          },
        ],
      };
      changes.addPartnerEntry(entry);
      if (command.categoryId)
        categorizeSide(budget, entry, command.categoryId, source, changes);
      break;
    }
    case "partner.match": {
      matchPartnerImport(book, budget, command, source, changes);
      break;
    }
    case "partner.edit": {
      editPartnerEntry(book, budget, command, source, changes);
      break;
    }
    case "counterparty.receive": {
      requireDate(budget, command.date);
      requireCash(budget, command.cashAccountId, command.date);
      const counterparty = accountAtDate(
        budget,
        command.counterpartyAccountId,
        command.date,
      );
      if (!isCounterparty(counterparty))
        fail("Choose Partner or Reimbursements");
      // A partner's payment changes both budgets' ledger, which a
      // one-sided repayment can't keep mirrored.
      if (counterparty.kind === "partner")
        fail(
          "Payments between partners come from both partners' bank imports, matched into one settlement",
        );
      if (
        command.providerId &&
        budget.transactions.some(
          (transaction) =>
            active(transaction) &&
            transaction.providerId === command.providerId,
        )
      )
        fail("Provider transaction already exists");
      if (counterparty.kind === "reimbursements" && !command.counterpartyName)
        fail("Name the person or organization making the reimbursement");
      if (source === "user" && !command.recordedAt)
        fail("Repayments require their recorded time");
      const outstanding = sum(
        counterpartyRegisterEntries(budget, {
          accountId: counterparty.id,
          counterpartyName: command.counterpartyName,
          cutoff: command.date,
        }).map((entry) => entry.amount),
      );
      if (command.amount > outstanding)
        fail("Receipt exceeds the outstanding counterparty balance");
      appendTransaction(changes, budget, command.id, {
        id: `${command.id}:receipt`,
        accountId: command.cashAccountId,
        date: command.date,
        amount: command.amount,
        payee: command.payee ?? command.counterpartyName ?? counterparty.name,
        status: "posted",
        expenseMonth: monthOf(command.date),
        kind: "reimbursement",
        linkedCounterpartyAccountId: counterparty.id,
        counterpartyName: command.counterpartyName,
        ...(command.providerId ? { providerId: command.providerId } : {}),
      });
      const receipt = getTransaction(budget, `${command.id}:receipt`);
      receipt.reviewed = source === "user";
      receipt.history[0]!.actorId = actorId;
      receipt.history[0]!.at = command.recordedAt;
      break;
    }
    case "partner.request": {
      requireDate(budget, command.date);
      if (!partnerAccountOf(budget))
        fail("Link budgets with your partner before asking them to pay");
      if (book.partnerRequests?.some((item) => item.id === command.requestId))
        fail("Request ID already exists");
      changes.addPartnerRequest({
        id: command.requestId,
        requesterId: actorId,
        date: command.date,
        amount: command.amount,
      });
      break;
    }
    case "partner.settle": {
      recordSettlement(book, budget, command, changes);
      break;
    }
    case "partner.settlement.reject": {
      const settlement = book.partnerSettlements?.find(
        (item) => item.id === command.settlementId && !item.removed,
      );
      if (!settlement) fail("This settlement was removed");
      const budgets = isPersonalLedger(book)
        ? [budget]
        : Object.values(book.budgets);
      for (const owner of budgets) {
        const leg = owner.transactions.find(
          (item) =>
            item.partnerSettlementId === command.settlementId && !item.removed,
        );
        if (!leg) fail("This settlement's bank transaction is missing");
        changes.transaction(owner, leg!).removed = true;
        leg!.history.push({
          revision: ++leg!.revision,
          reason: "removed",
          amount: leg!.amount,
          date: leg!.date,
          payee: leg!.payee,
          status: leg!.status,
          operationId: command.id,
          actorId,
          ...(command.recordedAt ? { at: command.recordedAt } : {}),
        });
      }
      const tracked = changes.partnerSettlement(settlement!);
      tracked.removed = true;
      tracked.history.push({
        actorId,
        operationId: command.id,
        ...(command.recordedAt ? { at: command.recordedAt } : {}),
        reason: "removed",
      });
      break;
    }
    case "partner.settlement.confirm": {
      const settlement = book.partnerSettlements?.find(
        (item) => item.id === command.settlementId && !item.removed,
      );
      if (!settlement) fail("This settlement was removed");
      confirmSettlement(changes, settlement!, {
        actorId,
        operationId: command.id,
        at: command.recordedAt,
      });
      break;
    }
    case "account.add": {
      if (budget.accounts.some((account) => account.id === command.accountId))
        fail("Account ID already exists");
      const date = command.date ?? `${budget.startMonth}-01`;
      requireDate(budget, date);
      if (command.kind === "credit" && command.openingBalance > 0)
        fail(
          "Positive credit-card balances require bank evidence and are not supported by manual setup",
        );
      changes.addAccount(budget, {
        id: command.accountId,
        name: command.name,
        kind: command.kind,
        openingBalance: command.openingBalance,
        date,
      });
      if (command.kind === "credit")
        changes.addCategory(budget, {
          id: `card:${command.accountId}`,
          name: `${command.name} payment`,
          group: "Credit card payments",
          pairedAccountId: command.accountId,
        });
      break;
    }
    case "account.reconcile": {
      requireDate(budget, command.date);
      const account = accountAtDate(budget, command.accountId, command.date);
      const difference = safe(
        command.balance - clearedBalance(budget, account),
      );
      if (difference && !command.adjustmentId)
        fail(
          "The bank's cleared balance doesn't match. Fix the difference or create an adjustment",
        );
      if (!difference && command.adjustmentId)
        fail("The cleared balance already matches the bank's");
      if (command.adjustmentId)
        appendTransaction(changes, budget, command.id, {
          id: command.adjustmentId,
          accountId: account.id,
          date: command.date,
          amount: difference,
          payee: "Reconciliation balance adjustment",
          status: "posted",
          expenseMonth: monthOf(command.date),
          kind: "adjustment",
        });
      for (const transaction of budget.transactions)
        if (
          active(transaction) &&
          transaction.accountId === account.id &&
          transaction.status === "posted" &&
          !transaction.reconciled
        )
          changes.transaction(budget, transaction).reconciled = true;
      changes.account(budget, account).reconciled = {
        date: command.date,
        balance: command.balance,
      };
      break;
    }
    case "group.add": {
      const taken = new Set(
        [
          ...(budget.groups ?? []),
          ...budget.categories.map((c) => c.group),
        ].map((group) => group.toLowerCase()),
      );
      if (taken.has(command.name.toLowerCase()))
        fail("Category group already exists");
      changes.groups(budget);
      budget.groups = [command.name, ...(budget.groups ?? [])];
      break;
    }
    case "group.reorder": {
      const current = [
        ...new Set([
          ...(budget.groups ?? []),
          ...budget.categories.map((c) => c.group),
        ]),
      ];
      const named = [...new Set(command.names)].filter((name) =>
        current.includes(name),
      );
      changes.groups(budget);
      budget.groups = [
        ...named,
        ...current.filter((name) => !named.includes(name)),
      ];
      break;
    }
    case "category.add": {
      if (
        budget.categories.some((category) => category.id === command.categoryId)
      )
        fail("Category ID already exists");
      changes.addCategory(budget, {
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
        changes.addCategory(budget, {
          id: category.categoryId,
          name: category.name,
          group: category.group,
        });
      }
      break;
    }
    case "assign": {
      getCategory(budget, command.categoryId);
      checkAssignmentChange(book, budget, command.month, [
        { categoryId: command.categoryId, amount: command.amount },
      ]);
      addAssignment(
        changes,
        budget,
        command.categoryId,
        command.month,
        command.amount,
        command.id,
      );
      if (command.amount > 0)
        ensureLaterMonthsFunded(book, actorId, command.month);
      break;
    }
    case "assign.set": {
      getCategory(budget, command.categoryId);
      const amount = safe(
        command.amount -
          (changes.assignment(budget, command.categoryId, command.month)
            ?.amount ?? 0),
      );
      if (!amount) break;
      checkAssignmentChange(book, budget, command.month, [
        { categoryId: command.categoryId, amount },
      ]);
      addAssignment(
        changes,
        budget,
        command.categoryId,
        command.month,
        amount,
        command.id,
      );
      if (amount > 0) ensureLaterMonthsFunded(book, actorId, command.month);
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
      checkAssignmentChange(book, budget, command.month, command.changes);
      command.changes.forEach((change, index) =>
        addAssignment(
          changes,
          budget,
          change.categoryId,
          command.month,
          change.amount,
          `${command.id}:${index}`,
        ),
      );
      if (command.changes.some((change) => change.amount > 0))
        ensureLaterMonthsFunded(book, actorId, command.month);
      break;
    }
    case "cover": {
      if (command.fromCategoryId === command.toCategoryId)
        fail("Choose a different source category");
      getCategory(budget, command.fromCategoryId);
      getCategory(budget, command.toCategoryId);
      const state = materialize(book, actorId, command.month);
      if (
        state.categories.get(command.fromCategoryId)!.available < command.amount
      )
        fail("Source category has insufficient funds");
      addAssignment(
        changes,
        budget,
        command.fromCategoryId,
        command.month,
        -command.amount,
        `${command.id}:from`,
      );
      addAssignment(
        changes,
        budget,
        command.toCategoryId,
        command.month,
        command.amount,
        `${command.id}:to`,
      );
      break;
    }
    case "target.set": {
      const category = changes.category(
        budget,
        getCategory(budget, command.categoryId),
      );
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
      const category = changes.category(
        budget,
        getCategory(budget, command.categoryId),
      );
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
    case "transaction.save": {
      saveRegisterTransaction(book, budget, command, source, changes);
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
      if (existing) ensureReconciledUnchanged(existing, command);
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
      const refundOfTransactionId =
        command.refundOfTransactionId ?? existing?.refundOfTransactionId;
      if (refundOfTransactionId) {
        const original = getTransaction(budget, refundOfTransactionId);
        if (
          original.id === command.transactionId ||
          original.kind !== "purchase" ||
          original.amount >= 0
        )
          fail("Link refunds to an original purchase");
        if (command.amount <= 0 || command.date < original.date)
          fail("A linked refund must be an inflow on or after its purchase");
        const siblings = budget.transactions.filter(
          (item) =>
            active(item) &&
            item.id !== command.transactionId &&
            item.refundOfTransactionId === original.id,
        );
        if (
          sum(siblings.map((item) => item.amount)) + command.amount >
          -original.amount
        )
          fail("Refunds exceed the original purchase");
        const earlier = siblings.filter(
          (item) =>
            item.date < command.date ||
            (item.date === command.date &&
              item.id.localeCompare(command.transactionId) < 0),
        );
        const refundLines = proportionalRefundLines(
          original,
          sum(earlier.map((item) => item.amount)),
          command.amount,
        ).map((line) => ({
          lineId: line.id,
          categoryId: line.categoryId,
          amount: line.amount,
          counterpartyShare: line.counterpartyShare,
        }));
        if (!refundLines.length)
          fail("The original purchase has no refundable category");
        if (refundLines.length === 1) {
          command.lines = undefined;
          command.categoryId = refundLines[0]!.categoryId;
          command.counterpartyShare = refundLines[0]!.counterpartyShare ?? null;
        } else {
          command.lines = refundLines;
          command.categoryId = undefined;
          command.counterpartyShare = undefined;
        }
      }
      const counterpartyShare =
        command.counterpartyShare === null
          ? undefined
          : (command.counterpartyShare ??
            (command.lines
              ? undefined
              : existing?.counterpartyShare
                ? {
                    ...existing.counterpartyShare,
                    amount: Math.min(
                      existing.counterpartyShare.amount,
                      Math.abs(command.amount),
                    ),
                  }
                : undefined));
      if (account.kind === "tracking" && counterpartyShare)
        fail("Tracking activity cannot have a counterparty share");
      const validateShare = (amount: number, share?: CounterpartyShare) => {
        if (!share) return;
        if (share.amount > Math.abs(amount))
          fail("Counterparty share exceeds its line amount");
        const account = getAccount(budget, share.accountId);
        if (!isCounterparty(account))
          fail("Choose Partner or Reimbursements for the share");
        if (account.kind === "reimbursements" && !share.counterpartyName)
          fail("Name the person or organization for this reimbursement");
        if (
          !budget.categories.some(
            (item) => item.counterpartyAccountId === share.accountId,
          )
        )
          fail("Counterparty paired envelope is missing");
      };
      validateShare(command.amount, counterpartyShare);
      if (
        source === "user" &&
        !command.recordedAt &&
        (counterpartyShare ||
          existing?.counterpartyShare ||
          command.lines?.some((line) => line.counterpartyShare) ||
          existing?.lines?.some((line) => line.counterpartyShare))
      )
        fail("Share edits require their recorded time");
      const lines = command.lines
        ? command.lines.map((line) => ({
            id: line.lineId,
            categoryId: line.categoryId,
            amount: line.amount,
            ...(line.counterpartyShare
              ? { counterpartyShare: line.counterpartyShare }
              : {}),
          }))
        : command.categoryId &&
            existing?.lines?.some((line) => line.counterpartyShare) &&
            command.counterpartyShare === undefined &&
            !refundOfTransactionId
          ? (() => {
              const preserved =
                rescaleLines(existing.lines, command.amount) ??
                fail(
                  "Edit the split lines to keep their counterparty shares when changing this amount",
                );
              return preserved.map((line) => ({
                ...line,
                categoryId: command.categoryId!,
              }));
            })()
          : command.categoryId || !existing?.lines
            ? undefined
            : rescaleLines(existing.lines, command.amount);
      const categoryId = lines
        ? undefined
        : (command.categoryId ?? existing?.categoryId);
      if (lines) {
        if (account.kind === "tracking")
          fail("Tracking activity does not use budget categories");
        if (new Set(lines.map((line) => line.id)).size !== lines.length)
          fail("Each split line needs its own id");
        for (const line of lines) {
          if (!line.amount) fail("Enter an amount on every split line");
          validateShare(line.amount, line.counterpartyShare);
          const category = getCategory(budget, line.categoryId);
          refusePairedEnvelope(category);
          if (category.pairedAccountId || category.pairedLoanId)
            fail("Choose a spending category for every split line");
        }
        if (sum(lines.map((line) => line.amount)) !== command.amount)
          fail("Split lines must add up to the transaction amount");
      }
      if (account.kind === "tracking" && categoryId)
        fail("Tracking activity does not use budget categories");
      if (
        account.kind === "credit" &&
        command.amount > 0 &&
        !categoryId &&
        !lines
      )
        fail("Use a card payment or posted statement credit for card inflows");
      if (counterpartyShare && (!categoryId || lines))
        fail("A counterparty share requires its own purpose category");
      if (categoryId) {
        const category = getCategory(budget, categoryId);
        refusePairedEnvelope(category);
        if (category.pairedAccountId || category.pairedLoanId)
          fail("Use the paired payment operation");
      }
      const revision = existing
        ? Math.max(existing.revision + 1, command.revision ?? 0)
        : (command.revision ?? 1);
      const expenseMonth =
        command.expenseMonth ?? existing?.expenseMonth ?? monthOf(command.date);
      const reviewedPosting = Boolean(
        existing?.reviewed &&
        existing.status === "pending" &&
        command.status === "posted" &&
        existing.accountId === account.id &&
        existing.date === command.date &&
        existing.amount === command.amount &&
        existing.categoryId === categoryId &&
        existing.expenseMonth === expenseMonth,
      );
      const transaction: Transaction = {
        id: command.transactionId,
        accountId: account.id,
        date: command.date,
        amount: command.amount,
        payee: command.payee,
        status: command.status,
        categoryId,
        lines,
        counterpartyShare: lines ? undefined : counterpartyShare,
        refundOfTransactionId,
        expenseMonth,
        providerId: command.providerId ?? existing?.providerId,
        revision,
        reviewed:
          source === "user"
            ? (command.reviewed ?? existing?.reviewed ?? true)
            : reviewedPosting,
        kind:
          command.amount < 0
            ? "purchase"
            : categoryId || lines
              ? "refund"
              : "income",
        reconciled: existing?.reconciled,
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
            ...(() => {
              const before = existing ? counterpartyLines(existing) : [];
              const after =
                lines ??
                (categoryId
                  ? [
                      {
                        id: command.transactionId,
                        categoryId,
                        amount: command.amount,
                        counterpartyShare,
                      },
                    ]
                  : []);
              const shareChanges = [
                ...new Set([...before, ...after].map((line) => line.id)),
              ].flatMap((lineId) => {
                const previous =
                  before.find((line) => line.id === lineId)
                    ?.counterpartyShare ?? null;
                const next =
                  after.find((line) => line.id === lineId)?.counterpartyShare ??
                  null;
                return canonicalJson(previous) === canonicalJson(next)
                  ? []
                  : [{ lineId, previous, next }];
              });
              return shareChanges.length
                ? { actorId, at: command.recordedAt, shareChanges }
                : {};
            })(),
          },
        ],
      };
      changes.putTransaction(budget, transaction);
      if (!reapplyingRefund)
        recomputeLinkedRefunds(
          book,
          budget,
          refundOfTransactionId ?? transaction.id,
          command.id,
          command.recordedAt,
          source,
          changes,
          refundOfTransactionId ? transaction.id : undefined,
        );
      if (
        account.kind === "credit" &&
        command.amount > 0 &&
        !isPostedLinkedCardRefund(budget, transaction) &&
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
      if (
        budget.transactions.some(
          (item) =>
            active(item) && item.refundOfTransactionId === transaction.id,
        )
      )
        fail("Remove linked refunds before removing their purchase");
      if (
        !["purchase", "refund", "income", "adjustment"].includes(
          transaction.kind,
        )
      )
        fail(
          "Dedicated payment records cannot be deleted through transaction removal",
        );
      changes.transaction(budget, transaction).removed = true;
      transaction.history.push({
        revision: ++transaction.revision,
        amount: transaction.amount,
        date: transaction.date,
        payee: transaction.payee,
        status: transaction.status,
        operationId: command.id,
        reason: "removed",
      });
      if (transaction.refundOfTransactionId)
        recomputeLinkedRefunds(
          book,
          budget,
          transaction.refundOfTransactionId,
          command.id,
          command.recordedAt,
          source,
          changes,
        );
      break;
    }
    case "transaction.reject": {
      const rejected = new Map<string, Transaction>();
      for (const id of command.transactionIds) {
        const transaction = getTransaction(budget, id);
        if (
          budget.transactions.some(
            (item) =>
              active(item) && item.refundOfTransactionId === transaction.id,
          )
        )
          fail("Remove linked refunds before rejecting their purchase");
        const counterparts = transferCounterparts(budget, transaction);
        if (isTransfer(transaction) && counterparts.length !== 1)
          fail("The other side of this transfer is missing or ambiguous");
        for (const item of [transaction, ...counterparts]) {
          if (item.reviewed)
            fail("Only unapproved transactions can be rejected");
          if (
            ![
              "purchase",
              "income",
              "refund",
              "transfer",
              "card-payment",
              "loan-payment",
            ].includes(item.kind)
          )
            fail("This transaction cannot be rejected from the register");
          rejected.set(item.id, item);
        }
      }
      for (const transaction of rejected.values()) {
        changes.transaction(budget, transaction);
        if (transaction.kind === "loan-payment") {
          const loan =
            budget.loans.find((item) =>
              item.payments.some(
                (payment) => payment.id === transaction.linkedId,
              ),
            ) ?? fail("The confirmed loan payment could not be found");
          changes.loan(budget, loan).payments = loan.payments.filter(
            (payment) => payment.id !== transaction.linkedId,
          );
        }
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
      }
      for (const sourceId of new Set(
        [...rejected.values()].flatMap((item) =>
          item.refundOfTransactionId ? [item.refundOfTransactionId] : [],
        ),
      ))
        recomputeLinkedRefunds(
          book,
          budget,
          sourceId,
          command.id,
          command.recordedAt,
          source,
          changes,
        );
      break;
    }
    case "transaction.approve": {
      for (const id of command.transactionIds) {
        const transaction = getTransaction(budget, id);
        if (
          transaction.amount < 0 &&
          !categoryLines(transaction).length &&
          transaction.kind === "purchase" &&
          getAccount(budget, transaction.accountId).kind !== "tracking"
        )
          fail("Categorize purchases before approval");
        changes.transaction(budget, transaction).reviewed = true;
        for (const counterpart of transferCounterparts(budget, transaction))
          changes.transaction(budget, counterpart).reviewed = true;
        // Approving one partner's leg confirms the settlement for both.
        const settlement = book.partnerSettlements?.find(
          (item) => item.id === transaction.partnerSettlementId,
        );
        if (settlement && !settlement.removed)
          confirmSettlement(changes, settlement, {
            actorId,
            operationId: command.id,
          });
      }
      break;
    }
    case "transaction.categorize.batch": {
      const categorized = new Set<string>();
      for (const transactionId of command.transactionIds) {
        if (categorized.has(transactionId)) continue;
        const transaction = getTransaction(budget, transactionId);
        for (const item of [
          transaction,
          ...transferCounterparts(budget, transaction),
        ])
          categorized.add(item.id);
        applyCommand(
          book,
          budget,
          {
            type: "transaction.categorize",
            id: command.id,
            transactionId,
            categoryId: command.categoryId,
            recordedAt: command.recordedAt,
          },
          source,
          changes,
        );
      }
      break;
    }
    case "transaction.categorize": {
      const transaction = getTransaction(budget, command.transactionId);
      if (isTransfer(transaction)) {
        const counterparts = transferCounterparts(budget, transaction);
        const other =
          counterparts[0] ?? fail("The other side of this transfer is missing");
        if (counterparts.length !== 1)
          fail("The other side of this transfer is missing or ambiguous");
        if (
          !transferNeedsCategory(
            getAccount(budget, transaction.accountId),
            getAccount(budget, other.accountId),
          )
        )
          fail("This transfer does not use a category");
        const category = getCategory(budget, command.categoryId);
        refusePairedEnvelope(category);
        if (category.pairedAccountId || category.pairedLoanId)
          fail("Choose a spending category for this transfer");
        for (const item of [transaction, other]) {
          changes.transaction(budget, item).categoryId = category.id;
          item.reviewed = source === "user";
          item.history.push({
            revision: ++item.revision,
            amount: item.amount,
            date: item.date,
            payee: item.payee,
            status: item.status,
            operationId: command.id,
            reason: "categorized",
          });
        }
        break;
      }
      if (!["purchase", "income", "refund"].includes(transaction.kind))
        fail("Use the dedicated operation for transfers and repayments");
      if (getAccount(budget, transaction.accountId).kind === "tracking")
        fail("Tracking activity does not use budget categories");
      const category = getCategory(budget, command.categoryId);
      refusePairedEnvelope(category);
      if (transaction.refundOfTransactionId)
        fail("Edit the original purchase to change linked refund categories");
      if (category.pairedAccountId || category.pairedLoanId)
        fail("Payment categories cannot categorize purchases");
      changes.transaction(budget, transaction);
      if (transaction.lines?.some((line) => line.counterpartyShare)) {
        transaction.lines = transaction.lines.map((line) => ({
          ...line,
          categoryId: category.id,
        }));
        delete transaction.categoryId;
      } else {
        transaction.categoryId = category.id;
        delete transaction.lines;
      }
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
      recomputeLinkedRefunds(
        book,
        budget,
        transaction.id,
        command.id,
        command.recordedAt,
        source,
        changes,
      );
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
      if (source !== "user")
        fail("Uncertain matches require explicit user review");
      for (const refund of budget.transactions.filter(
        (item) => active(item) && item.refundOfTransactionId === duplicate.id,
      ))
        changes.transaction(budget, refund).refundOfTransactionId = target.id;
      recomputeLinkedRefunds(
        book,
        budget,
        target.id,
        command.id,
        command.recordedAt,
        source,
        changes,
      );
      changes.transaction(budget, duplicate).removed = true;
      changes.transaction(budget, target).history.push(...duplicate.history, {
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
    case "card.payment": {
      requireDate(budget, command.date);
      validateCardPayment(
        book,
        budget,
        command.cashAccountId,
        command.cardAccountId,
        command.date,
        command.amount,
      );
      appendTransaction(changes, budget, command.id, {
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
      appendTransaction(changes, budget, command.id, {
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
      appendTransaction(changes, budget, command.id, {
        id: `${command.id}:credit`,
        accountId: command.accountId,
        date: command.date,
        amount: command.amount,
        payee: "Posted statement credit",
        status: "posted",
        expenseMonth: monthOf(command.date),
        kind: "statement-credit",
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
        changes.addCategory(budget, category);
      }
      refusePairedEnvelope(category);
      if (category.pairedAccountId || category.pairedLoanId)
        fail("Category is already paired");
      changes.category(budget, category).pairedLoanId = command.loanId;
      category.target = {
        cadence: "loan",
        behavior: "contribution",
        amount: command.minimumPayment,
        startMonth: budget.startMonth,
        snoozedMonths: [],
      };
      changes.addLoan(budget, {
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
      changes.loan(budget, loan).rates.push({
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
      changes.loan(budget, loan).payments.push({
        id: command.id,
        date: command.date,
        principal: command.principal,
        interest: command.interest,
      });
      appendTransaction(changes, budget, command.id, {
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
      changes.budget(budget);
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
      const income = changes.expectedIncome(budget, command.month);
      if (command.amount === null) delete income[command.month];
      else income[command.month] = command.amount;
      break;
    }
  }
}
