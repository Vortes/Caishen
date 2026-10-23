"use client";

import { CalendarDaysIcon, ChartNoAxesCombinedIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Tag } from "~/components/ui/tag";
import { Figure, Property, Title } from "../app-shell/cards";
import shell from "../app-shell/shell.module.css";
import entry from "../app-shell/transaction-entry.module.css";
import {
  balanceOn,
  dayLabel,
  endOf,
  forecast,
  longMonthLabel,
  monthLabel,
  monthsBetween,
  money,
  paidOffOn,
  percent,
  rateDue,
  rateOn,
  TODAY,
  type Loan,
} from "./data";
import { AddLoanPanel, RateEditor } from "./editors";
import { ExtraPayment } from "./preview";
import { useStore, type Tab } from "./store";
import styles from "./loans.module.css";

export function LoansInspector() {
  const store = useStore();
  const { state, month, selected, editor, variants } = store;
  if (editor?.kind === "add" && variants.add === "panel")
    return (
      <Card>
        <Title
          icon={<LoanIcon />}
          title="New loan"
          subtitle="Copy the terms from your lender’s latest statement."
        />
        <AddLoanPanel />
      </Card>
    );
  const loan = state.loans.find((item) => item.id === selected);
  if (!loan) {
    const open = state.loans.filter(
      (item) => balanceOn(item, endOf(month)) > 0,
    );
    return (
      <>
        <Card>
          <Title
            icon={<LoanIcon />}
            title="Loans"
            subtitle={
              state.loans.length
                ? "Nothing selected. Pick a loan to see its payoff."
                : "No loans yet."
            }
          />
          <Figure
            value={money(
              -open.reduce(
                (sum, item) => sum + balanceOn(item, endOf(month)),
                0,
              ),
            )}
            caption="Total remaining"
          />
        </Card>
        <Card>
          <Property label="Monthly">
            {money(open.reduce((sum, item) => sum + item.minimumPayment, 0))}
          </Property>
          <Property label="Funded">
            {money(open.reduce((sum, item) => sum + item.funded, 0))}
          </Property>
        </Card>
      </>
    );
  }
  return <LoanDetails key={loan.id} loan={loan} />;
}

function LoanDetails({ loan }: { loan: Loan }) {
  const store = useStore();
  const { month, editor } = store;
  const balance = balanceOn(loan, endOf(month));
  const paidOff = paidOffOn(loan, endOf(month));
  const rate = rateOn(loan, endOf(month));
  const due = rateDue(loan);
  const result = forecast(loan, month);
  const interestPaid = loan.payments
    .filter((payment) => payment.date <= endOf(month))
    .reduce((sum, payment) => sum + payment.interest, 0);
  const recorded = loan.payments.filter(
    (payment) => payment.date <= endOf(month),
  ).length;

  const updateRate = () => {
    store.setTab("rates");
    store.open({ kind: "rate", loanId: loan.id });
  };

  if (paidOff)
    return (
      <>
        <Card>
          <Title icon={<LoanIcon />} title={loan.name} subtitle="Paid off" />
          <Figure
            value={money(0)}
            caption={`Paid off in ${longMonthLabel(paidOff.slice(0, 7))}`}
          />
        </Card>
        <Card>
          <Property label="Rate">
            {percent(rate.annualRateBps)}
            <span className={shell.faint}>
              {loan.variable ? "Variable" : "Fixed"}
            </span>
          </Property>
          <Property label="Borrowed">{money(loan.principal)}</Property>
          <Property label="Interest">
            {money(interestPaid)} paid in total
          </Property>
          <Property label="Took">
            {recorded} payments over{" "}
            {monthsBetween(
              loan.rates[0]!.effectiveDate.slice(0, 7),
              paidOff.slice(0, 7),
            )}{" "}
            months
          </Property>
        </Card>
        <Card>
          <Tabs value="payments">
            <TabsList aria-label="Loan details">
              <TabsTrigger value="payments">Payments {recorded}</TabsTrigger>
            </TabsList>
            <TabsContent value="payments">
              <Payments loan={loan} summary={false} />
            </TabsContent>
          </Tabs>
        </Card>
      </>
    );

  const tab: Tab =
    !loan.variable && store.tab === "rates" ? "extra" : store.tab;
  return (
    <>
      <Card>
        <Title
          icon={<LoanIcon />}
          title={loan.name}
          subtitle={loan.variable ? "Variable rate" : "Fixed rate"}
        />
        <Figure value={money(-balance)} caption="Remaining balance" />
        {loan.variable && (
          <div className={shell.cardActions}>
            <Button
              variant={due ? "primary" : "secondary"}
              onClick={updateRate}
            >
              Update rate
            </Button>
          </div>
        )}
      </Card>
      <Card>
        <Property label="Rate">
          {percent(rate.annualRateBps)}
          <span className={shell.faint}>
            {loan.variable
              ? `Variable · since ${dayLabel(rate.effectiveDate)}`
              : "Fixed"}
          </span>
          {due && <Tag tone="attention">Rate due</Tag>}
        </Property>
        <Property label="Payment">
          {money(loan.minimumPayment)} monthly
        </Property>
        <Property label="Funded">{money(loan.funded)} this month</Property>
        <Property label="Payoff" icon={CalendarDaysIcon}>
          {result.payoffMonth ? (
            monthLabel(result.payoffMonth)
          ) : (
            <Tag tone="attention">No payoff date</Tag>
          )}
        </Property>
        <Property label="Interest">
          {result.interest === null
            ? "Unknown"
            : `${money(result.interest)} left to pay`}
        </Property>
      </Card>
      <Card>
        <Tabs value={tab} onValueChange={(value) => store.setTab(value as Tab)}>
          <TabsList aria-label="Loan details">
            <TabsTrigger value="extra">Extra payment</TabsTrigger>
            <TabsTrigger value="payments">Payments {recorded}</TabsTrigger>
            {loan.variable && <TabsTrigger value="rates">Rates</TabsTrigger>}
          </TabsList>
          <TabsContent value="extra">
            <ExtraPayment loan={loan} />
          </TabsContent>
          <TabsContent value="payments">
            <Payments loan={loan} />
          </TabsContent>
          {loan.variable && (
            <TabsContent value="rates">
              {editor?.kind === "rate" && editor.loanId === loan.id ? (
                <RateEditor loan={loan} />
              ) : (
                <Rates loan={loan} onUpdate={updateRate} />
              )}
            </TabsContent>
          )}
        </Tabs>
      </Card>
    </>
  );
}

function Payments({
  loan,
  summary = true,
}: {
  loan: Loan;
  // Borrowed and interest so far, which a paid-off loan shows above.
  summary?: boolean;
}) {
  const { month, state } = useStore();
  const [all, setAll] = useState(false);
  const payments = loan.payments
    .filter((payment) => payment.date <= endOf(month))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!payments.length)
    return (
      <div className={shell.tabEmpty}>
        <strong className={shell.tabEmptyTitle}>No payments yet</strong>
        <p>
          Record lender payments in the account register. Their principal and
          interest appear here.
        </p>
      </div>
    );
  const shown = all ? payments : payments.slice(0, 6);
  const account = state.accounts.find((item) => item.id === loan.payFrom)?.name;
  return (
    <div className={styles.tabStack}>
      {summary && (
        <dl className={styles.compare}>
          <div>
            <dt>Borrowed</dt>
            <dd>{money(loan.principal)}</dd>
          </div>
          <div>
            <dt>Interest paid</dt>
            <dd>
              {money(payments.reduce((sum, item) => sum + item.interest, 0))} so
              far
            </dd>
          </div>
        </dl>
      )}
      <ul className={styles.history}>
        {shown.map((payment) => (
          <li key={payment.id}>
            <span className={styles.historyMain}>
              <span>{dayLabel(payment.date)}</span>
              <span className={styles.numeric}>
                {money(payment.principal + payment.interest)}
              </span>
            </span>
            <span className={styles.historyDetail}>
              <span className={shell.truncate}>{account}</span>
              <span className={styles.numeric}>
                {money(payment.principal)} principal · {money(payment.interest)}{" "}
                interest
              </span>
            </span>
          </li>
        ))}
      </ul>
      {payments.length > shown.length && (
        <div>
          <Button variant="quiet" onClick={() => setAll(true)}>
            Show all {payments.length}
          </Button>
        </div>
      )}
    </div>
  );
}

function Rates({ loan, onUpdate }: { loan: Loan; onUpdate: () => void }) {
  const due = rateDue(loan);
  const current = rateOn(loan, TODAY);
  const rates = [...loan.rates].sort((a, b) =>
    b.effectiveDate.localeCompare(a.effectiveDate),
  );
  const age = monthsBetween(
    current.effectiveDate.slice(0, 7),
    TODAY.slice(0, 7),
  );
  return (
    <div className={styles.tabStack}>
      {due && (
        <p className={entry.notice}>
          Last confirmed {dayLabel(current.effectiveDate)}, {age} months ago.
          Check your lender’s latest statement and confirm the rate, even if it
          hasn’t changed.
        </p>
      )}
      <ul className={styles.history}>
        {rates.map((rate, index) => {
          const previous = rates[index + 1];
          const change = previous
            ? rate.annualRateBps - previous.annualRateBps
            : null;
          return (
            <li key={rate.effectiveDate}>
              <span className={styles.historyMain}>
                <span>
                  {dayLabel(rate.effectiveDate)}
                  {rate.effectiveDate > TODAY && (
                    <span className={shell.faint}> · Upcoming</span>
                  )}
                  {rate === current && (
                    <span className={shell.faint}> · Current</span>
                  )}
                </span>
                <span className={styles.numeric}>
                  {percent(rate.annualRateBps)}
                </span>
              </span>
              <span className={styles.historyDetail}>
                <span>
                  {index === rates.length - 1 ? "When added" : "Confirmed"}
                </span>
                <span className={styles.numeric}>
                  {change === null
                    ? ""
                    : change === 0
                      ? "No change"
                      : `${change > 0 ? "+" : "−"}${(Math.abs(change) / 100).toFixed(2)} pts`}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <div>
        <Button variant="quiet" onClick={onUpdate}>
          Update rate
        </Button>
      </div>
    </div>
  );
}

export function LoanIcon() {
  return (
    <ChartNoAxesCombinedIcon
      size={15}
      className={shell.titleIcon}
      aria-hidden
    />
  );
}
