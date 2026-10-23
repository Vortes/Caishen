import type { View } from "~/components/budget/types";
import { isTransfer, READY_TO_ASSIGN } from "~/domain/transfers";
import {
  canEditImport,
  importCategory,
  partnerMatchesOf,
  type BankImport,
} from "./import-draft";

type Transaction = View["budget"]["transactions"][number];

export function canShare(view: View, item: Transaction | BankImport) {
  const account = view.accounts.find(
    (account) => account.id === item.accountId,
  );
  if (item.removed || (account?.kind !== "cash" && account?.kind !== "credit"))
    return false;

  if ("kind" in item)
    return (
      (item.kind === "purchase" || item.kind === "refund") && !isTransfer(item)
    );

  if (
    !canEditImport(item) ||
    item.loanId ||
    item.error ||
    item.needsMatchReview ||
    partnerMatchesOf(item).length
  )
    return false;

  const categoryId = importCategory(view, item);
  return (
    item.amount < 0 ||
    (item.amount > 0 && Boolean(categoryId) && categoryId !== READY_TO_ASSIGN)
  );
}
