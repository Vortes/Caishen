"use client";

import { FormField, SelectField } from "~/components/shared";
import { today } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { EntityOptions } from "~/components/budget/form-options";

export function StatementCreditForm({
  view,
  defaultAccountId,
}: {
  view: View;
  defaultAccountId?: string;
}) {
  const cards = view.accounts.filter((account) => account.kind === "credit");
  const cardAccountId = cards.find(
    (account) => account.id === defaultAccountId,
  )?.id;
  return (
    <>
      <SelectField
        label="Credit card"
        name="accountId"
        defaultValue={cardAccountId}
        required
      >
        <EntityOptions items={cards} emptyLabel="Add an account first" />
      </SelectField>
      <div className="form-row">
        <FormField
          label="Posted credit amount ($)"
          name="amount"
          inputMode="decimal"
          required
        />
        <FormField
          label="Posting date"
          name="date"
          type="date"
          defaultValue={today(view.budget.settings.timezone)}
          required
        />
      </div>
      <p className="field-hint">
        Record only a posted credit. It reduces card debt and releases only
        reserves exceeding remaining debt. It creates no bank deposit.
      </p>
    </>
  );
}
