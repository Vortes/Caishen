"use client";

import { useState } from "react";
import { cn } from "~/lib/utils";
import type { Command } from "~/domain/engine";
import {
  optionAmount,
  planAutoAssign,
  type AutoAssignOption,
  type AutoAssignPlan,
} from "~/domain/auto-assign";
import { formatMoney, newId } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import type { Category } from "~/components/budget/category-table";
import { Amount, Icon } from "~/components/shared";
import { Button } from "~/components/ui-legacy/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui-legacy/dialog";

const fillOptions: { id: AutoAssignOption; label: string }[] = [
  { id: "underfunded", label: "Underfunded" },
  { id: "assigned-last-month", label: "Assigned last month" },
  { id: "spent-last-month", label: "Spent last month" },
  { id: "average-assigned", label: "Average assigned" },
  { id: "average-spent", label: "Average spent" },
  { id: "reduce-overfunding", label: "Reduce overfunding" },
];
const resetOptions: { id: AutoAssignOption; label: string }[] = [
  { id: "reset-available", label: "Reset available amount" },
  { id: "reset-assigned", label: "Reset assigned amount" },
];

// YNAB's Auto-Assign. With nothing selected it covers the whole month and previews
// every change first; with a selection it applies right away.
export function AutoAssignSection({
  view,
  selected,
  busy,
  run,
}: {
  view: View;
  selected: Category[];
  busy: boolean;
  run: (command: Command) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [preview, setPreview] = useState<{
    label: string;
    plan: AutoAssignPlan;
  } | null>(null);
  const whole = selected.length === 0;
  // Ties in Underfunded go top to bottom as the plan shows them: by group, then category.
  const groups = [...new Set(view.categories.map((item) => item.group))];
  const scope = (whole ? view.categories : selected)
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        groups.indexOf(a.item.group) - groups.indexOf(b.item.group) ||
        a.index - b.index,
    )
    .map(({ item }) => item);
  const apply = (plan: AutoAssignPlan) => {
    run({
      type: "assign.batch",
      id: newId(),
      month: view.month,
      changes: plan.changes,
    });
    setPreview(null);
  };
  const underfunded = optionAmount("underfunded", scope);
  const button = (
    option: { id: AutoAssignOption; label: string },
    primary = false,
  ) => {
    const amount = optionAmount(option.id, scope);
    // YNAB offers this only for the whole month, and only when something is overfunded.
    if (option.id === "reduce-overfunding" && (!whole || amount === 0))
      return null;
    const plan = planAutoAssign({
      option: option.id,
      scope,
      readyToAssign: view.readyToAssign,
      month: view.month,
    });
    return (
      <button
        key={option.id}
        type="button"
        className={cn("auto-assign-option", primary && "is-primary")}
        disabled={busy || plan.changes.length === 0}
        onClick={() =>
          whole ? setPreview({ label: option.label, plan }) : apply(plan)
        }
      >
        <span>{option.label}</span>
        <Amount value={amount} />
      </button>
    );
  };
  return (
    <section className="inspector-section">
      <h3>
        <button
          type="button"
          className="auto-assign-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <Icon name="zap" size={14} />
          Auto-Assign
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
        </button>
      </h3>
      {expanded && (
        <>
          <div className="auto-assign-list">
            {fillOptions.map((option, index) => button(option, index === 0))}
          </div>
          {underfunded > 0 && view.readyToAssign <= 0 && (
            <p className="auto-assign-hint">
              Ready to Assign is empty. Move money from a category to fund the
              rest.
            </p>
          )}
          {underfunded > view.readyToAssign && view.readyToAssign > 0 && (
            <p className="auto-assign-hint">
              Only {formatMoney(view.readyToAssign)} is Ready to Assign.
              Underfunded covers overspending first, then targets by due date,
              until it runs out.
            </p>
          )}
          <div className="auto-assign-list">
            {resetOptions.map((option) => button(option))}
          </div>
        </>
      )}
      <AutoAssignPreview
        view={view}
        preview={preview}
        busy={busy}
        onCancel={() => setPreview(null)}
        onConfirm={() => preview && apply(preview.plan)}
      />
    </section>
  );
}

function AutoAssignPreview({
  view,
  preview,
  busy,
  onCancel,
  onConfirm,
}: {
  view: View;
  preview: { label: string; plan: AutoAssignPlan } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const changes = preview?.plan.changes ?? [];
  const net = changes.reduce((sum, change) => sum + change.amount, 0);
  return (
    <Dialog
      open={Boolean(preview)}
      onOpenChange={(open) => !open && onCancel()}
    >
      <DialogContent className="auto-assign-preview">
        <DialogHeader>
          <DialogTitle>{preview?.label}</DialogTitle>
          <DialogDescription>
            Review where your money goes before anything changes.
          </DialogDescription>
        </DialogHeader>
        <ul className="auto-assign-changes">
          {changes.map((change) => (
            <li key={change.categoryId}>
              <span>
                {
                  view.categories.find((item) => item.id === change.categoryId)
                    ?.name
                }
              </span>
              <Amount
                value={change.amount}
                signed
                className={change.amount > 0 ? "positive" : undefined}
              />
            </li>
          ))}
        </ul>
        <dl className="inspector-values auto-assign-total">
          <div>
            <dt>Ready to Assign after</dt>
            <dd>
              <Amount value={view.readyToAssign - net} />
            </dd>
          </div>
        </dl>
        {preview && preview.plan.short > 0 && (
          <p className="auto-assign-hint">
            {formatMoney(preview.plan.short)} more is needed, but Ready to
            Assign runs out first.
          </p>
        )}
        {preview && preview.plan.stuck > 0 && (
          <p className="auto-assign-hint">
            {formatMoney(preview.plan.stuck)} stays put because it’s already
            spent.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            {net >= 0 ? "Assign money" : "Move to Ready to Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
