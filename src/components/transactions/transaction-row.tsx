"use client";

import type { RefCallback } from "react";

import { monthName } from "~/components/budget/format";
import type { Panel, View } from "~/components/budget/types";
import { Amount, Icon } from "~/components/shared";
import { Checkbox } from "~/components/ui-legacy/checkbox";
import { cn } from "~/lib/utils";

type Transaction = View["budget"]["transactions"][number];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  year: "2-digit",
});

export function TransactionRow({
  transaction,
  index,
  rowOffset,
  accountName,
  categoryName,
  showAccount,
  selected,
  busy,
  rowRef,
  onSelect,
  open,
  onEdit,
}: {
  transaction: Transaction;
  index: number;
  rowOffset: number;
  accountName?: string;
  categoryName?: string;
  showAccount: boolean;
  selected: boolean;
  busy: boolean;
  rowRef?: RefCallback<HTMLTableRowElement>;
  onSelect: (id: string, checked: boolean) => void;
  open: (panel: Panel) => void;
  onEdit: (id: string) => void;
}) {
  const canEdit = ["purchase", "income", "refund"].includes(transaction.kind);
  const needsCategory =
    transaction.kind === "purchase" && !transaction.categoryId;
  const category = needsCategory
    ? "This needs a category"
    : (categoryName ??
      transactionCategory(transaction.kind, transaction.amount));
  return (
    <tr
      ref={rowRef}
      data-index={index}
      data-transaction-id={transaction.id}
      aria-rowindex={index + 2 + rowOffset}
      aria-selected={selected}
      data-selected={selected ? "" : undefined}
    >
      <td className="register-select-cell">
        <Checkbox
          aria-label={`Select ${transaction.payee}`}
          checked={selected}
          onCheckedChange={(checked) =>
            onSelect(transaction.id, checked === true)
          }
        />
      </td>
      {showAccount && <td className="register-account-cell">{accountName}</td>}
      <td className="register-date-cell">
        <time dateTime={transaction.date}>
          {dateFormatter.format(new Date(`${transaction.date}T12:00:00`))}
        </time>
      </td>
      <td className="register-payee-cell">
        <button
          type="button"
          className="register-cell-button"
          onClick={() => open({ type: "history", id: transaction.id })}
          title={`View history for ${transaction.payee}`}
        >
          {transaction.payee}
        </button>
        {transaction.expenseMonth !== transaction.date.slice(0, 7) && (
          <small className="muted">
            For {monthName(transaction.expenseMonth)}
          </small>
        )}
      </td>
      <td className="register-category-cell">
        {canEdit ? (
          <button
            type="button"
            className={cn(
              "register-cell-button",
              needsCategory && "register-category-warning",
            )}
            disabled={busy}
            onClick={() => onEdit(transaction.id)}
            title={`Edit category for ${transaction.payee}`}
          >
            {category}
          </button>
        ) : (
          <span>{category}</span>
        )}
      </td>
      <td className="number register-outflow-cell">
        {transaction.amount < 0 && <Amount value={-transaction.amount} />}
      </td>
      <td className="number register-inflow-cell">
        {transaction.amount > 0 && <Amount value={transaction.amount} />}
      </td>
      <td className="register-status-cell">
        <div className="register-status-indicators">
          <span
            title={transaction.reviewed ? "Approved" : "Needs review"}
            className={
              transaction.reviewed
                ? "register-approved"
                : "register-needs-review"
            }
          >
            <Icon name={transaction.reviewed ? "check" : "info"} size={14} />
            <span className="sr-only">
              {transaction.reviewed ? "Approved" : "Needs review"}
            </span>
          </span>
          <span
            className={
              transaction.status === "pending"
                ? "register-pending"
                : "register-posted"
            }
            title={transaction.status === "pending" ? "Pending" : "Posted"}
          >
            <Icon
              name={transaction.status === "pending" ? "clock" : "posted"}
              size={14}
            />
            <span className="sr-only">
              {transaction.status === "pending" ? "Pending" : "Posted"}
            </span>
          </span>
        </div>
      </td>
    </tr>
  );
}

export function transactionCategory(kind: Transaction["kind"], amount: number) {
  switch (kind) {
    case "card-payment":
      return "Credit card payment";
    case "loan-payment":
      return "Loan payment";
    case "statement-credit":
      return "Statement credit";
    case "reimbursement":
      return "Reimbursement";
    case "settlement":
      return "Partner repayment";
    default:
      return amount > 0 ? "Inflow: Ready to Assign" : "Choose category";
  }
}
