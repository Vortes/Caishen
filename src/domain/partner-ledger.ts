import { z } from "zod";
import type { Budget, Transaction, TransactionLine } from "./engine";
import { counterpartyLines, shareContribution } from "./counterparty";
import { payeeKey } from "./payee-memory";

// The partner ledger: the one ledger both partners' budgets share (shared
// costs phase 3). Each partner's Partner account shows it with the opposite
// balance: positive is owed to the viewer, negative the viewer owes.
//
// Mirrored-entry contract
//
// - A `partnerEntry` row is household data, so both partners' browsers hold
//   it. It carries only ledger facts: who paid, the date, payee, status, the
//   shared line's amount, the other partner's share, and the history of
//   those facts. Nothing else of either budget is ever copied into it: no
//   category, no other line, no other account, no Reimbursements data.
// - A `partnerEntrySide` row is one partner's private side of an entry, in
//   their own budget: the category their part of it belongs to. Only its
//   owner's browser holds it.
// - A mirrored entry's source is the payer's transaction line whose share
//   names their Partner account. Its id is partnerEntryId(payer, transaction,
//   line), and `source` names that line. The engine keeps the entry equal to
//   its source after every command (synchronizePartnerEntries); edits made
//   from either side (the `partner.edit` command) change the source line,
//   from which the entry follows. An entry whose source loses its partner
//   share, or is removed, is marked removed and keeps its history.
// - The payer's accounting is the line's own (src/domain/counterparty.ts).
//   The other partner's accounting is the entry's: their Partner account
//   moves by mirroredChange, their paired envelope holds it, and their
//   side's category, once chosen, carries their share as cash-backed
//   spending. Until then the entry is uncategorized and the money owed is
//   held from Ready to Assign.
// - An entry without a `source` is reserved for purchases one partner
//   records for the other before the payer's bank import arrives (phase
//   3b); readers already count such an entry for the partner who didn't pay.

export const PARTNER_HISTORY_FIELDS = [
  "share",
  "amount",
  "date",
  "payee",
  "status",
] as const;

export type PartnerEntryChange = {
  actorId: string;
  at?: string;
  operationId: string;
  reason: "created" | "updated" | "removed" | "restored";
  changes?: {
    field: (typeof PARTNER_HISTORY_FIELDS)[number];
    previous: string | number;
    next: string | number;
  }[];
};

export type PartnerEntry = {
  id: string;
  payerId: string;
  source?: { transactionId: string; lineId: string };
  date: string;
  payee: string;
  status: "pending" | "posted";
  // The shared line's signed amount as the payer's account recorded it:
  // negative for a purchase, positive for a refund.
  amount: number;
  // The partner who didn't pay: their part of the amount.
  share: number;
  removed?: boolean;
  history: PartnerEntryChange[];
};

export type PartnerSide = { categoryId?: string };

const identifier = z.string().min(1).max(1024);
const cents = z.number().int().safe();
const day = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);

export const partnerEntryChangeSchema = z.object({
  actorId: identifier,
  at: z.string().optional(),
  operationId: identifier,
  reason: z.enum(["created", "updated", "removed", "restored"]),
  changes: z
    .array(
      z.object({
        field: z.enum(PARTNER_HISTORY_FIELDS),
        previous: z.union([z.string(), cents]),
        next: z.union([z.string(), cents]),
      }),
    )
    .optional(),
});

export const partnerEntryObject = z.object({
  id: identifier,
  payerId: identifier,
  source: z
    .object({ transactionId: identifier, lineId: identifier })
    .optional(),
  date: day,
  payee: z.string(),
  status: z.enum(["pending", "posted"]),
  amount: cents.refine((value) => value !== 0),
  share: cents.nonnegative(),
  removed: z.boolean().optional(),
  history: z.array(partnerEntryChangeSchema),
});
export const shareWithinAmount = [
  (entry: { share: number; amount: number }) =>
    entry.share <= Math.abs(entry.amount),
  { message: "A partner's share can't exceed the shared amount" },
] as const;
export const partnerEntrySchema = partnerEntryObject.refine(
  ...shareWithinAmount,
);

export const partnerSideSchema = z.object({
  categoryId: identifier.optional(),
});

/** A mirrored entry's id: the payer's transaction line it mirrors. */
export function partnerEntryId(
  payerId: string,
  transactionId: string,
  lineId: string,
): string {
  return [payerId, transactionId, lineId]
    .map((part) => part.replaceAll("%", "%25").replaceAll(":", "%3A"))
    .join(":");
}

/** The budget's Partner account, when the household is partnered. */
export function partnerAccountOf(
  budget: Pick<Budget, "accounts">,
): Budget["accounts"][number] | undefined {
  return budget.accounts.find((account) => account.kind === "partner");
}

/**
 * The lines of a transaction that are shared with the partner: their share
 * names the payer's Partner account.
 */
export function partnerLines(
  budget: Pick<Budget, "accounts">,
  transaction: Transaction,
): TransactionLine[] {
  const partner = partnerAccountOf(budget);
  if (!partner) return [];
  return counterpartyLines(transaction).filter(
    (line) => line.counterpartyShare?.accountId === partner.id,
  );
}

/** Whether an entry counts toward balances by the cutoff day. */
export function entryCounts(entry: PartnerEntry, cutoff: string): boolean {
  return (
    !entry.removed &&
    entry.date <= cutoff &&
    !(entry.status === "pending" && entry.amount > 0)
  );
}

/**
 * How an entry moves the viewer's Partner account: positive when the
 * partner owes the viewer more.
 */
export function mirroredChange(entry: PartnerEntry, viewerId: string): number {
  const payerChange = shareContribution(entry.amount, {
    accountId: "",
    amount: entry.share,
  });
  return entry.payerId === viewerId ? payerChange : -payerChange || 0;
}

/** The entries one partner's accounting takes from the other's purchases. */
export function mirroredEntries(
  entries: PartnerEntry[] | undefined,
  viewerId: string,
): PartnerEntry[] {
  return (entries ?? []).filter(
    (entry) => !entry.removed && entry.payerId !== viewerId,
  );
}

/**
 * The category the viewer's side of an entry belongs to, when it names one
 * of their spending categories.
 */
export function sideCategory(
  budget: Pick<Budget, "categories" | "partnerSides">,
  entryId: string,
): string | undefined {
  const categoryId = budget.partnerSides?.[entryId]?.categoryId;
  const category = budget.categories.find((item) => item.id === categoryId);
  return category && spendingCategory(category) ? category.id : undefined;
}

export function spendingCategory(
  category: Budget["categories"][number],
): boolean {
  return (
    !category.counterpartyAccountId &&
    !category.pairedAccountId &&
    !category.pairedLoanId
  );
}

/** Why a budget's partner sides don't read, as reference issues. */
export function partnerSideIssues(
  budget: Pick<Budget, "categories" | "partnerSides">,
): string[] {
  return Object.values(budget.partnerSides ?? {}).some((side) => {
    if (side.categoryId === undefined) return false;
    const category = budget.categories.find(
      (item) => item.id === side.categoryId,
    );
    return !category || !spendingCategory(category);
  })
    ? ["Invalid partner entry category reference"]
    : [];
}

export type PartnerLedgerRow = {
  id: string;
  kind: "purchase" | "refund" | "repayment";
  date: string;
  payee: string;
  status: "pending" | "posted";
  payerId: string;
  // The whole shared amount, and each partner's part of it.
  shared: number;
  you: number;
  partner: number;
  // Signed for the viewer: positive means the partner owes the viewer more.
  change: number;
  balance: number;
  categoryId?: string;
  // The viewer's payee memory for an entry they still need to categorize.
  suggestedCategoryId?: string;
  needsCategory: boolean;
  // The viewer's own transaction and line, when they paid.
  transactionId?: string;
  lineId?: string;
  entryId?: string;
  history: PartnerEntryChange[];
};

/**
 * The viewer's Partner register, newest first, with a running balance that
 * ends at the Partner account's balance: their own shared lines and
 * repayments from their budget, and their partner's entries from the
 * shared ledger.
 */
export function partnerLedgerRows(
  budget: Budget,
  entries: PartnerEntry[] | undefined,
  cutoff: string,
): PartnerLedgerRow[] {
  const viewerId = budget.userId;
  const partner = partnerAccountOf(budget);
  if (!partner) return [];
  const byId = new Map((entries ?? []).map((entry) => [entry.id, entry]));
  const rows: Omit<PartnerLedgerRow, "balance">[] = [];
  for (const transaction of budget.transactions) {
    if (
      transaction.removed ||
      transaction.date > cutoff ||
      (transaction.status === "pending" && transaction.amount > 0)
    )
      continue;
    if (transaction.linkedCounterpartyAccountId === partner.id) {
      rows.push({
        id: `${transaction.id}:repayment`,
        kind: "repayment",
        date: transaction.date,
        payee: transaction.payee,
        status: transaction.status,
        payerId: "",
        shared: 0,
        you: 0,
        partner: 0,
        change: -transaction.amount,
        categoryId: undefined,
        needsCategory: false,
        transactionId: transaction.id,
        history: [],
      });
      continue;
    }
    for (const line of partnerLines(budget, transaction)) {
      const share = line.counterpartyShare!.amount;
      const entryId = partnerEntryId(viewerId, transaction.id, line.id);
      const shared = Math.abs(line.amount);
      rows.push({
        id: entryId,
        kind: line.amount > 0 ? "refund" : "purchase",
        date: transaction.date,
        payee: transaction.payee,
        status: transaction.status,
        payerId: viewerId,
        shared,
        you: shared - share,
        partner: share,
        change: shareContribution(line.amount, line.counterpartyShare),
        categoryId: line.categoryId,
        needsCategory: false,
        transactionId: transaction.id,
        lineId: line.id,
        entryId: byId.has(entryId) ? entryId : undefined,
        history: byId.get(entryId)?.history ?? [],
      });
    }
  }
  for (const entry of mirroredEntries(entries, viewerId)) {
    if (!entryCounts(entry, cutoff)) continue;
    const categoryId = sideCategory(budget, entry.id);
    const shared = Math.abs(entry.amount);
    const needsCategory = !categoryId && entry.share > 0;
    rows.push({
      id: entry.id,
      kind: entry.amount > 0 ? "refund" : "purchase",
      date: entry.date,
      payee: entry.payee,
      status: entry.status,
      payerId: entry.payerId,
      shared,
      you: entry.share,
      partner: shared - entry.share,
      change: mirroredChange(entry, viewerId),
      categoryId,
      suggestedCategoryId: needsCategory
        ? rememberedSpendingCategory(budget, entry.payee)
        : undefined,
      needsCategory,
      entryId: entry.id,
      history: entry.history,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let balance = 0;
  return rows
    .map((row) => {
      balance += row.change;
      return { ...row, balance };
    })
    .reverse();
}

// The spending category the viewer last gave this payee, which prefills
// their side of a partner's purchase.
function rememberedSpendingCategory(
  budget: Budget,
  payee: string,
): string | undefined {
  const memory = budget.payeeMemory?.[payeeKey(payee)];
  if (memory?.kind !== "category") return undefined;
  const category = budget.categories.find(
    (item) => item.id === memory.categoryId,
  );
  return category && spendingCategory(category) ? category.id : undefined;
}
