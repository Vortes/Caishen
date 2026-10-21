import { z } from "zod";
import {
  AccountingError,
  bookSchema,
  budgetSchema,
  householdSchema,
  sharedCategoryReferencesValid,
  storedIdentifier,
  transactionSchema,
  type Book,
  type Budget,
  type Household,
} from "./engine";
import {
  budgetSharedPurchases,
  isPersonalLedger,
  settlementReceiptDate,
  type AccountingState,
  type PartnerFacts,
  type PersonalLedger,
} from "./shared-ledger";

// Stored data can be unreadable when newer code wrote a value this code
// doesn't know (ADR 0006, "Stored data across code versions"). Reading is
// split so that only what depends on the unreadable part stops: an
// unreadable personal budget takes down that partner's plan, not the
// other's, and nothing is ever written over it.

export type StoredDataIssue = {
  path: (string | number)[];
  code: string;
  message: string;
};
export type StoredDataFailure = (
  | { part: "household" }
  | { part: "budget"; ownerId: string }
  | { part: "partner-facts"; ownerId: string }
) & { issues: StoredDataIssue[] };

export type PersonalBudgetRead =
  | {
      status: "ready";
      state: AccountingState;
      // Set when the partner's budget couldn't be read; this partner's plan
      // still works without it.
      failures: StoredDataFailure[];
    }
  | { status: "maintenance"; failures: StoredDataFailure[] };

export const PARTNER_MAINTENANCE_MESSAGE =
  "This change also needs your partner’s plan, which is under maintenance. Try again in a few minutes.";

const envelopeSchema = z.object({
  version: z.literal(1),
  budgets: z
    .record(z.unknown())
    .refine(
      (budgets) => [1, 2].includes(Object.keys(budgets).length),
      "Invalid household membership",
    ),
});

// Strict about every field a partner's numbers use, and nothing else, so a
// value only the owner's own plan uses can't take the partner's plan down.
const partnerFactsSchema: z.ZodType<PartnerFacts, z.ZodTypeDef, unknown> =
  z.object({
    userId: storedIdentifier,
    name: z.string(),
    categories: z.array(z.object({ id: storedIdentifier })),
    transactions: z.array(
      transactionSchema
        .pick({
          id: true,
          amount: true,
          date: true,
          expenseMonth: true,
          payee: true,
          status: true,
          sharedCategoryId: true,
          shares: true,
          linkedId: true,
          removed: true,
        })
        // Only compared with "reimbursement"; any other kind is not one.
        .extend({ kind: z.string() }),
    ),
  });

function issues(error: z.ZodError, prefix: (string | number)[] = []) {
  return error.issues.map((issue) => ({
    path: [...prefix, ...issue.path],
    code: issue.code,
    message: issue.message,
  }));
}

type Parts = {
  budgets: Record<string, unknown>;
  household: Household;
  readable: Map<string, Budget>;
  failures: StoredDataFailure[];
};

function readParts(
  stored: unknown,
): { book: Book } | { parts: Parts } | { failures: StoredDataFailure[] } {
  const book = bookSchema.safeParse(stored);
  if (book.success) return { book: book.data };
  const envelope = envelopeSchema.safeParse(stored);
  if (!envelope.success)
    return {
      failures: [{ part: "household", issues: issues(envelope.error) }],
    };
  const household = householdSchema.safeParse(stored);
  if (!household.success)
    return {
      failures: [{ part: "household", issues: issues(household.error) }],
    };
  const readable = new Map<string, Budget>();
  const failures: StoredDataFailure[] = [];
  for (const [ownerId, value] of Object.entries(envelope.data.budgets)) {
    const budget = budgetSchema.safeParse(value);
    if (budget.success && budget.data.userId === ownerId)
      readable.set(ownerId, budget.data);
    else
      failures.push({
        part: "budget",
        ownerId,
        issues: budget.success
          ? [
              {
                path: ["budgets", ownerId, "userId"],
                code: "custom",
                message: "Invalid household membership",
              },
            ]
          : issues(budget.error, ["budgets", ownerId]),
      });
  }
  // Every part reads on its own, so the household's cross-references broke.
  if (!failures.length)
    return { failures: [{ part: "household", issues: issues(book.error) }] };
  return {
    parts: {
      budgets: envelope.data.budgets,
      household: household.data,
      readable,
      failures,
    },
  };
}

function partnerFacts(parts: Parts, ownerId: string) {
  return Object.keys(parts.budgets)
    .filter((id) => id !== ownerId)
    .map((id) => ({
      id,
      facts: partnerFactsSchema.safeParse(parts.budgets[id]),
    }));
}

// Opens one partner's plan from the stored household. A Book when everything
// reads; a personal ledger when only the partner's budget can't be read;
// maintenance when this partner's own numbers can't be trusted.
export function openPersonalBudget(
  stored: unknown,
  userId: string,
): PersonalBudgetRead {
  const read = readParts(stored);
  if ("book" in read)
    return { status: "ready", state: read.book, failures: [] };
  if ("failures" in read)
    return { status: "maintenance", failures: read.failures };
  const { parts } = read;
  const own = parts.readable.get(userId);
  if (!own) return { status: "maintenance", failures: parts.failures };
  const partners: PartnerFacts[] = [];
  const failures = [...parts.failures];
  for (const { id, facts } of partnerFacts(parts, userId))
    if (facts.success && facts.data.userId === id) partners.push(facts.data);
    else
      failures.push({
        part: "partner-facts",
        ownerId: id,
        issues: facts.success ? [] : issues(facts.error, ["budgets", id]),
      });
  const categoryIds = (id: string) =>
    (id === userId
      ? own.categories
      : partners.find((partner) => partner.userId === id)?.categories
    )?.map((category) => category.id);
  if (
    failures.some((failure) => failure.part === "partner-facts") ||
    !sharedCategoryReferencesValid(
      parts.household.sharedCategories,
      categoryIds,
    )
  )
    return { status: "maintenance", failures };
  const state: PersonalLedger = {
    kind: "personal",
    version: 1,
    budget: own,
    members: Object.keys(parts.budgets).map((id) => ({
      userId: id,
      name:
        id === userId
          ? own.name
          : partners.find((partner) => partner.userId === id)!.name,
    })),
    ...parts.household,
    partnerPurchases: partners.flatMap(budgetSharedPurchases),
    partnerReceiptDates: Object.fromEntries(
      parts.household.settlements.flatMap((settlement) => {
        const recipient = partners.find(
          (partner) => partner.userId === settlement.recipientId,
        );
        const date =
          recipient && settlementReceiptDate(recipient, settlement.id);
        return date ? [[settlement.id, date]] : [];
      }),
    ),
    partnerActivityCategoryIds: [
      ...new Set(
        partners.flatMap((partner) =>
          partner.transactions.flatMap((transaction) =>
            transaction.sharedCategoryId ? [transaction.sharedCategoryId] : [],
          ),
        ),
      ),
    ],
  };
  return { status: "ready", state, failures };
}

// The stored household after a change, validated as strictly as any write.
// A personal ledger's changes are written into the stored household around
// the partner's unreadable budget, which stays exactly as it was stored.
export function storeState(stored: unknown, next: AccountingState): unknown {
  if (!isPersonalLedger(next)) return bookSchema.parse(next);
  const envelope = envelopeSchema.parse(stored);
  const budget = budgetSchema.parse(next.budget);
  const household = householdSchema.parse(next);
  const partners = Object.keys(envelope.budgets).filter(
    (id) => id !== budget.userId,
  );
  if (!Object.hasOwn(envelope.budgets, budget.userId))
    throw new AccountingError("Budget access denied");
  const categoryIds = (id: string) =>
    id === budget.userId
      ? budget.categories.map((category) => category.id)
      : partners.includes(id)
        ? partnerFactsSchema
            .parse(envelope.budgets[id])
            .categories.map((category) => category.id)
        : undefined;
  if (!sharedCategoryReferencesValid(household.sharedCategories, categoryIds))
    throw new AccountingError(PARTNER_MAINTENANCE_MESSAGE);
  return {
    ...(stored as Record<string, unknown>),
    budgets: { ...envelope.budgets, [budget.userId]: budget },
    ...household,
  };
}
