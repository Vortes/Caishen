import type { State, View } from "~/components/budget/types";
import { createTransactionDraft, READY_TO_ASSIGN } from "./transaction-draft";

export type BankImport = State["imports"][number];

export function importRowId(item: BankImport) {
  return `bank:${JSON.stringify([item.connectionId, item.logicalId])}`;
}

export function canEditImport(item: BankImport) {
  return Boolean(
    item.accountId && !item.removed && !item.transactionId && !item.quarantined,
  );
}

export function createImportDraft(view: View, item: BankImport) {
  return {
    ...createTransactionDraft(
      view,
      item.date.slice(0, 7),
      undefined,
      item.accountId ?? undefined,
    ),
    date: item.date,
    payee: item.payee,
    categoryId: item.categoryId ?? (item.amount > 0 ? READY_TO_ASSIGN : ""),
    outflow: item.amount < 0 ? (-item.amount / 100).toFixed(2) : "",
    inflow: item.amount > 0 ? (item.amount / 100).toFixed(2) : "",
    status: item.pending ? ("pending" as const) : ("posted" as const),
  };
}
