import type { View } from "~/components/budget/types";
import {
  bankImportActionIssue,
  transactionActionIssue,
  transactionShareMode,
} from "~/domain/transaction-actions";
import { bankImportNeedsReview } from "~/lib/bank-import-review";
import { READY_TO_ASSIGN } from "~/domain/transfers";
import {
  importCategory,
  partnerMatchesOf,
  type BankImport,
} from "./import-draft";

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
  const account = view.accounts.find(
    (account) => account.id === item.accountId,
  );
  const shareAccount = account?.kind === "cash" || account?.kind === "credit";
  if (!("kind" in item)) {
    const editable =
      bankImportActionIssue(view.budget, item, "record") === null;
    const categoryId = importCategory(view, item);
    return {
      select: editable,
      edit: editable ? "transaction" : null,
      approve: false,
      reject: false,
      categorize: false,
      refund: false,
      share:
        editable &&
        shareAccount &&
        !item.loanId &&
        !item.error &&
        !item.needsMatchReview &&
        !partnerMatchesOf(item).length &&
        (item.amount < 0 ||
          (item.amount > 0 &&
            Boolean(categoryId) &&
            categoryId !== READY_TO_ASSIGN))
          ? "edit"
          : null,
    };
  }
  const active = !item.removed;
  const needsReview = transactionNeedsReview(view, item);
  return {
    select: active,
    edit: !active
      ? null
      : item.linkedCounterpartyAccountId
        ? "repayment"
        : transactionActionIssue(view.budget, item, "edit") === null
          ? "transaction"
          : null,
    approve:
      needsReview &&
      transactionActionIssue(view.budget, item, "approve") === null,
    reject: transactionActionIssue(view.budget, item, "reject") === null,
    categorize:
      transactionActionIssue(view.budget, item, "categorize") === null,
    refund: transactionActionIssue(view.budget, item, "refund") === null,
    share: transactionShareMode(view.budget, item),
  };
}
