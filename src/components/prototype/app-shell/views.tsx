"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  Clock3Icon,
  LockIcon,
  MinusIcon,
} from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import {
  accounts,
  allCategories,
  available,
  fundedRatio,
  funding,
  groups,
  loans,
  money,
  transactions,
  type Category,
  type Funding,
} from "./data";
import styles from "./shell.module.css";

// Arrow keys move the selection through the rows of a list, like Linear's j/k.
function moveSelection(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-row]"),
  ];
  const index = rows.indexOf(document.activeElement as HTMLButtonElement);
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
  selectedId,
  onSelect,
  checked,
  onCheck,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  checked: string[];
  onCheck: (ids: string[], value: boolean) => void;
}) {
  const [closed, setClosed] = useState<string[]>([]);
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
                <span className={styles.numeric}>{money(sum(available))}</span>
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
                        selectedId === category.id ? "true" : undefined
                      }
                      onClick={() => onSelect(category.id)}
                    >
                      <span className={styles.rowName}>
                        <FundingRing category={category} />
                        <span className={styles.nameStack}>
                          <span className={styles.truncate}>
                            {category.name}
                          </span>
                          <FundingBar category={category} />
                        </span>
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
  empty: "No money assigned",
};

export function FundingRing({
  category,
  size = 14,
}: {
  category: Category;
  size?: number;
}) {
  const state = funding(category);
  const ratio = fundedRatio(category);
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
      {state === "funded" || state === "overspent" ? (
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
            strokeDasharray={state === "empty" ? "1.6 1.6" : undefined}
          />
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

// Alternative to FundingRing; the prototype's indicator switch shows one.
function FundingBar({ category }: { category: Category }) {
  const state = funding(category);
  return (
    <span
      className={styles.bar}
      data-state={state}
      role="img"
      aria-label={fundingLabel[state]}
    >
      <span style={{ transform: `scaleX(${fundedRatio(category)})` }} />
    </span>
  );
}

export function AvailablePill({ category }: { category: Category }) {
  return (
    <span className={styles.pill} data-state={funding(category)}>
      {money(available(category))}
    </span>
  );
}

const statusIcon = {
  pending: { icon: Clock3Icon, label: "Pending" },
  cleared: { icon: CircleCheckIcon, label: "Cleared" },
  reconciled: { icon: LockIcon, label: "Reconciled" },
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
  const rows = transactions.filter(
    (item) =>
      (!accountId || item.accountId === accountId) &&
      (!reviewOnly || item.needsReview),
  );
  const days = [...new Set(rows.map((item) => item.day))];
  if (!rows.length) {
    return (
      <div className={styles.empty}>
        <CheckIcon size={18} aria-hidden />
        <p>
          <strong>Everything here is reviewed.</strong>
          New bank imports will show up as they arrive.
        </p>
      </div>
    );
  }
  return (
    <div
      className={styles.list}
      role="group"
      aria-label="Transactions"
      onKeyDown={moveSelection}
    >
      {days.map((day) => {
        const items = rows.filter((item) => item.day === day);
        return (
          <div key={day}>
            <div className={styles.dayRow}>
              <span>{day}</span>
              <span className={styles.groupCount}>{items[0]?.date}</span>
            </div>
            {items.map((item) => {
              const status = statusIcon[item.status];
              const category = allCategories.find(
                (entry) => entry.id === item.categoryId,
              );
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
                    <status.icon
                      size={14}
                      className={styles.statusIcon}
                      data-status={item.status}
                      aria-label={status.label}
                    />
                    <span className={styles.truncate}>{item.payee}</span>
                  </span>
                  <span className={styles.truncate}>
                    {category ? (
                      <span className={styles.muted}>{category.name}</span>
                    ) : item.amount > 0 ? (
                      <span className={styles.muted}>Ready to Assign</span>
                    ) : (
                      <span className={styles.chip} data-tone="amber">
                        Needs category
                      </span>
                    )}
                  </span>
                  <span
                    className={`${styles.truncate} ${styles.faint}`}
                    data-optional
                  >
                    {account?.name}
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

export function LoansView({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
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
            {loan.rate}
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
