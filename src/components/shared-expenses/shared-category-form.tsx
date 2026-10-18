"use client";

import { FormField } from "~/components/shared";
import type { View } from "~/components/budget/types";
import {
  sharePercent,
  type SharedCategory,
} from "~/components/shared-expenses/split";

export function SharedCategoryForm({
  view,
  shared,
  categoryId,
}: {
  view: View;
  shared?: SharedCategory;
  categoryId?: string;
}) {
  return (
    <>
      {!shared && categoryId && (
        <input type="hidden" name="categoryId" value={categoryId} />
      )}
      <FormField
        label="Your share (%)"
        name="percent"
        type="number"
        min="0"
        max="100"
        step="1"
        defaultValue={
          shared ? sharePercent(shared.weights, view.budget.userId) : 50
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
