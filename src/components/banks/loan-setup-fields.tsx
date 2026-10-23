"use client";

import styles from "~/components/app-shell/banks.module.css";

type LoanDraft = {
  loanBalance: string;
  annualRate: string;
  minimumPayment: string;
  variable: boolean;
};

export function LoanSetupFields({
  id,
  currentBalance,
  draft,
  busy,
  fieldError,
  errorId,
  onChange,
}: {
  id: string;
  currentBalance: number | null;
  draft: LoanDraft;
  busy: boolean;
  fieldError?: string;
  errorId: string;
  onChange: (next: Partial<LoanDraft>) => void;
}) {
  return (
    <div className={styles.loanFields}>
      <p className={styles.fieldHint}>
        {currentBalance === null
          ? "Your bank hasn’t provided a balance. Enter the principal owed from your lender’s latest statement."
          : "Confirm the APR and required payment with your lender."}
      </p>
      <div className={styles.field}>
        <label htmlFor={`${id}-principal`}>Current principal owed</label>
        <input
          id={`${id}-principal`}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={currentBalance ?? draft.loanBalance}
          readOnly={currentBalance !== null}
          disabled={busy}
          aria-invalid={Boolean(fieldError) || undefined}
          data-invalid={Boolean(fieldError) || undefined}
          aria-describedby={fieldError ? errorId : undefined}
          onChange={(event) =>
            onChange({
              loanBalance: event.target.value,
            })
          }
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-apr`}>APR (%)</label>
        <input
          id={`${id}-apr`}
          type="number"
          inputMode="decimal"
          min="0"
          max="1000"
          step="0.01"
          value={draft.annualRate}
          disabled={busy}
          aria-invalid={Boolean(fieldError) || undefined}
          data-invalid={Boolean(fieldError) || undefined}
          aria-describedby={fieldError ? errorId : undefined}
          onChange={(event) =>
            onChange({
              annualRate: event.target.value,
            })
          }
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-payment`}>Required monthly payment</label>
        <input
          id={`${id}-payment`}
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          value={draft.minimumPayment}
          disabled={busy}
          aria-invalid={Boolean(fieldError) || undefined}
          data-invalid={Boolean(fieldError) || undefined}
          aria-describedby={fieldError ? errorId : undefined}
          onChange={(event) =>
            onChange({
              minimumPayment: event.target.value,
            })
          }
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-rate-type`}>Interest rate</label>
        <select
          id={`${id}-rate-type`}
          value={draft.variable ? "variable" : "fixed"}
          disabled={busy}
          onChange={(event) =>
            onChange({
              variable: event.target.value === "variable",
            })
          }
        >
          <option value="fixed">Fixed rate</option>
          <option value="variable">Variable rate</option>
        </select>
      </div>
      <p className={styles.fieldHint}>
        Creates a loan payment category. Payoff forecasts are estimates;
        payments use your lender’s confirmed principal and interest.
      </p>
    </div>
  );
}
