"use client";

import { SelectField } from "~/components/shared";
import type { View } from "~/components/budget/types";
import { EntityOptions } from "~/components/budget/form-options";

export function StandingRuleForm({ view }: { view: View }) {
  return (
    <>
      <SelectField label="Cover overspending in" name="toCategoryId" required>
        <EntityOptions
          items={view.categories.filter(
            (item) => !item.pairedAccountId && !item.pairedLoanId,
          )}
          emptyLabel="Create a category first"
        />
      </SelectField>
      <SelectField
        label="Using available money from"
        name="fromCategoryId"
        required
      >
        <EntityOptions
          items={view.categories.filter(
            (item) => !item.pairedAccountId && !item.pairedLoanId,
          )}
          emptyLabel="Create a category first"
        />
      </SelectField>
      <p className="field-hint">
        This explicitly authorizes the agent to use this source category when
        covering overspending. It never assigns Ready to Assign.
      </p>
    </>
  );
}
