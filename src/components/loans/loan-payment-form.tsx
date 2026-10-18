"use client";

import { FormField, SelectField } from "~/components/shared";
import { today } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { EntityOptions } from "~/components/budget/form-options";

export function LoanPaymentForm({ view }: { view: View }) {
  return (
    <>
      <SelectField label="Paid from cash account" name="accountId" required>
        <EntityOptions
          items={view.accounts.filter((account) => account.kind === "cash")}
          emptyLabel="Add an account first"
        />
      </SelectField>
      <div className="form-row">
        <FormField
          label="Lender-confirmed principal ($)"
          name="principal"
          inputMode="decimal"
          required
        />
        <FormField
          label="Lender-confirmed interest ($)"
          name="interest"
          inputMode="decimal"
          required
        />
      </div>
      <FormField
        label="Payment date"
        name="date"
        type="date"
        defaultValue={today(view.budget.settings.timezone)}
        required
      />
      <p className="field-hint">
        The bank payment equals principal plus interest. Only the confirmed
        principal reduces your loan balance.
      </p>
    </>
  );
}
