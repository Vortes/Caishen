"use client";

import {
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  Clock3Icon,
  InboxIcon,
  LandmarkIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { Tag } from "~/components/ui/tag";
import { dayLabel, money, type Category, type Funding } from "./model";
import { AssignedCell } from "./assigned";
import { FundingBar } from "./funding-bar";
import { useTransactionEntry } from "./transaction-entry";
import { TransactionEditor } from "./transaction-form";
import { MoveMoneyPopover } from "./move-money";
import { viewOf, type PlanView as PlanViewId } from "./plan-views";
import moveStyles from "./move-money.module.css";
import { useShellData } from "./shell-data";
import { ReviewBar, useReviewSelection } from "./transaction-review";
import styles from "./shell.module.css";
import reviewStyles from "./transaction-review.module.css";

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
  view,
  onSelect,
  checked,
  onCheck,
}: {
  view: PlanViewId | null;
  onSelect: (id: string) => void;
  checked: string[];
  onCheck: (ids: string[], value: boolean) => void;
}) {
  const shell = useShellData();
  const [closed, setClosed] = useState<string[]>([]);
  if (!shell.groups.length) {
    return (
      <Empty title="No categories yet.">
        Categories you create in Caishen show up here.
      </Empty>
    );
  }
  // A view keeps only its categories, and only the groups that still have
  // some; group totals add up what's showing.
  const focus = view ? viewOf(view) : null;
  const groups = focus
    ? shell.groups
        .map((group) => ({
          ...group,
          categories: group.categories.filter(focus.matches),
        }))
        .filter((group) => group.categories.length)
    : shell.groups;
  if (focus && !groups.length) {
    return (
      <Empty title={focus.empty.title} icon={CheckIcon}>
        {focus.empty.body}
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
              <RowCheckbox
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
                    <RowCheckbox
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
                        aria-hidden
                      >
                        <span className={moveStyles.placeholder}>
                          {money(category.assigned)}
                        </span>
                      </span>
                      <span
                        className={`${styles.numeric} ${styles.muted}`}
                        data-optional
                      >
                        {money(category.activity)}
                      </span>
                      <span className={styles.numeric} aria-hidden>
                        <span className={moveStyles.placeholder}>
                          <AvailablePill category={category} />
                        </span>
                      </span>
                    </button>
                    <AssignedCell category={category} />
                    <MoveMoneyPopover category={category} align="end">
                      <button
                        type="button"
                        className={moveStyles.pillButton}
                        aria-label={`${money(category.available)} available in ${category.name}. ${
                          category.available < 0
                            ? "Cover overspending"
                            : "Move money"
                        }`}
                      >
                        <AvailablePill category={category} />
                      </button>
                    </MoveMoneyPopover>
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
// in the list is checked. The label is the hit area: the full row height.
function RowCheckbox({
  label,
  state,
  onChange,
}: {
  label: string;
  state: boolean | "mixed";
  onChange: () => void;
}) {
  return (
    <label className={styles.checkboxSlot}>
      <Checkbox
        aria-label={label}
        checked={state === "mixed" ? "indeterminate" : state}
        onCheckedChange={onChange}
      />
    </label>
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
  checked,
  onCheck,
}: {
  accountId: string | null;
  reviewOnly: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  checked: string[];
  onCheck: (ids: string[], value: boolean) => void;
}) {
  const { transactions, accounts, month, today } = useShellData();
  const { session } = useTransactionEntry();
  // The register follows the month picker, like the plan. The review inbox
  // spans every month, so nothing waiting is hidden by the picker.
  const rows = transactions.filter(
    (item) =>
      (!accountId || item.accountId === accountId) &&
      (reviewOnly ? item.needsReview : item.date.startsWith(month.key)),
  );
  const selection = useReviewSelection({ rows, checked, onCheck });
  // In the register the editor takes its transaction's row. A new one, or one
  // this month or filter hides, opens at the top.
  const editingId = session?.initial?.id;
  const inPlace =
    session && rows.some((item) => item.id === editingId)
      ? editingId
      : undefined;
  if (!rows.length && !session) {
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
  // Every row, the headers, and the editor share one grid, so each field
  // sits under the column it fills. All accounts leads with an Account
  // column, since that's what a new entry picks first.
  const accountColumn = !accountId;
  return (
    <div
      className={`${styles.list} ${styles.register}`}
      data-accounts={accountColumn || undefined}
      role="group"
      aria-label="Transactions"
      data-selecting={selection.selected.length > 0 || undefined}
      data-review-bar={selection.selectable.length > 0 || undefined}
      onKeyDown={(event) => {
        // x toggles the focused row's checkbox, like the plan.
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
      <ReviewBar selection={selection} onCheck={onCheck} />
      <div className={`${styles.txColumns} ${styles.columnHeader}`} aria-hidden>
        {accountColumn && (
          <span data-column="account" data-optional>
            Account
          </span>
        )}
        <span data-column="date" data-optional>
          Date
        </span>
        <span data-column="payee">Payee</span>
        <span data-column="category">Category</span>
        <span className={styles.numeric} data-column="outflow" data-wide>
          Outflow
        </span>
        <span className={styles.numeric} data-column="inflow" data-wide>
          Inflow
        </span>
        <span className={styles.numeric} data-narrow>
          Amount
        </span>
        <span data-column="status" />
      </div>
      {session && !inPlace && (
        <TransactionEditor accountColumn={accountColumn} />
      )}
      {rows.map((item) => {
        const status = statusIcon[item.status];
        const account = accounts.find((entry) => entry.id === item.accountId);
        // Marks the row in its first column.
        const reviewDot = (
          <span
            className={styles.reviewDot}
            data-on={item.needsReview ? "" : undefined}
          >
            {item.needsReview && <span className="sr-only">Needs review</span>}
          </span>
        );
        if (item.id === inPlace)
          return (
            <TransactionEditor key={item.id} accountColumn={accountColumn} />
          );
        const checkable = item.source === "budget";
        const isChecked = checkable && checked.includes(item.id);
        return (
          <div
            key={item.id}
            className={`${styles.rowWrap} ${reviewStyles.checkable}`}
            data-checked={isChecked || undefined}
          >
            {checkable && (
              <RowCheckbox
                label={`Select ${item.payee}`}
                state={isChecked}
                onChange={() => onCheck([item.id], !isChecked)}
              />
            )}
            <button
              type="button"
              data-row
              data-id={checkable ? item.id : undefined}
              data-transaction-row={item.id}
              className={`${styles.txColumns} ${styles.row}`}
              aria-current={selectedId === item.id ? "true" : undefined}
              onClick={() => onSelect(item.id)}
            >
              {accountColumn && (
                <span
                  className={styles.rowName}
                  data-column="account"
                  data-optional
                >
                  {reviewDot}
                  <span className={`${styles.truncate} ${styles.faint}`}>
                    {account?.name ?? "Unlinked bank account"}
                  </span>
                </span>
              )}
              <span className={styles.rowName} data-column="date" data-optional>
                {!accountColumn && reviewDot}
                <span className={`${styles.truncate} ${styles.muted}`}>
                  {dayLabel(item.date, today)}
                </span>
              </span>
              <span className={styles.rowName} data-column="payee">
                <span className={styles.truncate}>{item.payee}</span>
                {item.shared && (
                  <UsersIcon
                    size={12}
                    className={styles.inlineIcon}
                    aria-label="Shared"
                  />
                )}
              </span>
              <span className={styles.truncate} data-column="category">
                {item.needsCategory ? (
                  <Tag tone="attention">{item.categoryLabel}</Tag>
                ) : (
                  <span className={styles.muted}>{item.categoryLabel}</span>
                )}
                {item.forMonth && (
                  <span className={styles.faint}> · {item.forMonth}</span>
                )}
              </span>
              <span
                className={styles.numeric}
                data-column="outflow"
                data-empty={item.amount < 0 ? undefined : true}
              >
                {item.amount < 0 && money(-item.amount)}
              </span>
              <span
                className={styles.numeric}
                data-column="inflow"
                data-empty={item.amount > 0 ? undefined : true}
                data-inflow={item.amount > 0 || undefined}
              >
                {item.amount > 0 && money(item.amount)}
              </span>
              <span className={styles.statusCell} data-column="status">
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
              </span>
            </button>
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
