"use client";

import { groupAmountInput } from "~/components/budget/amount-input";
import { CheckIcon, CircleAlertIcon, SearchIcon } from "lucide-react";
import { Popover } from "radix-ui";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { newId } from "~/components/budget/format";
import type { Command } from "~/domain/engine";
import { money, type Category } from "./model";
import { Button } from "~/components/ui/button";
import { usePortalContainer } from "~/components/ui/tooltip";
import { usePopoverMotion } from "~/components/ui/popover-motion";
import { POPOVER_GAP } from "~/components/ui/tokens";
import { useShellData } from "./shell-data";
import shell from "./shell.module.css";
import styles from "./move-money.module.css";

export const READY_TO_ASSIGN = "ready-to-assign";

export type MoveMoney = {
  // Sends the move's command with a summary for its confirmation. Returns
  // why it can't be sent right now, or null once it's on its way.
  move: (command: Command, summary: string) => string | null;
  // Called with a cleanup while a move popover is open, so the shell can
  // hold its undo shortcut until it closes.
  holdOpen: () => () => void;
};

const MoveMoneyContext = createContext<MoveMoney | null>(null);

export const MoveMoneyProvider = MoveMoneyContext.Provider;

export function useMoveMoney() {
  const value = useContext(MoveMoneyContext);
  if (!value) throw new Error("useMoveMoney needs a MoveMoneyProvider.");
  return value;
}

// The popover's height with its destination list open, plus the gap and
// collision padding around it.
const TALLEST_FORM = 520;

// YNAB's move-money popover. A category with money moves it somewhere else;
// an overspent one covers the overspending from somewhere else. Ready to
// Assign can be either side.
export function MoveMoneyPopover({
  category,
  align = "center",
  children,
}: {
  category: Category;
  align?: "start" | "center" | "end";
  children: ReactNode;
}) {
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  const motion = usePopoverMotion(open);
  const [side, setSide] = useState<"top" | "bottom">("bottom");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listOpen = useRef(false);
  const cover = category.available < 0;
  const { holdOpen } = useMoveMoney();
  useEffect(() => (open ? holdOpen() : undefined), [open, holdOpen]);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        // The form grows once its list opens, so the side is chosen for its
        // tallest state, when it opens, and kept. Near the bottom of the
        // window it opens upward and grows away from the trigger.
        const rect = triggerRef.current?.getBoundingClientRect();
        if (next && rect) {
          const below = window.innerHeight - rect.bottom;
          setSide(
            below >= TALLEST_FORM || below >= rect.top ? "bottom" : "top",
          );
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild ref={triggerRef}>
        {children}
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          {...motion}
          className={styles.popover}
          side={side}
          align={align}
          sideOffset={POPOVER_GAP}
          collisionPadding={12}
          aria-label={
            cover
              ? `Cover ${category.name}'s overspending`
              : `Move money from ${category.name}`
          }
          // Escape closes an open destination list before the popover.
          onEscapeKeyDown={(event) => {
            if (listOpen.current) event.preventDefault();
          }}
        >
          <MoveForm
            category={category}
            listOpen={listOpen}
            onDone={() => setOpen(false)}
          />
          <Popover.Arrow className={styles.arrow} width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export type Option = {
  id: string;
  name: string;
  group: string;
  available: number;
};

// "$1,234.50", "1234.5", and "12" all read as dollars; returns cents.
export function parseAmount(text: string) {
  const value = Number(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : NaN;
}

function MoveForm({
  category,
  listOpen,
  onDone,
}: {
  category: Category;
  listOpen: { current: boolean };
  onDone: () => void;
}) {
  const { categories, readyToAssign, month } = useShellData();
  const { move } = useMoveMoney();
  const cover = category.available < 0;
  const [amount, setAmount] = useState(
    category.available === 0
      ? ""
      : (Math.abs(category.available) / 100).toFixed(2),
  );
  const [other, setOther] = useState<string | null>(null);
  const [error, setError] = useState<{
    field: "amount" | "other" | "form";
    message: string;
  } | null>(null);
  const amountId = useId();
  const cents = parseAmount(amount);

  // Covering draws only from somewhere with money; moving can go anywhere.
  const options: Option[] = [
    {
      id: READY_TO_ASSIGN,
      name: "Ready to Assign",
      group: "Inflow",
      available: readyToAssign,
    },
    ...categories
      .filter((item) => item.id !== category.id)
      .map(({ id, name, group, available }) => ({
        id,
        name,
        group,
        available,
      })),
  ].filter((option) => !cover || option.available > 0);
  const short = (option: Option) =>
    cover && cents > 0 && option.available < cents;

  const submit = (to = other) => {
    if (!(cents > 0)) {
      setError({ field: "amount", message: "Enter an amount above zero." });
      return;
    }
    if (!cover && cents > category.available) {
      setError({
        field: "amount",
        message: `${category.name} only has ${money(Math.max(0, category.available))} available.`,
      });
      return;
    }
    const chosen = options.find((option) => option.id === to);
    if (!chosen) {
      setError({
        field: "other",
        message: cover
          ? "Choose where to cover it from."
          : "Choose where to move it.",
      });
      return;
    }
    if (short(chosen)) {
      setError({
        field: "other",
        message: `${chosen.name} only has ${money(chosen.available)} available.`,
      });
      return;
    }
    // Ready to Assign on either side
    // is an assignment, negative when money leaves the category; two
    // categories are a cover from one to the other.
    const id = newId();
    const command: Command =
      chosen.id === READY_TO_ASSIGN
        ? {
            type: "assign",
            id,
            categoryId: category.id,
            month: month.key,
            amount: cover ? cents : -cents,
          }
        : {
            type: "cover",
            id,
            fromCategoryId: cover ? chosen.id : category.id,
            toCategoryId: cover ? category.id : chosen.id,
            month: month.key,
            amount: cents,
          };
    const [fromName, toName] = cover
      ? [chosen.name, category.name]
      : [category.name, chosen.name];
    const blocked = move(
      command,
      `Moved ${money(cents)} from ${fromName} to ${toName}`,
    );
    if (blocked) setError({ field: "form", message: blocked });
    else onDone();
  };

  const amountField = (
    <div className={styles.field}>
      <label htmlFor={amountId}>
        {cover ? "Overspending to cover" : "Amount"}
      </label>
      <div
        className={styles.amountInput}
        data-invalid={error?.field === "amount" || undefined}
      >
        <span aria-hidden>$</span>
        <input
          id={amountId}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={amount}
          aria-invalid={error?.field === "amount" || undefined}
          aria-describedby={
            error?.field === "amount" ? `${amountId}-error` : undefined
          }
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            setAmount(groupAmountInput(event.target));
            setError(null);
          }}
        />
      </div>
      {error?.field === "amount" && (
        <FieldError id={`${amountId}-error`} message={error.message} />
      )}
    </div>
  );
  const destination = (
    <Destination
      label={cover ? "From" : "To"}
      options={options}
      value={other}
      short={short}
      error={error?.field === "other" ? error.message : undefined}
      listOpen={listOpen}
      onChange={(id) => {
        setOther(id);
        setError(null);
      }}
    />
  );
  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          {cover ? "Cover" : "Move from"}
        </span>
        <strong className={shell.truncate}>{category.name}</strong>
        <span className={styles.balance} data-state={category.funding}>
          {money(category.available)}
        </span>
      </div>
      {amountField}
      {destination}
      {error?.field === "form" && (
        <div className={styles.formError}>
          <FieldError id={`${amountId}-form-error`} message={error.message} />
        </div>
      )}
      <div className={styles.footer}>
        <Popover.Close asChild>
          <Button size="sm">Cancel</Button>
        </Popover.Close>
        <Button variant="primary" size="sm" type="submit">
          {cover ? "Cover" : "Move"}
        </Button>
      </div>
    </form>
  );
}

export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p className={styles.error} id={id} role="alert">
      <CircleAlertIcon size={13} aria-hidden />
      {message}
    </p>
  );
}

// The destination (or, when covering, the source): a searchable list of Ready
// to Assign and the plan's categories under their groups.
export function Destination({
  label,
  options,
  value,
  short,
  error,
  listOpen,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string | null;
  short: (option: Option) => boolean;
  error?: string;
  listOpen: { current: boolean };
  onChange: (id: string) => void;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  // The list animates open and closed when the pointer does it, and changes
  // at once from the keyboard, so keyboard use never waits on motion.
  const [instant, setInstant] = useState(false);
  const pointer = usePointerModality();
  useEffect(() => {
    listOpen.current = expanded;
  }, [listOpen, expanded]);
  const show = () => {
    if (expanded) return;
    setInstant(!pointer.current);
    setQuery("");
    setActive(null);
    setExpanded(true);
  };
  const hide = () => {
    setInstant(!pointer.current);
    setExpanded(false);
  };

  const visible = options.filter((option) =>
    option.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const pickable = visible.filter((option) => !short(option));
  const current =
    pickable.find((option) => option.id === active) ?? pickable[0];
  const chosen = options.find((option) => option.id === value);

  const pick = (option: Option) => {
    if (short(option)) return;
    onChange(option.id);
    hide();
  };
  const step = (by: number) => {
    const index = current ? pickable.indexOf(current) : -1;
    const next =
      pickable[Math.min(pickable.length - 1, Math.max(0, index + by))];
    if (!next) return;
    setActive(next.id);
    listRef.current
      ?.querySelector(`[data-id="${CSS.escape(next.id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  let lastGroup = "";
  return (
    <div className={styles.field}>
      {/* While the list is open, the label closes it like any click outside
          the list. Left alone, the press would blur the field and close the
          list, then the label's click would focus the field and reopen it. */}
      <label
        htmlFor={id}
        onMouseDown={(event) => {
          if (expanded) event.preventDefault();
        }}
        onClick={(event) => {
          if (!expanded) return;
          event.preventDefault();
          hide();
        }}
      >
        {label}
      </label>
      <div
        className={styles.search}
        data-invalid={error ? "" : undefined}
        data-expanded={expanded || undefined}
      >
        {expanded && (
          <SearchIcon size={14} className={styles.searchIcon} aria-hidden />
        )}
        <input
          id={id}
          role="combobox"
          autoComplete="off"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={
            expanded && current ? `${listId}-${current.id}` : undefined
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          placeholder={expanded ? "Find a category" : "Choose a category"}
          value={expanded ? query : (chosen?.name ?? "")}
          readOnly={!expanded}
          onFocus={show}
          onClick={show}
          onBlur={hide}
          onChange={(event) => {
            show();
            setQuery(event.target.value);
            setActive(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!expanded) show();
              else step(event.key === "ArrowDown" ? 1 : -1);
            } else if (event.key === "Enter" && expanded) {
              event.preventDefault();
              if (current) pick(current);
            } else if (event.key === "Escape" && expanded) {
              hide();
            }
          }}
        />
        {chosen && !expanded && (
          <span
            className={styles.optionAmount}
            data-tone={tone(chosen.available)}
          >
            {money(chosen.available)}
          </span>
        )}
      </div>
      {error && <FieldError id={`${id}-error`} message={error} />}
      <div
        className={styles.listFrame}
        data-open={expanded || undefined}
        data-instant={instant || undefined}
        aria-hidden={!expanded || undefined}
        inert={!expanded}
      >
        <div className={styles.listClip}>
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className={styles.list}
            // Keeps focus in the search field while the pointer picks.
            onMouseDown={(event) => event.preventDefault()}
          >
            {visible.length === 0 && (
              <p className={styles.empty}>No categories match</p>
            )}
            {visible.map((option) => {
              const heading =
                option.group !== lastGroup ? (
                  <p
                    key={`group-${option.group}`}
                    className={styles.group}
                    aria-hidden
                  >
                    {option.group}
                  </p>
                ) : null;
              lastGroup = option.group;
              const disabled = short(option);
              return [
                heading,
                <div
                  key={option.id}
                  id={`${listId}-${option.id}`}
                  data-id={option.id}
                  role="option"
                  aria-selected={option.id === value}
                  aria-disabled={disabled || undefined}
                  data-active={option.id === current?.id || undefined}
                  className={styles.option}
                  title={
                    disabled
                      ? `Only ${money(option.available)} available`
                      : undefined
                  }
                  onMouseEnter={() => !disabled && setActive(option.id)}
                  onClick={() => pick(option)}
                >
                  <span className={styles.check} aria-hidden>
                    {option.id === value && (
                      <CheckIcon size={13} strokeWidth={2.5} />
                    )}
                  </span>
                  <span className={shell.truncate}>{option.name}</span>
                  <span
                    className={styles.optionAmount}
                    data-tone={tone(option.available)}
                  >
                    {money(option.available)}
                  </span>
                </div>,
              ];
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Whether the latest input was a pointer rather than the keyboard.
function usePointerModality() {
  const pointer = useRef(false);
  useEffect(() => {
    const onPointer = () => (pointer.current = true);
    const onKey = () => (pointer.current = false);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  return pointer;
}

function tone(value: number) {
  return value < 0 ? "negative" : value > 0 ? "positive" : "zero";
}
