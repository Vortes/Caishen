"use client";

import { FormField, Icon, SelectField } from "~/components/shared";
import { today, formatMoney } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { EntityOptions } from "~/components/budget/form-options";

export function SettlementForm({ view }: { view: View }) {
  return (
    <>
      <div className="notice">
        <Icon name="shared" size={18} />
        <p>
          You owe {formatMoney(view.settlement.youOwe)}. Your partner owes{" "}
          {formatMoney(view.settlement.owedToYou)}. Your net payment is{" "}
          <strong>{formatMoney(Math.max(0, view.settlement.net))}</strong>.
        </p>
      </div>
      <SelectField
        label="Payment from cash account"
        name="accountId"
        required={view.settlement.net > 0}
      >
        <EntityOptions
          items={view.accounts.filter((account) => account.kind === "cash")}
          emptyLabel="Add an account first"
        />
      </SelectField>
      <div className="form-row">
        <FormField
          label="Actual net payment ($)"
          name="amount"
          defaultValue={(Math.max(0, view.settlement.net) / 100).toFixed(2)}
          inputMode="decimal"
          required
        />
        <FormField
          label="Actual payment date"
          name="date"
          type="date"
          defaultValue={today(view.budget.settings.timezone)}
          required
        />
      </div>
      <p className="field-hint">
        The net amount must match the outstanding obligations. Offsets release
        unused real reserves. Your partner records receipt after the deposit
        arrives.
      </p>
    </>
  );
}
