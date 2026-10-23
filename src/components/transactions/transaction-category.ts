import type { View } from "~/components/budget/types";

type Transaction = View["budget"]["transactions"][number];

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
