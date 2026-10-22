"use client";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { moveMonth } from "~/components/budget/format";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { usePortalContainer } from "~/components/ui/tooltip";
import type { ShellData } from "../app-shell/model";
import shellStyles from "../app-shell/shell.module.css";
import { LAST_MONTH } from "./fixture";
import styles from "./batch-4.module.css";

export type MonthPickerLayout = "grid" | "lists";

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
// years ahead.
export function MonthNav({
  month,
  layout,
  onChange,
}: {
  month: ShellData["month"];
  layout: MonthPickerLayout;
  onChange: (month: string) => void;
}) {
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
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
            {month.label}
            <ChevronDownIcon size={12} aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal container={container}>
          <Popover.Content
            className={styles.popover}
            data-layout={layout}
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-label="Choose a month"
            // The picker focuses the month on screen itself.
            onOpenAutoFocus={(event) => event.preventDefault()}
          >
            {layout === "grid" ? (
              <MonthGrid month={month} onPick={pick} />
            ) : (
              <MonthLists month={month} onPick={pick} />
            )}
            <div className={styles.pickerFooter}>
              <Button
                size="sm"
                disabled={month.key === month.current}
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
        disabled={month.key >= LAST_MONTH}
        onClick={() => onChange(moveMonth(month.key, 1))}
      >
        <ChevronRightIcon aria-hidden />
      </IconButton>
    </div>
  );
}

function inRange(key: string, month: ShellData["month"]) {
  return key >= month.start && key <= LAST_MONTH;
}

// Variant A: one year at a time, its twelve months in a grid, like YNAB's
// mobile calendar and the transaction date's calendar.
function MonthGrid({
  month,
  onPick,
}: {
  month: ShellData["month"];
  onPick: (month: string) => void;
}) {
  const firstYear = Number(month.start.slice(0, 4));
  const lastYear = Number(LAST_MONTH.slice(0, 4));
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

// Variant B: every year in one list and the chosen year's months in
// another, side by side, like the date wheels of a native picker laid flat.
function MonthLists({
  month,
  onPick,
}: {
  month: ShellData["month"];
  onPick: (month: string) => void;
}) {
  const firstYear = Number(month.start.slice(0, 4));
  const lastYear = Number(LAST_MONTH.slice(0, 4));
  const years = Array.from(
    { length: lastYear - firstYear + 1 },
    (_, index) => firstYear + index,
  );
  const [year, setYear] = useState(Number(month.key.slice(0, 4)));
  const yearList = useRef<HTMLDivElement>(null);
  const monthList = useRef<HTMLDivElement>(null);

  useEffect(() => {
    yearList.current
      ?.querySelector<HTMLElement>('[aria-checked="true"]')
      ?.scrollIntoView({ block: "center" });
    monthList.current
      ?.querySelector<HTMLButtonElement>('[aria-current="date"]')
      ?.focus();
  }, []);

  // Up and down move between rows; the list's own Tab stop is its chosen row.
  const arrows = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    ];
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <div className={styles.lists}>
      <div
        ref={yearList}
        className={styles.list}
        role="radiogroup"
        aria-label="Year"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            monthList.current
              ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
              ?.focus();
            return;
          }
          arrows(event);
        }}
      >
        {years.map((value) => (
          <button
            type="button"
            key={value}
            role="radio"
            aria-checked={value === year}
            className={styles.listItem}
            data-today={
              value === Number(month.current.slice(0, 4)) || undefined
            }
            tabIndex={value === year ? 0 : -1}
            onClick={() => setYear(value)}
            onFocus={() => setYear(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div
        ref={monthList}
        className={styles.list}
        role="group"
        aria-label={`Months in ${year}`}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            yearList.current
              ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
              ?.focus();
            return;
          }
          arrows(event);
        }}
      >
        {LONG.map((label, index) => {
          const key = keyOf(year, index);
          return (
            <button
              type="button"
              key={key}
              className={styles.listItem}
              aria-current={key === month.key ? "date" : undefined}
              data-today={key === month.current || undefined}
              disabled={!inRange(key, month)}
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
