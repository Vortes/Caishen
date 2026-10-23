"use client";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { Popover } from "radix-ui";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { moveMonth } from "~/components/budget/format";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { usePortalContainer } from "~/components/ui/tooltip";
import type { ShellData } from "./model";
import shellStyles from "./shell.module.css";
import styles from "./month-picker.module.css";

const SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const keyOf = (year: number, index: number) =>
  `${year}-${String(index + 1).padStart(2, "0")}`;

// The header's month: arrows step a month at a time, as before; the label
// opens a dropdown that jumps to any month from the budget's first to five
// years ahead. Away from the current month, Today brings it back.
export function MonthNav({
  month,
  onChange,
}: {
  month: ShellData["month"];
  onChange: (month: string) => void;
}) {
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  const away = month.key !== month.current;
  const pick = (next: string) => {
    setOpen(false);
    onChange(next);
  };
  return (
    <div className={shellStyles.monthNav}>
      <IconButton
        label="Previous month"
        disabled={!month.canGoBack}
        onClick={() => onChange(moveMonth(month.key, -1))}
      >
        <ChevronLeftIcon aria-hidden />
      </IconButton>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={`${shellStyles.monthButton} ${styles.monthTrigger}`}
            aria-label={`${month.label}, choose a month`}
          >
            <MonthLabel year={month.key.slice(0, 4)}>{month.label}</MonthLabel>
          </button>
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Content
            className={styles.popover}
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-label="Choose a month"
            // The picker focuses the month on screen itself.
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            <MonthGrid month={month} onPick={pick} />
            <div className={styles.pickerFooter}>
              <Button
                size="sm"
                disabled={!away}
                onClick={() => pick(month.current)}
              >
                This month
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <IconButton
        label="Next month"
        disabled={month.key >= lastMonth(month)}
        onClick={() => onChange(moveMonth(month.key, 1))}
      >
        <ChevronRightIcon aria-hidden />
      </IconButton>
      <div
        className={styles.today}
        data-shown={away || undefined}
        inert={!away}
      >
        <Button
          variant="quiet"
          size="sm"
          onClick={() => onChange(month.current)}
        >
          Today
        </Button>
      </div>
    </div>
  );
}

// The label is as wide as the widest month name in that year, so the arrows
// on either side never move as the month changes. Every name sits hidden in
// the same grid cell to size it in the label's own font; they are drawn from
// CSS so they never show up as text on the page.
export function MonthLabel({
  year,
  children,
}: {
  year: string;
  children: ReactNode;
}) {
  return (
    <span className={styles.labelSlot}>
      {LONG.map((name) => (
        <span
          key={name}
          className={styles.labelGhost}
          data-text={`${name} ${year}`}
          aria-hidden
        >
          <ChevronDownIcon size={12} />
        </span>
      ))}
      <span className={styles.label}>
        {children}
        <ChevronDownIcon size={12} aria-hidden />
      </span>
    </span>
  );
}

function lastMonth(month: ShellData["month"]) {
  const future = moveMonth(month.current, 60);
  return month.key > future ? month.key : future;
}

function inRange(key: string, month: ShellData["month"]) {
  return key >= month.start && key <= lastMonth(month);
}

// One year at a time, with arrow-key navigation between its months.
function MonthGrid({
  month,
  onPick,
}: {
  month: ShellData["month"];
  onPick: (month: string) => void;
}) {
  const firstYear = Number(month.start.slice(0, 4));
  const lastYear = Number(lastMonth(month).slice(0, 4));
  const [year, setYear] = useState(Number(month.key.slice(0, 4)));
  // The month with focus; arrows move it across years.
  const [focus, setFocus] = useState(month.key);
  const grid = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    grid.current
      ?.querySelector<HTMLButtonElement>(`[data-month="${month.key}"]`)
      ?.focus();
  }, [month.key]);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current
      ?.querySelector<HTMLButtonElement>(`[data-month="${focus}"]`)
      ?.focus();
  }, [focus, year]);

  const moveFocus = (next: string) => {
    if (!inRange(next, month)) return;
    moved.current = true;
    setFocus(next);
    setYear(Number(next.slice(0, 4)));
  };
  const firstOpen = SHORT.map((_, index) => keyOf(year, index)).find((key) =>
    inRange(key, month),
  );
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -3,
      ArrowDown: 3,
      PageUp: -12,
      PageDown: 12,
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    moveFocus(moveMonth(focus, step));
  };

  return (
    <div className={styles.monthGrid}>
      <div className={styles.yearRow}>
        <IconButton
          label="Previous year"
          disabled={year <= firstYear}
          onClick={() => setYear(year - 1)}
        >
          <ChevronLeftIcon aria-hidden />
        </IconButton>
        <span className={styles.yearLabel} aria-live="polite">
          {year}
        </span>
        <IconButton
          label="Next year"
          disabled={year >= lastYear}
          onClick={() => setYear(year + 1)}
        >
          <ChevronRightIcon aria-hidden />
        </IconButton>
      </div>
      <div
        ref={grid}
        className={styles.months}
        role="group"
        aria-label={`Months in ${year}`}
        onKeyDown={onKeyDown}
      >
        {SHORT.map((label, index) => {
          const key = keyOf(year, index);
          // One Tab stop: the focused month, or this year's first open one.
          const tabbable = focus.startsWith(`${year}-`)
            ? key === focus
            : key === firstOpen;
          return (
            <button
              type="button"
              key={key}
              data-month={key}
              className={styles.monthCell}
              aria-label={`${LONG[index]} ${year}`}
              aria-current={key === month.key ? "date" : undefined}
              data-today={key === month.current || undefined}
              disabled={!inRange(key, month)}
              tabIndex={tabbable ? 0 : -1}
              onFocus={() => setFocus(key)}
              onClick={() => onPick(key)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
