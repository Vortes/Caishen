"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Popover } from "radix-ui";
import {
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { usePortalContainer } from "~/components/ui/tooltip";
import { money } from "./model";
import shell from "./shell.module.css";
import styles from "./transaction-entry.module.css";

export type ChoiceOption = {
  value: string;
  label: string;
  group?: string;
  // A balance shown beside the option, in cents.
  amount?: number;
  disabled?: boolean;
};

type FieldProps = {
  id: string;
  label: string;
  describedBy?: string;
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  inputRef?: Ref<HTMLInputElement>;
};

// The list under a field. Focus stays in the field, which moves the active
// option, so the list itself is never tabbed into.
function OptionList({
  open,
  onClose,
  listId,
  label,
  anchor,
  children,
}: {
  open: boolean;
  onClose: () => void;
  listId: string;
  label: string;
  anchor: ReactNode;
  children: ReactNode;
}) {
  const container = usePortalContainer();
  const anchorRef = useRef<HTMLDivElement>(null);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Popover.Anchor asChild>
        <div ref={anchorRef}>{anchor}</div>
      </Popover.Anchor>
      <Popover.Portal container={container}>
        <Popover.Content
          id={listId}
          role="listbox"
          aria-label={label}
          className={styles.listPopover}
          align="start"
          sideOffset={4}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // The field closes the list on Escape, so the editor around it
          // stays open.
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node))
              event.preventDefault();
          }}
          // Keeps focus in the field while the pointer picks.
          onMouseDown={(event) => event.preventDefault()}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Option({
  id,
  label,
  selected,
  active,
  disabled,
  amount,
  onActivate,
  onPick,
}: {
  id: string;
  label: string;
  selected: boolean;
  active: boolean;
  disabled?: boolean;
  amount?: number;
  onActivate: () => void;
  onPick: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={disabled ? true : undefined}
      data-active={active || undefined}
      className={styles.option}
      onMouseMove={disabled ? undefined : onActivate}
      onClick={disabled ? undefined : onPick}
    >
      <span className={styles.check} aria-hidden>
        {selected && <CheckIcon size={13} strokeWidth={2.5} />}
      </span>
      <span className={shell.truncate}>{label}</span>
      {amount !== undefined && (
        <span className={styles.optionAmount} data-tone={tone(amount)}>
          {money(amount)}
        </span>
      )}
    </div>
  );
}

// Picks one option by typing to filter, like the move-money destination.
// Tabbing in selects the current choice so typing replaces it; Enter or Tab
// takes the highlighted match, and Escape closes only the list.
export function ChoiceField({
  id,
  label,
  value,
  options,
  placeholder,
  searchPlaceholder,
  describedBy,
  invalid,
  disabled,
  readOnly,
  inputRef,
  onChange,
}: FieldProps & {
  value: string;
  options: ChoiceOption[];
  placeholder: string;
  searchPlaceholder: string;
  onChange: (value: string) => void;
}) {
  const listId = `${id}-list`;
  const listRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const selected = options.find((option) => option.value === value);
  const search = query.trim().toLowerCase();
  const visible = options.filter((option) =>
    `${option.group ?? ""} ${option.label}`.toLowerCase().includes(search),
  );
  const pickable = visible.filter((option) => !option.disabled);
  const current =
    pickable.find((option) => option.value === active) ??
    (search ? undefined : pickable.find((option) => option.value === value)) ??
    pickable[0];
  const open = expanded && !disabled && !readOnly;

  const show = (text = "") => {
    setQuery(text);
    setActive(null);
    setExpanded(true);
  };
  const pick = (option: ChoiceOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setExpanded(false);
    setQuery("");
  };
  const step = (by: number) => {
    const index = current ? pickable.indexOf(current) : -1;
    const next =
      pickable[Math.min(pickable.length - 1, Math.max(0, index + by))];
    if (!next) return;
    setActive(next.value);
    listRef.current
      ?.querySelector(`[id="${listId}-${visible.indexOf(next)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show();
      else step(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (current) pick(current);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    } else if (event.key === "Tab" && open && search && current) {
      pick(current);
    }
  };

  let lastGroup: string | undefined;
  return (
    <OptionList
      open={open}
      onClose={() => setExpanded(false)}
      listId={listId}
      label={label}
      anchor={
        <div
          className={styles.well}
          data-invalid={invalid ? true : undefined}
          data-disabled={disabled ? true : undefined}
        >
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            className={styles.input}
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={
              open && current
                ? `${listId}-${visible.indexOf(current)}`
                : undefined
            }
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={open ? searchPlaceholder : placeholder}
            value={open ? query : (selected?.label ?? "")}
            onFocus={(event) => event.currentTarget.select()}
            onClick={() => {
              if (!open) show();
            }}
            onBlur={() => setExpanded(false)}
            onChange={(event) => show(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {!open && selected?.amount !== undefined && (
            <span
              className={styles.optionAmount}
              data-tone={tone(selected.amount)}
            >
              {money(selected.amount)}
            </span>
          )}
          <ChevronDownIcon size={12} className={styles.chevron} aria-hidden />
        </div>
      }
    >
      <div ref={listRef} className={styles.listScroll}>
        {visible.length === 0 && (
          <p className={styles.empty}>No matches for “{query.trim()}”</p>
        )}
        {visible.map((option, index) => {
          const heading =
            option.group && option.group !== lastGroup ? (
              <p
                key={`group-${option.group}`}
                className={styles.group}
                aria-hidden
              >
                {option.group}
              </p>
            ) : null;
          lastGroup = option.group;
          return [
            heading,
            <Option
              key={option.value}
              id={`${listId}-${index}`}
              label={option.label}
              selected={option.value === value}
              active={option === current}
              disabled={option.disabled}
              amount={option.amount}
              onActivate={() => setActive(option.value)}
              onPick={() => pick(option)}
            />,
          ];
        })}
      </div>
    </OptionList>
  );
}

// Free text with the budget's earlier payees as suggestions. Suggestions are
// only taken with the arrow keys or a click, so Enter still saves the form.
export function PayeeField({
  id,
  label,
  value,
  payees,
  describedBy,
  invalid,
  disabled,
  readOnly,
  inputRef,
  onChange,
}: FieldProps & {
  value: string;
  payees: string[];
  onChange: (value: string) => void;
}) {
  const listId = `${id}-list`;
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(-1);
  const search = value.trim().toLowerCase();
  const suggestions = search
    ? payees
        .filter(
          (payee) =>
            payee.toLowerCase().includes(search) &&
            payee.toLowerCase() !== search,
        )
        .sort(
          (a, b) =>
            Number(!a.toLowerCase().startsWith(search)) -
            Number(!b.toLowerCase().startsWith(search)),
        )
        .slice(0, 8)
    : [];
  const open = expanded && suggestions.length > 0 && !disabled && !readOnly;
  const pick = (payee: string) => {
    onChange(payee);
    setExpanded(false);
    setActive(-1);
  };
  return (
    <OptionList
      open={open}
      onClose={() => setExpanded(false)}
      listId={listId}
      label={`${label} suggestions`}
      anchor={
        <div className={styles.well} data-invalid={invalid ? true : undefined}>
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            className={styles.input}
            autoComplete="off"
            spellCheck={false}
            maxLength={240}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={
              open && active >= 0 ? `${listId}-${active}` : undefined
            }
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            readOnly={readOnly}
            placeholder="Who you paid or who paid you"
            value={value}
            onBlur={() => setExpanded(false)}
            onChange={(event) => {
              onChange(event.target.value);
              setExpanded(true);
              setActive(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (!suggestions.length) return;
                event.preventDefault();
                setExpanded(true);
                const by = event.key === "ArrowDown" ? 1 : -1;
                setActive((index) =>
                  open
                    ? Math.min(suggestions.length - 1, Math.max(0, index + by))
                    : 0,
                );
              } else if (event.key === "Enter" && open && active >= 0) {
                event.preventDefault();
                pick(suggestions[active]!);
              } else if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setExpanded(false);
              }
            }}
          />
        </div>
      }
    >
      <div className={styles.listScroll}>
        {suggestions.map((payee, index) => (
          <Option
            key={payee}
            id={`${listId}-${index}`}
            label={payee}
            selected={false}
            active={index === active}
            onActivate={() => setActive(index)}
            onPick={() => pick(payee)}
          />
        ))}
      </div>
    </OptionList>
  );
}

function tone(value: number) {
  return value < 0 ? "negative" : value > 0 ? "positive" : "zero";
}
