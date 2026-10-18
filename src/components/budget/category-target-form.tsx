"use client";

import { Button } from "~/components/ui/button";

import { useState } from "react";
import { FormField, SelectField } from "~/components/shared";
import { currentMonth, newId } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import type { Command } from "~/domain/engine";

export function CategoryTargetForm({
  view,
  month,
  category,
  busy,
  run,
}: {
  view: View;
  month: string;
  category?: View["categories"][number];
  busy: boolean;
  run: (command: Command) => void;
}) {
  const [targetCadence, setTargetCadence] = useState<string>(
    category?.target?.cadence ??
      (category?.pairedAccountId
        ? "card-monthly"
        : category?.pairedLoanId
          ? "loan"
          : "monthly"),
  );
  const [targetBehavior, setTargetBehavior] = useState<string>(
    category?.target?.behavior ??
      (category?.pairedAccountId || category?.pairedLoanId
        ? "contribution"
        : "refill"),
  );
  return (
    <>
      <div className="form-row">
        <SelectField
          label="Schedule"
          name="cadence"
          value={targetCadence}
          onChange={(event) => {
            const cadence = event.target.value;
            setTargetCadence(cadence);
            if (cadence !== "custom" && targetBehavior === "balance") {
              setTargetBehavior("refill");
            }
          }}
        >
          {!category?.pairedAccountId && !category?.pairedLoanId && (
            <>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom</option>
            </>
          )}
          {category?.pairedAccountId && (
            <>
              <option value="card-monthly">Monthly card payment</option>
              <option value="card-payoff">Pay off card by date</option>
            </>
          )}
          {category?.pairedLoanId && <option value="loan">Loan payment</option>}
        </SelectField>
        <SelectField
          label="Target behavior"
          name="behavior"
          value={targetBehavior}
          onChange={(event) => setTargetBehavior(event.target.value)}
        >
          {!category?.pairedAccountId && !category?.pairedLoanId && (
            <option value="refill">Refill up to</option>
          )}
          <option value="contribution">Set aside another</option>
          {targetCadence === "custom" && (
            <option value="balance">Have a balance of</option>
          )}
        </SelectField>
      </div>
      <div className="form-row">
        <FormField
          label="Target amount ($)"
          name="amount"
          inputMode="decimal"
          required
          defaultValue={
            category?.target
              ? (category.target.amount / 100).toFixed(2)
              : undefined
          }
        />
        <FormField
          label="Start month"
          name="startMonth"
          type="month"
          defaultValue={category?.target?.startMonth ?? month}
          min={view.budget.startMonth}
          required
        />
      </div>
      {["yearly", "custom", "card-payoff"].includes(targetCadence) && (
        <FormField
          label="Due date (yearly, custom, or card payoff)"
          name="dueDate"
          type="date"
          defaultValue={category?.target?.dueDate}
          required={
            targetCadence === "yearly" ||
            targetCadence === "card-payoff" ||
            (targetCadence === "custom" && targetBehavior !== "balance")
          }
        />
      )}
      {targetCadence === "weekly" && (
        <SelectField
          label="Weekly due day"
          name="weekday"
          defaultValue={category?.target?.weekday ?? 5}
        >
          <option value="">Not a weekly target</option>
          {[
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ].map((day, index) => (
            <option value={index} key={day}>
              {day}
            </option>
          ))}
        </SelectField>
      )}
      {targetCadence === "custom" && targetBehavior !== "balance" && (
        <div className="form-row">
          <FormField
            label="Repeat every (optional)"
            name="repeatEvery"
            type="number"
            min="1"
            max="120"
            defaultValue={category?.target?.repeatEvery}
          />
          <SelectField
            label="Repeat unit"
            name="repeatUnit"
            defaultValue={category?.target?.repeatUnit ?? "months"}
          >
            <option value="months">Months</option>
            <option value="years">Years</option>
          </SelectField>
        </div>
      )}
      <p className="field-hint">
        Targets guide your manual funding. Balance goals use a custom schedule
        and do not repeat. Refill targets count available rollover; contribution
        targets ask for new money.
      </p>
      {category?.target && (
        <div className="heading-actions">
          {!category.pairedAccountId &&
            month === currentMonth(view.budget.settings.timezone) && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run({
                    type: "target.snooze",
                    id: newId(),
                    categoryId: category.id,
                    month,
                    currentMonth: currentMonth(view.budget.settings.timezone),
                    snoozed: !category.target?.snoozedMonths.includes(month),
                  })
                }
              >
                {category.target.snoozedMonths.includes(month)
                  ? "Restore this month’s target"
                  : "Snooze this month"}
              </Button>
            )}
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              run({
                type: "target.set",
                id: newId(),
                categoryId: category.id,
                target: null,
              })
            }
          >
            Remove target
          </Button>
        </div>
      )}
    </>
  );
}
