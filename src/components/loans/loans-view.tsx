"use client";

import { Button } from "~/components/ui/button";

import { useState } from "react";
import { forecastLoan } from "~/domain/engine";
import { Amount, EmptyState, FormField, Icon } from "~/components/shared";
import { type Panel, type View } from "~/components/budget/types";
import { monthName } from "~/components/budget/format";

export function LoansView({
  view,
  open,
}: {
  view: View;
  open: (panel: Panel) => void;
}) {
  const [extra, setExtra] = useState<Record<string, string>>({});
  if (!view.loans.length)
    return (
      <section className="panel">
        <EmptyState
          icon="loans"
          title="A clear view of the way forward."
          action={
            <Button onClick={() => open({ type: "loan" })}>
              Add your first loan
            </Button>
          }
        >
          Add a fixed-rate personal loan or variable-rate student loan. Pair it
          with a payment category to see what you’ve funded and what comes next.
        </EmptyState>
        <div className="panel-footer">
          Forecasts are estimates. Your lender’s confirmed records determine
          actual principal, interest, and balances.
        </div>
      </section>
    );
  return (
    <div className="two-column">
      {view.loans.map((loan) => {
        const extraCents = Math.round(Number(extra[loan.id] ?? 0) * 100);
        const forecast =
          Number.isSafeInteger(extraCents) && extraCents > 0
            ? forecastLoan(
                { ...loan, minimumPayment: loan.forecast.payment },
                view.month,
                extraCents,
              )
            : loan.forecast;
        return (
          <section className="panel loan-card" key={loan.id}>
            <div className="loan-heading">
              <div>
                <h2>{loan.name}</h2>
                <p>
                  {loan.variable
                    ? "Variable-rate student loan"
                    : "Fixed-rate personal loan"}{" "}
                  · {(loan.forecast.rateBps / 100).toFixed(2)}% APR
                </p>
              </div>
              <span className="account-symbol">
                <Icon name="loans" size={20} />
              </span>
            </div>
            <Amount className="loan-balance" value={loan.balance} />
            <dl className="loan-details">
              <div>
                <dt>Required payment</dt>
                <dd>
                  <Amount value={loan.minimumPayment} />
                </dd>
              </div>
              <div>
                <dt>Funded in payment category</dt>
                <dd>
                  <Amount value={loan.funded} />
                </dd>
              </div>
              <div>
                <dt>Estimated payoff</dt>
                <dd>
                  {forecast.payoffMonth
                    ? monthName(forecast.payoffMonth)
                    : "Payment too low"}
                </dd>
              </div>
              <div>
                <dt>Estimated remaining interest</dt>
                <dd>
                  {forecast.interest === null ? (
                    "Unable to estimate"
                  ) : (
                    <Amount value={forecast.interest} />
                  )}
                </dd>
              </div>
            </dl>
            <div style={{ marginTop: 19 }}>
              <FormField
                label="Preview a one-time extra payment"
                name={`extra-${loan.id}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={extra[loan.id] ?? ""}
                placeholder="0.00"
                onChange={(event) =>
                  setExtra((previous) => ({
                    ...previous,
                    [loan.id]: event.target.value,
                  }))
                }
                hint="This preview changes no funding and initiates no payment."
              />
              <p className="field-hint" style={{ marginTop: 9 }}>
                {forecast.assumption}
              </p>
            </div>
            <div className="loan-actions">
              <Button
                onClick={() => open({ type: "loan-payment", id: loan.id })}
              >
                Record lender payment
              </Button>
              {loan.variable && (
                <Button
                  variant="ghost"
                  onClick={() => open({ type: "rate", id: loan.id })}
                >
                  Update rate
                </Button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
