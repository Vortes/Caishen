"use client";

import { CheckIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
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
  // Moves on to the next field after a click or Enter takes an option.
  // Tab already moves on by itself.
  onPicked?: (value: string) => void;
};

// The list under a field. Focus stays in the field, which moves the active
// option, so the list itself is never tabbed into.
function OptionList({
  open,
  onClose,
  listId,
  label,
  anchor,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  listId: string;
  label: string;
  anchor: ReactNode;
  // Room for a long name beside its balance.
  wide?: boolean;
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
          data-wide={wide || undefined}
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
  // Absent for a suggestion, which is never the field's current choice, so
  // its label lines up with the typed text instead of a check column.
  selected?: boolean;
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
      aria-selected={selected ?? false}
      aria-disabled={disabled ? true : undefined}
      data-active={active || undefined}
      className={styles.option}
      data-suggestion={selected === undefined || undefined}
      onMouseMove={disabled ? undefined : onActivate}
      onClick={disabled ? undefined : onPick}
    >
      {selected !== undefined && (
        <span className={styles.check} aria-hidden>
          {selected && <CheckIcon size={13} strokeWidth={2.5} />}
        </span>
      )}
      <span className={`${shell.truncate} ${styles.optionLabel}`}>{label}</span>
      {amount !== undefined && (
        <span className={styles.optionAmount} data-tone={tone(amount)}>
          {money(amount)}
        </span>
      )}
    </div>
  );
}

// Stands for the Add row in a field's list, never for an option.
const CREATE = "\u0000create";

// Picks one option by typing to filter, like the move-money destination.
// Arriving in the field opens its list, so typing filters it; Enter or Tab
// takes the highlighted match, and Escape closes only the list. With
// onCreate, a name that matches no option exactly can be added: its row
// leads the list, and Enter takes it once nothing else matches.
export function ChoiceField({
  id,
  label,
  value,
  options,
  placeholder,
  describedBy,
  invalid,
  disabled,
  readOnly,
  inputRef,
  onChange,
  onPicked,
  onCreate,
  wide = true,
}: FieldProps & {
  value: string;
  options: ChoiceOption[];
  placeholder: string;
  onChange: (value: string) => void;
  // Adds an option named for the typed text, like YNAB's Create Category.
  onCreate?: { noun: string; create: (name: string) => void };
  wide?: boolean;
}) {
  const listId = `${id}-list`;
  const listRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  // The field's text while the list is open: the chosen name until typing
  // replaces it, which is when it starts filtering.
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const selected = options.find((option) => option.value === value);
  const search = typed ? query.trim().toLowerCase() : "";
  const visible = options.filter((option) =>
    `${option.group ?? ""} ${option.label}`.toLowerCase().includes(search),
  );
  const creatable =
    onCreate &&
    search &&
    !options.some((option) => option.label.toLowerCase() === search)
      ? { value: CREATE, label: query.trim() }
      : undefined;
  const pickable = [
    ...(creatable ? [creatable] : []),
    ...visible.filter((option) => !option.disabled),
  ];
  const current =
    pickable.find((option) => option.value === active) ??
    (search ? undefined : pickable.find((option) => option.value === value)) ??
    pickable.find((option) => option !== creatable) ??
    creatable;
  const optionId = (option: ChoiceOption) =>
    option === creatable
      ? `${listId}-create`
      : `${listId}-${visible.indexOf(option)}`;
  const open = expanded && !disabled && !readOnly;

  const show = (text?: string) => {
    setQuery(text ?? selected?.label ?? "");
    setTyped(text !== undefined);
    setActive(null);
    setExpanded(true);
  };
  const pick = (option: ChoiceOption, advance = true) => {
    if (option.disabled) return;
    if (option === creatable) {
      setExpanded(false);
      setQuery("");
      onCreate?.create(option.label);
      return;
    }
    onChange(option.value);
    setExpanded(false);
    setQuery("");
    if (advance) onPicked?.(option.value);
  };
  const step = (by: number) => {
    const index = current ? pickable.indexOf(current) : -1;
    const next =
      pickable[Math.min(pickable.length - 1, Math.max(0, index + by))];
    if (!next) return;
    setActive(next.value);
    listRef.current
      ?.querySelector(`[id="${optionId(next)}"]`)
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
    } else if (
      event.key === "Tab" &&
      open &&
      search &&
      current &&
      current !== creatable
    ) {
      pick(current, false);
    }
  };

  let lastGroup: string | undefined;
  return (
    <OptionList
      open={open}
      onClose={() => setExpanded(false)}
      listId={listId}
      label={label}
      wide={wide}
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
              open && current ? optionId(current) : undefined
            }
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            value={open ? query : (selected?.label ?? "")}
            onFocus={(event) => {
              if (!open) show();
              event.currentTarget.select();
            }}
            onClick={() => {
              if (!open) show();
            }}
            onBlur={() => setExpanded(false)}
            onChange={(event) => show(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <ChevronDownIcon size={12} className={styles.chevron} aria-hidden />
        </div>
      }
    >
      <div ref={listRef} className={styles.listScroll}>
        {creatable && onCreate && (
          <div
            id={optionId(creatable)}
            role="option"
            aria-selected={false}
            data-active={creatable === current || undefined}
            className={styles.option}
            data-create
            onMouseMove={() => setActive(CREATE)}
            onClick={() => pick(creatable)}
          >
            <span className={styles.check} aria-hidden>
              <PlusIcon size={13} strokeWidth={2.5} />
            </span>
            <span className={`${shell.truncate} ${styles.optionLabel}`}>
              Add {onCreate.noun} “{creatable.label}”
            </span>
          </div>
        )}
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

// Free text with the budget's earlier payees as suggestions, most recent
// first. Arriving in the field opens them before anything is typed.
// Suggestions are only taken with the arrow keys or a click, so Enter on
// typed text still saves the form.
export function PayeeField({
  id,
  label,
  value,
  payees,
  destinations = [],
  selectedDestination,
  placeholder = "Who you paid or who paid you",
  describedBy,
  invalid,
  disabled,
  readOnly,
  inputRef,
  onChange,
  onPicked,
  onDestination,
}: FieldProps & {
  value: string;
  payees: string[];
  destinations?: ChoiceOption[];
  selectedDestination?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onDestination?: (value: string) => void;
}) {
  const listId = `${id}-list`;
  const listRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const search = query.trim().toLowerCase();
  const transfers = destinations.filter((item) =>
    item.label.toLowerCase().includes(search),
  );
  const suggestions = payees
    .filter((payee) => payee.toLowerCase().includes(search))
    .slice(0, 8);
  const options = [
    ...transfers.map((item) => ({ ...item, group: "Payments and Transfers" })),
    ...suggestions.map((payee) => ({
      value: `payee:${payee}`,
      label: payee,
      group: "Payees",
    })),
  ];
  const open = expanded && options.length > 0 && !disabled && !readOnly;
  const current = options[active];
  const pick = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (index < transfers.length) onDestination?.(option.value);
    else onChange(option.label);
    setExpanded(false);
    setActive(-1);
    onPicked?.(option.value);
  };
  const show = () => {
    setQuery("");
    setActive(-1);
    setExpanded(true);
  };
  return (
    <OptionList
      open={open}
      onClose={() => setExpanded(false)}
      listId={listId}
      label={`${label} suggestions`}
      wide
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
              open && current ? `${listId}-${active}` : undefined
            }
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            readOnly={readOnly}
            placeholder={placeholder}
            value={value}
            onFocus={(event) => {
              show();
              event.currentTarget.select();
            }}
            onClick={() => {
              if (!expanded) show();
            }}
            onBlur={() => setExpanded(false)}
            onChange={(event) => {
              onChange(event.target.value);
              setQuery(event.target.value);
              setExpanded(true);
              setActive(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (!options.length) return;
                event.preventDefault();
                setExpanded(true);
                const next = open
                  ? Math.min(
                      options.length - 1,
                      Math.max(
                        0,
                        active + (event.key === "ArrowDown" ? 1 : -1),
                      ),
                    )
                  : 0;
                setActive(next);
                listRef.current
                  ?.querySelector(`[id="${listId}-${next}"]`)
                  ?.scrollIntoView({ block: "nearest" });
              } else if (event.key === "Enter" && open && current) {
                event.preventDefault();
                pick(active);
              } else if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setExpanded(false);
              }
            }}
          />
          <ChevronDownIcon size={12} className={styles.chevron} aria-hidden />
        </div>
      }
    >
      <div ref={listRef} className={styles.listScroll}>
        {options.map((option, index) => (
          <div key={option.value}>
            {option.group !== options[index - 1]?.group && (
              <p className={styles.group}>{option.group}</p>
            )}
            <Option
              id={`${listId}-${index}`}
              label={option.label}
              selected={
                option.value === selectedDestination ||
                (index >= transfers.length && option.label === value)
              }
              active={index === active}
              onActivate={() => setActive(index)}
              onPick={() => pick(index)}
            />
          </div>
        ))}
      </div>
    </OptionList>
  );
}

function tone(value: number) {
  return value < 0 ? "negative" : value > 0 ? "positive" : "zero";
}
