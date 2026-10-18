"use client";

import { cn } from "~/lib/utils";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { type Command } from "~/domain/engine";
import type { Panel, State } from "~/components/budget/types";
import { newId } from "~/components/budget/format";
import {
  CategoryTable,
  budgetFilters,
  matchesFilter,
  type BudgetFilter,
} from "~/components/budget/category-table";
import { CategoryInspector } from "~/components/budget/category-inspector";
import { EmptyState, Icon } from "~/components/shared";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { useMediaQuery } from "~/components/shared/use-media-query";

export function BudgetPlan({
  state,
  busy,
  pending,
  run,
  open,
  onError,
  onReview,
  onAddTransaction,
  targetEditor,
  targetCategoryId,
  onSelectionChange,
}: {
  state: State;
  busy: boolean;
  pending: number;
  run: (command: Command) => void;
  open: (panel: Panel) => void;
  onError: (message: string) => void;
  onReview: () => void;
  onAddTransaction: () => void;
  targetEditor?: ReactNode;
  targetCategoryId?: string;
  onSelectionChange: () => void;
}) {
  const view = state.view!;
  const [filter, setFilter] = useState<BudgetFilter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const compact = useMediaQuery("(max-width: 1090px)");
  const inspectorOpener = useRef<HTMLElement | null>(null);
  const assignmentAttempts = useRef(new Map<string, string>());
  useEffect(() => {
    assignmentAttempts.current.clear();
  }, [state.revision]);
  const categories = view.categories.filter(
    (category) =>
      matchesFilter(category, filter) &&
      category.name.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedCategories = view.categories.filter((category) =>
    targetCategoryId
      ? category.id === targetCategoryId
      : selected.includes(category.id),
  );
  const onSelect = (ids: string[], showDetails = false) => {
    if (document.activeElement instanceof HTMLElement)
      inspectorOpener.current = document.activeElement;
    onSelectionChange();
    setSelected(ids);
    if (ids.length && showDetails) setInspectorOpen(true);
  };
  const closeInspector = () => {
    onSelectionChange();
    setSelected([]);
    setInspectorOpen(false);
  };
  const inspector = (
    <CategoryInspector
      view={view}
      selected={selectedCategories}
      state={state}
      pending={pending}
      open={open}
      onReview={onReview}
      onClear={closeInspector}
      targetEditor={targetEditor}
      showClose={compact}
    />
  );
  return (
    <div
      className={cn(
        "budget-plan",
        (inspectorOpen || targetEditor) && "inspector-open",
      )}
    >
      <div className="plan-main">
        <div
          className="plan-filters"
          role="group"
          aria-label="Filter categories"
        >
          {budgetFilters.map((item) => {
            const count =
              item.id === "all"
                ? 0
                : view.categories.filter((category) =>
                    matchesFilter(category, item.id),
                  ).length;
            return (
              <button
                className={cn(
                  "filter-chip",
                  filter === item.id && "is-active",
                  item.id === "overspent" && count > 0 && "has-warning",
                )}
                key={item.id}
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.id === "overspent" && count > 0 && (
                  <Icon name="info" size={12} />
                )}
                {item.label}
                {count > 0 && <span>{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="plan-toolbar">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => open({ type: "category" })}
          >
            <Icon name="plus" size={15} />
            Add category
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => open({ type: "import" })}
          >
            <Icon name="folder" size={14} />
            Import categories
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="inspector-toggle"
            aria-label="Toggle budget details"
            aria-expanded={inspectorOpen}
            onClick={(event) => {
              inspectorOpener.current = event.currentTarget;
              setInspectorOpen(!inspectorOpen);
            }}
          >
            <Icon name="settings" size={17} />
          </Button>
          <div className="category-search">
            <Icon name="search" size={14} />
            <Input
              aria-label="Search categories"
              placeholder="Find a category"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
        {view.categories.length === 0 ? (
          <EmptyState
            icon="budget"
            title="Give every dollar a job"
            action={
              <div className="empty-actions">
                <Button
                  onClick={() =>
                    open({
                      type: view.accounts.length ? "category" : "account",
                    })
                  }
                >
                  <Icon name="plus" size={15} />
                  {view.accounts.length
                    ? "Create your first category"
                    : "Add account"}
                </Button>
                {!view.accounts.length && (
                  <Button
                    variant="secondary"
                    onClick={() => open({ type: "category" })}
                  >
                    Add category
                  </Button>
                )}
              </div>
            }
          >
            Start with your account balances, add categories for the things that
            matter, and assign the money you have.
          </EmptyState>
        ) : !categories.length ? (
          <EmptyState icon="search" title="No categories match">
            Try a different filter or search.
          </EmptyState>
        ) : (
          <CategoryTable
            categories={categories}
            selected={selected}
            onSelect={onSelect}
            busy={busy}
            onError={onError}
            onAssign={(category, amount) => {
              const key = `${state.revision}:${view.month}:${category.id}:${amount}`;
              const id = assignmentAttempts.current.get(key) ?? newId();
              assignmentAttempts.current.set(key, id);
              run({
                type: "assign",
                id,
                categoryId: category.id,
                month: view.month,
                amount: amount - category.assigned,
              });
            }}
          />
        )}
        <div className="plan-footer">
          <span>{view.categories.length} categories</span>
          {selected.length > 0 && (
            <button
              onClick={() => {
                onSelectionChange();
                setSelected([]);
              }}
            >
              Clear selection
            </button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onAddTransaction}
            disabled={busy || !view.accounts.length}
          >
            <Icon name="plus" size={13} />
            Add transaction
          </Button>
        </div>
      </div>
      {compact ? (
        <Dialog
          open={inspectorOpen || Boolean(targetEditor)}
          onOpenChange={(value) => {
            if (!value) closeInspector();
          }}
        >
          <DialogContent
            className="inspector-dialog translate-x-0 translate-y-0"
            showCloseButton={false}
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              inspectorOpener.current?.focus({ preventScroll: true });
            }}
          >
            <DialogTitle className="sr-only">Budget details</DialogTitle>
            {inspector}
          </DialogContent>
        </Dialog>
      ) : (
        inspector
      )}
    </div>
  );
}
