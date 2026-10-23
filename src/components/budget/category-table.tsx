"use client";

import { cn } from "~/lib/utils";
import { useState } from "react";
import type { View } from "~/components/budget/types";
import type { Command } from "~/domain/engine";
import { formatMoney } from "~/components/budget/format";
import { AssignedInput } from "~/components/budget/assigned-input";
import {
  CategoryBar,
  StatusIcon,
  categoryStatus,
  statusLine,
} from "~/components/budget/category-row-status";
import { MoveMoneyPopover } from "~/components/budget/move-money-popover";
import { Amount, Icon } from "~/components/shared";
import { Checkbox } from "~/components/ui-legacy/checkbox";
import { useRowSelection } from "~/components/ui/use-row-selection";
import selectionStyles from "~/components/ui/row-selection.module.css";

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

export function CategoryTable({
  view,
  run,
  categories,
  selected,
  onSelect,
  onAssign,
  onError,
  busy,
}: {
  view: View;
  run: (command: Command) => void;
  categories: Category[];
  selected: string[];
  onSelect: (ids: string[], showDetails?: boolean) => void;
  onAssign: (category: Category, amount: number) => void;
  onError: (message: string) => void;
  busy: boolean;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [moving, setMoving] = useState<string | null>(null);
  const selectionStyle = useRowSelection(selected);
  const groups = [...new Set(categories.map((category) => category.group))];
  const selectMany = (ids: string[], checked: boolean) =>
    onSelect(
      checked
        ? [...new Set([...selected, ...ids])]
        : selected.filter((id) => !ids.includes(id)),
    );
  return (
    <div className="category-table-scroll">
      <table
        className={cn("plan-table", selectionStyles.list)}
        {...selectionStyle.listProps}
      >
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
                    const status = categoryStatus(category);
                    const line = statusLine(category, status);
                    return (
                      <tr
                        className={cn("category-row", selectionStyles.row)}
                        key={category.id}
                        {...selectionStyle.rowProps(category.id)}
                        aria-selected={selected.includes(category.id)}
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
                                {line && (
                                  <span
                                    className={`category-status is-${status}`}
                                  >
                                    {line}
                                  </span>
                                )}
                              </div>
                              <CategoryBar
                                category={category}
                                status={status}
                              />
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
                          <MoveMoneyPopover
                            view={view}
                            category={category}
                            open={moving === category.id}
                            onOpenChange={(open) => {
                              setMoving(open ? category.id : null);
                              if (open) onSelect([category.id]);
                            }}
                            run={run}
                          >
                            <button
                              className={`available-pill ${status}`}
                              aria-label={`${category.name} available ${formatMoney(category.available)}. ${status === "overspent" || status === "credit" ? "Cover overspending" : "Move money"}`}
                              disabled={busy}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <StatusIcon category={category} status={status} />
                              <Amount value={category.available} />
                            </button>
                          </MoveMoneyPopover>
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
