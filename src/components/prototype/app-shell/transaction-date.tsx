"use client";

import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Popover } from "radix-ui";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { IconButton } from "~/components/ui/icon-button";
import { usePortalContainer } from "~/components/ui/tooltip";
import styles from "./transaction-entry.module.css";

// What the form can ask of the date field once it's on screen.
export type DateFieldHandle = {
  // Moves focus to the chosen day, now or as soon as the calendar mounts.
  focusCalendar: () => void;
};

const weekdays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const weekdayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const pad = (value: number) => String(value).padStart(2, "0");
const iso = (year: number, month: number, day: number) =>
  `${year}-${pad(month)}-${pad(day)}`;

function parts(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

function daysIn(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parts(value);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month);
}

// Moves a date by whole days, staying on the calendar.
function addDays(date: string, by: number) {
  const { year, month, day } = parts(date);
  const next = new Date(Date.UTC(year, month - 1, day + by));
  return iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

// The same day in another month, or that month's last day.
function addMonths(date: string, by: number) {
  const { year, month, day } = parts(date);
  const index = year * 12 + month - 1 + by;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return iso(nextYear, nextMonth, Math.min(day, daysIn(nextYear, nextMonth)));
}

function weekday(date: string) {
  const { year, month, day } = parts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// Shown as MM/DD/YYYY, like the rest of a US register.
export function formatDate(date: string) {
  if (!isDate(date)) return date;
  const { year, month, day } = parts(date);
  return `${pad(month)}/${pad(day)}/${year}`;
}

// A typed date. While typing only complete forms count, so the text isn't
// rewritten mid-word; on blur a missing or two-digit year is filled in.
function parseDate(text: string, today: string, finished: boolean) {
  const value = text.trim();
  if (isDate(value)) return value;
  const match = finished
    ? /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(value)
    : /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (!match) return null;
  const year = !match[3]
    ? parts(today).year
    : match[3].length === 2
      ? 2000 + Number(match[3])
      : Number(match[3]);
  const date = iso(year, Number(match[1]), Number(match[2]));
  return isDate(date) ? date : null;
}

function monthLabel(date: string) {
  const { year, month } = parts(date);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function dayLabel(date: string) {
  const { year, month, day } = parts(date);
  return `${weekdayNames[weekday(date)]}, ${new Date(
    Date.UTC(year, month - 1, day),
  ).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })}`;
}

// The transaction date: typed as text, or picked from a calendar that opens
// under the field. The calendar is a dialog; arrow keys move the day, Page
// Up and Page Down the month, and Escape closes only the calendar.
export function DateField({
  id,
  label,
  value,
  min,
  today,
  open,
  describedBy,
  invalid,
  readOnly,
  handle,
  inputRef,
  onOpenChange,
  onChange,
  onPicked,
  onAdvance,
}: {
  id: string;
  label: string;
  value: string;
  // The first day the account can hold a transaction.
  min: string;
  today: string;
  open: boolean;
  describedBy?: string;
  invalid?: boolean;
  readOnly?: boolean;
  handle?: Ref<DateFieldHandle>;
  inputRef?: (element: HTMLInputElement | null) => void;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  // A day was picked from the calendar.
  onPicked: () => void;
  // Tab out of the calendar moves on to the next field.
  onAdvance: () => void;
}) {
  const container = usePortalContainer();
  const anchorRef = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  // Where focus was when the calendar was asked to take it, until it mounts.
  const pending = useRef<Element | null>(null);
  const calendarId = `${id}-calendar`;
  const chosen = isDate(value) ? value : null;
  // The day the keyboard is on, which also decides the month shown.
  const [focused, setFocused] = useState(chosen ?? today);
  const [moved, setMoved] = useState(0);
  const shown = !readOnly && open;

  // Opening, or typing a full date, shows that date's month.
  useEffect(() => {
    if (shown && chosen) setFocused(chosen);
  }, [shown, chosen]);

  const focusDay = () => {
    const day = grid.current?.querySelector<HTMLElement>('[tabindex="0"]');
    if (!day) return false;
    day.focus({ preventScroll: true });
    return true;
  };
  useImperativeHandle(handle, () => ({
    focusCalendar: () => {
      if (!focusDay()) pending.current = document.activeElement;
    },
  }));
  // A keyboard move puts focus on the new day once it renders.
  useEffect(() => {
    if (moved) focusDay();
  }, [moved]);

  // Focus goes back to the field, or on touch to the calendar button, so a
  // software keyboard doesn't open by itself.
  const returnFocus = () => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    (fine ? input.current : trigger.current)?.focus({ preventScroll: true });
  };
  const close = () => {
    onOpenChange(false);
    returnFocus();
  };
  const pick = (date: string) => {
    if (date < min) return;
    onChange(date);
    onOpenChange(false);
    if (window.matchMedia("(pointer: fine)").matches) onPicked();
    else trigger.current?.focus({ preventScroll: true });
  };
  const move = (date: string) => {
    setFocused(date);
    setMoved((count) => count + 1);
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const by: Record<string, () => string> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => addDays(focused, -weekday(focused)),
      End: () => addDays(focused, 6 - weekday(focused)),
      PageUp: () => addMonths(focused, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, event.shiftKey ? 12 : 1),
    };
    const next = by[event.key];
    if (!next) return;
    event.preventDefault();
    move(next());
  };

  // The calendar sits in a portal, so Tab out of it goes back to the form:
  // forward to the next field, backward to the date text.
  const onContentKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const stops = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled):not([tabindex="-1"])',
      ),
    ];
    const index = stops.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      onOpenChange(false);
      input.current?.focus();
    } else if (!event.shiftKey && index === stops.length - 1) {
      event.preventDefault();
      onOpenChange(false);
      onAdvance();
    }
  };

  const { year, month } = parts(focused);
  const first = iso(year, month, 1);
  const lead = weekday(first);
  const count = daysIn(year, month);
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: count }, (_, index) => iso(year, month, index + 1)),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7),
  );
  const earliest = addDays(first, -1) < min;
  const headingId = `${calendarId}-heading`;

  return (
    <Popover.Root
      open={shown}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <Popover.Anchor asChild>
        <div
          ref={anchorRef}
          className={styles.well}
          data-invalid={invalid ? true : undefined}
          data-date
        >
          <input
            ref={(element) => {
              input.current = element;
              inputRef?.(element);
            }}
            id={id}
            name="date"
            role="combobox"
            className={styles.input}
            autoComplete="off"
            spellCheck={false}
            placeholder="MM/DD/YYYY"
            aria-haspopup="dialog"
            aria-expanded={shown}
            aria-controls={shown ? calendarId : undefined}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            readOnly={readOnly}
            value={formatDate(value)}
            onFocus={(event) => event.currentTarget.select()}
            onClick={() => onOpenChange(true)}
            onChange={(event) => {
              const text = event.target.value;
              onChange(parseDate(text, today, false) ?? text);
            }}
            onBlur={(event) => {
              const date = parseDate(event.target.value, today, true);
              if (date && date !== value) onChange(date);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                // Arrow Down opens the calendar, or moves into it.
                event.preventDefault();
                if (shown) focusDay();
                else {
                  pending.current = document.activeElement;
                  onOpenChange(true);
                }
              } else if (event.key === "Escape" && shown) {
                event.preventDefault();
                event.stopPropagation();
                onOpenChange(false);
              } else if (event.key === "Enter" && shown) {
                // Enter takes the typed date and closes the calendar; it
                // never saves while the calendar is open.
                event.preventDefault();
                const date = parseDate(event.currentTarget.value, today, true);
                if (date) onChange(date);
                onOpenChange(false);
              }
            }}
          />
          {/* A mouse or keyboard opens the calendar from the field itself;
              touch gets a button, so it can open without the keyboard. */}
          <CalendarIcon size={13} className={styles.dateIcon} aria-hidden />
          <span className={styles.dateTrigger}>
            <IconButton
              ref={trigger}
              size="sm"
              label="Choose date"
              aria-haspopup="dialog"
              aria-expanded={shown}
              aria-controls={shown ? calendarId : undefined}
              disabled={readOnly}
              onClick={() => {
                if (shown) {
                  onOpenChange(false);
                  return;
                }
                pending.current = document.activeElement;
                onOpenChange(true);
              }}
            >
              <CalendarIcon aria-hidden />
            </IconButton>
          </span>
        </div>
      </Popover.Anchor>
      <Popover.Portal container={container}>
        <Popover.Content
          id={calendarId}
          aria-label={`${label} calendar`}
          className={styles.calendar}
          align="start"
          sideOffset={4}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const from = pending.current;
            pending.current = null;
            if (!from) return;
            // Focus that moved on to another field in the meantime stays
            // there, and the calendar gets out of its way.
            const active = document.activeElement;
            if (active === from || active === document.body) focusDay();
            else if (active !== input.current) onOpenChange(false);
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
          // Escape is handled on the calendar itself, so the editor around
          // it stays open until the next press.
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node))
              event.preventDefault();
          }}
          onKeyDown={onContentKeyDown}
        >
          <div className={styles.calendarHeader}>
            <IconButton
              size="sm"
              label="Show previous month"
              disabled={earliest}
              onClick={() => setFocused(addMonths(focused, -1))}
            >
              <ChevronLeftIcon aria-hidden />
            </IconButton>
            <h2
              id={headingId}
              className={styles.calendarTitle}
              aria-live="polite"
            >
              {monthLabel(focused)}
            </h2>
            <IconButton
              size="sm"
              label="Show next month"
              onClick={() => setFocused(addMonths(focused, 1))}
            >
              <ChevronRightIcon aria-hidden />
            </IconButton>
          </div>
          <div
            ref={grid}
            role="grid"
            aria-labelledby={headingId}
            className={styles.calendarGrid}
            onKeyDown={onGridKeyDown}
          >
            <div role="row" className={styles.calendarWeek}>
              {weekdays.map((day, index) => (
                <span
                  key={day}
                  role="columnheader"
                  aria-label={weekdayNames[index]}
                  className={styles.calendarWeekday}
                >
                  {day}
                </span>
              ))}
            </div>
            {weeks.map((week, index) => (
              <div key={index} role="row" className={styles.calendarWeek}>
                {week.map((date, column) =>
                  date ? (
                    <span
                      key={date}
                      role="gridcell"
                      aria-selected={date === chosen}
                    >
                      <button
                        type="button"
                        className={styles.calendarDay}
                        tabIndex={date === focused ? 0 : -1}
                        aria-label={dayLabel(date)}
                        aria-current={date === today ? "date" : undefined}
                        aria-disabled={date < min ? true : undefined}
                        data-selected={date === chosen || undefined}
                        onClick={() => pick(date)}
                        onFocus={() => {
                          if (date !== focused) setFocused(date);
                        }}
                      >
                        {parts(date).day}
                      </button>
                    </span>
                  ) : (
                    <span key={`blank-${column}`} role="gridcell" />
                  ),
                )}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
