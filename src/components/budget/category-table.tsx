"use client";

import { cn } from "~/lib/utils";
import { useState } from "react";
import type { View } from "~/components/budget/types";
import { formatMoney } from "~/components/budget/format";
import { AssignedInput } from "~/components/budget/assigned-input";
import { Amount, Icon } from "~/components/shared";
import { Checkbox } from "~/components/ui/checkbox";

export type Category = View["categories"][number];
export type BudgetFilter =
  "all" | "overspent" | "underfunded" | "snoozed" | "available";
export const budgetFilters: { id: BudgetFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "overspent", label: "Overspent" },
  { id: "underfunded", label: "Underfunded" },
  { id: "snoozed", label: "Snoozed" },
  { id: "available", label: "Money available" },
];
export function matchesFilter(category: Category, filter: BudgetFilter) {
  switch (filter) {
    case "overspent":
      return category.available < 0;
    case "underfunded":
      return (category.targetProgress?.needed ?? 0) > 0;
    case "snoozed":
      return Boolean(category.targetProgress?.snoozed);
    case "available":
      return category.available > 0;
    default:
      return true;
  }
}
export function categoryStatus(category: Category) {
  if (category.available < 0) return "overspent";
  if (category.targetProgress?.snoozed) return "snoozed";
  if ((category.targetProgress?.needed ?? 0) > 0) return "underfunded";
  if (category.available > 0) return "funded";
  return "empty";
}

export function CategoryTable({
  categories,
  selected,
  onSelect,
  onAssign,
  onError,
  busy,
  sharedSplits,
}: {
  categories: Category[];
  selected: string[];
  onSelect: (ids: string[], showDetails?: boolean) => void;
  onAssign: (category: Category, amount: number) => void;
  onError: (message: string) => void;
  busy: boolean;
  sharedSplits: Map<string, number[]>;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const groups = [...new Set(categories.map((category) => category.group))];
  const selectMany = (ids: string[], checked: boolean) =>
    onSelect(
      checked
        ? [...new Set([...selected, ...ids])]
        : selected.filter((id) => !ids.includes(id)),
    );
  return (
    <div className="category-table-scroll">
      <table className="plan-table">
        <colgroup>
          <col className="category-column" />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>
              <Checkbox
                aria-label="Select all categories"
                checked={
                  categories.length > 0 &&
                  categories.every((category) => selected.includes(category.id))
                    ? true
                    : categories.some((category) =>
                          selected.includes(category.id),
                        )
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={(checked) =>
                  selectMany(
                    categories.map((category) => category.id),
                    checked === true,
                  )
                }
              />
              <span>Category</span>
            </th>
            <th className="number">Assigned</th>
            <th className="number">Activity</th>
            <th className="number">Available</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const items = categories.filter(
              (category) => category.group === group,
            );
            const isCollapsed = collapsed.includes(group);
            return (
              <CategoryGroup
                key={group}
                group={group}
                items={items}
                selected={selected}
                collapsed={isCollapsed}
                onToggle={() =>
                  setCollapsed((values) =>
                    isCollapsed
                      ? values.filter((value) => value !== group)
                      : [...values, group],
                  )
                }
                onCheck={(checked) =>
                  selectMany(
                    items.map((category) => category.id),
                    checked,
                  )
                }
              >
                {!isCollapsed &&
                  items.map((category) => {
                    const progress = category.targetProgress;
                    const status = categoryStatus(category);
                    const splits = sharedSplits.get(category.id) ?? [];
                    const split = splits[0];
                    const percent = progress
                      ? Math.min(
                          100,
                          Math.max(
                            0,
                            progress.total > 0
                              ? (progress.funded / progress.total) * 100
                              : 100,
                          ),
                        )
                      : 0;
                    return (
                      <tr
                        className={cn(
                          "category-row",
                          selected.includes(category.id) && "is-selected",
                        )}
                        key={category.id}
                        onClick={() => onSelect([category.id], true)}
                      >
                        <td>
                          <div className="category-name-cell">
                            <span onClick={(event) => event.stopPropagation()}>
                              <Checkbox
                                aria-label={`Select ${category.name}`}
                                checked={selected.includes(category.id)}
                                onCheckedChange={(checked) =>
                                  selectMany([category.id], checked === true)
                                }
                              />
                            </span>
                            <div className="category-name-content">
                              <div className="category-name-line">
                                <button
                                  className="category-name"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onSelect([category.id], true);
                                  }}
                                >
                                  {category.name}
                                </button>
                                {split !== undefined && (
                                  <span
                                    className="shared-mark"
                                    title="Shared with your partner"
                                  >
                                    <Icon name="shared" size={12} />
                                    <span aria-hidden="true">
                                      {splits.length > 1
                                        ? "Multiple splits"
                                        : `${split}/${100 - split}`}
                                    </span>
                                    <span className="sr-only">
                                      {splits.length > 1
                                        ? `Shared with your partner using ${splits.length} split rules`
                                        : `Shared with your partner. Your share ${split} percent, partner’s share ${100 - split} percent`}
                                    </span>
                                  </span>
                                )}
                              </div>
                              {progress && (
                                <>
                                  <span className="category-target-note">
                                    {progress.snoozed
                                      ? "Snoozed"
                                      : progress.needed > 0
                                        ? `${formatMoney(progress.needed)} needed`
                                        : "Funded"}
                                  </span>
                                  <span
                                    className={`category-progress ${status}`}
                                    aria-hidden="true"
                                  >
                                    <span style={{ width: `${percent}%` }} />
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="number">
                          <AssignedInput
                            name={category.name}
                            value={category.assigned}
                            busy={busy}
                            onChange={(amount) => onAssign(category, amount)}
                            onError={onError}
                          />
                        </td>
                        <td className="number">
                          <Amount value={category.activity} />
                        </td>
                        <td className="number">
                          <button
                            className={`available-pill ${status}`}
                            aria-label={`${category.name} available ${formatMoney(category.available)}. View details`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelect([category.id], true);
                            }}
                          >
                            {status === "funded" && (
                              <Icon name="check" size={12} />
                            )}
                            {status === "overspent" && (
                              <Icon name="info" size={12} />
                            )}
                            <Amount value={category.available} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </CategoryGroup>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CategoryGroup({
  group,
  items,
  selected,
  collapsed,
  onToggle,
  onCheck,
  children,
}: {
  group: string;
  items: Category[];
  selected: string[];
  collapsed: boolean;
  onToggle: () => void;
  onCheck: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className="category-group-row">
        <td>
          <div className="category-group-name">
            <button
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${group}`}
              aria-expanded={!collapsed}
              onClick={onToggle}
            >
              <Icon
                name={collapsed ? "chevron-right" : "chevron-down"}
                size={14}
              />
            </button>
            <Checkbox
              aria-label={`Select ${group} categories`}
              checked={
                items.every((item) => selected.includes(item.id))
                  ? true
                  : items.some((item) => selected.includes(item.id))
                    ? "indeterminate"
                    : false
              }
              onCheckedChange={(checked) => onCheck(checked === true)}
            />
            <button
              onClick={onToggle}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${group} categories`}
            >
              {group}
            </button>
          </div>
        </td>
        <td className="number">
          <Amount
            value={items.reduce((sum, category) => sum + category.assigned, 0)}
          />
        </td>
        <td className="number">
          <Amount
            value={items.reduce((sum, category) => sum + category.activity, 0)}
          />
        </td>
        <td className="number">
          <Amount
            value={items.reduce((sum, category) => sum + category.available, 0)}
          />
        </td>
      </tr>
      {children}
    </>
  );
}
