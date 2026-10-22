"use client";

import {
  ArrowRightLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  Clock3Icon,
  LandmarkIcon,
  LockIcon,
  SearchIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { IconButton } from "~/components/ui/icon-button";
import { Tag } from "~/components/ui/tag";
import {
  shortDay,
  money,
  type Category,
  type Funding,
  type Transaction,
} from "./model";
import {
  AddToGroupButton,
  FirstGroupButton,
  isPaymentGroup,
  type Added,
} from "./add-category";
import { AssignedCell } from "./assigned";
import { FundingBar } from "./funding-bar";
import { useTransactionEntry, type DraftField } from "./transaction-entry";
import { TransactionEditor } from "./transaction-form";
import { MoveMoneyPopover } from "./move-money";
import { viewOf, type PlanView as PlanViewId } from "./plan-views";
import moveStyles from "./move-money.module.css";
import { useShellData } from "./shell-data";
import {
  SelectAll,
  SelectionIsland,
  useReviewSelection,
} from "./transaction-review";
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
  reveal,
}: {
  view: PlanViewId | null;
  onSelect: (id: string) => void;
  checked: string[];
  onCheck: (ids: string[], value: boolean) => void;
  // A group or category to bring into view and focus, like one just added.
  reveal: Added | null;
}) {
  const shell = useShellData();
  const [closed, setClosed] = useState<string[]>([]);
  const toggle = (id: string) =>
    setClosed((values) =>
      values.includes(id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    );
  // A new category's row, or a new group's header.
  const revealGroup =
    reveal?.type === "group"
      ? reveal.name
      : shell.categories.find((item) => item.id === reveal?.id)?.group;
  // Opens a closed group first, then focuses the target once it renders,
  // once: closing the group again afterwards keeps it closed.
  const revealed = useRef<Added | null>(null);
  useEffect(() => {
    if (!reveal || !revealGroup || revealed.current === reveal) return;
    if (closed.includes(revealGroup)) {
      setClosed((values) => values.filter((value) => value !== revealGroup));
      return;
    }
    const target = document.querySelector<HTMLElement>(
      reveal.type === "group"
        ? `[data-group-toggle="${CSS.escape(reveal.name)}"]`
        : `[data-row][data-id="${CSS.escape(reveal.id)}"]`,
    );
    if (!target) return;
    revealed.current = reveal;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center" });
  }, [reveal, revealGroup, closed]);
  if (!shell.groups.length) {
    return (
      <Empty title="Give every dollar a job." action={<FirstGroupButton />}>
        Start with a category group, like Bills, then add the categories that go
        in it.
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
      <Empty title={focus.empty.title} icon={CheckIcon} done>
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
        const ids = group.categories.map((item) => item.id);
        // A group with no categories stays folded; its header's + adds one.
        const open = ids.length > 0 && !closed.includes(group.id);
        const sum = (pick: (category: Category) => number) =>
          group.categories.reduce((total, item) => total + pick(item), 0);
        const count = ids.filter((id) => checked.includes(id)).length;
        return (
          <div key={group.id}>
            <div className={styles.rowWrap}>
              {ids.length > 0 && (
                <RowCheckbox
                  label={`Select ${group.name}`}
                  state={
                    count === 0 ? false : count === ids.length ? true : "mixed"
                  }
                  onChange={() => onCheck(ids, count < ids.length)}
                />
              )}
              {/* The whole header toggles the group for the pointer; the
                  name is the button, so the + beside it can be one too. */}
              <div
                className={`${styles.columns} ${styles.groupRow}`}
                onClick={(event) => {
                  if (!(event.target as Element).closest("button"))
                    toggle(group.id);
                }}
              >
                <span className={styles.groupName}>
                  <button
                    type="button"
                    className={styles.groupToggle}
                    aria-expanded={open}
                    data-group-toggle={group.name}
                    onClick={() => toggle(group.id)}
                  >
                    <ChevronDownIcon
                      size={12}
                      strokeWidth={2.5}
                      className={styles.groupCaret}
                      aria-hidden
                    />
                    <span className={styles.truncate}>{group.name}</span>
                    <span className={styles.groupCount}>
                      {group.categories.length}
                    </span>
                  </button>
                  {!isPaymentGroup(group) && (
                    <span className={styles.groupAdd}>
                      <AddToGroupButton group={group.name} />
                    </span>
                  )}
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
              </div>
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

// Reconciled rows recede, so the cleared ones still to check stand out.
const statusIcon = {
  pending: { icon: Clock3Icon, label: "Pending" },
  posted: { icon: CircleCheckIcon, label: "Cleared" },
  reconciled: { icon: LockIcon, label: "Reconciled" },
};

function matches(item: Transaction, query: string, accountName?: string) {
  const text = query.toLowerCase();
  return [
    item.payee,
    item.categoryLabel,
    accountName,
    money(Math.abs(item.amount)),
  ].some((value) => value?.toLowerCase().includes(text));
}

const registerEditFields: Record<string, DraftField> = {
  date: "date",
  payee: "payee",
  category: "categoryId",
  outflow: "outflow",
  inflow: "inflow",
};

// The editable column under a click at x, or the nearest one, so a click
// anywhere in the row opens a field: above or below a cell's text, in a gap,
// or on a column the editor can't change. Columns are measured by their
// grid tracks, since amounts hug their text and an empty one has no width.
function columnAt(row: HTMLElement, x: number, skip?: string) {
  const style = getComputedStyle(row);
  const tracks = style.gridTemplateColumns.split(" ").map(parseFloat);
  const gap = parseFloat(style.columnGap);
  let left =
    row.getBoundingClientRect().left +
    parseFloat(style.borderLeftWidth) +
    parseFloat(style.paddingLeft);
  const cells = [...row.children].filter(
    (cell): cell is HTMLElement =>
      cell instanceof HTMLElement && cell.getClientRects().length > 0,
  );
  let nearest: { column: string; distance: number } | undefined;
  cells.forEach((cell, index) => {
    const right = left + (tracks[index] ?? 0);
    const column = cell.dataset.column;
    if (column && column in registerEditFields && column !== skip) {
      const distance = x < left ? left - x : x > right ? x - right : 0;
      if (!nearest || distance < nearest.distance)
        nearest = { column, distance };
    }
    left = right + gap;
  });
  return nearest?.column;
}

export function RegisterView({
  accountId,
  reviewOnly,
  query,
  selectedId,
  onSelect,
  checked,
  onCheck,
  onJump,
}: {
  accountId: string | null;
  reviewOnly: boolean;
  query: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  checked: string[];
  onCheck: (ids: string[], value: boolean) => void;
  onJump: (transaction: NonNullable<Transaction["counterpart"]>) => void;
}) {
  const { transactions, accounts, month } = useShellData();
  const entry = useTransactionEntry();
  const { session } = entry;
  const register = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedId) return;
    const row = register.current?.querySelector<HTMLButtonElement>(
      `[data-transaction-row="${CSS.escape(selectedId)}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
    row?.focus({ preventScroll: true });
  }, [selectedId, accountId]);
  const accountName = (id: string | null) =>
    accounts.find((entry) => entry.id === id)?.name;
  const search = query.trim();
  // The register follows the month picker, like the plan. Search and the
  // review inbox span every month, so nothing is hidden by the picker.
  const rows = transactions.filter(
    (item) =>
      (!accountId || item.accountId === accountId) &&
      (!reviewOnly || item.needsReview) &&
      (search
        ? matches(item, search, accountName(item.accountId))
        : reviewOnly || item.date.startsWith(month.key)),
  );
  // YNAB's pattern: pending transactions lead under one heading that
  // collapses, set apart from the cleared ones below.
  const [pendingOpen, setPendingOpen] = useState(true);
  const pending = rows.filter((item) => item.status === "pending");
  const cleared = rows.filter((item) => item.status !== "pending");
  // A collapsed heading's rows can't be selected.
  const selection = useReviewSelection({
    rows: pendingOpen ? rows : cleared,
    checked,
    onCheck,
  });
  const entering = useJustChecked(checked);
  const keyboard = useKeyboardInput();
  // In the register the editor takes its transaction's row. A new one, or one
  // this month or filter hides, opens at the top.
  const editingId = session?.rowId;
  const inPlace =
    session && rows.some((item) => item.id === editingId)
      ? editingId
      : undefined;
  if (!rows.length && !session) {
    return search ? (
      <Empty title={`No transactions match “${search}”.`} icon={SearchIcon}>
        Search looks at payees, categories, and amounts in every month.
      </Empty>
    ) : reviewOnly ? (
      <Empty title="Everything here is reviewed." icon={CheckIcon} done>
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
  const row = (item: Transaction) => {
    if (item.id === inPlace)
      return <TransactionEditor key={item.id} accountColumn={accountColumn} />;
    const statusKey = item.reconciled ? "reconciled" : item.status;
    const status = statusIcon[statusKey];
    const checkable = item.source === "budget" || Boolean(item.editableImport);
    const isChecked = checkable && checked.includes(item.id);
    // Marks the row in its first column.
    const reviewDot = (
      <span
        className={styles.reviewDot}
        data-on={item.needsReview ? "" : undefined}
      >
        {item.needsReview && <span className="sr-only">Needs review</span>}
      </span>
    );
    return (
      <div
        key={item.id}
        className={`${styles.rowWrap} ${reviewStyles.checkable}`}
        data-checked={isChecked || undefined}
        data-entering={(isChecked && entering.includes(item.id)) || undefined}
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
          data-pending={item.status === "pending" || undefined}
          className={`${styles.txColumns} ${styles.row}`}
          aria-current={selectedId === item.id ? "true" : undefined}
          onClick={(event) => {
            // A pointer click; Enter and Space click with no position.
            if (isChecked && checked.length === 1 && event.detail > 0) {
              const column = columnAt(
                event.currentTarget,
                event.clientX,
                item.categoryNotNeeded ? "category" : undefined,
              );
              if (column) {
                entry.start({
                  transactionId: item.id,
                  field: registerEditFields[column]!,
                });
                return;
              }
            }
            onSelect(item.id);
          }}
        >
          {accountColumn && (
            <span
              className={styles.rowName}
              data-column="account"
              data-optional
            >
              {reviewDot}
              <span className={`${styles.truncate} ${styles.faint}`}>
                {accountName(item.accountId) ?? "Unlinked bank account"}
              </span>
            </span>
          )}
          <span className={styles.rowName} data-column="date" data-optional>
            {!accountColumn && reviewDot}
            <span className={`${styles.truncate} ${styles.muted}`}>
              {shortDay(item.date)}
            </span>
          </span>
          <span
            className={styles.rowName}
            data-column="payee"
            data-jump={Boolean(item.counterpart) || undefined}
          >
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
            <status.icon
              size={14}
              className={styles.statusIcon}
              data-status={statusKey}
              aria-label={status.label}
            />
          </span>
        </button>
        {item.counterpart && (
          <div className={`${styles.txColumns} ${styles.rowActions}`}>
            <span className={styles.counterpartAction}>
              <IconButton
                asChild
                label={`View in ${item.counterpart.accountName}`}
                size="sm"
              >
                <a
                  href={`/prototype/app-shell?${new URLSearchParams({
                    account: item.counterpart.accountId,
                    transaction: item.counterpart.id,
                    month: item.counterpart.date.slice(0, 7),
                  }).toString()}`}
                  onClick={(event) => {
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    onJump(item.counterpart!);
                  }}
                >
                  <ArrowRightLeftIcon aria-hidden />
                </a>
              </IconButton>
            </span>
            <span
              aria-hidden
              className={`${styles.numeric} ${styles.actionAmountSizer}`}
            >
              {money(Math.abs(item.amount))}
            </span>
          </div>
        )}
      </div>
    );
  };
  return (
    <div
      className={`${styles.list} ${styles.register} ${reviewStyles.register}`}
      ref={register}
      data-accounts={accountColumn || undefined}
      role="group"
      aria-label="Transactions"
      data-selecting={selection.selected.length > 0 || undefined}
      data-instant={keyboard || undefined}
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
      <div className={`${styles.txColumns} ${styles.columnHeader}`}>
        <SelectAll selection={selection} onCheck={onCheck} />
        {accountColumn && (
          <span data-column="account" data-optional aria-hidden>
            Account
          </span>
        )}
        <span data-column="date" data-optional aria-hidden>
          Date
        </span>
        <span data-column="payee" aria-hidden>
          Payee
        </span>
        <span data-column="category" aria-hidden>
          Category
        </span>
        <span
          className={styles.numeric}
          data-column="outflow"
          data-wide
          aria-hidden
        >
          Outflow
        </span>
        <span
          className={styles.numeric}
          data-column="inflow"
          data-wide
          aria-hidden
        >
          Inflow
        </span>
        <span className={styles.numeric} data-narrow aria-hidden>
          Amount
        </span>
        <span data-column="status" />
      </div>
      {session && !inPlace && (
        <TransactionEditor accountColumn={accountColumn} />
      )}
      {pending.length > 0 && (
        <div
          role="group"
          aria-label="Pending transactions"
          className={styles.pendingGroup}
        >
          <button
            type="button"
            className={`${styles.dayRow} ${styles.groupRow} ${styles.pendingHeader}`}
            aria-expanded={pendingOpen}
            onClick={() => setPendingOpen(!pendingOpen)}
          >
            <ChevronDownIcon
              size={12}
              strokeWidth={2.5}
              className={styles.groupCaret}
              aria-hidden
            />
            <span>Pending</span>
            <span className={styles.groupCount}>{pending.length}</span>
          </button>
          {/* Collapsing keeps a transaction that's being edited open. */}
          {pending
            .filter((item) => pendingOpen || item.id === inPlace)
            .map(row)}
        </div>
      )}
      {cleared.map(row)}
      <SelectionIsland selection={selection} onCheck={onCheck} />
    </div>
  );
}

function useJustChecked(checked: string[]) {
  const [previous, setPrevious] = useState(checked);
  const [entering, setEntering] = useState<string[]>([]);
  if (previous !== checked) {
    setPrevious(checked);
    setEntering(checked.filter((id) => !previous.includes(id)));
  }
  useEffect(() => {
    if (!entering.length) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setEntering([]));
    });
    return () => cancelAnimationFrame(frame);
  }, [entering]);
  return entering;
}

function useKeyboardInput() {
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const onKeyDown = () => setKeyboard(true);
    const onPointerDown = () => setKeyboard(false);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);
  return keyboard;
}

function Empty({
  title,
  icon: Icon = LandmarkIcon,
  done = false,
  action,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  // Nothing is left to do, like every category being funded.
  done?: boolean;
  // The one thing to do next, under the explanation.
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.empty} data-tone={done ? "done" : undefined}>
      <Icon size={18} aria-hidden />
      <div className={styles.emptyBody}>
        <p>
          <strong>{title}</strong>
          {children}
        </p>
        {action && <div>{action}</div>}
      </div>
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
