"use client";

import { FormField, SelectField } from "~/components/shared";
import { today } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { EntityOptions } from "~/components/budget/form-options";

export function LoanForm({ view }: { view: View }) {
  return (
    <>
      <FormField
        label="Loan name"
        name="name"
        placeholder="Student loan"
        required
        maxLength={120}
      />
      <SelectField label="Loan type" name="variable">
        <option value="variable">Variable-rate student loan</option>
        <option value="fixed">Fixed-rate personal loan</option>
      </SelectField>
      <div className="form-row">
        <FormField
          label="Confirmed principal ($)"
          name="principal"
          inputMode="decimal"
          required
          placeholder="0.00"
        />
        <FormField
          label="Confirmed annual rate (%)"
          name="annualRate"
          type="number"
          min="0"
          max="1000"
          step="0.01"
          required
        />
      </div>
      <div className="form-row">
        <FormField
          label="Required monthly payment ($)"
          name="minimumPayment"
          inputMode="decimal"
          required
        />
        <FormField
          label="Confirmed as of"
          name="effectiveDate"
          type="date"
          defaultValue={today(view.budget.settings.timezone)}
          required
        />
      </div>
      <SelectField label="Payment category" name="categoryId">
        <option value="">Create a paired payment category</option>
        <EntityOptions
          items={view.categories.filter(
            (item) => !item.pairedAccountId && !item.pairedLoanId,
          )}
          emptyLabel="Create a category first"
        />
      </SelectField>
      <p className="field-hint">
        Loan debt is not available cash. Forecasts estimate the future; actual
        lender records determine principal and interest.
      </p>
    </>
  );
}
