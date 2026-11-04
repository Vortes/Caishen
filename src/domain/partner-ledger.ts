import { z } from "zod";
import { classifyRegisterEntry } from "./register-entry";
import type { Changes } from "./changes";
import type { Budget, Transaction, TransactionLine } from "./engine";
import { isPending } from "./cleared";
import { counterpartyLines, shareContribution } from "./counterparty";
import type { PartnerSettlement } from "./partner-settlements";
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
//   The other partner's accounting is the entry's, and works like a credit
//   card purchase with their Partner account as the card (ADR 0015): the
//   account moves by mirroredChange, and their side's category, once
//   chosen, carries their share as credit spending. What the category holds
//   funds it into the paired envelope; the rest is credit overspending in
//   the category and unfunded credit on the account. An uncategorized share
//   is unfunded and holds nothing from Ready to Assign. The envelope's
//   available amount is its float minus the account's balance and its
//   unfunded credit. Paying them more than it holds is cash overspending
//   that resets at month end, as a card payment category's does. A former
//   partner's frozen entries keep these rules.

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
  // "recorded" and "matched" come from purchases recorded before their
  // payer's import, which stored entries still carry.
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
  source?: {
    transactionId: string;
    lineId: string;
    hasPurposeCategory: boolean;
    onSplitPurchase: boolean;
  };
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

// One partner's side of an entry: one category, or lines across several
// that add up to their part, like a split transaction's.
export type PartnerSideLine = {
  id: string;
  categoryId: string;
  amount: number;
};
export type PartnerSide = { categoryId?: string; lines?: PartnerSideLine[] };

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
    .object({
      transactionId: identifier,
      lineId: identifier,
      hasPurposeCategory: z.boolean(),
      onSplitPurchase: z.boolean(),
    })
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

// A former partner's entry, kept in each budget under the closed account it
// belonged to when the partnership ended. It never changes again.
export type FormerPartnerEntry = PartnerEntry & { accountId: string };
export const formerPartnerEntrySchema = partnerEntryObject
  .extend({ accountId: identifier })
  .refine(...shareWithinAmount);

export const partnerSideLineSchema = z.object({
  id: identifier,
  categoryId: identifier,
  amount: cents,
});
export const partnerSideSchema = z.object({
  categoryId: identifier.optional(),
  lines: z.array(partnerSideLineSchema).optional(),
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
  return budget.accounts.find(
    (account) =>
      account.kind === "person" && !!account.linkedUserId && !account.closed,
  );
}

/**
 * The lines of a transaction that are shared with the partner: their share
 * names the payer's Partner account, or the given partner ledger account.
 */
export function partnerLines(
  budget: Pick<Budget, "accounts">,
  transaction: Transaction,
  accountId = partnerAccountOf(budget)?.id,
): TransactionLine[] {
  if (!accountId) return [];
  return counterpartyLines(transaction).filter(
    (line) => line.counterpartyShare?.accountId === accountId,
  );
}

/** Whether an account holds a partner ledger: the partner's, or a former one's. */
export const isPartnerLedger = (
  account: Pick<Budget["accounts"][number], "kind" | "linkedUserId" | "closed">,
) => account.kind === "person" && (!!account.linkedUserId || !!account.closed);

/**
 * The ledger entries behind one partner ledger account: the household's
 * shared entries for the Partner account, or the frozen entries a former
 * partner's closed account keeps.
 */
export function ledgerEntries(
  budget: Pick<Budget, "accounts" | "formerPartnerEntries">,
  shared: PartnerEntry[] | undefined,
  accountId: string,
): PartnerEntry[] {
  const account = budget.accounts.find((item) => item.id === accountId);
  if (account?.kind !== "person") return [];
  if (account.linkedUserId && !account.closed) return shared ?? [];
  if (!account.closed) return [];
  return (budget.formerPartnerEntries ?? []).filter(
    (entry) => entry.accountId === accountId,
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

/**
 * The entries one partner's accounting takes from the shared ledger: the
 * other's purchases. Their own come from their transactions.
 */
export function mirroredEntries(
  entries: PartnerEntry[] | undefined,
  viewerId: string,
): PartnerEntry[] {
  return (entries ?? []).filter(
    (entry) => !entry.removed && entry.payerId !== viewerId,
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

/**
 * How the viewer's side of an entry spends its change: the whole change in
 * its category, or each split line in its own. What the lines leave of the
 * change, once the share is edited after the split, spends nowhere until
 * it's categorized.
 */
export function sideSpending(
  budget: Pick<Budget, "categories" | "partnerSides">,
  entryId: string,
  change: number,
): [categoryId: string, amount: number][] {
  const lines = budget.partnerSides?.[entryId]?.lines;
  if (!lines) {
    const categoryId = sideCategory(budget, entryId);
    return categoryId ? [[categoryId, change]] : [];
  }
  return lines.flatMap((line) => {
    const category = budget.categories.find(
      (item) => item.id === line.categoryId,
    );
    return category && spendingCategory(category)
      ? [[category.id, line.amount] as [string, number]]
      : [];
  });
}

/**
 * Whether the viewer's side of an entry still needs a category: it has
 * none, or it's a split whose lines no longer add up to the change after a
 * share edit.
 */
export function sideNeedsCategory(
  budget: Pick<Budget, "categories" | "partnerSides">,
  entry: Pick<PartnerEntry, "id" | "share">,
  change: number,
): boolean {
  return budget.partnerSides?.[entry.id]?.lines
    ? sideSpending(budget, entry.id, change).reduce(
        (total, [, amount]) => total + amount,
        0,
      ) !== change
    : !sideCategory(budget, entry.id) && entry.share > 0;
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
  return Object.values(budget.partnerSides ?? {}).some((side) =>
    [
      side.categoryId,
      ...(side.lines ?? []).map((line) => line.categoryId),
    ].some((categoryId) => {
      if (categoryId === undefined) return false;
      const category = budget.categories.find((item) => item.id === categoryId);
      return !category || !spendingCategory(category);
    }),
  )
    ? ["Invalid partner entry category reference"]
    : [];
}

export type PartnerLedgerRow = {
  id: string;
  kind: "purchase" | "refund" | "repayment" | "settlement";
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
  // The viewer's split of their side of a partner's purchase.
  lines?: PartnerSideLine[];
  // The viewer's payee memory for an entry they haven't categorized.
  suggestedCategoryId?: string;
  needsCategory: boolean;
  // The viewer's own transaction and line, when they paid.
  transactionId?: string;
  lineId?: string;
  entryId?: string;
  // A settlement: the household's record of it, and how it was sent.
  settlementId?: string;
  method?: string;
  confirmed?: boolean;
  shareMode: { mode: "edit" } | { mode: "read"; reason: string };
  history: PartnerEntryChange[];
};

/**
 * The viewer's Partner register, newest first, with a running balance that
 * ends at the Partner account's balance: their own shared lines and
 * settlement legs from their budget, and their partner's entries from the
 * shared ledger.
 */
export function partnerLedgerRows(
  budget: Budget,
  entries: PartnerEntry[] | undefined,
  cutoff: string,
  settlements?: PartnerSettlement[],
  partner = partnerAccountOf(budget),
): PartnerLedgerRow[] {
  const viewerId = budget.userId;
  if (!partner) return [];
  const bySource = entriesBySource(entries);
  const rows: Omit<PartnerLedgerRow, "balance">[] = [];
  for (const transaction of budget.transactions) {
    if (
      transaction.removed ||
      transaction.date > cutoff ||
      (isPending(transaction) && transaction.amount > 0)
    )
      continue;
    if (transaction.linkedCounterpartyAccountId === partner.id) {
      const settlement = settlements?.find(
        (item) => item.id === transaction.partnerSettlementId,
      );
      rows.push({
        id: settlement?.id ?? `${transaction.id}:repayment`,
        kind: settlement ? "settlement" : "repayment",
        date: transaction.date,
        payee: transaction.payee,
        status: transaction.status,
        payerId: settlement?.payerId ?? "",
        shared: settlement?.amount ?? 0,
        you: 0,
        partner: 0,
        change: -transaction.amount,
        categoryId: undefined,
        needsCategory: false,
        transactionId: transaction.id,
        settlementId: settlement?.id,
        method: settlement?.method,
        confirmed: settlement?.confirmed,
        shareMode: {
          mode: "read",
          reason: "Shares apply to purchases and refunds",
        },
        history: [],
      });
      continue;
    }
    const shareMode = classifyRegisterEntry(budget, transaction).capabilities
      .share;
    for (const line of partnerLines(budget, transaction, partner.id)) {
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
        shareMode:
          shareMode.mode === "none"
            ? { mode: "read", reason: "Shares apply to purchases and refunds" }
            : shareMode,
        history: entry?.history ?? [],
      });
    }
  }
  for (const entry of mirroredEntries(entries, viewerId)) {
    if (!entryCounts(entry, cutoff)) continue;
    const categoryId = sideCategory(budget, entry.id);
    const lines = budget.partnerSides?.[entry.id]?.lines;
    const change = mirroredChange(entry, viewerId);
    const shared = Math.abs(entry.amount);
    const needsCategory = sideNeedsCategory(budget, entry, change);
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
      change,
      categoryId,
      ...(lines ? { lines } : {}),
      suggestedCategoryId:
        needsCategory && !lines
          ? rememberedSpendingCategory(budget, entry.payee)
          : undefined,
      needsCategory,
      entryId: entry.id,
      shareMode: { mode: "edit" },
      history: entry.history,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  // A former partner's ledger is closed: its shares can't change.
  const frozen = !!partner.closed;
  let balance = 0;
  return rows
    .map((row) => {
      balance += row.change;
      return {
        ...row,
        balance,
        ...(frozen
          ? {
              shareMode: {
                mode: "read" as const,
                reason: "Shares with a former partner are frozen",
              },
            }
          : {}),
      };
    })
    .reverse();
}

// The spending category the viewer last gave this payee, which prefills
// their side of a partner's purchase.
export function rememberedSpendingCategory(
  budget: Pick<Budget, "payeeMemory" | "categories">,
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
    source: {
      transactionId: transaction.id,
      lineId: line.id,
      hasPurposeCategory: Boolean(line.categoryId),
      onSplitPurchase: Boolean(transaction.lines),
    },
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
  const sourceChanged =
    entry.source?.transactionId !== facts.source?.transactionId ||
    entry.source?.lineId !== facts.source?.lineId ||
    entry.source?.hasPurposeCategory !== facts.source?.hasPurposeCategory ||
    entry.source?.onSplitPurchase !== facts.source?.onSplitPurchase;
  if (!changed.length && !entry.removed) {
    if (sourceChanged) changes.partnerEntry(entry).source = facts.source;
    return;
  }
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
