import { z } from "zod";
import {
  budgetShape,
  payeeMemorySchema,
  storedIdentifier,
  targetSchema,
  transactionHistorySchema,
  transactionSchema,
} from "./engine";
import {
  partnerEntryObject,
  partnerSideSchema,
  shareWithinAmount,
} from "./partner-ledger";
import {
  partnerRequestSchema,
  partnerSettlementSchema,
} from "./partner-settlements";
import type { TableName, WireRow } from "./rows";

// What each row table's data holds, read as strictly as the engine reads
// the same records (ADR 0006, "Stored data across code versions"). A stored
// row that doesn't read takes only what depends on it out of service: its
// owner's personal budget, or the household for shared rows.

const budget = budgetShape.shape;
const element = <T extends z.ZodTypeAny>(array: z.ZodArray<T>) => array.element;
const owned = { userId: storedIdentifier };
const sort = { sort: z.number().int() };
const sequence = z.number().int().nonnegative();
const cents = z.number().int().safe();

const loan = element(budget.loans);
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
    .omit({ history: true, lines: true })
    .extend({ ...owned, ...sort }),
  transactionLine: element(transactionSchema.shape.lines.unwrap()).extend({
    ...owned,
    ...sort,
    transactionId: storedIdentifier,
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
  payeeMemory: payeeMemorySchema.extend({
    ...owned,
    payeeKey: storedIdentifier,
  }),
  partnerEntry: partnerEntryObject.extend(sort).refine(...shareWithinAmount),
  partnerEntrySide: partnerSideSchema.extend({
    ...owned,
    entryId: storedIdentifier,
  }),
  partnerSettlement: partnerSettlementSchema.extend(sort),
  partnerRequest: partnerRequestSchema.extend(sort),
  formerPartnerEntry: partnerEntryObject
    .extend({ ...owned, ...sort, accountId: storedIdentifier })
    .refine(...shareWithinAmount),
} satisfies Record<TableName, z.ZodTypeAny>;

/** Why a live row's data doesn't read, or null when it does. */
export function rowIssues(row: WireRow): z.ZodIssue[] | null {
  if (row.deleted) return null;
  const result = rowDataSchemas[row.table].safeParse(row.data);
  return result.success ? null : result.error.issues;
}
