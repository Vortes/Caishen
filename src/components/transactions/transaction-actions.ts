import type { View } from "~/components/budget/types";
import { partnerAccountOf } from "~/domain/partner-ledger";
import { classifyRegisterEntry } from "~/domain/register-entry";
import { bankImportNeedsReview } from "~/lib/bank-import-review";
import { importCategory, type BankImport } from "./import-draft";

type Transaction = View["budget"]["transactions"][number];

export type TransactionActions = {
  select: boolean;
  edit: "transaction" | "repayment" | null;
  approve: boolean;
  enter: boolean;
  reject: boolean;
  remove: boolean;
  categorize: boolean;
  share: "edit" | null;
};

export function transactionNeedsReview(
  view: View,
  item: Transaction | BankImport,
) {
  if (!("kind" in item)) return bankImportNeedsReview(item);
  return (
    !item.reviewed ||
    classifyRegisterEntry(view.budget, item).fields.needsCategory ||
    // A settlement with a former partner stays as it was when they parted.
    Boolean(
      item.partnerSettlementId &&
      item.linkedCounterpartyAccountId === partnerAccountOf(view.budget)?.id &&
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
  const approve = selected
    .filter((row) => row.actions.approve)
    .map((row) => row.id);
  return {
    edit: single?.actions.edit
      ? { id: single.id, kind: single.actions.edit }
      : null,
    approve,
    enter: approve.length
      ? []
      : selected.filter((row) => row.actions.enter).map((row) => row.id),
    reject: selected.filter((row) => row.actions.reject).map((row) => row.id),
    remove: selected.filter((row) => row.actions.remove).map((row) => row.id),
    categorize: selected
      .filter((row) => row.actions.categorize)
      .map((row) => row.id),
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
      approve: capabilities.approve.ok,
      enter: capabilities.enter.ok,
      reject: capabilities.reject.ok,
      remove: capabilities.remove.ok,
      categorize: capabilities.categorize.ok,
      share:
        capabilities.link.ok && capabilities.share.mode !== "none"
          ? capabilities.share.mode
          : null,
    };
  }
  const edit = entry.fields.repayment
    ? "repayment"
    : capabilities.edit.ok
      ? "transaction"
      : null;
  return {
    select: !entry.transaction.removed,
    edit: entry.transaction.removed ? null : edit,
    approve: transactionNeedsReview(view, item) && capabilities.approve.ok,
    enter: capabilities.enter.ok,
    reject: capabilities.reject.ok,
    remove: capabilities.remove.ok,
    categorize: capabilities.categorize.ok,
    share: capabilities.share.mode === "none" ? null : capabilities.share.mode,
  };
}
