"use client";

import { FormField } from "~/components/shared";
import { today } from "~/components/budget/format";
import type { View } from "~/components/budget/types";

export function LoanRateForm({
  view,
  loan,
}: {
  view: View;
  loan?: View["loans"][number];
}) {
  return (
    <>
      <FormField
        label="Confirmed annual rate (%)"
        name="annualRate"
        type="number"
        min="0"
        max="1000"
        step="0.01"
        defaultValue={loan ? loan.forecast.rateBps / 100 : undefined}
        required
      />
      <FormField
        label="Rate effective date"
        name="effectiveDate"
        type="date"
        defaultValue={today(view.budget.settings.timezone)}
        required
      />
      <p className="field-hint">
        The effective rate is retained in history. Forecasts assume the latest
        confirmed rate continues.
      </p>
    </>
  );
}
