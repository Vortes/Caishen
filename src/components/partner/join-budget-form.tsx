"use client";

import { FormField } from "~/components/shared";

export function JoinBudgetForm() {
  return (
    <>
      <FormField
        label="Partner’s invitation code"
        name="code"
        required
        autoFocus
        autoComplete="off"
      />
      <p className="field-hint">
        Your own budget and transactions remain private. A household supports
        two people.
      </p>
    </>
  );
}
