"use client";

import type { RefCallback } from "react";
import type { State } from "~/components/budget/types";
import { Amount, Icon } from "~/components/shared";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  year: "2-digit",
});

export function BankImportRow({
  id,
  item,
  index,
  rowOffset,
  accountName,
  showAccount,
  rowRef,
  onReview,
}: {
  id: string;
  item: State["imports"][number];
  index: number;
  rowOffset: number;
  accountName?: string;
  showAccount: boolean;
  rowRef?: RefCallback<HTMLTableRowElement>;
  onReview: () => void;
}) {
  const reason = !item.accountId
    ? "Connect account"
    : item.removed
      ? "Removed by bank"
      : item.needsMatchReview
        ? "Check match"
        : "Needs review";
  return (
    <tr
      ref={rowRef}
      data-index={index}
      data-transaction-id={id}
      data-bank-import=""
      aria-rowindex={index + 2 + rowOffset}
    >
      <td className="register-select-cell">
        <span className="sr-only">
          Review this bank transaction individually
        </span>
      </td>
      {showAccount && (
        <td className="register-account-cell">
          {accountName ?? "Connect account"}
        </td>
      )}
      <td className="register-date-cell">
        <time dateTime={item.date}>
          {dateFormatter.format(new Date(`${item.date}T12:00:00`))}
        </time>
      </td>
      <td className="register-payee-cell">
        <button
          type="button"
          className="register-cell-button"
          onClick={onReview}
        >
          {item.payee}
        </button>
      </td>
      <td className="register-category-cell">
        <button
          type="button"
          className="register-cell-button register-import-review"
          onClick={onReview}
        >
          <Icon name="info" size={14} />
          {reason}
        </button>
      </td>
      <td className="number register-outflow-cell">
        {item.amount < 0 && <Amount value={-item.amount} />}
      </td>
      <td className="number register-inflow-cell">
        {item.amount > 0 && <Amount value={item.amount} />}
      </td>
      <td className="register-status-cell">
        <div className="register-status-indicators">
          <span className="register-needs-review" title="Needs review">
            <Icon name="info" size={14} />
            <span className="sr-only">Needs review</span>
          </span>
          <span
            className={item.pending ? "register-pending" : "register-posted"}
            title={item.pending ? "Pending" : "Posted"}
          >
            <Icon name={item.pending ? "clock" : "posted"} size={14} />
            <span className="sr-only">
              {item.pending ? "Pending" : "Posted"}
            </span>
          </span>
        </div>
      </td>
    </tr>
  );
}
