import { formatMoney } from "~/components/budget/format";
import type { View } from "~/components/budget/types";

type Category = View["categories"][number];

export type CategoryStatus =
  "overspent" | "credit" | "snoozed" | "underfunded" | "funded" | "empty";

// Cash overspending (red) is money that already left a bank account. Overspending
// beyond that went on a credit card (yellow) and becomes card debt.
export function categoryStatus(category: Category): CategoryStatus {
  if (category.available < 0)
    return category.cashOverspending > 0 ? "overspent" : "credit";
  if (category.targetProgress?.snoozed) return "snoozed";
  if ((category.targetProgress?.needed ?? 0) > 0) return "underfunded";
  // A met target is funded even when it's all spent, like YNAB's green $0.00.
  if (category.available > 0 || category.target) return "funded";
  return "empty";
}

// YNAB's row status: what happened this month, shown beside the name.
export function statusLine(category: Category, status: CategoryStatus) {
  const funds = Math.max(0, category.opening + category.assigned);
  const spent = -Math.min(0, category.activity);
  if (status === "overspent")
    return `Overspent. ${formatMoney(spent)} of ${formatMoney(funds)}`;
  if (status === "credit")
    return `Overspent on credit. ${formatMoney(spent)} of ${formatMoney(funds)}`;
  if (status === "snoozed") return "Snoozed";
  if (status === "underfunded")
    return `${formatMoney(category.targetProgress?.needed ?? 0)} more needed this month`;
  if (spent > 0 && category.available === 0) return "Fully spent";
  if (spent > 0) return `Spent ${formatMoney(spent)} of ${formatMoney(funds)}`;
  return category.target ? "Funded" : "";
}
