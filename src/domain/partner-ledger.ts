import { z } from "zod";
import type { Changes } from "./changes";
import type { Budget, Transaction, TransactionLine } from "./engine";
import { counterpartyLines, shareContribution } from "./counterparty";
import { payeeKey } from "./payee-memory";
import { isPersonalLedger, type AccountingState } from "./shared-ledger";

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
// - An entry without a `source` is a purchase recorded before the payer's
//   bank import arrives (`partner.record`). It counts at once in both
//   budgets: the non-payer's as above, and the payer's Partner account and
//   paired envelope by the same change, held as credit rather than cash
//   overspending, since no account of theirs has paid it yet. The payer's
//   own part waits for the import; the category they chose for it, if they
//   recorded it themselves, is their side until then.
// - When the payer's import arrives it is matched to the entry
//   (`partner.match`): the import becomes the payer's transaction with the
//   entry's share, and the entry's `source` names it. The entry keeps its
//   id, its history, and the non-payer's side.

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
  // "recorded": created before the payer's import, by whoever recorded it.
  // "matched": linked to the payer's import, which is its source from then.
  reason:
    "created" | "recorded" | "matched" | "updated" | "removed" | "restored";
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
  reason: z.enum([
    "created",
    "recorded",
    "matched",
    "updated",
    "removed",
    "restored",
  ]),
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

/** Whether an entry still waits for its payer's bank import. */
export function awaitingImport(entry: PartnerEntry): boolean {
  return !entry.source;
}

/**
 * The entries one partner's accounting takes from the shared ledger: the
 * other's purchases, and their own still waiting for their import.
 */
export function mirroredEntries(
  entries: PartnerEntry[] | undefined,
  viewerId: string,
): PartnerEntry[] {
  return (entries ?? []).filter(
    (entry) =>
      !entry.removed && (entry.payerId !== viewerId || awaitingImport(entry)),
  );
}

/** The key of a payer's line, for finding the entry it's the source of. */
export const sourceKey = (transactionId: string, lineId: string) =>
  `${transactionId}\u0000${lineId}`;

/** The entry each source line is the source of. */
export function entriesBySource(
  entries: PartnerEntry[] | undefined,
): Map<string, PartnerEntry> {
  return new Map(
    (entries ?? []).flatMap((entry) =>
      entry.source
        ? [[sourceKey(entry.source.transactionId, entry.source.lineId), entry]]
        : [],
    ),
  );
}

/** Who recorded an entry before its payer's import, if anyone did. */
export function recordedBy(entry: PartnerEntry): string | undefined {
  return entry.history.find((change) => change.reason === "recorded")?.actorId;
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
  // Recorded before the payer's import, which hasn't arrived yet.
  awaitingImport: boolean;
  // Who recorded it before the payer's import, when someone did.
  recordedBy?: string;
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
  const bySource = entriesBySource(entries);
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
        awaitingImport: false,
        history: [],
      });
      continue;
    }
    for (const line of partnerLines(budget, transaction)) {
      const share = line.counterpartyShare!.amount;
      const entry = bySource.get(sourceKey(transaction.id, line.id));
      const shared = Math.abs(line.amount);
      rows.push({
        // A matched entry keeps the id it was recorded under.
        id: entry?.id ?? partnerEntryId(viewerId, transaction.id, line.id),
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
        entryId: entry?.id,
        awaitingImport: false,
        recordedBy: entry && recordedBy(entry),
        history: entry?.history ?? [],
      });
    }
  }
  for (const entry of mirroredEntries(entries, viewerId)) {
    if (!entryCounts(entry, cutoff)) continue;
    const paid = entry.payerId === viewerId;
    const categoryId = sideCategory(budget, entry.id);
    const shared = Math.abs(entry.amount);
    // The payer categorizes their part once their import arrives.
    const needsCategory = !paid && !categoryId && entry.share > 0;
    rows.push({
      id: entry.id,
      kind: entry.amount > 0 ? "refund" : "purchase",
      date: entry.date,
      payee: entry.payee,
      status: entry.status,
      payerId: entry.payerId,
      shared,
      you: paid ? shared - entry.share : entry.share,
      partner: paid ? entry.share : shared - entry.share,
      change: mirroredChange(entry, viewerId),
      categoryId,
      suggestedCategoryId: needsCategory
        ? rememberedSpendingCategory(budget, entry.payee)
        : undefined,
      needsCategory,
      entryId: entry.id,
      awaitingImport: awaitingImport(entry),
      recordedBy: recordedBy(entry),
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

// Writing the ledger: entries follow their source lines.

type EntryFacts = Pick<
  PartnerEntry,
  "payerId" | "source" | "date" | "payee" | "status" | "amount" | "share"
>;
export type LedgerWrite = {
  actorId: string;
  operationId: string;
  at?: string;
};

/** The ledger facts of a payer's shared line: all an entry may hold. */
export function lineFacts(
  payerId: string,
  transaction: Transaction,
  line: TransactionLine,
): EntryFacts {
  return {
    payerId,
    source: { transactionId: transaction.id, lineId: line.id },
    date: transaction.date,
    payee: transaction.payee,
    status: transaction.status,
    amount: line.amount,
    share: line.counterpartyShare!.amount,
  };
}

/**
 * Writes an entry's facts, recording what changed in its history. A new
 * entry is created only when it shares something: a line shared with the
 * partner at $0.00 stays private until it has been shared.
 */
export function writeEntry(
  state: AccountingState,
  changes: Changes,
  id: string,
  facts: EntryFacts,
  write: LedgerWrite,
): void {
  const entry = state.partnerEntries?.find((item) => item.id === id);
  const stamp = {
    actorId: write.actorId,
    operationId: write.operationId,
    ...(write.at ? { at: write.at } : {}),
  };
  if (!entry) {
    if (!facts.share) return;
    changes.addPartnerEntry({
      id,
      ...facts,
      history: [{ ...stamp, reason: "created" }],
    });
    return;
  }
  const changed = PARTNER_HISTORY_FIELDS.flatMap((field) =>
    entry[field] === facts[field]
      ? []
      : [{ field, previous: entry[field], next: facts[field] }],
  );
  if (!changed.length && !entry.removed) return;
  const tracked = changes.partnerEntry(entry);
  Object.assign(tracked, facts);
  tracked.history.push({
    ...stamp,
    reason: tracked.removed ? "restored" : "updated",
    ...(changed.length ? { changes: changed } : {}),
  });
  delete tracked.removed;
}

function removeEntry(
  changes: Changes,
  entry: PartnerEntry,
  write: LedgerWrite,
): void {
  if (entry.removed) return;
  const tracked = changes.partnerEntry(entry);
  tracked.removed = true;
  tracked.history.push({
    actorId: write.actorId,
    operationId: write.operationId,
    ...(write.at ? { at: write.at } : {}),
    reason: "removed",
  });
}

/**
 * Keeps the entries mirrored from the transactions a command touched equal
 * to their source lines. Runs after every command, so whatever changes a
 * shared line (an edit, a removal, a bank update, a refund) updates both
 * partners' ledgers. A personal ledger holds only its owner's budget, so
 * it mirrors only that budget's lines.
 */
export function synchronizePartnerEntries(
  state: AccountingState,
  changes: Changes,
  write: LedgerWrite,
): void {
  const partnered = isPersonalLedger(state)
    ? state.members.length === 2
    : Object.keys(state.budgets).length === 2;
  if (!partnered) return;
  const budgets = isPersonalLedger(state)
    ? [state.budget]
    : Object.values(state.budgets);
  const bySource = entriesBySource(state.partnerEntries);
  for (const budget of budgets) {
    if (!partnerAccountOf(budget)) continue;
    for (const { before, after } of changes.transactionEdits(budget)) {
      const transactionId = (after ?? before)!.id;
      const mirrored = new Set<string>();
      if (after && !after.removed)
        for (const line of partnerLines(budget, after)) {
          // A matched entry keeps the id it was recorded under.
          const id =
            bySource.get(sourceKey(after.id, line.id))?.id ??
            partnerEntryId(budget.userId, after.id, line.id);
          mirrored.add(id);
          writeEntry(
            state,
            changes,
            id,
            lineFacts(budget.userId, after, line),
            write,
          );
        }
      for (const entry of state.partnerEntries ?? [])
        if (
          entry.payerId === budget.userId &&
          entry.source?.transactionId === transactionId &&
          !mirrored.has(entry.id)
        )
          removeEntry(changes, entry, write);
    }
  }
}
