"use client";

import styles from "~/components/app-shell/banks.module.css";
import { groupThousands } from "~/components/budget/format";
import { AmountInput } from "~/components/ui/amount-input";
import { Field } from "~/components/ui/field";
import { TextInput } from "~/components/ui/text-input";

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
  // The loan's one error shows under the account; each field points to it.
  const sharedErrorId = fieldError ? errorId : undefined;
  return (
    <div className={styles.loanFields}>
      <p className={styles.fieldHint}>
        {currentBalance === null
          ? "Your bank hasn’t provided a balance. Enter the principal owed from your lender’s latest statement."
          : "Confirm the APR and required payment with your lender."}
      </p>
      <Field label="Current principal owed" sharedErrorId={sharedErrorId}>
        <AmountInput
          value={
            currentBalance === null
              ? draft.loanBalance
              : groupThousands(String(currentBalance))
          }
          readOnly={currentBalance !== null}
          disabled={busy}
          onChange={(loanBalance) => onChange({ loanBalance })}
        />
      </Field>
      <Field label="APR" sharedErrorId={sharedErrorId}>
        <TextInput
          value={draft.annualRate}
          suffix="%"
          inputMode="decimal"
          disabled={busy}
          onChange={(annualRate) => onChange({ annualRate })}
        />
      </Field>
      <Field label="Required monthly payment" sharedErrorId={sharedErrorId}>
        <AmountInput
          value={draft.minimumPayment}
          disabled={busy}
          onChange={(minimumPayment) => onChange({ minimumPayment })}
        />
      </Field>
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
