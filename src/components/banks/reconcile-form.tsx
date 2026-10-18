"use client";

import { cn } from "~/lib/utils";
import { Amount, FormField, SelectField } from "~/components/shared";
import { today } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { EntityOptions } from "~/components/budget/form-options";
import { FormTextArea as TextArea } from "~/components/budget/form-textarea";
import type { RouterOutputs } from "~/trpc/react";

export function ReconcileForm({
  view,
  month,
  fileText,
  readFile,
  result,
  defaultAccountId,
}: {
  view: View;
  month: string;
  fileText: string;
  readFile: React.ChangeEventHandler<HTMLInputElement>;
  result: RouterOutputs["budget"]["reconcile"] | null;
  defaultAccountId?: string;
}) {
  return (
    <>
      <SelectField
        label="Account"
        name="accountId"
        defaultValue={defaultAccountId}
        required
      >
        <EntityOptions
          items={view.accounts}
          emptyLabel="Add an account first"
        />
      </SelectField>
      <div className="form-row">
        <FormField
          label="Statement period begins"
          name="periodStart"
          type="date"
          defaultValue={`${month}-01`}
          required
        />
        <FormField
          label="Statement cutoff"
          name="cutoff"
          type="date"
          defaultValue={today(view.budget.settings.timezone)}
          required
        />
      </div>
      <div className="form-row">
        <FormField
          label="Statement opening balance ($)"
          name="openingBalance"
          inputMode="decimal"
          required
        />
        <FormField
          label="Statement closing balance ($)"
          name="closingBalance"
          inputMode="decimal"
          required
        />
      </div>
      <FormField
        label="Statement activity CSV"
        name="file"
        type="file"
        accept=".csv,text/csv"
        onChange={readFile}
        hint="Columns: date, description, amount. Signed amounts, posted activity only."
      />
      <TextArea
        label="Or paste statement CSV"
        name="csv"
        required={!fileText}
        placeholder={"date,description,amount\n2026-10-01,Groceries,-24.50"}
      />
      <label className="checkbox-field">
        <input type="checkbox" name="verified" />
        <span>
          I confirmed this is the complete cleared activity from my bank
          statement.
          <p className="field-hint">
            This is your attestation. Caishen cannot authenticate the uploaded
            document.
          </p>
        </span>
      </label>
      {result && (
        <div
          className={cn("notice", result.status !== "reconciled" && "warning")}
          role="status"
        >
          <div>
            <strong>
              {result.status === "reconciled"
                ? "Statement matches your cleared ledger"
                : result.status === "discrepancy"
                  ? "There is a difference to investigate"
                  : "More evidence is needed"}
            </strong>
            {result.differenceCents !== null && (
              <p>
                Balance difference: <Amount value={result.differenceCents} />
              </p>
            )}
            {result.reasons.map((reason) => (
              <p key={reason}>{reason}</p>
            ))}
            {result.missingFromLedger.length > 0 && (
              <p>
                {result.missingFromLedger.length} statement items are missing
                from your ledger.
              </p>
            )}
            {result.missingFromStatement.length > 0 && (
              <p>
                {result.missingFromStatement.length} ledger items are missing
                from the statement.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
