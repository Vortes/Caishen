"use client";

import {
  useState,
  type KeyboardEvent,
  type ReactElement,
  type UIEvent,
} from "react";
import { Popover } from "~/components/ui/popover";
import { money, type ActivityEntry, type Category } from "./model";
import shell from "./shell.module.css";
import styles from "./activity.module.css";

// Opens a transaction in its account's register, remembering the category
// it was opened from.
export type ActivityJump = (
  transaction: { id: string; accountId: string; date: string },
  from: Category,
) => void;

const day = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

// An entry without a date, like a partner purchase whose ledger row is
// missing, shows an empty cell rather than failing.
const dayOf = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) ? day.format(new Date(date)) : "";

// The Activity column's width: wide enough for the plan's longest figure,
// since an amount is never cut off or shrunk. Tabular digits are 1ch wide,
// and the separators narrower, so ch over-measures slightly.
export function activityColumn(figures: number[]) {
  const longest = Math.max(...figures.map((value) => money(value).length));
  return `max(104px, ${longest}ch)`;
}

// The month's transactions in a category, opened from its Activity amount.
export function ActivityPopover({
  category,
  onJump,
  align = "center",
  children,
}: {
  category: Category;
  onJump: ActivityJump;
  align?: "start" | "center" | "end";
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      label={`${category.name} activity`}
      trigger={children}
      open={open}
      onOpenChange={setOpen}
      align={align}
      size="wide"
    >
      {/* Its own component, so rows are built only while it's open. */}
      <ActivityList
        category={category}
        onJump={(entry) => {
          setOpen(false);
          onJump(entry, category);
        }}
      />
    </Popover>
  );
}

function ActivityList({
  category,
  onJump,
}: {
  category: Category;
  onJump: (entry: ActivityEntry) => void;
}) {
  const [more, setMore] = useState(false);
  const entries = category.activityEntries;
  // A card's payment category lists only its payments; the rest of its
  // activity is the card spending its categories funded.
  const funded =
    category.activity - entries.reduce((total, item) => total + item.amount, 0);
  // The bottom fades while rows are hidden below it.
  const measure = (element: HTMLElement | null) => {
    if (!element) return;
    setMore(
      element.scrollHeight - element.scrollTop - element.clientHeight > 1,
    );
  };
  // Up and Down move between transactions, like a menu.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...event.currentTarget.querySelectorAll("button")];
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[event.key === "ArrowDown" ? at + 1 : at - 1];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };
  return (
    <div className={styles.panel}>
      <div className={styles.header}>{category.name}</div>
      {entries.length === 0 && funded === 0 ? (
        <p className={styles.empty}>No activity this month.</p>
      ) : (
        <div
          ref={measure}
          className={styles.scroll}
          data-more={more || undefined}
          onScroll={(event: UIEvent<HTMLDivElement>) =>
            measure(event.currentTarget)
          }
          onKeyDown={onKeyDown}
        >
          <div className={`${styles.columns} ${styles.head}`} aria-hidden>
            <span>Account</span>
            <span>Date</span>
            <span>Payee</span>
            <span data-numeric>Amount</span>
          </div>
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`${styles.columns} ${styles.row}`}
              aria-label={`${entry.payee}, ${money(entry.amount)}${
                dayOf(entry.date) ? `, ${dayOf(entry.date)}` : ""
              }, ${entry.account}. Open in register`}
              onClick={() => onJump(entry)}
            >
              <span title={entry.account}>{entry.account}</span>
              <span>{dayOf(entry.date)}</span>
              <span title={entry.payee}>{entry.payee}</span>
              <span data-numeric>{money(entry.amount)}</span>
            </button>
          ))}
          {funded !== 0 && (
            <div className={`${styles.columns} ${styles.static}`}>
              <span title={category.pays?.name}>{category.pays?.name}</span>
              <span />
              <span>Funded card spending</span>
              <span data-numeric>{money(funded)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// The plan row's Activity amount, over the row's own Activity cell the way
// the Assigned amount is, since a button can't hold another.
export function ActivityCell({
  category,
  onJump,
}: {
  category: Category;
  onJump: ActivityJump;
}) {
  const label = money(category.activity);
  return (
    <div className={`${shell.columns} ${styles.overlay}`}>
      <div className={styles.cell} data-optional>
        <ActivityPopover category={category} onJump={onJump}>
          <button
            type="button"
            className={styles.amount}
            aria-label={`${label} activity in ${category.name}. Show transactions`}
          >
            {label}
          </button>
        </ActivityPopover>
      </div>
    </div>
  );
}

// The details panel's Activity, which opens the same list, for plans too
// narrow to show the Activity column.
export function ActivityProperty({
  category,
  onJump,
}: {
  category: Category;
  onJump: ActivityJump;
}) {
  const label = money(category.activity);
  return (
    <ActivityPopover category={category} onJump={onJump} align="end">
      <button
        type="button"
        className={styles.property}
        aria-label={`${label} activity in ${category.name}. Show transactions`}
      >
        {label}
      </button>
    </ActivityPopover>
  );
}
