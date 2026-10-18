"use client";

import { FormField } from "~/components/shared";

export function CategoryForm() {
  return (
    <>
      <FormField
        label="Category name"
        name="name"
        placeholder="Groceries"
        maxLength={120}
        required
        autoFocus
      />
      <FormField
        label="Category group"
        name="group"
        defaultValue="Everyday"
        maxLength={120}
      />
      <p className="field-hint">
        Creating a category assigns no money. You decide how to fund it.
      </p>
    </>
  );
}
