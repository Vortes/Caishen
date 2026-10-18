"use client";

import { useId, useRef, useState, type Ref } from "react";

import { Amount, Icon } from "~/components/shared";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";

export type TransactionChoiceOption = {
  value: string;
  label: string;
  group?: string;
  amount?: number;
  disabled?: boolean;
};

export function TransactionChoice({
  id,
  label,
  searchLabel,
  value,
  options,
  placeholder,
  disabled,
  invalid,
  describedBy,
  onChange,
  ref,
}: {
  id: string;
  label: string;
  searchLabel: string;
  value: string;
  options: TransactionChoiceOption[];
  placeholder: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const matches = options.filter((option) =>
    `${option.group ?? ""} ${option.label}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const visible = matches.slice(0, 100);
  const active = visible[activeIndex];
  const choose = (option: TransactionChoiceOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };
  const move = (direction: number) => {
    for (let step = 1; step <= visible.length; step++) {
      const index =
        (activeIndex + direction * step + visible.length) % visible.length;
      if (!visible[index]?.disabled) {
        setActiveIndex(index);
        listRef.current
          ?.querySelector<HTMLElement>(`[data-option-index="${index}"]`)
          ?.scrollIntoView({ block: "nearest" });
        break;
      }
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActiveIndex(0);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          id={id}
          type="button"
          variant="outline"
          className="transaction-editor-choice"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setQuery("");
              setActiveIndex(0);
              setOpen(true);
            }
          }}
        >
          <span className={cn(!selected && "is-placeholder")}>
            {selected?.label ?? placeholder}
          </span>
          <Icon name="chevron-down" size={12} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="transaction-choice-popover"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (
            !window.matchMedia("(pointer: coarse)").matches &&
            navigator.maxTouchPoints === 0
          ) {
            searchRef.current?.focus();
          }
        }}
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <Input
          ref={searchRef}
          className="transaction-choice-search"
          aria-label={searchLabel}
          aria-controls={listId}
          aria-activedescendant={
            active ? `${listId}-${activeIndex}` : undefined
          }
          value={query}
          autoComplete="off"
          spellCheck={false}
          placeholder={searchLabel}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              move(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              if (active) choose(active);
            }
          }}
        />
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={`${label} options`}
          className="transaction-choice-list"
        >
          {visible.map((option, index) => (
            <div key={option.value}>
              {option.group && visible[index - 1]?.group !== option.group && (
                <div className="transaction-choice-group">{option.group}</div>
              )}
              <button
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-label={option.label}
                aria-selected={option.value === value}
                aria-disabled={option.disabled}
                disabled={option.disabled}
                tabIndex={-1}
                data-option-index={index}
                data-active={index === activeIndex || undefined}
                className="transaction-choice-option"
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span>
                  {option.value === value && <Icon name="check" size={13} />}
                  {option.label}
                </span>
                {option.amount !== undefined && (
                  <Amount
                    value={option.amount}
                    className={
                      option.amount < 0
                        ? "negative"
                        : option.amount > 0
                          ? "positive"
                          : undefined
                    }
                  />
                )}
              </button>
            </div>
          ))}
          {!visible.length && (
            <p className="transaction-choice-empty">No matches found.</p>
          )}
          {matches.length > visible.length && (
            <p className="transaction-choice-empty">
              Keep typing to narrow {matches.length} matches.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
