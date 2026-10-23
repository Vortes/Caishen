import type { View } from "~/components/budget/types";
import type { CounterpartyShare } from "~/domain/engine";
import { isFullShare } from "~/domain/counterparty";
import {
  buildTransactionDraftCommand,
  createTransactionDraft,
} from "./transaction-draft";
import {
  createImportDraft,
  importRowId,
  type BankImport,
} from "./import-draft";

import { transactionActions } from "./transaction-actions";

export type ShareBasis = "half" | "full" | "fixed";
export type ShareChoice = {
  share: CounterpartyShare | null;
  basis: ShareBasis;
};
export const halfOf = (amount: number) => Math.floor(Math.abs(amount) / 2);

// A partner share set to nothing stays on the partner account at $0.00, so
// the write-off and its history stay visible. Any other empty share is just
// no share.
export function keepShare(
  saved: CounterpartyShare | null | undefined,
  next: CounterpartyShare | null,
  partnerId: string | undefined,
): CounterpartyShare | null {
  if (next && next.amount > 0) return next;
  if (
    saved &&
    saved.accountId === partnerId &&
    (!next || next.accountId === partnerId)
  )
    return { accountId: saved.accountId, amount: 0 };
  return null;
}

export function shareForAmount({ share, basis }: ShareChoice, amount: number) {
  return (
    share && {
      ...share,
      amount:
        basis === "half"
          ? halfOf(amount)
          : basis === "full"
            ? Math.abs(amount)
            : share.amount,
    }
  );
}

// Build the entire selection before any writes. Imported rows keep their
// source record so saving uses the bank's fingerprint and revision checks.
export function prepareTransactionShares(
  view: View,
  imports: BankImport[],
  ids: string[],
  choice: ShareChoice,
  categoryId: string,
) {
  return ids.map((rowId) => {
    const transaction = view.budget.transactions.find(
      (item) => item.id === rowId && !item.removed,
    );
    const imported = imports.find((item) => importRowId(item) === rowId);
    const item = transaction ?? imported;
    if (!item || transactionActions(view, item).share !== "edit")
      throw new Error(
        "This selection changed. Close Share and select the transactions again.",
      );
    if (transaction?.lines?.length)
      throw new Error("Edit split transactions individually.");
    const draft = imported
      ? createImportDraft(view, imported)
      : createTransactionDraft(view, view.month, transaction);
    const share = keepShare(
      transaction?.counterpartyShare,
      shareForAmount(choice, item.amount),
      view.accounts.find((account) => account.kind === "partner")?.id,
    );
    draft.counterpartyShare = share && {
      ...share,
      amount: (share.amount / 100).toFixed(2),
    };
    if (
      !draft.categoryId &&
      !isFullShare({ amount: item.amount, counterpartyShare: share })
    )
      draft.categoryId = categoryId;
    const command = buildTransactionDraftCommand({
      draft,
      view,
      transaction,
      operationId: crypto.randomUUID(),
      entityId: crypto.randomUUID(),
    });
    return { rowId, imported, command, summary: `Saved ${item.payee}` };
  });
}

export type PreparedTransactionShare = ReturnType<
  typeof prepareTransactionShares
>[number];
