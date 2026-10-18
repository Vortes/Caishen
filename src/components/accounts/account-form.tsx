"use client";

import { FormField, SelectField } from "~/components/shared";
import type { View } from "~/components/budget/types";

export function AccountForm({ view, month }: { view: View; month: string }) {
  return (
    <>
      <FormField
        label="Account name"
        name="name"
        placeholder="Everyday checking"
        required
        maxLength={120}
        autoFocus
      />
      <div className="form-row">
        <SelectField label="Account type" name="kind">
          <option value="cash">Cash / checking / savings</option>
          <option value="credit">Credit card</option>
        </SelectField>
        <FormField
          label="Opening balance ($)"
          name="openingBalance"
          inputMode="decimal"
          placeholder="0.00"
          required
          hint="For a card, enter the amount owed."
        />
      </div>
      <FormField
        label="Balance as of"
        name="date"
        type="date"
        defaultValue={`${month}-01`}
        min={`${view.budget.startMonth}-01`}
        required
      />
      <p className="field-hint">
        This is a manual account. It does not connect to your bank. Cash is
        Ready to Assign; card debt creates no cash.
      </p>
    </>
  );
}
