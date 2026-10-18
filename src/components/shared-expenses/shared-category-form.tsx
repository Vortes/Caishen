"use client";

import { FormField, SelectField } from "~/components/shared";
import type { View } from "~/components/budget/types";
import { EntityOptions } from "~/components/budget/form-options";

export function SharedCategoryForm({
  view,
  shared,
}: {
  view: View;
  shared?: View["sharedCategories"][number];
}) {
  return (
    <>
      <FormField
        label="Shared category name"
        name="name"
        placeholder="Rent"
        defaultValue={shared?.name}
        maxLength={120}
        required
      />
      {!shared && (
        <SelectField label="Your budget category" name="categoryId" required>
          <EntityOptions
            items={view.categories.filter(
              (item) => !item.pairedAccountId && !item.pairedLoanId,
            )}
            emptyLabel="Create a category first"
          />
        </SelectField>
      )}
      <FormField
        label="Your share (%)"
        name="percent"
        type="number"
        min="0"
        max="100"
        step="1"
        defaultValue={
          shared
            ? Math.round(
                ((shared.weights[view.budget.userId] ?? 0) /
                  Object.values(shared.weights).reduce(
                    (sum, weight) => sum + weight,
                    0,
                  )) *
                  100,
              )
            : 50
        }
        required
        hint="Your partner’s share is the remainder. Either person may change this rule."
      />
      <p className="field-hint">
        {shared
          ? "New purchases use the updated split; existing transaction shares remain inspectable."
          : "A matching shared category is created in your partner’s budget. Each person funds the full cash they pay or owe."}
      </p>
    </>
  );
}
