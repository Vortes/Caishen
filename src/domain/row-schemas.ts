import { z } from "zod";
import {
  budgetShape,
  householdSchema,
  payeeMemorySchema,
  storedIdentifier,
  targetSchema,
  transactionHistorySchema,
  transactionSchema,
} from "./engine";
import type { TableName, WireRow } from "./rows";

// What each row table's data holds, read as strictly as the engine reads
// the same records (ADR 0006, "Stored data across code versions"). A stored
// row that doesn't read takes only what depends on it out of service: its
// owner's personal budget, or the household for shared rows. The stored
// data tests record these shapes, which may only grow.

const budget = budgetShape.shape;
const household = householdSchema.shape;
const element = <T extends z.ZodTypeAny>(array: z.ZodArray<T>) => array.element;
const owned = { userId: storedIdentifier };
const sort = { sort: z.number().int() };
const sequence = z.number().int().nonnegative();
const cents = z.number().int().safe();

const loan = element(budget.loans);
const reimbursement = element(budget.reimbursements);
const settlement = element(household.settlements);
const purchase = transactionSchema.pick({
  id: true,
  amount: true,
  date: true,
  expenseMonth: true,
  payee: true,
  status: true,
  shares: true,
});

export const rowDataSchemas = {
  member: z.object({ ...owned, ...sort, name: z.string() }),
  budgetSettings: budget.settings.extend({
    ...owned,
    startMonth: budget.startMonth,
  }),
  account: element(budget.accounts).extend({ ...owned, ...sort }),
  categoryGroup: z.object({ ...owned, ...sort, name: z.string() }),
  category: element(budget.categories)
    .omit({ target: true })
    .extend({ ...owned, ...sort }),
  target: z
    .object({ ...owned, categoryId: storedIdentifier })
    .and(targetSchema),
  assignment: element(budget.assignments).extend({ ...owned, ...sort }),
  expectedIncome: z.object({
    ...owned,
    month: budget.startMonth,
    amount: cents.nonnegative(),
  }),
  transaction: transactionSchema
    .omit({ history: true, shares: true, splitWeights: true })
    .extend({ ...owned, ...sort }),
  transactionShare: z.object({
    ...owned,
    transactionId: storedIdentifier,
    participantId: storedIdentifier,
    share: cents.nonnegative().optional(),
    weight: cents.nonnegative().optional(),
  }),
  transactionHistory: transactionHistorySchema.extend({
    ...owned,
    transactionId: storedIdentifier,
    sequence,
  }),
  loan: loan
    .omit({ rates: true, payments: true })
    .extend({ ...owned, ...sort }),
  loanRate: element(loan.shape.rates).extend({
    ...owned,
    loanId: storedIdentifier,
    sequence,
  }),
  loanPayment: element(loan.shape.payments).extend({
    ...owned,
    ...sort,
    loanId: storedIdentifier,
  }),
  reimbursement: reimbursement
    .omit({ receipts: true })
    .extend({ ...owned, ...sort }),
  reimbursementReceipt: element(reimbursement.shape.receipts).extend({
    ...owned,
    ...sort,
    reimbursementId: storedIdentifier,
  }),
  // Standing rules are no longer kept; their stored rows still read.
  rule: z.object({
    id: storedIdentifier,
    fromCategoryId: storedIdentifier,
    toCategoryId: storedIdentifier,
    enabled: z.boolean(),
    ...owned,
    ...sort,
  }),
  // The server reads the JSON parts with its own bank import schemas
  // (src/server/services/bank-import-rows.ts).
  bankImport: z.object({
    ...owned,
    ...sort,
    connectionId: storedIdentifier,
    logicalId: storedIdentifier,
    record: z.unknown().optional(),
    resolved: z.unknown().optional(),
    error: z.string().optional(),
    reviews: z.array(z.unknown()).optional(),
  }),
  sharedCategory: element(household.sharedCategories).extend(sort),
  obligation: element(household.obligations).extend(sort),
  settlement: settlement.omit({ allocations: true }).extend(sort),
  settlementAllocation: element(settlement.shape.allocations).extend({
    settlementId: storedIdentifier,
    sequence,
  }),
  partnerFact: z.discriminatedUnion("kind", [
    purchase.extend({
      viewerId: storedIdentifier,
      kind: z.literal("purchase"),
      ...sort,
      payerId: storedIdentifier,
      sharedCategoryId: storedIdentifier,
    }),
    z.object({
      viewerId: storedIdentifier,
      kind: z.literal("receipt"),
      settlementId: storedIdentifier,
      date: transactionSchema.shape.date,
    }),
    z.object({
      viewerId: storedIdentifier,
      kind: z.literal("activity"),
      // Empty when the browser rebuilt it from a personal ledger.
      payerId: z.string(),
      sharedCategoryId: storedIdentifier,
      ...sort,
    }),
  ]),
  payeeMemory: payeeMemorySchema.extend({
    ...owned,
    payeeKey: storedIdentifier,
  }),
} satisfies Record<TableName, z.ZodTypeAny>;

/** Why a live row's data doesn't read, or null when it does. */
export function rowIssues(row: WireRow): z.ZodIssue[] | null {
  if (row.deleted) return null;
  const result = rowDataSchemas[row.table].safeParse(row.data);
  return result.success ? null : result.error.issues;
}
