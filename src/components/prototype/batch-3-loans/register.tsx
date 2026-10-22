"use client";

import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { Button } from "~/components/ui/button";
import shell from "../app-shell/shell.module.css";
import entry from "../app-shell/transaction-entry.module.css";
import { paymentRows, shortDayLabel, money, type Loan } from "./data";
import { interestHint, PaymentSplit, usePaymentDraft } from "./editors";
import { DayField, focusFirst, Select, Well } from "./fields";
import { useStore } from "./store";
import styles from "./loans.module.css";

// The register as the shell draws it, read-only but for the loan payment a
// Record payment hands over.
export function Register({ accountId }: { accountId: string | null }) {
  const store = useStore();
  const { state, month, paidFrom, editor, justSaved } = store;
  const accountColumn = !accountId;
  const rows = [...state.rows, ...paymentRows(state, paidFrom)]
    .filter(
      (item) =>
        (!accountId || item.accountId === accountId) &&
        item.date.startsWith(month),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const editing =
    editor?.kind === "register-payment" &&
    (!accountId || editor.accountId === accountId)
      ? state.loans.find((item) => item.id === editor.loanId)
      : undefined;
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
      {editing && editor?.kind === "register-payment" && (
        <LoanPaymentEntry
          key={editing.id}
          loan={editing}
          accountColumn={accountColumn}
        />
      )}
      {rows.map((item) => (
        <div key={item.id} className={shell.rowWrap}>
          <div
            data-row
            className={`${shell.txColumns} ${shell.row} ${styles.staticRow}`}
            aria-current={justSaved === item.id ? "true" : undefined}
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

// The shell's transaction editor, opened from a loan with its payment filled
// in: the loan as payee, its payment category, the planned amount, and focus
// on the interest the lender confirmed.
function LoanPaymentEntry({
  loan,
  accountColumn,
}: {
  loan: Loan;
  accountColumn: boolean;
}) {
  const store = useStore();
  const { draft, errors, change, submit } = usePaymentDraft(loan);
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    document.getElementById(`${id}-interest`)?.focus();
  }, [id]);
  const cash = store.state.accounts.filter((item) => item.kind === "cash");
  const amountError = errors.amount;
  return (
    <form
      ref={form}
      className={entry.form}
      noValidate
      aria-label={`Record a payment to ${loan.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        const bad = submit();
        if (bad.length)
          requestAnimationFrame(() => focusFirst(form.current, bad.map(field)));
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          store.open(null);
        }
      }}
    >
      <div
        className={`${shell.txColumns} ${entry.entryRow}`}
        data-accounts={accountColumn || undefined}
      >
        {accountColumn && (
          <Cell id={field("accountId")} column="account" label="Account">
            <Select
              id={field("accountId")}
              value={draft.accountId}
              error={errors.accountId}
              onChange={(accountId) => change({ accountId })}
            >
              {cash.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </Cell>
        )}
        <Cell id={field("date")} column="date" label="Date" error={errors.date}>
          <DayField
            id={field("date")}
            label="Date"
            value={draft.date}
            min={loan.rates[0]!.effectiveDate}
            error={errors.date}
            onChange={(date) => change({ date })}
          />
        </Cell>
        <Cell id={field("payee")} column="payee" label="Payee">
          <Well
            id={field("payee")}
            value={`Payment to ${loan.name}`}
            readOnly
            onChange={() => undefined}
          />
        </Cell>
        <Cell id={field("category")} column="category" label="Category">
          <Well
            id={field("category")}
            value={`${loan.name} payment`}
            readOnly
            onChange={() => undefined}
          />
        </Cell>
        <Cell id={field("amount")} column="outflow" label="Outflow">
          <Well
            id={field("amount")}
            value={draft.amount}
            prefix="$"
            placeholder="Outflow"
            align="end"
            error={amountError}
            onChange={(amount) => change({ amount })}
          />
        </Cell>
        <Cell id={field("inflow")} column="inflow" label="Inflow">
          <Well
            id={field("inflow")}
            value=""
            prefix="$"
            placeholder="Inflow"
            align="end"
            readOnly
            onChange={() => undefined}
          />
        </Cell>
        <span data-column="status" aria-hidden />
        {amountError && (
          <p id={`${field("amount")}-error`} className={entry.amountError}>
            <CircleAlertIcon size={13} aria-hidden />
            {amountError}
          </p>
        )}
      </div>
      <div className={`${entry.loanDetails} ${styles.loanEntry}`}>
        <div className={styles.interestField}>
          <label htmlFor={field("interest")}>Lender-confirmed interest</label>
          <Well
            id={field("interest")}
            value={draft.interest}
            prefix="$"
            placeholder="0.00"
            error={errors.interest}
            hint
            onChange={(interest) => change({ interest })}
          />
          {errors.interest && (
            <p id={`${field("interest")}-error`} className={entry.formError}>
              <CircleAlertIcon size={13} aria-hidden />
              {errors.interest}
            </p>
          )}
          <p id={`${field("interest")}-hint`} className={styles.faintSmall}>
            {interestHint(loan, draft.date)}
          </p>
        </div>
        <div className={styles.entrySplit}>
          <PaymentSplit loan={loan} draft={draft} />
        </div>
      </div>
      <div className={entry.rowFooter}>
        <div className={entry.actions}>
          <Button size="sm" onClick={() => store.open(null)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit">
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

function Cell({
  id,
  column,
  label,
  error,
  children,
}: {
  id: string;
  column: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={entry.cell} data-column={column}>
      <label htmlFor={id} className={entry.cellLabel}>
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className={entry.formError} role="alert">
          <CircleAlertIcon size={13} aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
