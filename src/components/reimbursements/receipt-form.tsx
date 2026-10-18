"use client";

import { FormField, SelectField } from "~/components/shared";
import { formatMoney, shortDate, today } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { EntityOptions } from "~/components/budget/form-options";

export function ReceiptForm({
  view,
  claim,
  settlement,
}: {
  view: View;
  claim?: View["reimbursements"][number];
  settlement?: View["sharedStatement"]["awaitingYourConfirmation"][number];
}) {
  return (
    <>
      {settlement && (
        <p className="field-hint">
          Your partner recorded a repayment of{" "}
          <strong>{formatMoney(settlement.amount)}</strong> on{" "}
          {shortDate(settlement.date)}.
        </p>
      )}
      <SelectField label="Receiving cash account" name="accountId" required>
        <EntityOptions
          items={view.accounts.filter((account) => account.kind === "cash")}
          emptyLabel="Add an account first"
        />
      </SelectField>
      {claim && (
        <FormField
          label="Cash received ($)"
          name="amount"
          defaultValue={(claim.outstanding / 100).toFixed(2)}
          inputMode="decimal"
          required
        />
      )}
      <FormField
        label="Date received"
        name="date"
        type="date"
        defaultValue={today(view.budget.settings.timezone)}
        min={settlement?.date}
        required
      />
      <p className="field-hint">
        Record the actual receipt. Received reimbursements return to Ready to
        Assign without becoming new earnings.
      </p>
    </>
  );
}
