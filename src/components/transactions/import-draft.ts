import type { State, View } from "~/components/budget/types";
import {
  rememberedCategory,
  rememberedCounterpartyShare,
} from "~/domain/payee-memory";
import { createTransactionDraft, READY_TO_ASSIGN } from "./transaction-draft";

export type BankImport = State["imports"][number];

export function importRowId(item: BankImport) {
  return `bank:${JSON.stringify([item.connectionId, item.logicalId])}`;
}

/** The purchases a partner recorded that a waiting import may be. */
export function partnerMatchesOf(item: BankImport) {
  return ("partnerMatches" in item ? item.partnerMatches : undefined) ?? [];
}
export type PartnerImportMatch = ReturnType<typeof partnerMatchesOf>[number];

export function canEditImport(item: BankImport) {
  return Boolean(
    item.accountId && !item.removed && !item.transactionId && !item.quarantined,
  );
}

/**
 * The category a waiting bank import takes: the one it already has, else
 * what its payee's memory prefills (READY_TO_ASSIGN for Ready to Assign).
 */
export function importCategory(view: View, item: BankImport) {
  return (
    item.categoryId ??
    (item.accountId
      ? rememberedCategory(view.budget, {
          payee: item.payee,
          accountId: item.accountId,
          amount: item.amount,
        })
      : undefined)
  );
}

export function createImportDraft(view: View, item: BankImport) {
  const share = importShare(view, item);
  return {
    ...createTransactionDraft(
      view,
      item.date.slice(0, 7),
      undefined,
      item.accountId ?? undefined,
    ),
    date: item.date,
    payee: item.payee,
    categoryId:
      importCategory(view, item) ?? (item.amount > 0 ? READY_TO_ASSIGN : ""),
    counterpartyShare: share
      ? { ...share, amount: (share.amount / 100).toFixed(2) }
      : undefined,
    outflow: item.amount < 0 ? (-item.amount / 100).toFixed(2) : "",
    inflow: item.amount > 0 ? (item.amount / 100).toFixed(2) : "",
    status: item.pending ? ("pending" as const) : ("posted" as const),
  };
}

export function importShare(view: View, item: BankImport) {
  return item.accountId
    ? rememberedCounterpartyShare(view.budget, {
        payee: item.payee,
        accountId: item.accountId,
        amount: item.amount,
      })
    : undefined;
}
