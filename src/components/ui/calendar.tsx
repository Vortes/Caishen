"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
  type Ref,
} from "react";
import {
  DayPicker,
  type CustomComponents,
  type DayButtonProps,
} from "react-day-picker";
import styles from "./calendar.module.css";
import { IconButton } from "./icon-button";

// What a surrounding field can ask of the calendar.
export type CalendarHandle = {
  // Moves focus to the selected day, or today. False if nothing rendered yet.
  focusDay: () => boolean;
};

// Dates cross this boundary as YYYY-MM-DD, like the rest of the app.
// DayPicker works in local Dates, so each one is local midnight.
function toDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year!, month! - 1, day);
}

function toIso(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const labels = {
  labelNav: () => "Change month",
  labelPrevious: () => "Show previous month",
  labelNext: () => "Show next month",
  // Today and the selection are carried by aria-current and aria-selected.
  labelDayButton: (date: Date) =>
    date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
};

const classNames = {
  root: styles.root,
  months: styles.months,
  month: styles.month,
  nav: styles.nav,
  month_caption: styles.caption,
  caption_label: styles.title,
  month_grid: styles.grid,
  weekdays: styles.week,
  weekday: styles.weekday,
  weeks: styles.weeks,
  week: styles.week,
  day: styles.day,
  day_button: styles.dayButton,
};

// The month buttons are IconButtons. DayPicker marks the end of the range
// with aria-disabled; here it becomes a real disabled button.
function MonthButton(props: ComponentProps<"button">) {
  return (
    <IconButton
      label={props["aria-label"] ?? ""}
      disabled={Boolean(props["aria-disabled"])}
      onClick={props.onClick}
    >
      {props.children}
    </IconButton>
  );
}

function Chevron({ orientation }: { orientation?: string }) {
  return orientation === "left" ? (
    <ChevronLeftIcon aria-hidden />
  ) : (
    <ChevronRightIcon aria-hidden />
  );
}

// The month is the calendar's heading, announced as it changes.
function CaptionLabel({ className, children }: ComponentProps<"span">) {
  return (
    <h2 className={className} aria-live="polite">
      {children}
    </h2>
  );
}

function DayButton({ day: _day, modifiers, ...props }: DayButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  // DayPicker moves the focused day; the button follows it.
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);
  return (
    <button
      ref={ref}
      aria-current={modifiers.today ? "date" : undefined}
      {...props}
    />
  );
}

const components: Partial<CustomComponents> = {
  PreviousMonthButton: MonthButton,
  NextMonthButton: MonthButton,
  Chevron,
  CaptionLabel,
  DayButton,
};

// One month of days to pick a single date from. It shows the selected
// date's month, and follows the selection when it changes. Arrow keys move
// the day, Page Up and Page Down the month, and Shift with either a year.
export function Calendar({
  value,
  today,
  min,
  onSelect,
  ref,
}: {
  // The selected date, YYYY-MM-DD.
  value: string | null;
  today: string;
  // The first day that can be picked. Earlier months can't be shown.
  min?: string;
  // A day was picked, including the one already selected.
  onSelect: (date: string) => void;
  ref?: Ref<CalendarHandle>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [month, setMonth] = useState(() => toDate(value ?? today));

  useEffect(() => {
    if (value) setMonth(toDate(value));
  }, [value]);

  useImperativeHandle(ref, () => ({
    focusDay: () => {
      const day = root.current?.querySelector<HTMLElement>(
        'button[tabindex="0"]',
      );
      if (!day) return false;
      day.focus({ preventScroll: true });
      return true;
    },
  }));

  const earliest = min ? toDate(min) : undefined;

  return (
    <div ref={root}>
      <DayPicker
        mode="single"
        required
        showOutsideDays
        selected={value ? toDate(value) : undefined}
        onSelect={(date) => onSelect(toIso(date))}
        month={month}
        onMonthChange={setMonth}
        today={toDate(today)}
        startMonth={earliest}
        disabled={earliest ? { before: earliest } : undefined}
        labels={labels}
        classNames={classNames}
        components={components}
      />
    </div>
  );
}
