"use client";

import { CalendarIcon } from "lucide-react";
import {
  useImperativeHandle,
  useRef,
  type KeyboardEvent,
  type Ref,
} from "react";
import { Calendar, type CalendarHandle } from "~/components/ui/calendar";
import { IconButton } from "~/components/ui/icon-button";
import { Popover } from "~/components/ui/popover";
import styles from "./transaction-entry.module.css";

// What the form can ask of the date field once it's on screen.
export type DateFieldHandle = {
  // Moves focus to the chosen day, now or as soon as the calendar mounts.
  focusCalendar: () => void;
};

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

// Shown as MM/DD/YYYY, like the rest of a US register.
function formatDate(date: string) {
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

// A date typed as text, or picked from a calendar that opens under the
// field. The calendar is a dialog, and Escape closes only it.
export function DateField({
  id,
  label,
  value,
  min,
  max,
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
  // The last day that can be picked, if any.
  max?: string;
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
  const input = useRef<HTMLInputElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const calendar = useRef<CalendarHandle>(null);
  // Where focus was when the calendar was asked to take it, until it mounts.
  const pending = useRef<Element | null>(null);
  const calendarId = `${id}-calendar`;
  const chosen = isDate(value) ? value : null;
  const shown = !readOnly && open;

  const focusDay = () => calendar.current?.focusDay() ?? false;
  useImperativeHandle(handle, () => ({
    focusCalendar: () => {
      if (!focusDay()) pending.current = document.activeElement;
    },
  }));

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
    onChange(date);
    onOpenChange(false);
    if (window.matchMedia("(pointer: fine)").matches) onPicked();
    else trigger.current?.focus({ preventScroll: true });
  };

  // When the calendar mounts after the form asked it to take focus, it takes
  // it, unless focus has since moved on to another field: then the calendar
  // gets out of its way.
  const onShown = () => {
    const from = pending.current;
    pending.current = null;
    if (!from) return;
    const active = document.activeElement;
    if (active === from || active === document.body) focusDay();
    else if (active !== input.current) onOpenChange(false);
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

  return (
    <Popover
      id={calendarId}
      label={`${label} calendar`}
      size="trigger"
      open={shown}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
      anchor={
        <div
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
      }
    >
      {/* Escape is handled here, so the editor around the calendar stays
          open until the next press. */}
      <div
        ref={(panel) => {
          if (panel) onShown();
        }}
        className={styles.calendarPanel}
        onKeyDown={onContentKeyDown}
      >
        <Calendar
          ref={calendar}
          value={chosen}
          today={today}
          min={min}
          max={max}
          onSelect={pick}
        />
      </div>
    </Popover>
  );
}
