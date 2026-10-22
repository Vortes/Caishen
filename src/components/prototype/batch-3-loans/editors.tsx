"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { FieldError } from "../app-shell/move-money";
import shell from "../app-shell/shell.module.css";
import entry from "../app-shell/transaction-entry.module.css";
import target from "../app-shell/target-editor.module.css";
import {
  balanceOn,
  dayLabel,
  endOf,
  forecast,
  monthLabel,
  money,
  parseAmount,
  parseRate,
  percent,
  rateOn,
  THIS_MONTH,
  TODAY,
  type Loan,
} from "./data";
import {
  categoryLabel,
  checkLoan,
  checkPayment,
  checkRate,
  emptyLoan,
  estimatedInterest,
  paymentDraft,
  split,
  type LoanDraft,
  type PaymentDraft,
  type RateDraft,
} from "./drafts";
import { DayField, Field, focusFirst, Select, Well } from "./fields";
import { useStore } from "./store";
import styles from "./loans.module.css";

// ---------- Add loan ----------

function useLoanDraft() {
  const store = useStore();
  const [draft, setDraft] = useState<LoanDraft>(emptyLoan);
  const [tried, setTried] = useState(false);
  const errors = tried ? checkLoan(draft, store.state.loans) : {};
  const change = (next: Partial<LoanDraft>) =>
    setDraft((value) => ({ ...value, ...next }));
  const submit = (form: HTMLElement | null, ids: (field: string) => string) => {
    setTried(true);
    const found = checkLoan(draft, store.state.loans);
    const order = ["name", "balance", "asOf", "rate", "payment"] as const;
    if (order.some((field) => found[field])) {
      requestAnimationFrame(() =>
        focusFirst(
          form,
          order.filter((field) => found[field]).map((field) => ids(field)),
        ),
      );
      return;
    }
    const id = `loan-${Date.now()}`;
    store.addLoan({
      id,
      name: draft.name.trim(),
      categoryId: draft.categoryId === "new" ? `cat-${id}` : draft.categoryId,
      principal: parseAmount(draft.balance)!,
      minimumPayment: parseAmount(draft.payment)!,
      variable: draft.variable,
      rates: [
        { effectiveDate: draft.asOf, annualRateBps: parseRate(draft.rate)! },
      ],
      payments: [],
      funded: 0,
      payFrom: store.state.accounts.find((item) => item.kind === "cash")!.id,
    });
  };
  return { draft, errors, change, submit };
}

// The payoff the new loan's terms give, once they read.
function draftForecast(draft: LoanDraft) {
  const balance = parseAmount(draft.balance);
  const rate = parseRate(draft.rate);
  const payment = parseAmount(draft.payment);
  if (!balance || !payment || rate === null) return null;
  if ([balance, rate, payment].some(Number.isNaN)) return null;
  return forecast(
    {
      id: "draft",
      name: draft.name,
      categoryId: "draft",
      principal: balance,
      minimumPayment: payment,
      variable: draft.variable,
      rates: [{ effectiveDate: TODAY, annualRateBps: rate }],
      payments: [],
    },
    THIS_MONTH,
  );
}

function DraftPayoff({ draft }: { draft: LoanDraft }) {
  const result = draftForecast(draft);
  if (!result)
    return (
      <p className={target.hint}>
        Fill in the balance, rate, and payment to see when it’s paid off.
      </p>
    );
  if (result.payoffMonth === null)
    return (
      <p className={entry.notice}>
        {money(result.payment)} a month doesn’t cover the first month’s
        interest, so there’s no payoff date. Check the payment with your lender;
        you can still add the loan.
      </p>
    );
  return (
    <p className={styles.summary}>
      At {money(result.payment)} a month, it’s paid off in{" "}
      <strong>{monthLabel(result.payoffMonth)}</strong> with about{" "}
      <strong>{money(result.interest!)}</strong> of interest.
    </p>
  );
}

export function AddLoanPanel() {
  const store = useStore();
  const { draft, errors, change, submit } = useLoanDraft();
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);
  return (
    <form
      ref={form}
      className={target.form}
      noValidate
      aria-label="Add a loan"
      onSubmit={(event) => {
        event.preventDefault();
        submit(form.current, field);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          store.open(null);
        }
      }}
    >
      <Field id={field("name")} label="Name" error={errors.name}>
        <Well
          id={field("name")}
          value={draft.name}
          placeholder="Chase mortgage"
          error={errors.name}
          onChange={(name) => change({ name })}
        />
      </Field>
      <div className={styles.pair}>
        <Field
          id={field("balance")}
          label="Balance owed"
          error={errors.balance}
        >
          <Well
            id={field("balance")}
            value={draft.balance}
            prefix="$"
            placeholder="0.00"
            align="end"
            error={errors.balance}
            onChange={(balance) => change({ balance })}
          />
        </Field>
        <Field id={field("asOf")} label="As of" error={errors.asOf}>
          <DayField
            id={field("asOf")}
            label="Balance as of"
            value={draft.asOf}
            min="2000-01-01"
            error={errors.asOf}
            onChange={(asOf) => change({ asOf })}
          />
        </Field>
      </div>
      <SegmentedControl
        fill
        aria-label="Rate type"
        value={draft.variable ? "variable" : "fixed"}
        onValueChange={(value) => change({ variable: value === "variable" })}
      >
        <SegmentedControlItem value="fixed">Fixed rate</SegmentedControlItem>
        <SegmentedControlItem value="variable">
          Variable rate
        </SegmentedControlItem>
      </SegmentedControl>
      <div className={styles.pair}>
        <Field
          id={field("rate")}
          label="Interest rate"
          error={errors.rate}
          hint={
            draft.variable
              ? "Forecasts keep this rate until you confirm a new one."
              : undefined
          }
        >
          <Well
            id={field("rate")}
            value={draft.rate}
            suffix="%"
            placeholder="0.00"
            align="end"
            error={errors.rate}
            hint={draft.variable}
            onChange={(rate) => change({ rate })}
          />
        </Field>
        <Field
          id={field("payment")}
          label="Monthly payment"
          error={errors.payment}
        >
          <Well
            id={field("payment")}
            value={draft.payment}
            prefix="$"
            placeholder="0.00"
            align="end"
            error={errors.payment}
            onChange={(payment) => change({ payment })}
          />
        </Field>
      </div>
      <Field
        id={field("category")}
        label="Payment category"
        hint="Holds the cash for each payment. Its target starts at the monthly payment."
      >
        <CategorySelect
          id={field("category")}
          draft={draft}
          onChange={(categoryId) => change({ categoryId })}
        />
      </Field>
      <DraftPayoff draft={draft} />
      <div className={target.footer}>
        <span className={target.spacer} />
        <Button size="sm" onClick={() => store.open(null)}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit">
          Add loan
        </Button>
      </div>
    </form>
  );
}

function CategorySelect({
  id,
  draft,
  onChange,
}: {
  id: string;
  draft: LoanDraft;
  onChange: (categoryId: string) => void;
}) {
  const { state } = useStore();
  return (
    <Select id={id} value={draft.categoryId} onChange={onChange}>
      <option value="new">
        New: {categoryLabel({ ...draft, categoryId: "new" }, [])}
      </option>
      <optgroup label="Existing categories">
        {state.categories.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}

// Add loan as a row at the top of the list, like a new transaction in the
// register: each term sits under its column, and the payoff column fills in
// as the terms are typed.
export function AddLoanRow() {
  const store = useStore();
  const { draft, errors, change, submit } = useLoanDraft();
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);
  const result = draftForecast(draft);
  return (
    <form
      ref={form}
      className={`${entry.form} ${styles.rowForm}`}
      noValidate
      aria-label="Add a loan"
      onSubmit={(event) => {
        event.preventDefault();
        submit(form.current, field);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          store.open(null);
        }
      }}
    >
      <div className={`${shell.loanColumns} ${styles.rowFields}`}>
        <RowCell id={field("name")} label="Name" error={errors.name}>
          <Well
            id={field("name")}
            value={draft.name}
            placeholder="Loan name"
            error={errors.name}
            onChange={(name) => change({ name })}
          />
        </RowCell>
        <RowCell id={field("rate")} label="Interest rate" error={errors.rate}>
          <Well
            id={field("rate")}
            value={draft.rate}
            suffix="%"
            placeholder="Rate"
            align="end"
            error={errors.rate}
            onChange={(rate) => change({ rate })}
          />
        </RowCell>
        <span
          className={`${styles.rowPayoff} ${shell.muted}`}
          aria-live="polite"
        >
          {result?.payoffMonth
            ? monthLabel(result.payoffMonth)
            : result
              ? "No payoff"
              : "–"}
        </span>
        <RowCell
          id={field("balance")}
          label="Balance owed"
          error={errors.balance}
        >
          <Well
            id={field("balance")}
            value={draft.balance}
            prefix="$"
            placeholder="Balance"
            align="end"
            error={errors.balance}
            onChange={(balance) => change({ balance })}
          />
        </RowCell>
      </div>
      <div className={styles.rowDetails}>
        <div className={target.field}>
          <span className={target.label} id={field("type-label")}>
            Rate
          </span>
          <SegmentedControl
            aria-labelledby={field("type-label")}
            value={draft.variable ? "variable" : "fixed"}
            onValueChange={(value) =>
              change({ variable: value === "variable" })
            }
          >
            <SegmentedControlItem value="fixed">Fixed</SegmentedControlItem>
            <SegmentedControlItem value="variable">
              Variable
            </SegmentedControlItem>
          </SegmentedControl>
        </div>
        <Field
          id={field("payment")}
          label="Monthly payment"
          error={errors.payment}
        >
          <Well
            id={field("payment")}
            value={draft.payment}
            prefix="$"
            placeholder="0.00"
            align="end"
            error={errors.payment}
            onChange={(payment) => change({ payment })}
          />
        </Field>
        <Field id={field("asOf")} label="Balance as of" error={errors.asOf}>
          <DayField
            id={field("asOf")}
            label="Balance as of"
            value={draft.asOf}
            min="2000-01-01"
            error={errors.asOf}
            onChange={(asOf) => change({ asOf })}
          />
        </Field>
        <Field id={field("category")} label="Payment category">
          <CategorySelect
            id={field("category")}
            draft={draft}
            onChange={(categoryId) => change({ categoryId })}
          />
        </Field>
      </div>
      <div className={styles.rowFooter}>
        <div className={styles.rowFooterText}>
          <DraftPayoff draft={draft} />
        </div>
        <div className={entry.actions}>
          <Button size="sm" onClick={() => store.open(null)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit">
            Add loan
          </Button>
        </div>
      </div>
    </form>
  );
}

function RowCell({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={entry.cell}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {children}
      {error && <FieldError id={`${id}-error`} message={error} />}
    </div>
  );
}

// ---------- Rate ----------

export function RateEditor({ loan }: { loan: Loan }) {
  const store = useStore();
  const current = rateOn(loan, TODAY);
  const [draft, setDraft] = useState<RateDraft>({
    rate: (current.annualRateBps / 100).toFixed(2),
    date: TODAY,
  });
  const [tried, setTried] = useState(false);
  const errors = tried ? checkRate(draft, loan) : {};
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>("input")?.select();
  }, []);
  const change = (next: Partial<RateDraft>) =>
    setDraft((value) => ({ ...value, ...next }));
  return (
    <form
      ref={form}
      className={target.form}
      noValidate
      aria-label={`Update the rate for ${loan.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        const found = checkRate(draft, loan);
        if (found.rate || found.date) {
          requestAnimationFrame(() =>
            focusFirst(form.current, [
              ...(found.rate ? [field("rate")] : []),
              ...(found.date ? [field("date")] : []),
            ]),
          );
          return;
        }
        store.confirmRate(loan.id, parseRate(draft.rate)!, draft.date);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          store.open(null);
        }
      }}
    >
      <div className={styles.pair}>
        <Field id={field("rate")} label="Confirmed rate" error={errors.rate}>
          <Well
            id={field("rate")}
            value={draft.rate}
            suffix="%"
            align="end"
            error={errors.rate}
            onChange={(rate) => change({ rate })}
          />
        </Field>
        <Field id={field("date")} label="Starts" error={errors.date}>
          <DayField
            id={field("date")}
            label="Rate starts"
            value={draft.date}
            min={loan.rates[0]!.effectiveDate}
            error={errors.date}
            onChange={(date) => change({ date })}
          />
        </Field>
      </div>
      <RateImpact loan={loan} draft={draft} />
      <div className={target.footer}>
        <span className={target.spacer} />
        <Button size="sm" onClick={() => store.open(null)}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit">
          Confirm rate
        </Button>
      </div>
    </form>
  );
}

function RateImpact({ loan, draft }: { loan: Loan; draft: RateDraft }) {
  const { month } = useStore();
  const rate = parseRate(draft.rate);
  const current = rateOn(loan, endOf(month));
  if (
    rate === null ||
    Number.isNaN(rate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)
  )
    return null;
  if (draft.date > endOf(month))
    return (
      <p className={target.hint}>
        Starts {dayLabel(draft.date)}. Forecasts use{" "}
        {percent(current.annualRateBps)} until then.
      </p>
    );
  if (rate === current.annualRateBps)
    return (
      <p className={target.hint}>
        Same as the current rate. Confirming it records that your lender hasn’t
        changed it.
      </p>
    );
  const before = forecast(loan, month);
  const after = forecast(
    {
      ...loan,
      rates: [
        ...loan.rates,
        { effectiveDate: draft.date, annualRateBps: rate },
      ],
    },
    month,
  );
  if (after.payoffMonth === null)
    return (
      <p className={entry.notice}>
        At {percent(rate)}, the {money(loan.minimumPayment)} payment doesn’t
        cover the monthly interest, so there’s no payoff date.
      </p>
    );
  return (
    <dl className={styles.compare}>
      <div>
        <dt>Payoff</dt>
        <dd>
          {before.payoffMonth ? monthLabel(before.payoffMonth) : "None"} →{" "}
          <strong>{monthLabel(after.payoffMonth)}</strong>
        </dd>
      </div>
      <div>
        <dt>Interest</dt>
        <dd>
          {before.interest === null ? "Unknown" : money(before.interest)} →{" "}
          <strong>{money(after.interest!)}</strong>
        </dd>
      </div>
    </dl>
  );
}

// ---------- Payment ----------

export function usePaymentDraft(loan: Loan) {
  const store = useStore();
  const [draft, setDraft] = useState<PaymentDraft>(() => paymentDraft(loan));
  const [tried, setTried] = useState(false);
  const errors = tried ? checkPayment(draft, loan) : {};
  const change = (next: Partial<PaymentDraft>) =>
    setDraft((value) => ({ ...value, ...next }));
  // Returns the fields to fix, in order, or saves and returns none.
  const submit = (): string[] => {
    setTried(true);
    const found = checkPayment(draft, loan);
    const order = ["accountId", "date", "amount", "interest"] as const;
    const bad = order.filter((field) => found[field]);
    if (bad.length) return bad;
    const parts = split(draft, loan)!;
    store.recordPayment(loan.id, {
      accountId: draft.accountId,
      date: draft.date,
      principal: parts.principal,
      interest: parts.interest,
    });
    return [];
  };
  return { draft, errors, change, submit };
}

// What the payment does to the loan, under the amounts.
export function PaymentSplit({
  loan,
  draft,
}: {
  loan: Loan;
  draft: PaymentDraft;
}) {
  const parts = split(draft, loan);
  if (!parts || parts.principal < 0)
    return (
      <p className={target.hint}>
        The payment is one outflow. Only the principal part lowers the loan
        balance.
      </p>
    );
  return (
    <dl className={styles.compare}>
      <div>
        <dt>Principal</dt>
        <dd>
          <strong>{money(parts.principal)}</strong> of {money(parts.amount)}
        </dd>
      </div>
      <div>
        <dt>Balance</dt>
        <dd>
          {money(balanceOn(loan, TODAY))} →{" "}
          <strong>{money(Math.max(0, parts.after))}</strong>
        </dd>
      </div>
    </dl>
  );
}

export function interestHint(loan: Loan, date: string) {
  const rate = rateOn(loan, /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : TODAY);
  return `Estimated ${money(estimatedInterest(loan, date))} at ${percent(rate.annualRateBps)}. Use the figure on your lender’s statement.`;
}

export function PaymentEditor({ loan }: { loan: Loan }) {
  const store = useStore();
  const { draft, errors, change, submit } = usePaymentDraft(loan);
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current
      ?.querySelector<HTMLInputElement>(`#${CSS.escape(field("interest"))}`)
      ?.focus();
    // Focus once, when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cash = store.state.accounts.filter((item) => item.kind === "cash");
  return (
    <form
      ref={form}
      className={target.form}
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
      <div className={styles.pair}>
        <Field
          id={field("accountId")}
          label="Paid from"
          error={errors.accountId}
        >
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
        </Field>
        <Field id={field("date")} label="Date" error={errors.date}>
          <DayField
            id={field("date")}
            label="Payment date"
            value={draft.date}
            min={loan.rates[0]!.effectiveDate}
            error={errors.date}
            onChange={(date) => change({ date })}
          />
        </Field>
      </div>
      <div className={styles.pair}>
        <Field id={field("amount")} label="Payment" error={errors.amount}>
          <Well
            id={field("amount")}
            value={draft.amount}
            prefix="$"
            align="end"
            error={errors.amount}
            onChange={(amount) => change({ amount })}
          />
        </Field>
        <Field
          id={field("interest")}
          label="Lender-confirmed interest"
          error={errors.interest}
          hint={interestHint(loan, draft.date)}
        >
          <Well
            id={field("interest")}
            value={draft.interest}
            prefix="$"
            placeholder="0.00"
            align="end"
            error={errors.interest}
            hint
            onChange={(interest) => change({ interest })}
          />
        </Field>
      </div>
      <PaymentSplit loan={loan} draft={draft} />
      <div className={target.footer}>
        <span className={target.spacer} />
        <Button size="sm" onClick={() => store.open(null)}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit">
          Record payment
        </Button>
      </div>
    </form>
  );
}
