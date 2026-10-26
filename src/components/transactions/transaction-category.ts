import type { View } from "~/components/budget/types";
import { newId } from "~/components/budget/format";
import { transactionActions } from "./transaction-actions";
import {
  createImportDraft,
  importRowId,
  type BankImport,
} from "./import-draft";
import {
  buildTransactionDraftCommand,
  type PreparedTransactionChange,
} from "./transaction-draft";

type Transaction = View["budget"]["transactions"][number];

export function prepareTransactionCategories(
  view: View,
  imports: BankImport[],
  ids: string[],
  categoryId: string,
): PreparedTransactionChange[] {
  const changes: PreparedTransactionChange[] = [];
  const transactionIds: string[] = [];
  for (const rowId of ids) {
    const transaction = view.budget.transactions.find(
      (item) => item.id === rowId,
    );
    const imported = imports.find((item) => importRowId(item) === rowId);
    const item = transaction ?? imported;
    if (!item || !transactionActions(view, item).categorize)
      throw new Error("This selection changed. Select the transactions again.");
    if (transaction) {
      transactionIds.push(transaction.id);
      continue;
    }
    if (imported) {
      const draft = { ...createImportDraft(view, imported), categoryId };
      changes.push({
        rowIds: [rowId],
        imported,
        command: buildTransactionDraftCommand({
          draft,
          view,
          operationId: newId(),
          entityId: newId(),
        }),
        summary: `Categorized ${imported.payee}`,
      });
    }
  }
  if (transactionIds.length)
    changes.unshift({
      rowIds: transactionIds,
      command: {
        type: "transaction.categorize.batch",
        id: newId(),
        transactionIds,
        categoryId,
      },
      summary: `Categorized ${transactionIds.length} ${transactionIds.length === 1 ? "transaction" : "transactions"}`,
    });
  return changes;
}

export function transactionCategory(kind: Transaction["kind"], amount: number) {
  switch (kind) {
    case "transfer":
    case "card-payment":
      return "Category not needed";
    case "loan-payment":
      return "Loan payment";
    case "statement-credit":
      return "Statement credit";
    case "reimbursement":
      return "Reimbursement";
    // YNAB's reconciliation adjustments go straight to Ready to Assign.
    case "adjustment":
      return "Inflow: Ready to Assign";
    default:
      return amount > 0 ? "Inflow: Ready to Assign" : "Choose category";
  }
}
