"use client";

import { FormField, SelectField } from "~/components/shared";
import { monthName, formatMoney } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { EntityOptions } from "~/components/budget/form-options";

export function AssignmentForm({
  view,
  month,
  categoryId,
}: {
  view: View;
  month: string;
  categoryId?: string;
}) {
  return (
    <>
      <SelectField
        label="Category to fund"
        name="categoryId"
        defaultValue={categoryId}
      >
        <EntityOptions
          items={view.categories}
          emptyLabel="Create a category first"
        />
      </SelectField>
      <SelectField label="Move money from" name="fromCategoryId">
        <option value="">
          Ready to Assign · {formatMoney(view.readyToAssign)}
        </option>
        <EntityOptions
          items={view.categories}
          emptyLabel="Create a category first"
        />
      </SelectField>
      <FormField
        label="Amount to add ($)"
        name="amount"
        inputMode="decimal"
        placeholder="0.00"
        required
        hint="Enter a negative amount from Ready to Assign to return category funds."
        autoFocus
      />
      <p className="field-hint">
        Current month: {monthName(month)}. Targets guide funding and never
        assign money.
      </p>
    </>
  );
}
