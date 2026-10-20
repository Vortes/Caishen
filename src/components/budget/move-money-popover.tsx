"use client";

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "~/lib/utils";
import type { Command } from "~/domain/engine";
import { formatMoney, money, newId } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import type { Category } from "~/components/budget/category-table";
import { Amount } from "~/components/shared";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

const readyToAssign = "ready-to-assign";

// YNAB's move-money popover. A category with money moves it to a destination; an
// overspent category covers the overspending from a source.
export function MoveMoneyPopover({
  view,
  category,
  open,
  onOpenChange,
  run,
  children,
}: {
  view: View;
  category: Category;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: (command: Command) => void;
  children: ReactNode;
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{children}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="move-popover"
          side="bottom"
          align="center"
          sideOffset={8}
          collisionPadding={12}
          onClick={(event) => event.stopPropagation()}
        >
          <MoveForm
            view={view}
            category={category}
            onCancel={() => onOpenChange(false)}
            onMove={(command) => {
              run(command);
              onOpenChange(false);
            }}
          />
          <PopoverPrimitive.Arrow className="move-popover-arrow" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function MoveForm({
  view,
  category,
  onCancel,
  onMove,
}: {
  view: View;
  category: Category;
  onCancel: () => void;
  onMove: (command: Command) => void;
}) {
  const cover = category.available < 0;
  const [amount, setAmount] = useState(
    category.available === 0
      ? ""
      : (Math.abs(category.available) / 100).toFixed(2),
  );
  const [other, setOther] = useState<string | null>(null);
  // Errors sit next to the field that needs fixing.
  const [error, setError] = useState<{
    field: "amount" | "other";
    message: string;
  } | null>(null);
  const amountId = useId();
  const otherId = useId();
  const balance = (id: string) =>
    id === readyToAssign
      ? view.readyToAssign
      : view.categories.find((item) => item.id === id)!.available;
  const name = (id: string) =>
    id === readyToAssign
      ? "Ready to Assign"
      : view.categories.find((item) => item.id === id)!.name;
  const submit = () => {
    if (!other) {
      setError({
        field: "other",
        message: cover
          ? "Choose a category to cover it from."
          : "Choose a category to move it to.",
      });
      return;
    }
    let cents: number;
    try {
      const data = new FormData();
      data.set("amount", amount);
      cents = money(data, "amount");
      if (cents <= 0) throw new Error("Enter an amount greater than zero.");
    } catch (caught) {
      setError({
        field: "amount",
        message:
          caught instanceof Error ? caught.message : "Enter a dollar amount.",
      });
      return;
    }
    // The engine refuses to move money a source doesn't hold; say so before sending.
    const source = cover ? other : category.id;
    if (balance(source) < cents) {
      setError({
        field: cover ? "other" : "amount",
        message: `${name(source)} only has ${formatMoney(Math.max(0, balance(source)))} available.`,
      });
      return;
    }
    const id = newId();
    const month = view.month;
    if (other === readyToAssign)
      onMove({
        type: "assign",
        id,
        categoryId: category.id,
        month,
        amount: cover ? cents : -cents,
      });
    else
      onMove({
        type: "cover",
        id,
        fromCategoryId: cover ? other : category.id,
        toCategoryId: cover ? category.id : other,
        month,
        amount: cents,
      });
  };
  return (
    <form
      className="move-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="move-field">
        <label htmlFor={amountId}>
          {cover ? "Cover overspending" : "Move"}
        </label>
        <Input
          id={amountId}
          inputMode="decimal"
          autoFocus
          aria-invalid={error?.field === "amount" || undefined}
          aria-describedby={
            error?.field === "amount" ? `${amountId}-error` : undefined
          }
          onFocus={(event) => event.currentTarget.select()}
          placeholder="0.00"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            setError(null);
          }}
        />
        {error?.field === "amount" && (
          <FieldError id={`${amountId}-error`} message={error.message} />
        )}
      </div>
      <div className="move-field">
        <label htmlFor={otherId}>{cover ? "From" : "To"}</label>
        <CategoryPicker
          id={otherId}
          invalid={error?.field === "other"}
          view={view}
          excludeId={category.id}
          value={other}
          onChange={(id) => {
            setOther(id);
            setError(null);
          }}
        />
        {error?.field === "other" && (
          <FieldError id={`${otherId}-error`} message={error.message} />
        )}
      </div>
      <div className="move-actions">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          OK
        </Button>
      </div>
    </form>
  );
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p className="move-error" id={id} role="alert">
      <CircleAlertIcon size={14} aria-hidden="true" />
      {message}
    </p>
  );
}

type Option = { id: string; name: string; group: string; available: number };

function CategoryPicker({
  id,
  invalid,
  view,
  excludeId,
  value,
  onChange,
}: {
  id: string;
  invalid: boolean;
  view: View;
  excludeId: string;
  value: string | null;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const options = useMemo<Option[]>(
    () => [
      {
        id: readyToAssign,
        name: "Ready to Assign",
        group: "Inflow",
        available: view.readyToAssign,
      },
      ...view.categories
        .filter((item) => item.id !== excludeId)
        .map(({ id, name, group, available }) => ({
          id,
          name,
          group,
          available,
        })),
    ],
    [view, excludeId],
  );
  const chosen = options.find((option) => option.id === value);
  const visible = options.filter((option) =>
    option.name.toLowerCase().includes(query.toLowerCase()),
  );
  const pick = (option: Option) => {
    onChange(option.id);
    setQuery("");
    setExpanded(false);
  };
  const scrollTo = (index: number) =>
    listRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  let lastGroup = "";
  return (
    <div className="move-picker">
      <div className="move-picker-input">
        <Input
          id={id}
          role="combobox"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={
            expanded && visible[active] ? `${listId}-${active}` : undefined
          }
          autoComplete="off"
          placeholder={chosen ? undefined : "Choose a category"}
          value={expanded ? query : (chosen?.name ?? "")}
          onFocus={() => {
            setExpanded(true);
            setActive(
              Math.max(
                0,
                visible.findIndex((item) => item.id === value),
              ),
            );
          }}
          onClick={() => setExpanded(true)}
          onBlur={() => setExpanded(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setExpanded(true);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setExpanded(true);
              const step = event.key === "ArrowDown" ? 1 : -1;
              const next = Math.min(
                visible.length - 1,
                Math.max(0, active + step),
              );
              setActive(next);
              scrollTo(next);
            } else if (event.key === "Enter" && expanded) {
              event.preventDefault();
              const option = visible[active];
              if (option) pick(option);
            } else if (event.key === "Escape" && expanded) {
              event.preventDefault();
              event.stopPropagation();
              setExpanded(false);
              setQuery("");
            }
          }}
        />
        {chosen && !expanded && (
          <Amount
            value={chosen.available}
            className={cn("move-picker-chosen", tone(chosen.available))}
          />
        )}
      </div>
      {expanded && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="move-picker-list"
          onMouseDown={(event) => event.preventDefault()}
        >
          {visible.length === 0 && (
            <p className="move-picker-empty">No categories match</p>
          )}
          {visible.map((option, index) => {
            const heading =
              option.group !== lastGroup ? (
                <p className="move-picker-group" key={`${option.group}-head`}>
                  {option.group}
                </p>
              ) : null;
            lastGroup = option.group;
            return [
              heading,
              <div
                key={option.id}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.id === value}
                data-active={index === active ? "" : undefined}
                className="move-picker-option"
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option)}
              >
                <span>{option.name}</span>
                <Amount
                  value={option.available}
                  className={tone(option.available)}
                />
              </div>,
            ];
          })}
        </div>
      )}
    </div>
  );
}

function tone(value: number) {
  return value < 0 ? "negative" : value > 0 ? "positive" : "muted";
}
