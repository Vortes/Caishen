import {
  classifyRegisterEntry,
  TRANSACTION_ACTION_LIMIT,
  directEntryAccountMessage,
  splitPurchaseAmountMessage,
  purposeCategoryMessage,
} from "./register-entry";
import { z } from "zod";
import { approvalAfterCategorize, approvalAfterSave } from "./approval";
import { isCleared, isPending } from "./cleared";
export { isCleared, isPending } from "./cleared";
import {
  counterpartyLines,
  counterpartyRegisterEntries,
  isFullShare,
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
  entryCounts,
  formerPartnerEntrySchema,
  isPartnerLedger,
  ledgerEntries,
  mirroredChange,
  mirroredEntries,
  partnerAccountOf,
  partnerEntrySchema,
  partnerLedgerRows,
  partnerSideIssues,
  partnerSideSchema,
  sideCategory,
  sideNeedsCategory,
  sideSpending,
  spendingCategory,
  synchronizePartnerEntries,
  writeEntry,
  type FormerPartnerEntry,
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
  storedSettlementLegIssues,
  type PartnerRequest,
  type PartnerSettlement,
} from "./partner-settlements";
import { canonicalJson } from "./canonical-json";
import { Changes } from "./changes";
import { payeeKey, rememberCategorizations } from "./payee-memory";
import { personKey } from "./person-name";
import { keepsCardRules, personRole } from "./person-role";
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
});
const transactionInput = {
  cleared: z.boolean().optional(),
  counterpartyShare: shareInputSchema.nullable().optional(),
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
        categoryId: identifier.optional(),
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
    // A split of your part across categories, with categoryId null.
    lines: z
      .array(
        z.object({ lineId: identifier, categoryId: identifier, amount: cents }),
      )
      .min(2)
      .max(100)
      .optional(),
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
    recordedAt: z.string().datetime().optional(),
    // A repayment recognized in a bank import: the bank's name for it and
    // its transaction, waiting for the user's review.
    payee: z.string().trim().min(1).max(240).optional(),
    providerId: identifier.optional(),
  }),
  // A person who owes you or whom you owe, with their own account and
  // paired envelope.
  z.object({
    type: z.literal("person.add"),
    id: identifier,
    accountId: identifier,
    name: z.string().trim().min(1).max(120),
  }),
  z.object({
    type: z.literal("person.rename"),
    id: identifier,
    accountId: identifier,
    name: z.string().trim().min(1).max(120),
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
  // Accounts in sidebar order, top first. They trade places among
  // themselves; accounts it leaves out keep theirs.
  z.object({
    type: z.literal("account.reorder"),
    id: identifier,
    accountIds: z.array(identifier).max(500),
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
  // Groups are known by name, so the categories in it take the new one.
  z.object({
    type: z.literal("group.rename"),
    id: identifier,
    group: z.string().max(120),
    name: z.string().trim().min(1).max(120),
  }),
  // Deletes a group and its categories, as category.delete does each one.
  z.object({
    type: z.literal("group.delete"),
    id: identifier,
    group: z.string().max(120),
    moveTo: identifier.optional(),
  }),
  z.object({
    type: z.literal("category.reorder"),
    id: identifier,
    group: z.string().max(120),
    categoryIds: z.array(identifier).max(500),
  }),
  // Moves a category into another group, then orders that group's
  // categories like category.reorder. The group it leaves keeps its place in
  // the plan, even with nothing left in it.
  z.object({
    type: z.literal("category.move"),
    id: identifier,
    categoryId: identifier,
    group: z.string().max(120),
    categoryIds: z.array(identifier).max(500),
  }),
  z.object({
    type: z.literal("category.add"),
    id: identifier,
    categoryId: identifier,
    name: z.string().min(1).max(120),
    group: z.string().max(120).default("Everyday"),
  }),
  z.object({
    type: z.literal("category.rename"),
    id: identifier,
    categoryId: identifier,
    name: z.string().trim().min(1).max(120),
  }),
  // Deletes a category the user made. One with transactions or assigned
  // money names the category that takes them over.
  z.object({
    type: z.literal("category.delete"),
    id: identifier,
    categoryId: identifier,
    moveTo: identifier.optional(),
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
    transferAccountId: identifier.optional(),
    transferCounterpart: z
      .object({
        date: daySchema,
        providerId: identifier,
      })
      .optional(),
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
    transactionIds: z.array(identifier).min(1).max(TRANSACTION_ACTION_LIMIT),
  }),
  z.object({
    type: z.literal("transaction.reject"),
    recordedAt: z.string().datetime().optional(),
    id: identifier,
    transactionIds: z.array(identifier).min(1).max(TRANSACTION_ACTION_LIMIT),
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
    transactionIds: z.array(identifier).min(1).max(TRANSACTION_ACTION_LIMIT),
    categoryId: identifier,
  }),
  z.object({
    type: z.literal("transaction.merge"),
    recordedAt: z.string().datetime().optional(),
    id: identifier,
    transactionId: identifier,
    duplicateId: identifier,
  }),
  // Loans in sidebar order, like account.reorder.
  z.object({
    type: z.literal("loan.reorder"),
    id: identifier,
    loanIds: z.array(identifier).max(500),
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
  // A person is a counterparty account: what one person or organization
  // owes you (positive) or you owe them. A person linked to another Caishen
  // user is the partner, whose entries are mirrored into their budget. A
  // former partner's account is the partner ledger as it stood when the
  // partnership ended, closed: its balance and entries never change again.
  // The legacy kinds are only read until withPeople converts them.
  kind: "cash" | "credit" | "tracking" | "person" | LegacyCounterpartyKind;
  date: string;
  // The last time the cleared balance was confirmed against the bank's.
  reconciled?: { date: string; balance: number };
  // A person who is also a Caishen user in this household: the partner.
  linkedUserId?: string;
  // When a former partner's account was closed, and who disconnected.
  closed?: { at: string; by: string };
};
// Counterparty kinds stored before every counterparty became a person.
export type LegacyCounterpartyKind =
  "partner" | "reimbursements" | "former-partner";
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
  // Legacy: the person a Reimbursements share named, read only until
  // withPeople gives that person an account of their own.
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
  categoryId?: string;
  amount: number;
};
export type Transaction = {
  counterpartyShare?: CounterpartyShare;
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
  // Whether the bank has cleared it, independently of pending status.
  cleared?: boolean;
  // Cleared and confirmed against the bank by a reconciliation. Cleared
  // status is locked; only balance adjustments can still change amount.
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
  kind: "category" | "readyToAssign" | "share";
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
  // Each former partner's ledger entries as they stood when the partnership
  // ended, kept with the closed account they belong to.
  formerPartnerEntries?: FormerPartnerEntry[];
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
        categoryId: storedIdentifier.optional(),
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
  cleared: z.boolean().optional(),
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
  kind: z.enum(["category", "readyToAssign", "share"]),
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
      kind: z.enum([
        "cash",
        "credit",
        "tracking",
        "person",
        "partner",
        "reimbursements",
        "former-partner",
      ]),
      date: daySchema,
      reconciled: z.object({ date: daySchema, balance: cents }).optional(),
      linkedUserId: storedIdentifier.optional(),
      closed: z
        .object({ at: z.string().datetime(), by: storedIdentifier })
        .optional(),
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
  formerPartnerEntries: z.array(formerPartnerEntrySchema).optional(),
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
  // Stored budgets may still hold legacy counterparty kinds until
  // withPeople converts them on load.
  const counterpartyAccount = (id: string) =>
    budget.accounts.find(
      (account) =>
        account.id === id &&
        (isCounterparty(account) || isLegacyCounterparty(account)),
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
      ((!transaction.categoryId && !isFullShare(transaction)) ||
        transaction.lines !== undefined)
    )
      issues.push("Invalid counterparty share reference");
    // A settlement leg reads by its own rules (storedSettlementLegIssues).
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
        transaction.counterpartyShare
      )
        issues.push("Invalid counterparty repayment reference");
    }
    for (const line of counterpartyLines(transaction)) {
      if (!line.categoryId && !isFullShare(line))
        issues.push("A personal share requires a purpose category");
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
        (!category && !isFullShare(line)) ||
        category?.counterpartyAccountId ||
        category?.pairedAccountId ||
        category?.pairedLoanId ||
        !["purchase", "refund"].includes(transaction.kind)
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
    ...partnerSideIssues(budget),
    ...storedSettlementLegIssues(budget),
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
// A category the user made, which they may rename or delete. Caishen names
// and keeps the ones it pairs with a card, a loan, or a counterparty.
function editableCategory(budget: Budget, id: string): Category {
  const category = getCategory(budget, id);
  if (!spendingCategory(category))
    fail("Caishen names this category after its account");
  return category;
}
// A group's categories, when the user may rename or delete the group.
function editableGroup(budget: Budget, group: string): Category[] {
  if (!planGroups(budget).includes(group)) fail("Category group not found");
  const categories = budget.categories.filter(
    (category) => category.group === group,
  );
  if (!categories.every(spendingCategory))
    fail("Caishen keeps this group for its accounts");
  return categories;
}
// The categories something the budget recorded still names: deleting one
// then needs a category to take that history over.
export function categoriesWithHistory(
  budget: Pick<Budget, "transactions" | "assignments" | "partnerSides">,
): Set<string> {
  const used = new Set<string>();
  const add = (id: string | undefined) => {
    if (id !== undefined) used.add(id);
  };
  for (const transaction of budget.transactions) {
    add(transaction.categoryId);
    for (const line of transaction.lines ?? []) add(line.categoryId);
  }
  for (const assignment of budget.assignments)
    if (assignment.amount) add(assignment.categoryId);
  for (const side of Object.values(budget.partnerSides ?? {})) {
    add(side.categoryId);
    for (const line of side.lines ?? []) add(line.categoryId);
  }
  return used;
}
// Removes categories with their targets. Their history must have somewhere
// to go, like YNAB: a category with any asks for one that takes it over.
function deleteCategories(
  changes: Changes,
  budget: Budget,
  categories: Category[],
  moveTo?: string,
): void {
  const ids = new Set(categories.map((category) => category.id));
  const history = categoriesWithHistory(budget);
  const used = categories.find((category) => history.has(category.id));
  if (used && !moveTo)
    fail(
      `Choose a category for ${used.name}'s transactions and assigned money`,
    );
  if (moveTo) moveCategoryHistory(changes, budget, ids, moveTo);
  // A row's sort is its position, so everything after the first removal
  // moves up.
  const from = <T>(items: T[], removed: (item: T) => boolean) => {
    const index = items.findIndex(removed);
    return index < 0 ? [] : items.slice(index);
  };
  for (const category of from(budget.categories, (item) => ids.has(item.id)))
    changes.category(budget, category);
  budget.categories = budget.categories.filter((item) => !ids.has(item.id));
  for (const assignment of from(budget.assignments, (item) =>
    ids.has(item.categoryId),
  ))
    changes.assignment(budget, assignment.categoryId, assignment.month);
  budget.assignments = budget.assignments.filter(
    (assignment) => !ids.has(assignment.categoryId),
  );
  for (const [key, memory] of Object.entries(budget.payeeMemory ?? {}))
    if (memory.categoryId && ids.has(memory.categoryId))
      delete changes.payeeMemory(budget, key)[key];
}
// Every transaction, split line, month's assigned money, payee memory, and
// partner side that names the categories now names `moveTo`.
function moveCategoryHistory(
  changes: Changes,
  budget: Budget,
  ids: Set<string>,
  moveTo: string,
): void {
  if (ids.has(moveTo) || !spendingCategory(getCategory(budget, moveTo)))
    fail("Move them to another category");
  const moved = (id: string | undefined) =>
    id !== undefined && ids.has(id) ? moveTo : id;
  for (const transaction of budget.transactions) {
    if (
      moved(transaction.categoryId) === transaction.categoryId &&
      !transaction.lines?.some((line) => ids.has(line.categoryId ?? ""))
    )
      continue;
    changes.transaction(budget, transaction);
    transaction.categoryId = moved(transaction.categoryId);
    for (const line of transaction.lines ?? [])
      line.categoryId = moved(line.categoryId);
  }
  for (const assignment of [...budget.assignments]) {
    if (!ids.has(assignment.categoryId) || !assignment.amount) continue;
    const existing = changes.assignment(budget, moveTo, assignment.month);
    if (existing) existing.amount = safe(existing.amount + assignment.amount);
    else
      changes.addAssignment(budget, {
        ...assignment,
        categoryId: moveTo,
      });
  }
  for (const [key, memory] of Object.entries(budget.payeeMemory ?? {}))
    if (memory.categoryId && ids.has(memory.categoryId))
      changes.payeeMemory(budget, key)[key] = { ...memory, categoryId: moveTo };
  for (const [entryId, side] of Object.entries(budget.partnerSides ?? {}))
    if (
      ids.has(side.categoryId ?? "") ||
      side.lines?.some((line) => ids.has(line.categoryId))
    )
      changes.partnerSide(budget, entryId)[entryId] = {
        ...side,
        ...(side.categoryId ? { categoryId: moved(side.categoryId) } : {}),
        ...(side.lines
          ? {
              lines: side.lines.map((line) => ({
                ...line,
                categoryId: moved(line.categoryId)!,
              })),
            }
          : {}),
      };
}
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

// Every counterparty is a person: one account and one paired envelope in
// People each. The person linked to the other member of a partnered
// household is the partner, found by linkedUserId under any id.
/** A new person's account id. */
export const personAccountId = (key: string) => `counterparty:person:${key}`;
/** The paired envelope of a person's account. */
export const personEnvelopeId = (accountId: string) =>
  `envelope:${accountId.replace(/^counterparty:/, "")}`;
export const PEOPLE_GROUP = "People";

// A paired envelope's activity is its counterparty account's, so nothing
// else is categorized into it.
function refusePairedEnvelope(category: Category): void {
  if (category.counterpartyAccountId)
    fail(
      "A paired envelope changes only with its counterparty account. Choose a spending category",
    );
}

/** Whether an account is a person's: what they owe you or you owe them. */
export const isCounterparty = (account: Pick<Account, "kind">) =>
  account.kind === "person";

function requireUniquePersonName(
  budget: Budget,
  name: string,
  accountId: string,
): void {
  if (
    budget.accounts.some(
      (account) =>
        account.id !== accountId &&
        isCounterparty(account) &&
        !isFormerPartner(account) &&
        personKey(account.name) === personKey(name),
    )
  )
    fail(`${name} is already one of your people`);
}

/** Whether an account is of a kind stored before every counterparty was a person. */
export const isLegacyCounterparty = (account: Pick<Account, "kind">) =>
  account.kind === "partner" ||
  account.kind === "reimbursements" ||
  account.kind === "former-partner";

/** The person linked to the other member of the household: the partner. */
export const isLinkedPerson = (
  account: Pick<Account, "kind" | "linkedUserId" | "closed">,
) => personRole(account) === "partner";

/** A former partner's closed account, frozen as the partnership ended. */
export const isFormerPartner = (
  account: Pick<Account, "kind" | "linkedUserId" | "closed">,
) => personRole(account) === "former-partner";

export const frozenLedgerMessage =
  "Shared balances with a former partner are frozen. New spending stays in your own budget";

// What a transaction holds of a former partner's ledger: the shares and
// repayment that name a closed account. Once closed, none of it changes.
function frozenFacts(budget: Budget, transaction?: Transaction): string {
  if (!transaction || transaction.removed) return "[]";
  const closed = (id?: string) =>
    budget.accounts.some(
      (account) => account.id === id && isFormerPartner(account),
    );
  return JSON.stringify([
    ...(closed(transaction.linkedCounterpartyAccountId)
      ? [[transaction.linkedCounterpartyAccountId, transaction.amount]]
      : []),
    ...counterpartyLines(transaction).flatMap((line) =>
      closed(line.counterpartyShare?.accountId)
        ? [
            [
              line.id,
              line.amount,
              line.counterpartyShare!.accountId,
              line.counterpartyShare!.amount,
            ],
          ]
        : [],
    ),
  ]);
}

function refuseFrozenChanges(book: AccountingState, changes: Changes): void {
  for (const budget of isPersonalLedger(book)
    ? [book.budget]
    : Object.values(book.budgets)) {
    if (!budget.accounts.some(isFormerPartner)) continue;
    for (const { before, after } of changes.transactionEdits(budget))
      if (frozenFacts(budget, before) !== frozenFacts(budget, after))
        fail(frozenLedgerMessage);
  }
}

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
    fail(directEntryAccountMessage);
}

// Category groups in plan order: the named ones first, then those known only
// through their categories, in category order. People, which holds the
// paired envelopes, leads until it's been named.
export function planGroups(budget: Budget): string[] {
  const groups = [
    ...new Set([
      ...(budget.groups ?? []),
      ...budget.categories.map((category) => category.group),
    ]),
  ];
  const people = budget.categories.find(
    (category) => category.counterpartyAccountId,
  )?.group;
  if (!people || budget.groups?.includes(people)) return groups;
  return [people, ...groups.filter((name) => name !== people)];
}

// The items in the order the ids name them. They trade places among
// themselves; items the ids leave out keep theirs. Each moved item is
// touched before the list changes.
function reorder<T extends { id: string }>(
  items: T[],
  ids: string[],
  touch: (item: T) => T,
): T[] {
  const named = [...new Set(ids)].flatMap((id) => {
    const item = items.find((value) => value.id === id);
    return item ? [touch(item)] : [];
  });
  const moved = new Set(named);
  let next = 0;
  return items.map((item) => (moved.has(item) ? named[next++]! : item));
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

/**
 * One member's budget on its own after the partnership ends (ADR 0012).
 * Their Partner account becomes the former partner's closed account, named
 * after them, with its own paired envelope: every share, repayment, and
 * settlement leg that named the Partner account names it instead, and the
 * household's partner ledger entries are kept with it, so its balance and
 * every month's numbers stay as they were. Shares remembered for payees are
 * forgotten, since nothing new can be shared with a former partner.
 */
export function closePartnerLedger(
  book: Book,
  userId: string,
  close: { id: string; name: string; at: string; by: string },
): Book {
  const budget = structuredClone(ownBudget(book, userId));
  const result: Book = { version: 1, budgets: { [userId]: budget }, audit: [] };
  const partner = partnerAccountOf(budget);
  if (!partner) return result;
  const accountId = `counterparty:former:${close.id}`;
  const envelopeId = `envelope:former:${close.id}`;
  const envelope = budget.categories.find(
    (category) => category.counterpartyAccountId === partner.id,
  );
  const point = <T extends { accountId: string }>(share: T): T =>
    share.accountId === partner.id ? { ...share, accountId } : share;
  const pointed = <T extends { counterpartyShare?: CounterpartyShare }>(
    item: T,
  ): T =>
    item.counterpartyShare
      ? { ...item, counterpartyShare: point(item.counterpartyShare) }
      : item;
  budget.accounts = budget.accounts.map((account) =>
    account === partner
      ? {
          id: accountId,
          name: close.name,
          kind: "person",
          date: account.date,
          closed: { at: close.at, by: close.by },
        }
      : account,
  );
  budget.categories = budget.categories.map((category) =>
    category === envelope
      ? {
          ...category,
          id: envelopeId,
          name: close.name,
          counterpartyAccountId: accountId,
        }
      : category,
  );
  budget.assignments = budget.assignments.map((assignment) =>
    assignment.categoryId === envelope?.id
      ? { ...assignment, categoryId: envelopeId }
      : assignment,
  );
  budget.transactions = budget.transactions.map((transaction) => ({
    ...pointed(transaction),
    ...(transaction.linkedCounterpartyAccountId === partner.id
      ? { linkedCounterpartyAccountId: accountId }
      : {}),
    ...(transaction.lines ? { lines: transaction.lines.map(pointed) } : {}),
    history: transaction.history.map((change) =>
      change.shareChanges
        ? {
            ...change,
            shareChanges: change.shareChanges.map((share) => ({
              ...share,
              previous: share.previous && point(share.previous),
              next: share.next && point(share.next),
            })),
          }
        : change,
    ),
  }));
  if (budget.payeeMemory)
    budget.payeeMemory = Object.fromEntries(
      Object.entries(budget.payeeMemory).flatMap(([key, memory]) => {
        if (memory.counterpartyShare?.accountId !== partner.id)
          return [[key, memory]];
        if (memory.kind === "share") return [];
        const kept = { ...memory };
        delete kept.counterpartyShare;
        return [[key, kept]];
      }),
    );
  budget.formerPartnerEntries = [
    ...(budget.formerPartnerEntries ?? []),
    ...(book.partnerEntries ?? [])
      .filter((entry) => !entry.removed)
      .map((entry) => ({ ...structuredClone(entry), accountId })),
  ];
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
  for (const [index, line] of scaled.entries())
    if (line.counterpartyShare)
      line.counterpartyShare.amount = isFullShare(lines[index]!)
        ? Math.abs(line.amount)
        : Math.min(line.counterpartyShare.amount, Math.abs(line.amount));
  return scaled.every((line) => line.amount) ? scaled : undefined;
}

export function categoryLines(
  transaction: Pick<Transaction, "categoryId" | "lines" | "amount">,
): { categoryId: string; amount: number }[] {
  if (transaction.lines)
    return transaction.lines.flatMap((line) =>
      line.categoryId
        ? [{ categoryId: line.categoryId, amount: line.amount }]
        : [],
    );
  return transaction.categoryId
    ? [{ categoryId: transaction.categoryId, amount: transaction.amount }]
    : [];
}
// One transaction's or partner entry's part of a category's activity.
export type ActivityEntry = {
  source: "transaction" | "partner";
  id: string;
  amount: number;
};
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
// How much of the viewer's part of one of the linked person's purchases its
// categories set aside in the month it counts in.
type LinkedEntryFunding = {
  entry: PartnerEntry;
  month: string;
  amount: number;
  setAside: number;
};
// A partner ledger's account as a card (ADR 0015): what of your part of
// their purchases no category funded, and what the envelope holds for it.
type CardLedger = {
  envelopeId: string;
  unfunded: number;
  // What categories funded into the envelope that it still holds: only this
  // goes back to a category when a share is refunded.
  setAside: number;
  // What last month paid them beyond what the envelope held.
  overpaid: number;
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
  // Balance adjustments establish the day's balance before activity spends
  // it. Other same-day outflows precede inflows; IDs break remaining ties.
  transactions: Transaction[];
  assignments: Assignment[];
  // The partner's ledger entries dated in the month, by date and then ID,
  // each with the partner ledger account it moves.
  mirrored: (PartnerEntry & { accountId: string })[];
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
  for (const account of budget.accounts.filter(isPartnerLedger))
    for (const entry of mirroredEntries(
      ledgerEntries(budget, book.partnerEntries, account.id),
      budget.userId,
    ))
      rows(monthOf(entry.date)).mirrored.push({
        ...entry,
        accountId: account.id,
      });
  for (const { transactions, mirrored } of months.values()) {
    transactions.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        Number(b.kind === "adjustment") - Number(a.kind === "adjustment") ||
        Math.sign(a.amount) - Math.sign(b.amount) ||
        a.id.localeCompare(b.id),
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
  const positiveCardBalances = sum(
    budget.accounts
      .filter((account) => account.kind === "credit")
      .map((account) => Math.max(0, accounts.get(account.id)!.balance)),
  );
  const currentCashOverspending = sum(
    [...categories.values()].map((state) => state.cashOverspending),
  );
  return {
    cash,
    readyToAssign: safe(
      cash + positiveCardBalances - allocated + currentCashOverspending,
    ),
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
const creditKey = (categoryId: string) => categoryId;
const creditCategory = (key: string) => key.split("\u0000")[0]!;

// Replays the budget month by month from its start through the given month.
// After each month, afterMonth can read that month's Ready to Assign.
// Given activity, it fills it with what made each category's activity in
// the last month, by category ID.
function replay(
  book: AccountingState,
  budget: Budget,
  month: string,
  cutoff: string,
  afterMonth?: (month: string, readyToAssign: () => number) => void,
  activity?: Map<string, ActivityEntry[]>,
  linkedEntries?: Map<string, LinkedEntryFunding>,
): Materialized {
  const userId = budget.userId;
  const addActivity = (
    categoryId: string,
    source: ActivityEntry["source"],
    id: string,
    amount: number,
  ) => {
    if (!activity || !amount) return;
    const entries = activity.get(categoryId) ?? [];
    const entry = entries.find(
      (item) => item.source === source && item.id === id,
    );
    if (entry) entry.amount = safe(entry.amount + amount);
    else entries.push({ source, id, amount });
    activity.set(categoryId, entries);
  };
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
  const pairedEnvelope = new Map(
    budget.categories.flatMap((item) =>
      item.counterpartyAccountId ? [[item.counterpartyAccountId, item]] : [],
    ),
  );
  // A partner ledger's account works like a credit card (ADR 0015): your
  // side of their purchases is credit spending, and what no category funded
  // carries on the account as unfunded credit. A former partner's frozen
  // ledger keeps these rules, so disconnecting changes no numbers. A ledger
  // frozen with no entries keeps ADR 0007's rules.
  const linked = partnerAccountOf(budget);
  const cardLedgers = new Map<string, CardLedger>(
    budget.accounts
      .filter((account) => keepsCardRules(account, budget))
      .flatMap((account) => {
        const envelope = pairedEnvelope.get(account.id);
        return envelope
          ? [
              [
                account.id,
                {
                  envelopeId: envelope.id,
                  unfunded: 0,
                  setAside: 0,
                  overpaid: 0,
                },
              ],
            ]
          : [];
      }),
  );
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
      activity?.delete(categoryId);
      state.cashActivity = 0;
    }
    // Overpaying a partner left uncovered resets at month end, like a card
    // payment category left negative: that cash paid off unfunded credit,
    // and it came out of Ready to Assign.
    for (const ledger of cardLedgers.values()) {
      if (!ledger.overpaid) continue;
      const state = categories.get(ledger.envelopeId)!;
      state.opening = safe(state.opening + ledger.overpaid);
      state.available = state.opening;
      ledger.unfunded = safe(ledger.unfunded - ledger.overpaid);
      ledger.overpaid = 0;
    }
    for (const [accountId, state] of accounts) {
      startingBalances.set(accountId, state.balance);
      state.priorBalance = state.balance;
      state.outflows = 0;
      state.inflows = 0;
      state.fundedSpending = 0;
      state.paymentsMade = 0;
      state.creditsReleased = 0;
      state.reserve = Math.max(0, state.reserve);
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
    // The categorized parts of partner ledger entries this month, in date
    // order: negative for a purchase, positive for a refund.
    const ledgerParts: {
      entryId: string;
      accountId: string;
      categoryId: string;
      amount: number;
    }[] = [];
    const cashByCategory = new Map<string, number>();
    const payments: Transaction[] = [];
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
      if (isPending(transaction) && transaction.amount > 0) continue;
      const accountState = accounts.get(account.id)!;
      let lineBalance = accountState.balance;
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
        continue;
      }
      if (transaction.kind === "card-payment") {
        if (account.kind === "cash") {
          const card = index.transferCounterpart(transaction);
          if (card) payments.push({ ...card, amount: -transaction.amount });
        }
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
        addActivity(
          category.id,
          "transaction",
          transaction.id,
          transaction.amount,
        );
        state.available = safe(state.available + transaction.amount);
        state.cashActivity = safe(state.cashActivity + transaction.amount);
        cashByCategory.set(
          category.id,
          safe((cashByCategory.get(category.id) ?? 0) + transaction.amount),
        );
        const key = creditKey(category.id);
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
          if (!share)
            return line.categoryId
              ? [{ categoryId: line.categoryId, amount: line.amount }]
              : [];
          const contribution = shareContribution(line.amount, share);
          const counterparty = accounts.get(share.accountId)!;
          counterparty.balance = safe(counterparty.balance + contribution);
          const paired = budget.categories.find(
            (item) => item.counterpartyAccountId === share.accountId,
          )!;
          return [
            ...(line.categoryId
              ? [
                  {
                    categoryId: line.categoryId,
                    amount: safe(line.amount + contribution),
                  },
                ]
              : []),
            {
              categoryId: paired.id,
              amount: -contribution,
              key: creditKey(paired.id),
            },
          ];
        },
      );
      for (const { categoryId, amount, key } of accountingLines) {
        const state = categories.get(categoryId)!;
        state.activity = safe(state.activity + amount);
        addActivity(categoryId, "transaction", transaction.id, amount);
        state.available = safe(state.available + amount);
        // The change above zero spends or restores existing card credit;
        // only the remainder changes debt and its payment funding.
        const nextLineBalance = safe(lineBalance + amount);
        const cashAmount =
          account.kind === "cash"
            ? amount
            : Math.max(0, nextLineBalance) - Math.max(0, lineBalance);
        lineBalance = nextLineBalance;
        if (cashAmount) {
          state.cashActivity = safe(state.cashActivity + cashAmount);
          cashByCategory.set(
            categoryId,
            safe((cashByCategory.get(categoryId) ?? 0) + cashAmount),
          );
        }
        const creditAmount = safe(amount - cashAmount);
        if (creditAmount) {
          const cards =
            creditByCategory.get(key ?? categoryId) ??
            new Map<string, number>();
          cards.set(
            account.id,
            safe((cards.get(account.id) ?? 0) - creditAmount),
          );
          creditByCategory.set(key ?? categoryId, cards);
        }
      }
    }
    // The partner's purchases: what the viewer owes for them moves their
    // Partner account. Their side's category, once chosen, spends the share
    // on credit, as on a card.
    for (const entry of rows.mirrored) {
      if (!entryCounts(entry, cutoff)) continue;
      const change = mirroredChange(entry, userId);
      const counterparty = accounts.get(entry.accountId)!;
      counterparty.balance = safe(counterparty.balance + change);
      const ledger = cardLedgers.get(entry.accountId);
      if (ledger) {
        const spending = sideSpending(budget, entry.id, change);
        for (const [id, amount] of spending) {
          if (!amount) continue;
          const state = categories.get(id)!;
          state.activity = safe(state.activity + amount);
          addActivity(id, "partner", entry.id, amount);
          state.available = safe(state.available + amount);
          const cards = creditByCategory.get(id) ?? new Map<string, number>();
          cards.set(
            entry.accountId,
            safe((cards.get(entry.accountId) ?? 0) - amount),
          );
          creditByCategory.set(id, cards);
        }
        for (const [categoryId, amount] of spending)
          if (amount)
            ledgerParts.push({
              entryId: entry.id,
              accountId: entry.accountId,
              categoryId,
              amount,
            });
        if (linkedEntries && entry.accountId === linked?.id && change < 0)
          linkedEntries.set(entry.id, {
            entry,
            month: cursor,
            amount: -change,
            setAside: 0,
          });
        // A share with no category is unfunded from the start.
        ledger.unfunded = safe(
          ledger.unfunded - change + sum(spending.map(([, amount]) => amount)),
        );
        continue;
      }
      for (const [id, amount] of [
        ...sideSpending(budget, entry.id, change),
        [pairedEnvelope.get(entry.accountId)?.id, -change] as const,
      ]) {
        if (!id || !amount) continue;
        const state = categories.get(id)!;
        state.activity = safe(state.activity + amount);
        addActivity(id, "partner", entry.id, amount);
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
      // What a category funds of a partner's purchases moves into their
      // envelope, which holds it to pay them.
      const ledger = cardLedgers.get(purchase.cardId);
      if (ledger) {
        liquidity.set(
          ledger.envelopeId,
          safe((liquidity.get(ledger.envelopeId) ?? 0) + amount),
        );
        ledger.setAside = safe(ledger.setAside + amount);
      } else {
        const card = accounts.get(purchase.cardId)!;
        card.reserve = safe(card.reserve + amount);
        card.fundedSpending = safe(card.fundedSpending + amount);
      }
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
        const ledger = cardLedgers.get(refund.cardId);
        if (ledger) {
          const amount = Math.min(
            refund.remaining,
            Math.max(
              0,
              Math.min(ledger.setAside, liquidity.get(ledger.envelopeId) ?? 0),
            ),
          );
          if (!amount) continue;
          ledger.setAside = safe(ledger.setAside - amount);
          liquidity.set(
            ledger.envelopeId,
            safe(liquidity.get(ledger.envelopeId)! - amount),
          );
          liquidity.set(
            refund.categoryId,
            safe(liquidity.get(refund.categoryId)! + amount),
          );
          refund.remaining -= amount;
          moved = true;
          continue;
        }
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
    const paidCashShortfall = new Map<string, number>();
    for (const account of budget.accounts.filter(
      (item) => item.kind === "credit",
    )) {
      const state = accounts.get(account.id)!;
      paidCashShortfall.set(account.id, Math.max(0, -state.reserve));
      state.paymentsMade = safe(
        state.reserve - reserveBeforePayments.get(account.id)!,
      );
    }
    // What no category funded of a partner's purchases carries on their
    // account.
    for (const purchase of purchases) {
      const ledger = cardLedgers.get(purchase.cardId);
      if (ledger) ledger.unfunded = safe(ledger.unfunded + purchase.remaining);
    }
    // What each category funded goes to its earliest purchases first, so the
    // latest ones are short, and what it released to its earliest refunds.
    // Both are the envelope's activity, by purchase.
    for (const [accountId, ledger] of cardLedgers) {
      const parts = ledgerParts.filter((part) => part.accountId === accountId);
      for (const categoryId of new Set(parts.map((part) => part.categoryId))) {
        const inCategory = parts.filter(
          (part) => part.categoryId === categoryId,
        );
        const left = (
          items: { categoryId: string; cardId: string; remaining: number }[],
        ) =>
          sum(
            items
              .filter(
                (item) =>
                  item.categoryId === categoryId && item.cardId === accountId,
              )
              .map((item) => item.remaining),
          );
        // A refund in the same category offsets its purchases before
        // anything moves.
        let covered = safe(
          sum(inCategory.map((part) => Math.max(0, -part.amount))) -
            left(purchases),
        );
        let released = safe(
          sum(inCategory.map((part) => Math.max(0, part.amount))) -
            left(refunds),
        );
        for (const part of inCategory) {
          const amount =
            part.amount < 0
              ? Math.min(-part.amount, covered)
              : -Math.min(part.amount, released);
          if (part.amount < 0) covered = safe(covered - amount);
          else released = safe(released + amount);
          addActivity(ledger.envelopeId, "partner", part.entryId, amount);
          const funding = linkedEntries?.get(part.entryId);
          if (funding && amount > 0)
            funding.setAside = safe(funding.setAside + amount);
        }
      }
    }
    // A refund the envelope couldn't release reduces the unfunded credit
    // instead, below zero when it returns what the envelope paid out.
    for (const refund of refunds) {
      const ledger = cardLedgers.get(refund.cardId);
      if (ledger) ledger.unfunded = safe(ledger.unfunded - refund.remaining);
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
      let remainingDebt = Math.max(
        0,
        -state.balance - Math.max(0, state.reserve),
      );
      for (const cards of carriedCounterpartyCredit.values()) {
        const debt = Math.min(cards.get(account.id) ?? 0, remainingDebt);
        paidCashShortfall.set(
          account.id,
          Math.max(
            0,
            safe(
              paidCashShortfall.get(account.id)! -
                ((cards.get(account.id) ?? 0) - debt),
            ),
          ),
        );
        cards.set(account.id, debt);
        remainingDebt -= debt;
      }
    }
    for (const [cardId, shortfall] of paidCashShortfall) {
      const state = accounts.get(cardId)!;
      if (state.reserve < 0) state.reserve = -shortfall;
    }
    for (const category of budget.categories)
      if (category.pairedAccountId) {
        const state = categories.get(category.id)!;
        const account = accounts.get(category.pairedAccountId)!;
        state.available = account.reserve;
        state.activity = safe(state.available - state.opening - state.assigned);
        // The card's payments are the part of it a transaction made; the
        // rest is spending its categories funded.
        activity?.delete(category.id);
        for (const payment of payments)
          if (payment.accountId === category.pairedAccountId)
            addActivity(
              category.id,
              "transaction",
              payment.id,
              -payment.amount,
            );
        state.cashOverspending = Math.max(0, -state.available);
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
      const ledger = cardLedgers.get(category.counterpartyAccountId);
      state.available = safe(
        float -
          accounts.get(category.counterpartyAccountId)!.balance -
          (ledger?.unfunded ?? 0),
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
      // Paying them or moving money out leaves less of what categories
      // funded in the envelope.
      if (ledger) {
        // Like a card's payment category, its activity is what funded
        // purchases and payments moved in and out.
        state.activity = safe(state.available - state.opening - state.assigned);
        ledger.setAside = Math.min(
          ledger.setAside,
          Math.max(0, safe(state.available + cardCredit)),
        );
        // What they owe you carries, as in any person's envelope; the rest
        // of the cash overspending paid them more than the envelope held.
        const owedToYou = Math.max(
          0,
          accounts.get(category.counterpartyAccountId)!.balance,
        );
        ledger.overpaid = Math.min(
          state.cashOverspending,
          Math.max(0, safe(-state.available - owedToYou)),
        );
      }
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
        ? Math.max(0, -state.balance - Math.max(0, state.reserve))
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
  payoffBalance: number,
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
      Math.max(0, -payoffBalance - state.opening) / monthsRemaining,
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
  const activity = new Map<string, ActivityEntry[]>();
  const linkedEntries = new Map<string, LinkedEntryFunding>();
  const calculated = replay(
    book,
    budgetThrough(book, userId, month),
    month,
    endOf(month),
    undefined,
    activity,
    linkedEntries,
  );
  const cutoff = endOf(month);
  // Adjustments correct existing debt, including debt first entered this
  // month. They belong in the payoff target without treating new purchases
  // or payments as changes to the month's original requirement.
  const payoffBalances = new Map(calculated.startingBalances);
  for (const transaction of budget.transactions)
    if (
      active(transaction) &&
      transaction.kind === "adjustment" &&
      monthOf(transaction.date) === month
    )
      payoffBalances.set(
        transaction.accountId,
        safe(payoffBalances.get(transaction.accountId)! + transaction.amount),
      );
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
  const partnerFunding = linkedFunding(
    budget,
    calculated,
    linkedEntries,
    month,
  );
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
        ...(category.id === partnerFunding?.categoryId
          ? { stillToFund: partnerFunding.stillToFund }
          : {}),
        activityEntries: activity.get(category.id) ?? [],
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
                ? payoffBalances.get(category.pairedAccountId)!
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
              sum(
                mirroredEntries(
                  ledgerEntries(budget, book.partnerEntries, account.id),
                  userId,
                )
                  .filter((entry) => entryCounts(entry, cutoff))
                  .map((entry) => mirroredChange(entry, userId)),
              ),
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
    // Each former partner's register, as it stood when it closed.
    formerPartnerLedgers: Object.fromEntries(
      budget.accounts
        .filter(isFormerPartner)
        .map((account) => [
          account.id,
          partnerLedgerRows(
            budget,
            ledgerEntries(budget, undefined, account.id),
            cutoff,
            undefined,
            account,
          ),
        ]),
    ),
    partnerFunding,
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
 * What the viewer owes the linked person and how much of it their envelope
 * holds (ADR 0015). What you owe is the net amount; still to fund is what
 * the envelope lacks to pay it. Entries are the viewer's part of the
 * linked person's purchases in the month, and earlier ones still short,
 * oldest first. Each entry's set-aside amount is what its categories
 * funded; its short amount is what's still to fund of it now, since money
 * assigned to the envelope or a settlement later covers the earliest
 * shortfalls first. An earlier entry with nothing short left drops off.
 * Moved out is what the envelope lacks beyond every entry's shortfall:
 * money taken back out after categories funded the purchases. The short
 * amounts and moved out add up to still to fund.
 */
function linkedFunding(
  budget: Budget,
  calculated: Materialized,
  linkedEntries: Map<string, LinkedEntryFunding>,
  month: string,
) {
  const account = partnerAccountOf(budget);
  const envelope =
    account &&
    budget.categories.find((item) => item.counterpartyAccountId === account.id);
  if (!account || !envelope) return undefined;
  const owed = Math.max(0, -calculated.accounts.get(account.id)!.balance);
  const available = calculated.categories.get(envelope.id)!.available;
  // What the envelope holds toward what you owe. A red envelope is
  // overspending, not a gap to fund.
  const setAside = Math.min(owed, Math.max(0, available));
  const stillToFund = safe(owed - setAside);
  let covered = safe(
    sum(
      [...linkedEntries.values()].map((item) => item.amount - item.setAside),
    ) - stillToFund,
  );
  return {
    accountId: account.id,
    categoryId: envelope.id,
    owed,
    setAside,
    stillToFund,
    movedOut: Math.max(0, -covered),
    entries: [...linkedEntries.values()]
      .map((item) => {
        const short = safe(item.amount - item.setAside);
        const coveredLater = Math.max(0, Math.min(short, covered));
        covered = safe(covered - coveredLater);
        return { ...item, short: safe(short - coveredLater) };
      })
      .filter((item) => item.month === month || item.short > 0)
      .map(({ entry, month: entryMonth, amount, setAside, short }) => {
        const lines = budget.partnerSides?.[entry.id]?.lines;
        return {
          entryId: entry.id,
          date: entry.date,
          payee: entry.payee,
          month: entryMonth,
          amount,
          categoryId: sideCategory(budget, entry.id),
          ...(lines ? { lines: structuredClone(lines) } : {}),
          setAside,
          short,
          needsCategory: sideNeedsCategory(budget, entry, -amount),
        };
      }),
  };
}

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
  requireCash(budget, cashAccountId);
  if (getAccount(budget, cardAccountId).kind !== "credit")
    fail("Select a credit-card account");
  const calculated = materialize(book, budget.userId, monthOf(date), date);
  if (amount > calculated.accounts.get(cashAccountId)!.balance)
    fail("Card payment requires cash already received by its payment date");
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

function nextCleared(
  requested: boolean | undefined,
  status: "pending" | "posted",
  existing?: Transaction,
): boolean {
  if (requested !== undefined) return requested;
  if (!existing || (existing.status === "pending" && status === "posted"))
    return status === "posted";
  return isCleared(existing);
}
// What the bank has finished processing: every cleared transaction,
// whatever its date.
function clearedBalance(budget: Budget, account: Account): number {
  return budget.transactions
    .filter(
      (item) =>
        active(item) && item.accountId === account.id && isCleared(item),
    )
    .reduce((total, item) => safe(total + item.amount), 0);
}
// Reconciled transactions keep their confirmed amount and status; balance
// adjustments remain editable so an accepted difference can be corrected.
function ensureReconciledUnchanged(
  existing: Transaction,
  next: { amount: number; status: "pending" | "posted"; cleared?: boolean },
): void {
  if (
    existing.reconciled &&
    ((existing.kind !== "adjustment" && existing.amount !== next.amount) ||
      existing.status !== next.status ||
      next.cleared === false)
  )
    fail(
      "This transaction is reconciled, so its amount and cleared status can't change",
    );
}
function requireCash(budget: Budget, accountId: string): Account {
  const account = getAccount(budget, accountId);
  return account.kind === "cash" ? account : fail("Select a cash account");
}
function requireDate(budget: Budget, date: string): void {
  if (monthOf(date) < budget.startMonth)
    fail("Activity predates the budget start");
}
/**
 * The checks a ledger restored by a revert passes before it is saved: every
 * stored reference holds. Later changes may rely on restored rows, so the
 * checks cover the whole ledger.
 */
export function checkRestoredLedger(state: AccountingState): void {
  const readable = isPersonalLedger(state)
    ? budgetSchema.safeParse(state.budget).success &&
      householdSchema.safeParse(state).success
    : bookSchema.safeParse(state).success;
  if (!readable)
    fail("This can't be undone because later changes depend on it");
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
    "account.reorder",
    "group.add",
    "group.reorder",
    "group.rename",
    "group.delete",
    "category.reorder",
    "category.move",
    "category.add",
    "category.rename",
    "category.delete",
    "category.import",
    "settings.update",
    "income.expect",
    "loan.add",
    "loan.rate",
    "loan.reorder",
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
  refuseFrozenChanges(book, changes);
  if (source === "user")
    rememberCategorizations(
      budget,
      changes,
      command.type === "transaction.categorize" ||
        command.type === "transaction.categorize.batch",
    );
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

// One partner's split of their side of an entry across categories. Like a
// split transaction's, it leaves their payee memory as it was.
function splitSide(
  budget: Budget,
  entry: PartnerEntry,
  lines: { lineId: string; categoryId: string; amount: number }[],
  changes: Changes,
): void {
  if (new Set(lines.map((line) => line.lineId)).size !== lines.length)
    fail("Each split line needs its own id");
  for (const line of lines) {
    if (!line.amount) fail("Enter an amount on every split line");
    if (!spendingCategory(getCategory(budget, line.categoryId)))
      fail("Choose a spending category for every split line");
  }
  if (
    sum(lines.map((line) => line.amount)) !==
    mirroredChange(entry, budget.userId)
  )
    fail("Split lines must add up to your part");
  changes.partnerSide(budget, entry.id)[entry.id] = {
    lines: lines.map(({ lineId, categoryId, amount }) => ({
      id: lineId,
      categoryId,
      amount,
    })),
  };
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
    if (sourceLine) {
      if (
        sourceLine.onSplitPurchase &&
        command.amount !== undefined &&
        amount !== entry.amount
      )
        fail(splitPurchaseAmountMessage);
      if (share < Math.abs(amount) && !sourceLine.hasPurposeCategory)
        fail(purposeCategoryMessage);
    }
    writeEntry(
      book,
      changes,
      entry.id,
      {
        ...entry,
        ...(sourceLine
          ? {
              source: {
                ...sourceLine,
                hasPurposeCategory:
                  sourceLine.hasPurposeCategory && share < Math.abs(amount),
              },
            }
          : {}),
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
  const shareMode = classifyRegisterEntry(payer, transaction).capabilities
    .share;
  if (shareMode.mode !== "edit") fail("Shares apply to purchases and refunds");
  if (transaction.lines && amount !== line!.amount)
    fail(splitPurchaseAmountMessage);
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
    const account = getAccount(budget, leg.accountId);
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
): void {
  const actorId = budget.userId;
  switch (command.type) {
    case "partner.categorize": {
      // A former partner's entries are frozen, but the side is the viewer's
      // own, so its category can still be chosen.
      const entry =
        budget.formerPartnerEntries?.find(
          (item) => item.id === command.entryId,
        ) ?? partnerEntry(book, command.entryId);
      if (entry.payerId === actorId)
        fail("Categorize your own purchase on its transaction");
      if (command.lines) {
        if (command.categoryId !== null)
          fail("Choose one category or split it, not both");
        splitSide(budget, entry, command.lines, changes);
        break;
      }
      if (command.categoryId === null) {
        const sides = changes.partnerSide(budget, entry.id);
        delete sides[entry.id];
        if (!Object.keys(sides).length) delete budget.partnerSides;
        break;
      }
      categorizeSide(budget, entry, command.categoryId, source, changes);
      break;
    }
    case "partner.edit": {
      editPartnerEntry(book, budget, command, source, changes);
      break;
    }
    case "counterparty.receive": {
      requireDate(budget, command.date);
      requireCash(budget, command.cashAccountId);
      const counterparty = getAccount(budget, command.counterpartyAccountId);
      if (!isCounterparty(counterparty)) fail("Choose who paid you back");
      if (isFormerPartner(counterparty)) fail(frozenLedgerMessage);
      // A partner's payment changes both budgets' ledger, which a
      // one-sided repayment can't keep mirrored.
      if (isLinkedPerson(counterparty))
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
      if (source === "user" && !command.recordedAt)
        fail("Repayments require their recorded time");
      const outstanding = sum(
        counterpartyRegisterEntries(budget, {
          accountId: counterparty.id,
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
        payee: command.payee ?? counterparty.name,
        status: "posted",
        expenseMonth: monthOf(command.date),
        kind: "reimbursement",
        linkedCounterpartyAccountId: counterparty.id,
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
    case "person.add": {
      if (budget.accounts.some((account) => account.id === command.accountId))
        fail("Account ID already exists");
      requireUniquePersonName(budget, command.name, command.accountId);
      changes.addAccount(budget, {
        id: command.accountId,
        name: command.name,
        kind: "person",
        date: `${budget.startMonth}-01`,
      });
      changes.addCategory(budget, {
        id: personEnvelopeId(command.accountId),
        name: command.name,
        group: PEOPLE_GROUP,
        counterpartyAccountId: command.accountId,
      });
      break;
    }
    case "person.rename": {
      const account = getAccount(budget, command.accountId);
      if (!isCounterparty(account)) fail("Choose a person to rename");
      if (isFormerPartner(account)) fail(frozenLedgerMessage);
      requireUniquePersonName(budget, command.name, account.id);
      changes.account(budget, account).name = command.name;
      const envelope = budget.categories.find(
        (category) => category.counterpartyAccountId === account.id,
      );
      if (envelope) changes.category(budget, envelope).name = command.name;
      break;
    }
    case "account.add": {
      if (budget.accounts.some((account) => account.id === command.accountId))
        fail("Account ID already exists");
      const date = command.date ?? `${budget.startMonth}-01`;
      requireDate(budget, date);
      changes.addAccount(budget, {
        id: command.accountId,
        name: command.name,
        kind: command.kind,
        date,
      });
      appendTransaction(changes, budget, command.id, {
        id: command.id,
        accountId: command.accountId,
        date,
        amount: command.openingBalance,
        payee: "Starting Balance",
        status: "posted",
        cleared: true,
        expenseMonth: monthOf(date),
        kind: "adjustment",
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
    case "account.reorder": {
      budget.accounts = reorder(budget.accounts, command.accountIds, (item) =>
        changes.account(budget, item),
      );
      break;
    }
    case "loan.reorder": {
      budget.loans = reorder(budget.loans, command.loanIds, (item) =>
        changes.loan(budget, item),
      );
      break;
    }
    case "account.reconcile": {
      requireDate(budget, command.date);
      const account = getAccount(budget, command.accountId);
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
          isCleared(transaction) &&
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
    case "group.rename": {
      const categories = editableGroup(budget, command.group);
      if (
        planGroups(budget).some(
          (name) =>
            name !== command.group &&
            name.toLowerCase() === command.name.toLowerCase(),
        )
      )
        fail("Category group already exists");
      changes.groups(budget);
      budget.groups = budget.groups?.map((name) =>
        name === command.group ? command.name : name,
      );
      for (const category of categories)
        changes.category(budget, category).group = command.name;
      break;
    }
    case "group.delete": {
      deleteCategories(
        changes,
        budget,
        editableGroup(budget, command.group),
        command.moveTo,
      );
      changes.groups(budget);
      budget.groups = budget.groups?.filter((name) => name !== command.group);
      break;
    }
    case "category.move": {
      const category = getCategory(budget, command.categoryId);
      const paired = (item: Category) =>
        Boolean(
          item.pairedAccountId ??
          item.pairedLoanId ??
          item.counterpartyAccountId,
        );
      if (category.group !== command.group) {
        if (paired(category))
          fail("Payment and partner categories stay in their group");
        const members = budget.categories.filter(
          (item) => item.group === command.group,
        );
        if (members.length > 0 && members.every(paired))
          fail("That group can't hold your own categories");
        const groups = planGroups(budget);
        if (!groups.includes(command.group))
          fail("Category group doesn't exist");
        // Groups known only through their categories would shift, or vanish,
        // as one leaves; naming every group keeps them where they are.
        changes.groups(budget);
        budget.groups = groups;
        changes.category(budget, category).group = command.group;
      }
      const ids = command.categoryIds.filter((id) =>
        budget.categories.some(
          (item) => item.id === id && item.group === command.group,
        ),
      );
      budget.categories = reorder(budget.categories, ids, (item) =>
        changes.category(budget, item),
      );
      break;
    }
    case "category.reorder": {
      const ids = command.categoryIds.filter((id) =>
        budget.categories.some(
          (category) => category.id === id && category.group === command.group,
        ),
      );
      budget.categories = reorder(budget.categories, ids, (item) =>
        changes.category(budget, item),
      );
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
    case "category.rename": {
      const category = editableCategory(budget, command.categoryId);
      const taken = budget.categories.find(
        (item) =>
          item !== category &&
          item.group === category.group &&
          item.name.toLowerCase() === command.name.toLowerCase(),
      );
      if (taken) fail(`${category.group} already has ${taken.name}`);
      changes.category(budget, category).name = command.name;
      break;
    }
    case "category.delete": {
      deleteCategories(
        changes,
        budget,
        [editableCategory(budget, command.categoryId)],
        command.moveTo,
      );
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
    case "transaction.upsert": {
      if (
        command.transferCounterpart &&
        (source !== "provider" || !command.transferAccountId)
      )
        fail("Only a bank update can attach the other side's bank facts");
      requireDate(budget, command.date);
      const account = getAccount(budget, command.accountId);
      const existing = budget.transactions.find(
        (transaction) => transaction.id === command.transactionId,
      );
      const entry = classifyRegisterEntry(
        budget,
        existing ?? {
          id: command.transactionId,
          accountId: command.accountId,
          date: command.date,
          amount: command.amount,
          payee: command.payee,
          transferAccountId: command.transferAccountId,
          loanId: command.loanId,
        },
      );
      if (
        entry.shape.kind === "adjustment" &&
        (command.categoryId ||
          command.lines ||
          command.counterpartyShare ||
          command.transferAccountId ||
          command.loanId)
      )
        fail("A balance adjustment's category and kind cannot change");
      // A bank update may restore a removed transaction: a posting replaces
      // the removed pending purchase it came from (banks.ts restoresPending).
      // The user may not.
      if (
        existing &&
        !(existing.removed && source !== "user") &&
        !entry.capabilities.edit.ok
      )
        fail(entry.capabilities.edit.reason);
      if (
        command.transferAccountId ||
        command.loanId ||
        "counterpart" in entry.shape ||
        "loan" in entry.shape
      ) {
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
        const paired =
          existing &&
          (isTransfer(existing) || existing.kind === "loan-payment");
        if (command.lines) fail("A transfer cannot be split");
        if (
          command.counterpartyShare ||
          existing?.counterpartyShare ||
          existing?.lines?.some((line) => line.counterpartyShare)
        )
          fail("Resolve counterparty shares before converting to a transfer");
        if (!command.amount) fail("Enter a nonzero amount");
        const counterparts = existing
          ? transferCounterparts(budget, existing)
          : [];
        if (
          existing &&
          "counterpart" in entry.shape &&
          counterparts.length !== 1
        )
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
            reviewed: approvalAfterSave(
              source,
              source === "user" ? previous : before,
              facts,
              command.reviewed,
            ),
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
                ...(source === "user" ? { actorId: budget.userId } : {}),
              },
            ],
          };
          if (
            !before &&
            budget.transactions.some((item) => item.id === facts.id)
          )
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
          cleared: nextCleared(command.cleared, command.status, previous),
          expenseMonth: command.expenseMonth ?? monthOf(command.date),
          providerId: previous?.providerId ?? command.providerId,
        };
        const linkedId = paired ? previous!.linkedId! : command.id;
        let retainedCounterpart: string | undefined;
        if (command.transferAccountId) {
          if (command.transferAccountId === account.id)
            fail("Choose a different account");
          const counterpartDate =
            command.transferCounterpart?.date ??
            (otherPrevious?.accountId === command.transferAccountId &&
            (source === "provider" || otherPrevious.providerId)
              ? otherPrevious.date
              : command.date);
          const other = getAccount(budget, command.transferAccountId);
          if (command.transferCounterpart) {
            requireDate(budget, command.transferCounterpart.date);
            if (
              budget.transactions.some(
                (item) =>
                  active(item) &&
                  item.id !== otherPrevious?.id &&
                  item.providerId === command.transferCounterpart!.providerId,
              )
            )
              fail("Provider transaction already exists");
          }
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
              sending.id === account.id ? command.date : counterpartDate,
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
              date: counterpartDate,
              expenseMonth:
                reusable && (source === "provider" || reusable.providerId)
                  ? reusable.expenseMonth
                  : command.transferCounterpart
                    ? monthOf(counterpartDate)
                    : base.expenseMonth,
              payee: transferPayee(other, account, -command.amount),
              // Each side clears its own bank.
              cleared: nextCleared(
                command.transferCounterpart
                  ? true
                  : source === "provider" && !reusable
                    ? false
                    : undefined,
                command.status,
                reusable,
              ),
              providerId:
                reusable?.providerId ?? command.transferCounterpart?.providerId,
              kind,
              linkedId,
              categoryId,
            },
            reusable,
          );
        } else if (command.loanId) {
          requireCash(budget, account.id);
          const loan =
            budget.loans.find((item) => item.id === command.loanId) ??
            fail("Loan access denied");
          if (
            command.categoryId !== undefined &&
            command.categoryId !== loan.categoryId
          )
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
        break;
      }
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
      const counterpartyShare =
        command.counterpartyShare === null
          ? undefined
          : (command.counterpartyShare ??
            (command.lines
              ? undefined
              : existing?.counterpartyShare
                ? {
                    ...existing.counterpartyShare,
                    amount: isFullShare(existing)
                      ? Math.abs(command.amount)
                      : Math.min(
                          existing.counterpartyShare.amount,
                          Math.abs(command.amount),
                        ),
                  }
                : undefined));
      if (counterpartyShare) {
        const share = classifyRegisterEntry(budget, {
          id: command.transactionId,
          accountId: account.id,
          date: command.date,
          amount: command.amount,
          payee: command.payee,
          categoryId: command.categoryId ?? existing?.categoryId,
          counterpartyShare,
        }).capabilities.share;
        if (share.mode === "none")
          fail(
            isCounterparty(account)
              ? directEntryAccountMessage
              : "Tracking activity cannot have a counterparty share",
          );
      }
      const validateShare = (amount: number, share?: CounterpartyShare) => {
        if (!share) return;
        if (share.amount > Math.abs(amount))
          fail("Counterparty share exceeds its line amount");
        const account = getAccount(budget, share.accountId);
        if (!isCounterparty(account)) fail("Choose who the share is for");
        if (isFormerPartner(account)) fail(frozenLedgerMessage);
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
            categoryId: isFullShare(line) ? undefined : line.categoryId,
            amount: line.amount,
            ...(line.counterpartyShare
              ? { counterpartyShare: line.counterpartyShare }
              : {}),
          }))
        : command.categoryId &&
            existing?.lines?.some((line) => line.counterpartyShare) &&
            command.counterpartyShare === undefined
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
      const fullyShared = isFullShare({
        amount: command.amount,
        counterpartyShare,
      });
      const categoryId =
        lines || fullyShared
          ? undefined
          : (command.categoryId ?? existing?.categoryId);
      if (!lines && !categoryId && !fullyShared && existing?.counterpartyShare)
        fail(purposeCategoryMessage);
      if (lines) {
        if (account.kind === "tracking")
          fail("Tracking activity does not use budget categories");
        if (new Set(lines.map((line) => line.id)).size !== lines.length)
          fail("Each split line needs its own id");
        for (const line of lines) {
          if (!line.amount) fail("Enter an amount on every split line");
          validateShare(line.amount, line.counterpartyShare);
          if (!line.categoryId) {
            if (!isFullShare(line)) fail(purposeCategoryMessage);
            continue;
          }
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
      const statementCredit =
        account.kind === "credit" &&
        command.amount > 0 &&
        !categoryId &&
        !lines &&
        !counterpartyShare;
      if (
        counterpartyShare &&
        ((!categoryId &&
          !isFullShare({ amount: command.amount, counterpartyShare })) ||
          lines)
      )
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
      const kind: Transaction["kind"] =
        existing?.kind === "adjustment"
          ? "adjustment"
          : statementCredit
            ? "statement-credit"
            : command.amount < 0
              ? "purchase"
              : categoryId || lines || counterpartyShare
                ? "refund"
                : "income";
      const transaction: Transaction = {
        id: command.transactionId,
        accountId: account.id,
        date: command.date,
        amount: command.amount,
        payee: command.payee,
        status: command.status,
        cleared: nextCleared(command.cleared, command.status, existing),
        categoryId,
        lines,
        counterpartyShare: lines ? undefined : counterpartyShare,
        expenseMonth,
        providerId: command.providerId ?? existing?.providerId,
        revision,
        reviewed: approvalAfterSave(
          source,
          existing,
          {
            accountId: account.id,
            date: command.date,
            amount: command.amount,
            categoryId,
            expenseMonth,
            kind,
          },
          command.reviewed,
        ),
        kind,
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
                (categoryId || counterpartyShare
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
      break;
    }
    case "transaction.remove": {
      const transaction = getTransaction(budget, command.transactionId);
      const capability = classifyRegisterEntry(budget, transaction).capabilities
        .remove;
      if (!capability.ok) fail(capability.reason);
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
      break;
    }
    case "transaction.reject": {
      const rejected = new Map<string, Transaction>();
      for (const id of command.transactionIds) {
        const transaction = getTransaction(budget, id);
        const capability = classifyRegisterEntry(budget, transaction)
          .capabilities.reject;
        if (!capability.ok) fail(capability.reason);
        const counterparts = transferCounterparts(budget, transaction);
        for (const item of [transaction, ...counterparts]) {
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
      break;
    }
    case "transaction.approve": {
      for (const id of command.transactionIds) {
        const transaction = getTransaction(budget, id);
        const capability = classifyRegisterEntry(budget, transaction)
          .capabilities.approve;
        if (!capability.ok) fail(capability.reason);
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
      const capability = classifyRegisterEntry(budget, transaction).capabilities
        .categorize;
      if (!capability.ok) fail(capability.reason);
      if (isTransfer(transaction)) {
        const counterparts = transferCounterparts(budget, transaction);
        const category = getCategory(budget, command.categoryId);
        refusePairedEnvelope(category);
        if (category.pairedAccountId || category.pairedLoanId)
          fail("Choose a spending category for this transfer");
        for (const item of [transaction, ...counterparts]) {
          changes.transaction(budget, item).categoryId = category.id;
          item.reviewed = approvalAfterCategorize(source, item);
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
      const category = getCategory(budget, command.categoryId);
      refusePairedEnvelope(category);
      if (category.pairedAccountId || category.pairedLoanId)
        fail("Payment categories cannot categorize purchases");
      changes.transaction(budget, transaction);
      if (transaction.lines?.some((line) => line.counterpartyShare)) {
        transaction.lines = transaction.lines.map((line) => ({
          ...line,
          categoryId: isFullShare(line) ? undefined : category.id,
        }));
        delete transaction.categoryId;
      } else {
        transaction.categoryId = isFullShare(transaction)
          ? undefined
          : category.id;
        delete transaction.lines;
      }
      if (transaction.amount > 0) transaction.kind = "refund";
      transaction.reviewed = approvalAfterCategorize(source, transaction);
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
      if (source !== "user")
        fail("Uncertain matches require explicit user review");
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
