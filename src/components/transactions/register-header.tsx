"use client";

import { monthName } from "~/components/budget/format";
import { Amount } from "~/components/shared";

export type RegisterHeaderProps = {
  title: string;
  month: string;
  postedBalance: number;
  pendingOutflows: number;
  workingBalance: number;
  credit?: { reserve: number; shortfall: number };
};

export function RegisterHeader({
  title,
  month,
  postedBalance,
  pendingOutflows,
  workingBalance,
  credit,
}: RegisterHeaderProps) {
  return (
    <header className="register-header">
      <div className="register-title-strip">
        <h1>{title}</h1>
      </div>
      <div
        className="register-summary"
        role="group"
        aria-label="Account balances"
      >
        <div className="register-balance-equation">
          <BalanceItem label="Posted balance" value={postedBalance} />
          <span className="register-balance-operator" aria-hidden="true">
            +
          </span>
          <BalanceItem label="Pending outflows" value={pendingOutflows} />
          <span className="register-balance-operator" aria-hidden="true">
            =
          </span>
          <BalanceItem label="Working balance" value={workingBalance} />
        </div>
        {credit && (
          <div className="register-card-summary">
            <BalanceItem label="Reserved for payment" value={credit.reserve} />
            {credit.shortfall > 0 && (
              <BalanceItem
                label="Needs funding"
                value={credit.shortfall}
                negative
              />
            )}
          </div>
        )}
        <p className="register-as-of">As of {monthName(month)}</p>
      </div>
    </header>
  );
}

function BalanceItem({
  label,
  value,
  negative = false,
}: {
  label: string;
  value: number;
  negative?: boolean;
}) {
  return (
    <div className="register-balance-item">
      <Amount
        value={value}
        className={
          negative || value < 0
            ? "negative"
            : value > 0
              ? "positive"
              : undefined
        }
      />
      <span>{label}</span>
    </div>
  );
}
