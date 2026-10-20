"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  Clock3Icon,
  InboxIcon,
  LandmarkIcon,
  MinusIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  dayLabel,
  money,
  shortDay,
  type Category,
  type Funding,
} from "./model";
import { FundingBar } from "./funding-bar";
import { useShellData } from "./shell-data";
import styles from "./shell.module.css";

// Arrow keys move the selection through the rows of a list, like Linear's j/k.
function moveSelection(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-row]"),
  ];
  const index = rows.findIndex((row) => row === document.activeElement);
  const next =
    rows[
      index === -1
        ? 0
        : Math.min(
            rows.length - 1,
            Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)),
          )
    ];
  if (!next) return;
  event.preventDefault();
  next.focus();
  next.click();
}

export function PlanView({
  onSelect,
  checked,
  onCheck,
}: {
  onSelect: (id: string) => void;
  checked: string[];
  onCheck: (ids: string[], value: boolean) => void;
}) {
  const { groups } = useShellData();
  const [closed, setClosed] = useState<string[]>([]);
  if (!groups.length) {
    return (
      <Empty title="No categories yet.">
        Categories you create in Caishen show up here.
      </Empty>
    );
  }
  return (
    <div
      className={styles.list}
      role="group"
      aria-label="Categories"
      data-selecting={checked.length > 0 || undefined}
      onKeyDown={(event) => {
        // x toggles the focused row's checkbox, like Linear.
        const id =
          document.activeElement instanceof HTMLElement
            ? document.activeElement.dataset.id
            : undefined;
        if (event.key === "x" && id) {
          event.preventDefault();
          onCheck([id], !checked.includes(id));
          return;
        }
        moveSelection(event);
      }}
    >
      <div className={`${styles.columns} ${styles.columnHeader}`} aria-hidden>
        <span>Category</span>
        <span className={styles.numeric} data-optional>
          Assigned
        </span>
        <span className={styles.numeric} data-optional>
          Activity
        </span>
        <span className={styles.numeric}>Available</span>
      </div>
      {groups.map((group) => {
        const open = !closed.includes(group.id);
        const sum = (pick: (category: Category) => number) =>
          group.categories.reduce((total, item) => total + pick(item), 0);
        const ids = group.categories.map((item) => item.id);
        const count = ids.filter((id) => checked.includes(id)).length;
        return (
          <div key={group.id}>
            <div className={styles.rowWrap}>
              <Checkbox
                label={`Select ${group.name}`}
                state={
                  count === 0 ? false : count === ids.length ? true : "mixed"
                }
                onChange={() => onCheck(ids, count < ids.length)}
              />
              <button
                type="button"
                className={`${styles.columns} ${styles.groupRow}`}
                aria-expanded={open}
                onClick={() =>
                  setClosed((values) =>
                    open
                      ? [...values, group.id]
                      : values.filter((value) => value !== group.id),
                  )
                }
              >
                <span className={styles.groupName}>
                  <ChevronDownIcon
                    size={12}
                    strokeWidth={2.5}
                    className={styles.groupCaret}
                    aria-hidden
                  />
                  {group.name}
                  <span className={styles.groupCount}>
                    {group.categories.length}
                  </span>
                </span>
                <span className={styles.numeric} data-optional>
                  {money(sum((item) => item.assigned))}
                </span>
                <span className={styles.numeric} data-optional>
                  {money(sum((item) => item.activity))}
                </span>
                <span className={styles.numeric}>
                  {money(sum((item) => item.available))}
                </span>
              </button>
            </div>
            {open &&
              group.categories.map((category) => {
                const isChecked = checked.includes(category.id);
                return (
                  <div
                    key={category.id}
                    className={styles.rowWrap}
                    data-checked={isChecked || undefined}
                  >
                    <Checkbox
                      label={`Select ${category.name}`}
                      state={isChecked}
                      onChange={() => onCheck([category.id], !isChecked)}
                    />
                    <button
                      type="button"
                      data-row
                      data-id={category.id}
                      className={`${styles.columns} ${styles.row}`}
                      aria-current={
                        checked.length === 1 && checked[0] === category.id
                          ? "true"
                          : undefined
                      }
                      onClick={() => onSelect(category.id)}
                    >
                      <span className={styles.rowName}>
                        <FundingBar category={category}>
                          <span className={styles.truncate}>
                            {category.name}
                          </span>
                          {category.sharePercents.length > 0 && (
                            <UsersIcon
                              size={12}
                              className={styles.inlineIcon}
                              aria-label="Shared"
                            />
                          )}
                        </FundingBar>
                      </span>
                      <span
                        className={`${styles.numeric} ${styles.muted}`}
                        data-optional
                      >
                        {money(category.assigned)}
                      </span>
                      <span
                        className={`${styles.numeric} ${styles.muted}`}
                        data-optional
                      >
                        {money(category.activity)}
                      </span>
                      <span className={styles.numeric}>
                        <AvailablePill category={category} />
                      </span>
                    </button>
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}

// Lives in the row's left padding; shows on hover, focus, or once anything
// in the list is checked.
function Checkbox({
  label,
  state,
  onChange,
}: {
  label: string;
  state: boolean | "mixed";
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state}
      aria-label={label}
      className={styles.checkbox}
      onClick={onChange}
    >
      <span aria-hidden>
        {state === "mixed" ? (
          <MinusIcon size={10} strokeWidth={3} />
        ) : state ? (
          <CheckIcon size={10} strokeWidth={3} />
        ) : null}
      </span>
    </button>
  );
}

const fundingLabel: Record<Funding, string> = {
  funded: "Funded",
  underfunded: "Underfunded",
  overspent: "Overspent",
  credit: "Overspent on credit",
  snoozed: "Target snoozed",
  empty: "No money assigned",
};

export function FundingRing({
  category,
  size = 14,
}: {
  category: Category;
  size?: number;
}) {
  const state = category.funding;
  const ratio = category.fundedRatio;
  const radius = 5;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      className={styles.ring}
      data-state={state}
      role="img"
      aria-label={fundingLabel[state]}
    >
      {state === "funded" || state === "overspent" || state === "credit" ? (
        <>
          <circle cx="7" cy="7" r="6" className={styles.ringFill} />
          {state === "funded" ? (
            <path d="M4.5 7.2 6.2 8.8 9.5 5.4" className={styles.ringMark} />
          ) : (
            <path d="M7 4v3.6M7 9.6v.01" className={styles.ringMark} />
          )}
        </>
      ) : (
        <>
          <circle
            cx="7"
            cy="7"
            r="6"
            className={styles.ringTrack}
            strokeDasharray={
              state === "empty" || state === "snoozed" ? "1.6 1.6" : undefined
            }
          />
          {state === "snoozed" && (
            <path d="M5 7h4" className={styles.ringSnooze} />
          )}
          {state === "underfunded" && (
            <circle
              cx="7"
              cy="7"
              r={radius / 2}
              className={styles.ringArc}
              strokeWidth={radius}
              strokeDasharray={`${(ratio * circumference) / 2} ${circumference}`}
              transform="rotate(-90 7 7)"
            />
          )}
        </>
      )}
    </svg>
  );
}

export function AvailablePill({
  category,
}: {
  category: Pick<Category, "funding" | "available">;
}) {
  return (
    <span className={styles.pill} data-state={category.funding}>
      {money(category.available)}
    </span>
  );
}

const statusIcon = {
  pending: { icon: Clock3Icon, label: "Pending" },
  posted: { icon: CircleCheckIcon, label: "Posted" },
};

export function RegisterView({
  accountId,
  reviewOnly,
  selectedId,
  onSelect,
}: {
  accountId: string | null;
  reviewOnly: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { transactions, accounts, month, today } = useShellData();
  // The register follows the month picker, like the plan. The review inbox
  // spans every month, so nothing waiting is hidden by the picker.
  const rows = transactions.filter(
    (item) =>
      (!accountId || item.accountId === accountId) &&
      (reviewOnly ? item.needsReview : item.date.startsWith(month.key)),
  );
  if (!rows.length) {
    return reviewOnly ? (
      <Empty title="Everything here is reviewed." icon={CheckIcon}>
        New bank imports will show up as they arrive.
      </Empty>
    ) : (
      <Empty title={`No transactions in ${month.label}.`}>
        Pick another month to see its transactions.
      </Empty>
    );
  }
  const days = [...new Set(rows.map((item) => item.date))];
  return (
    <div
      className={styles.list}
      role="group"
      aria-label="Transactions"
      onKeyDown={moveSelection}
    >
      {days.map((day) => {
        const items = rows.filter((item) => item.date === day);
        const label = dayLabel(day, today);
        return (
          <div key={day}>
            <div className={styles.dayRow}>
              <span>{label}</span>
              {label !== shortDay(day) && (
                <span className={styles.groupCount}>{shortDay(day)}</span>
              )}
            </div>
            {items.map((item) => {
              const status = statusIcon[item.status];
              const account = accounts.find(
                (entry) => entry.id === item.accountId,
              );
              return (
                <button
                  type="button"
                  key={item.id}
                  data-row
                  className={`${styles.txColumns} ${styles.row}`}
                  aria-current={selectedId === item.id ? "true" : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <span className={styles.rowName}>
                    <span
                      className={styles.reviewDot}
                      data-on={item.needsReview ? "" : undefined}
                    >
                      {item.needsReview && (
                        <span className="sr-only">Needs review</span>
                      )}
                    </span>
                    {item.source === "bank" ? (
                      <InboxIcon
                        size={14}
                        className={styles.statusIcon}
                        aria-label="Bank import"
                      />
                    ) : (
                      <status.icon
                        size={14}
                        className={styles.statusIcon}
                        data-status={item.status}
                        aria-label={status.label}
                      />
                    )}
                    <span className={styles.truncate}>{item.payee}</span>
                    {item.shared && (
                      <UsersIcon
                        size={12}
                        className={styles.inlineIcon}
                        aria-label="Shared"
                      />
                    )}
                  </span>
                  <span className={styles.truncate}>
                    {item.needsCategory ? (
                      <span className={styles.chip} data-tone="amber">
                        {item.categoryLabel}
                      </span>
                    ) : (
                      <span className={styles.muted}>{item.categoryLabel}</span>
                    )}
                    {item.forMonth && (
                      <span className={styles.faint}> · {item.forMonth}</span>
                    )}
                  </span>
                  <span
                    className={`${styles.truncate} ${styles.faint}`}
                    data-optional
                  >
                    {account?.name ?? "Unlinked bank account"}
                  </span>
                  <span
                    className={styles.numeric}
                    data-inflow={item.amount > 0 || undefined}
                  >
                    {money(item.amount, true)}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Empty({
  title,
  icon: Icon = LandmarkIcon,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <Icon size={18} aria-hidden />
      <p>
        <strong>{title}</strong>
        {children}
      </p>
    </div>
  );
}

export function LoansView({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { loans } = useShellData();
  if (!loans.length) {
    return (
      <Empty title="No loans yet.">
        Loans you add in Caishen show their payoff here.
      </Empty>
    );
  }
  return (
    <div
      className={styles.list}
      role="group"
      aria-label="Loans"
      onKeyDown={moveSelection}
    >
      <div
        className={`${styles.loanColumns} ${styles.columnHeader}`}
        aria-hidden
      >
        <span>Loan</span>
        <span data-optional>Rate</span>
        <span data-optional>Payoff</span>
        <span className={styles.numeric}>Balance</span>
      </div>
      {loans.map((loan) => (
        <button
          type="button"
          key={loan.id}
          data-row
          className={`${styles.loanColumns} ${styles.row}`}
          aria-current={selectedId === loan.id ? "true" : undefined}
          onClick={() => onSelect(loan.id)}
        >
          <span className={styles.truncate}>{loan.name}</span>
          <span className={styles.muted} data-optional>
            {loan.rate ?? "No rate"}
          </span>
          <span className={styles.muted} data-optional>
            {loan.payoff}
          </span>
          <span className={styles.numeric}>{money(-loan.balance)}</span>
        </button>
      ))}
    </div>
  );
}
