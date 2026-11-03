"use client";

import { SplitIcon } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { View } from "~/components/budget/types";
import { SPLIT } from "~/components/transactions/transaction-draft";
import { SearchList, type SearchListOption } from "~/components/ui/search-list";
import { planGroups } from "~/domain/engine";
import { NewCategoryPopover, type NewCategory } from "./add-category";

// The spending categories a choice of category offers, under their groups
// in the plan's order, so each group heads its categories once. A loan's
// payment offers only that loan's category.
export function spendingCategoryOptions(
  view: Pick<View, "budget" | "categories">,
  loanId?: string,
): SearchListOption[] {
  const order = planGroups(view.budget);
  const rank = (group: string) => {
    const index = order.indexOf(group);
    return index < 0 ? order.length : index;
  };
  return view.categories
    .filter(
      (category) =>
        !category.pairedAccountId &&
        !category.counterpartyAccountId &&
        (loanId ? category.pairedLoanId === loanId : !category.pairedLoanId),
    )
    .map((category, index) => ({ category, index }))
    .sort(
      (a, b) =>
        rank(a.category.group) - rank(b.category.group) || a.index - b.index,
    )
    .map(({ category }) => ({
      value: category.id,
      label: category.name,
      group: category.group,
      amount: category.available,
    }));
}

// A choice of budget category: the list, New category, which adds one
// without leaving the editor, and Split when the editor can split. Picking
// Split makes the value "Split" until one category replaces it.
export function CategoryField({
  creatable = true,
  onSplit,
  split = false,
  inputRef,
  ...field
}: Omit<ComponentProps<typeof SearchList>, "onCreate" | "action"> & {
  creatable?: boolean;
  onSplit?: () => void;
  split?: boolean;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  // The name typed while its Add form is open.
  const [creating, setCreating] = useState<string | null>(null);
  // A category added from here, shown as the choice until the plan has it,
  // and the one whose add failed, which the choice lets go of.
  const [added, setAdded] = useState<NewCategory | null>(null);
  const [lost, setLost] = useState<string | null>(null);
  const { value, onChange } = field;
  useEffect(() => {
    if (lost && value === lost) onChange("");
  }, [lost, value, onChange]);
  const options = [...field.options];
  if (
    added &&
    added.id !== lost &&
    !options.some((option) => option.value === added.id)
  ) {
    // Under its group's other categories, so the group heads it once.
    const last = options.map((option) => option.group).lastIndexOf(added.group);
    options.splice(last < 0 ? options.length : last + 1, 0, {
      value: added.id,
      label: added.name,
      group: added.group,
    });
  }
  return (
    <NewCategoryPopover
      open={creating !== null}
      name={creating ?? ""}
      group={options.find((option) => option.value === value)?.group}
      onOpenChange={(open) => {
        if (!open) setCreating(null);
      }}
      onAdded={(category) => {
        setAdded(category);
        setLost(null);
        onChange(category.id);
      }}
      onSettled={(category, saved) => {
        if (!saved) setLost(category.id);
      }}
      onClosed={(category) => {
        if (category) field.onPicked?.(category.id);
        else input.current?.focus({ preventScroll: true });
      }}
    >
      <div>
        <SearchList
          {...field}
          inputRef={(element) => {
            input.current = element;
            if (typeof inputRef === "function") inputRef(element);
            else if (inputRef) inputRef.current = element;
          }}
          value={split ? SPLIT : value}
          displayValue={split ? "Split" : field.displayValue}
          options={options}
          onCreate={
            creatable ? { noun: "category", create: setCreating } : undefined
          }
          action={
            onSplit
              ? {
                  label: "Split",
                  icon: <SplitIcon size={13} strokeWidth={2.5} />,
                  onSelect: onSplit,
                }
              : undefined
          }
        />
      </div>
    </NewCategoryPopover>
  );
}
