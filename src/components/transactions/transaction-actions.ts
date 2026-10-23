import type { View } from "~/components/budget/types";
import { classifyRegisterEntry } from "~/domain/register-entry";
import { bankImportNeedsReview } from "~/lib/bank-import-review";
import { importCategory, type BankImport } from "./import-draft";

type Transaction = View["budget"]["transactions"][number];

export type TransactionActions = {
  select: boolean;
  edit: "transaction" | "repayment" | null;
  approve: boolean;
  reject: boolean;
  categorize: boolean;
  refund: boolean;
  share: "edit" | "read" | null;
};

export function transactionNeedsReview(
  view: View,
  item: Transaction | BankImport,
) {
  if (!("kind" in item)) return bankImportNeedsReview(item);
  return (
    !item.reviewed ||
    Boolean(
      item.partnerSettlementId &&
      !view.partnerSettlements.some(
        (settlement) =>
          settlement.id === item.partnerSettlementId && settlement.confirmed,
      ),
    )
  );
}

export function transactionSelectionActions(
  rows: { id: string; actions: TransactionActions }[],
) {
  const selected = rows.filter((row) => row.actions.select);
  const single = selected.length === 1 ? selected[0] : undefined;
  return {
    edit: single?.actions.edit
      ? { id: single.id, kind: single.actions.edit }
      : null,
    approve: selected.filter((row) => row.actions.approve).map((row) => row.id),
    reject: selected.filter((row) => row.actions.reject).map((row) => row.id),
    categorize:
      selected.length > 0 && selected.every((row) => row.actions.categorize),
    refund: single?.actions.refund ? single.id : null,
  };
}

export function transactionActions(
  view: View,
  item: Transaction | BankImport,
): TransactionActions {
  const entry = classifyRegisterEntry(
    view.budget,
    "kind" in item ? item : { ...item, categoryId: importCategory(view, item) },
  );
  const capabilities = entry.capabilities;
  if (entry.origin === "import") {
    return {
      select: capabilities.record.ok,
      edit: capabilities.record.ok ? "transaction" : null,
      approve: false,
      reject: false,
      categorize: false,
      refund: false,
      share:
        capabilities.share.mode === "none" ? null : capabilities.share.mode,
    };
  }
  return {
    select: !entry.transaction.removed,
    edit: entry.transaction.removed
      ? null
      : entry.transaction.linkedCounterpartyAccountId
        ? "repayment"
        : capabilities.edit.ok
          ? "transaction"
          : null,
    approve: transactionNeedsReview(view, item) && capabilities.approve.ok,
    reject: capabilities.reject.ok,
    categorize: capabilities.categorize.ok,
    refund: capabilities.refund.ok,
    share: capabilities.share.mode === "none" ? null : capabilities.share.mode,
  };
}
