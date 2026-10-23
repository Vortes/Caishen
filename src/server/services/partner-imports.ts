import { randomUUID } from "node:crypto";
import type { Budget, Command } from "~/domain/engine";
import {
  partnerMatches,
  payerCategory,
  planPartnerMatches,
  type ImportFacts,
} from "~/domain/partner-import-match";
import { recordedBy } from "~/domain/partner-ledger";
import type { AccountingState } from "~/domain/shared-ledger";
import type { StoredImport } from "~/server/integrations/transactions";
import { bankImportEligibility, type BankMapping } from "./bank-account-setup";

// Bank imports of purchases a partner recorded before they arrived
// (src/domain/partner-import-match.ts): a certain match is made as the
// import arrives; any other possible match waits in the inbox for the payer
// to confirm, rather than importing a second copy of the purchase.

type PartnerMatchCommand = Extract<Command, { type: "partner.match" }>;

function importFacts(accountId: string, record: StoredImport): ImportFacts {
  return {
    accountId,
    date: record.current.date,
    amount: -record.current.amountCents,
    payee: (record.current.merchantName ?? record.current.name).slice(0, 240),
  };
}

/**
 * What each new import of a bank update does about recorded purchases, by
 * import id: the match to make, or "wait" for the payer to confirm one.
 * Imports that can't be a recorded purchase are left out. Imports already
 * waiting in the inbox count as rivals for the same purchase.
 */
export function planPartnerImports(
  state: AccountingState,
  budget: Budget,
  records: StoredImport[],
  mappings: Record<string, BankMapping>,
  resolved: Record<string, unknown>,
  operationId: (record: StoredImport) => string,
): Map<string, PartnerMatchCommand | "wait"> {
  const waiting = records.flatMap((record) => {
    const mapping = mappings[record.current.providerAccountId];
    return mapping &&
      !resolved[record.id] &&
      !record.removed &&
      record.matchStatus === "confirmed" &&
      bankImportEligibility(mapping, record) === "eligible"
      ? [{ record, facts: importFacts(mapping.accountId, record) }]
      : [];
  });
  const plan = planPartnerMatches(
    state,
    budget,
    waiting.map(({ record, facts }) => ({ id: record.id, facts })),
  );
  const decided = new Map<string, PartnerMatchCommand | "wait">();
  for (const { record, facts } of waiting) {
    const entry = plan.get(record.id);
    if (!entry) continue;
    const categoryId =
      entry === "confirm" ? undefined : payerCategory(budget, entry, facts);
    decided.set(
      record.id,
      entry === "confirm" || !categoryId
        ? "wait"
        : {
            type: "partner.match",
            id: operationId(record),
            entryId: entry.id,
            transactionId: randomUUID(),
            accountId: facts.accountId,
            date: facts.date,
            amount: facts.amount,
            status: record.current.pending ? "pending" : "posted",
            providerId: record.current.providerTransactionId,
            categoryId,
          },
    );
  }
  return decided;
}

export type InboxPartnerMatch = {
  entryId: string;
  date: string;
  payee: string;
  // The total paid, and the partner's part of it.
  amount: number;
  share: number;
  recordedBy?: string;
  payeesAlike: boolean;
  // The category the payer's part takes unless they choose another.
  categoryId?: string;
};

/** The recorded purchases a waiting import may be, closest first. */
export function inboxPartnerMatches(
  state: Pick<AccountingState, "partnerEntries">,
  budget: Budget,
  accountId: string | null,
  record: StoredImport,
): InboxPartnerMatch[] {
  if (!accountId || record.removed) return [];
  const facts = importFacts(accountId, record);
  return partnerMatches(state, budget, facts).map(({ entry, payeesAlike }) => ({
    entryId: entry.id,
    date: entry.date,
    payee: entry.payee,
    amount: Math.abs(entry.amount),
    share: entry.share,
    recordedBy: recordedBy(entry),
    payeesAlike,
    categoryId: payerCategory(budget, entry, facts),
  }));
}

/**
 * Checks that a match the payer confirmed from the inbox is of this import:
 * its account, signed amount, and date. The engine checks the entry.
 */
export function confirmedPartnerMatch(
  command: PartnerMatchCommand,
  mapping: BankMapping,
  record: StoredImport,
): PartnerMatchCommand {
  const facts = importFacts(mapping.accountId, record);
  if (
    record.removed ||
    command.accountId !== facts.accountId ||
    command.amount !== facts.amount ||
    command.date !== facts.date
  )
    throw new Error(
      "A match must keep the bank's account, amount, and date. Reopen the import and try again.",
    );
  return {
    ...command,
    status: record.current.pending ? "pending" : "posted",
    providerId: record.current.providerTransactionId,
  };
}
