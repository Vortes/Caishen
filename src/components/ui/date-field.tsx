"use client";

import { CalendarIcon } from "lucide-react";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  type KeyboardEvent,
  type Ref,
} from "react";
import { Calendar, type CalendarHandle } from "./calendar";
import { useFieldControl } from "./field";
import styles from "./field.module.css";
import { IconButton } from "./icon-button";
import { Popover } from "./popover";
import { useOpenState } from "./surface";

// What a form can ask of the date field once it's on screen.
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

// A date in a Field: typed as MM/DD/YYYY, or picked from a calendar that
// opens under the well. Values cross as YYYY-MM-DD; text that isn't a date
// yet crosses as typed. A short "10/3" or a two-digit year is filled out when
// you leave the field; text it can't read stays, and its Field says why.
// The calendar is a dialog, and Escape closes only it.
export function DateField({
  value,
  onChange,
  today,
  min,
  max,
  name,
  open: controlled,
  onOpenChange,
  readOnly,
  disabled,
  handle,
  inputRef,
  onPicked,
  onAdvance,
}: {
  value: string;
  onChange: (value: string) => void;
  // The date the field is read against, in the budget's timezone: a typed
  // "10/3" takes its year.
  today: string;
  // The first and last days the calendar offers.
  min?: string;
  max?: string;
  // Sends the value with the form.
  name?: string;
  // For a screen that opens the calendar itself.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  readOnly?: boolean;
  disabled?: boolean;
  handle?: Ref<DateFieldHandle>;
  inputRef?: Ref<HTMLInputElement>;
  // A day was picked from the calendar with a mouse or keyboard.
  onPicked?: () => void;
  // Tab out of the calendar's last stop; without it focus moves on from the
  // field as Tab would.
  onAdvance?: () => void;
}) {
  const field = useFieldControl();
  const { report } = field;
  // Once it has said the text can't be read, it clears the message as soon
  // as the field holds a date again, or nothing.
  const unreadable = useRef(false);
  useEffect(() => {
    if (unreadable.current && (isDate(value) || !value.trim())) {
      unreadable.current = false;
      report(null);
    }
  }, [value, report]);
  const [open, setOpen] = useOpenState(controlled, onOpenChange);
  const input = useRef<HTMLInputElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const calendar = useRef<CalendarHandle>(null);
  // Where focus was when the calendar was asked to take it, until it mounts.
  const pending = useRef<Element | null>(null);
  const calendarId = `${field.id}-calendar`;
  const chosen = isDate(value) ? value : null;
  const locked = Boolean(readOnly) || Boolean(disabled);
  const shown = !locked && open;
  const fine = () => window.matchMedia("(pointer: fine)").matches;

  const focusDay = () => calendar.current?.focusDay() ?? false;
  useImperativeHandle(handle, () => ({
    focusCalendar: () => {
      if (!focusDay()) pending.current = document.activeElement;
    },
  }));

  const pick = (date: string) => {
    onChange(date);
    setOpen(false);
    // Focus goes back to the field, or on touch to the calendar button, so
    // a software keyboard doesn't open by itself.
    if (fine()) {
      if (onPicked) onPicked();
      else input.current?.focus({ preventScroll: true });
    } else trigger.current?.focus({ preventScroll: true });
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
    else if (active !== input.current) setOpen(false);
  };

  // The calendar sits in a portal, so Tab out of it goes back to the form:
  // forward to the next field, backward to the date text.
  const onContentKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      (fine() ? input.current : trigger.current)?.focus({
        preventScroll: true,
      });
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
      setOpen(false);
      input.current?.focus();
    } else if (!event.shiftKey && index === stops.length - 1) {
      setOpen(false);
      if (onAdvance) {
        event.preventDefault();
        onAdvance();
      } else {
        // Tab carries on from the field, to whatever follows it.
        input.current?.focus({ preventScroll: true });
      }
    }
  };

  return (
    <Popover
      id={calendarId}
      label={`${field.label} calendar`}
      open={shown}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
      anchor={
        <div
          className={`${styles.well} ${styles.date}`}
          data-invalid={field.invalid ? "" : undefined}
          data-disabled={disabled ? "" : undefined}
          data-open={shown ? "" : undefined}
        >
          <input
            ref={(element) => {
              input.current = element;
              assign(inputRef, element);
            }}
            id={field.id}
            name={name}
            role="combobox"
            className={styles.input}
            autoComplete="off"
            spellCheck={false}
            placeholder="MM/DD/YYYY"
            aria-haspopup="dialog"
            aria-expanded={shown}
            aria-controls={shown ? calendarId : undefined}
            aria-invalid={field.invalid ? true : undefined}
            aria-describedby={field.describedBy}
            readOnly={readOnly}
            disabled={disabled}
            value={formatDate(value)}
            onFocus={(event) => event.currentTarget.select()}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              const text = event.target.value;
              onChange(parseDate(text, today, false) ?? text);
            }}
            onBlur={(event) => {
              const text = event.target.value;
              const date = parseDate(text, today, true);
              if (date && date !== value) onChange(date);
              // An empty field is the screen's to judge when it submits.
              else if (!date && text.trim() && !locked) {
                unreadable.current = true;
                report(`Enter a date, such as ${formatDate(today)}.`);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                // Arrow Down opens the calendar, or moves into it.
                event.preventDefault();
                if (shown) focusDay();
                else {
                  pending.current = document.activeElement;
                  setOpen(true);
                }
              } else if (event.key === "Escape" && shown) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              } else if (event.key === "Enter" && shown) {
                // Enter takes the typed date and closes the calendar; it
                // never sends the form while the calendar is open.
                event.preventDefault();
                const date = parseDate(event.currentTarget.value, today, true);
                if (date) onChange(date);
                setOpen(false);
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
              disabled={locked}
              onClick={() => {
                if (shown) {
                  setOpen(false);
                  return;
                }
                pending.current = document.activeElement;
                setOpen(true);
              }}
            >
              <CalendarIcon aria-hidden />
            </IconButton>
          </span>
        </div>
      }
    >
      {/* Escape is handled here, so a form around the calendar stays open
          until the next press. */}
      <div
        ref={(panel) => {
          if (panel) onShown();
        }}
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

function assign<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}
