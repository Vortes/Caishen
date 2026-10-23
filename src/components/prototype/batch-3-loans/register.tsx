"use client";

import { CircleCheckIcon } from "lucide-react";
import shell from "../app-shell/shell.module.css";
import { paymentRows, shortDayLabel, money } from "./data";
import { useStore } from "./store";
import styles from "./loans.module.css";

// Read-only account context for reviewing loan balances and payment history.
export function Register({ accountId }: { accountId: string | null }) {
  const store = useStore();
  const { state, month } = store;
  const accountColumn = !accountId;
  const rows = [...state.rows, ...paymentRows(state)]
    .filter(
      (item) =>
        (!accountId || item.accountId === accountId) &&
        item.date.startsWith(month),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const accountName = (id: string) =>
    state.accounts.find((item) => item.id === id)?.name;
  return (
    <div
      className={`${shell.list} ${shell.register}`}
      data-accounts={accountColumn || undefined}
      role="group"
      aria-label="Transactions"
    >
      <div className={`${shell.txColumns} ${shell.columnHeader}`}>
        {accountColumn && (
          <span data-column="account" data-optional aria-hidden>
            Account
          </span>
        )}
        <span data-column="date" data-optional aria-hidden>
          Date
        </span>
        <span data-column="payee" aria-hidden>
          Payee
        </span>
        <span data-column="category" aria-hidden>
          Category
        </span>
        <span className={shell.numeric} data-column="outflow" aria-hidden>
          Outflow
        </span>
        <span className={shell.numeric} data-column="inflow" aria-hidden>
          Inflow
        </span>
        <span data-column="status" />
      </div>
      {rows.map((item) => (
        <div key={item.id} className={shell.rowWrap}>
          <div
            data-row
            className={`${shell.txColumns} ${shell.row} ${styles.staticRow}`}
          >
            {accountColumn && (
              <span
                className={shell.rowName}
                data-column="account"
                data-optional
              >
                <span className={`${shell.truncate} ${shell.faint}`}>
                  {accountName(item.accountId)}
                </span>
              </span>
            )}
            <span className={shell.rowName} data-column="date" data-optional>
              <span className={`${shell.truncate} ${shell.muted}`}>
                {shortDayLabel(item.date)}
              </span>
            </span>
            <span className={shell.rowName} data-column="payee">
              <span className={shell.truncate}>{item.payee}</span>
            </span>
            <span className={shell.truncate} data-column="category">
              <span className={shell.muted}>{item.category}</span>
            </span>
            <span className={shell.numeric} data-column="outflow">
              {item.amount < 0 && money(-item.amount)}
            </span>
            <span
              className={shell.numeric}
              data-column="inflow"
              data-inflow={item.amount > 0 || undefined}
            >
              {item.amount > 0 && money(item.amount)}
            </span>
            <span className={shell.statusCell} data-column="status">
              <CircleCheckIcon
                size={14}
                className={shell.statusIcon}
                data-status="posted"
                aria-label="Cleared"
              />
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
