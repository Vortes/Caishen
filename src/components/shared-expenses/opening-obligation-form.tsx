"use client";

import { FormField, SelectField } from "~/components/shared";
import type { View } from "~/components/budget/types";

export function OpeningObligationForm({ view }: { view: View }) {
  return (
    <>
      <SelectField label="Shared category" name="sharedCategoryId" required>
        {view.sharedCategories.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Who owes whom?" name="direction">
        <option value="you-owe">I owe my partner</option>
        <option value="partner-owes">My partner owes me</option>
      </SelectField>
      <FormField
        label="Already-split amount owed ($)"
        name="amount"
        inputMode="decimal"
        required
        placeholder="0.00"
      />
      <p className="field-hint">
        Enter the amount already owed after splitting. It is not split again and
        creates no cash or new-period spending.
      </p>
    </>
  );
}
