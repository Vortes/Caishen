"use client";

import { FormField, SelectField } from "~/components/shared";
import { today } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { EntityOptions } from "~/components/budget/form-options";

export function CardPaymentForm({
  view,
  defaultAccountId,
}: {
  view: View;
  defaultAccountId?: string;
}) {
  const cardAccountId = view.accounts.find(
    (account) => account.id === defaultAccountId && account.kind === "credit",
  )?.id;
  return (
    <>
      <SelectField label="Paid from cash account" name="cashAccountId" required>
        <EntityOptions
          items={view.accounts.filter((account) => account.kind === "cash")}
          emptyLabel="Add an account first"
        />
      </SelectField>
      <SelectField
        label="Paid to credit card"
        name="cardAccountId"
        defaultValue={cardAccountId}
        required
      >
        <EntityOptions
          items={view.accounts.filter((account) => account.kind === "credit")}
          emptyLabel="Add an account first"
        />
      </SelectField>
      <div className="form-row">
        <FormField
          label="Payment amount ($)"
          name="amount"
          inputMode="decimal"
          placeholder="0.00"
          required
        />
        <FormField
          label="Payment date"
          name="date"
          type="date"
          defaultValue={today(view.budget.settings.timezone)}
          required
        />
      </div>
      <p className="field-hint">
        The payment reduces bank cash, the card payment reserve, and card debt.
        It is not a new expense.
      </p>
    </>
  );
}
