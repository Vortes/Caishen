"use client";

import { FormField, SelectField } from "~/components/shared";
import { formatMoney } from "~/components/budget/format";
import type { View } from "~/components/budget/types";

export function ExpectedReimbursementForm({ view }: { view: View }) {
  return (
    <>
      <SelectField label="Original purchase" name="transactionId" required>
        {view.budget.transactions
          .filter(
            (item) =>
              !item.removed &&
              item.amount < 0 &&
              item.kind === "purchase" &&
              !item.sharedCategoryId,
          )
          .map((item) => (
            <option key={item.id} value={item.id}>
              {item.payee} · {formatMoney(-item.amount)}
            </option>
          ))}
      </SelectField>
      <FormField
        label="Person or organization"
        name="name"
        placeholder="Who will reimburse you?"
        required
        maxLength={120}
      />
      <div className="form-row">
        <FormField
          label="Expected amount ($)"
          name="amount"
          inputMode="decimal"
          required
          placeholder="0.00"
        />
        <SelectField label="How it will arrive" name="kind">
          <option value="cash">Cash reimbursement</option>
          <option value="statement-credit">Card statement credit</option>
        </SelectField>
      </div>
      <p className="field-hint">
        An expected reimbursement creates no spendable cash. Shared partner
        expenses already belong to the settlement.
      </p>
    </>
  );
}
