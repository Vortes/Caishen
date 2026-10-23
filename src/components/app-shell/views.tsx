"use client";

import { SHELL_PATH } from "~/components/workspace/routes";
import { counterpartyLines, isFullShare } from "~/domain/counterparty";
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
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { IconButton } from "~/components/ui/icon-button";
import { Tag } from "~/components/ui/tag";
import { useRowSelection } from "~/components/ui/use-row-selection";
import selectionStyles from "~/components/ui/row-selection.module.css";
import {
  isCounterparty,
  shortDay,
  money,
  type Category,
  type Funding,
  type Transaction,
} from "./model";
import { motion, MotionConfig } from "motion/react";
import { newId } from "~/components/budget/format";
import {
  AddToGroupButton,
  FirstGroupButton,
  isSystemGroup,
  useAddCategory,
  type Added,
} from "./add-category";
import { EASE, SETTLE_MS, useReorderDrag } from "./reorder-drag";
import { AssignedCell } from "./assigned";
import { FundingBar } from "./funding-bar";
import { useTransactionEntry, type DraftField } from "./transaction-entry";
import { TransactionEditor } from "./transaction-form";
import { RepaymentEditor } from "./repayment-editor";
import { ShareCell, ShareDetail } from "./share-detail";
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
export function moveSelection(event: KeyboardEvent<HTMLElement>) {
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
  const selectionStyle = useRowSelection(checked);
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
  const { add } = useAddCategory();
  const reorder = useReorderDrag({
    ids: groups.map((group) => group.id),
    enabled: groups.length > 1,
    onDrop: (order, id, done) => {
      // A view hides some groups; they keep their places around the ones
      // showing.
      const showing = new Set(order);
      let next = 0;
      const names = shell.groups.map((group) =>
        showing.has(group.id) ? order[next++]! : group.id,
      );
      const blocked = add(
        { type: "group.reorder", id: newId(), names },
        // A group's id is its name.
        `Moved ${id}`,
        done,
      );
      if (blocked) done();
    },
  });
  const byId = new Map(groups.map((group) => [group.id, group]));
  if (!shell.groups.length) {
    return (
      <Empty title="Give every dollar a job." action={<FirstGroupButton />}>
        Start with a category group, like Bills, then add the categories that go
        in it.
      </Empty>
    );
  }
  if (focus && !groups.length) {
    return (
      <Empty title={focus.empty.title} icon={CheckIcon} done>
        {focus.empty.body}
      </Empty>
    );
  }
  const totals = (group: (typeof groups)[number]) => {
    const sum = (pick: (category: Category) => number) =>
      group.categories.reduce((total, item) => total + pick(item), 0);
    return (
      <>
        <span className={styles.numeric} data-optional>
          {money(sum((item) => item.assigned))}
        </span>
        <span className={styles.numeric} data-optional>
          {money(sum((item) => item.activity))}
        </span>
        <span className={styles.numeric}>
          {money(sum((item) => item.available))}
        </span>
      </>
    );
  };
  const dragged = reorder.drag && byId.get(reorder.drag.id);
  // The column header's controls cover every group showing.
  const everyId = groups.flatMap((group) =>
    group.categories.map((item) => item.id),
  );
  const checkedCount = everyId.filter((id) => checked.includes(id)).length;
  const anyOpen = groups.some(
    (group) => group.categories.length > 0 && !closed.includes(group.id),
  );
  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={reorder.listRef}
        className={`${styles.list} ${styles.planList} ${selectionStyles.list}`}
        {...selectionStyle.listProps}
        role="group"
        aria-label="Categories"
        data-selecting={checked.length > 0 || undefined}
        data-dragging={reorder.drag ? true : undefined}
        data-settling={reorder.settling || undefined}
        onKeyDown={(event) => {
          const focused =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          // Alt+Up and Alt+Down move the focused group.
          const groupName = focused?.dataset.groupToggle;
          if (
            event.altKey &&
            groupName &&
            (event.key === "ArrowUp" || event.key === "ArrowDown")
          ) {
            event.preventDefault();
            reorder.nudge(groupName, event.key === "ArrowUp" ? -1 : 1);
            requestAnimationFrame(() =>
              document
                .querySelector<HTMLElement>(
                  `[data-group-toggle="${CSS.escape(groupName)}"]`,
                )
                ?.focus(),
            );
            return;
          }
          // x toggles the focused row's checkbox, like Linear.
          const id = focused?.dataset.id;
          if (event.key === "x" && id) {
            event.preventDefault();
            onCheck([id], !checked.includes(id));
            return;
          }
          moveSelection(event);
        }}
      >
        <div className={`${styles.columns} ${styles.columnHeader}`}>
          {everyId.length > 0 && (
            <RowCheckbox
              label="Select all categories"
              state={
                checkedCount === 0
                  ? false
                  : checkedCount === everyId.length
                    ? true
                    : "mixed"
              }
              onChange={() => onCheck(everyId, checkedCount < everyId.length)}
            />
          )}
          <span className={styles.groupName}>
            <button
              type="button"
              className={styles.groupToggle}
              aria-expanded={anyOpen}
              aria-label={anyOpen ? "Collapse all groups" : "Expand all groups"}
              onClick={() =>
                setClosed(anyOpen ? shell.groups.map((group) => group.id) : [])
              }
            >
              <ChevronDownIcon
                size={12}
                strokeWidth={2.5}
                className={styles.groupCaret}
                aria-hidden
              />
              <span aria-hidden>Category</span>
            </button>
          </span>
          <span className={styles.numeric} data-optional aria-hidden>
            Assigned
          </span>
          <span className={styles.numeric} data-optional aria-hidden>
            Activity
          </span>
          <span className={styles.numeric} aria-hidden>
            Available
          </span>
        </div>
        {reorder.order.map((groupId) => {
          const group = byId.get(groupId);
          if (!group) return null;
          const ids = group.categories.map((item) => item.id);
          // A group with no categories stays folded; its header's + adds one.
          // Every group folds while one is dragged.
          const open =
            ids.length > 0 && !closed.includes(group.id) && !reorder.drag;
          const count = ids.filter((id) => checked.includes(id)).length;
          return (
            <motion.div
              key={group.id}
              data-reorder-slot
              layout={reorder.animating ? "position" : false}
              transition={{ duration: SETTLE_MS / 1000, ease: EASE }}
            >
              {reorder.drag?.id === group.id ? (
                <div className={styles.dropSlot} aria-hidden />
              ) : (
                <div
                  className={styles.rowWrap}
                  onPointerDown={(event) => reorder.start(event, group.id)}
                >
                  {ids.length > 0 && (
                    <RowCheckbox
                      label={`Select ${group.name}`}
                      state={
                        count === 0
                          ? false
                          : count === ids.length
                            ? true
                            : "mixed"
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
                        aria-keyshortcuts={
                          reorder.enabled
                            ? "Alt+ArrowUp Alt+ArrowDown"
                            : undefined
                        }
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
                      {!isSystemGroup(group) && (
                        <span className={styles.groupAdd} data-no-drag>
                          <AddToGroupButton group={group.name} />
                        </span>
                      )}
                    </span>
                    {totals(group)}
                  </div>
                </div>
              )}
              {open &&
                group.categories.map((category) => {
                  const isChecked = checked.includes(category.id);
                  return (
                    <div
                      key={category.id}
                      className={`${styles.rowWrap} ${selectionStyles.row}`}
                      {...selectionStyle.rowProps(category.id)}
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
            </motion.div>
          );
        })}
        {dragged && (
          <motion.div
            className={styles.groupGhost}
            style={{ y: reorder.y }}
            initial={{ scale: 1 }}
            animate={{ scale: 1.01 }}
            transition={{ duration: 0.15, ease: EASE }}
            aria-hidden
          >
            <div className={`${styles.columns} ${styles.groupRow}`}>
              <span className={styles.groupName}>
                <span className={styles.groupToggle}>
                  <ChevronDownIcon
                    size={12}
                    strokeWidth={2.5}
                    className={styles.groupCaret}
                  />
                  <span className={styles.truncate}>{dragged.name}</span>
                  <span className={styles.groupCount}>
                    {dragged.categories.length}
                  </span>
                </span>
              </span>
              {totals(dragged)}
            </div>
          </motion.div>
        )}
      </div>
    </MotionConfig>
  );
}

// Lives in the row's left padding; shows on hover, focus, or once anything
// in the list is checked. The label is the hit area: the full row height.
function RowCheckbox({
  label,
  state,
  onChange,
  onShiftClick,
}: {
  label: string;
  state: boolean | "mixed";
  onChange: () => void;
  // Takes over a shift-click, which otherwise toggles just this box.
  onShiftClick?: () => void;
}) {
  return (
    <label
      className={styles.checkboxSlot}
      onClickCapture={(event) => {
        if (!onShiftClick || !event.shiftKey) return;
        event.preventDefault();
        onShiftClick();
      }}
    >
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
    item.shareLabel,
    accountName,
    money(Math.abs(item.amount)),
  ].some((value) => value?.toLowerCase().includes(text));
}

const registerEditFields: Record<string, DraftField> = {
  date: "date",
  payee: "payee",
  category: "categoryId",
  share: "counterpartyShare",
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
  const selectionStyle = useRowSelection(checked);
  // Shift-click checks, or clears, every row from the last one clicked to
  // this one, like YNAB and Gmail.
  const anchor = useRef<string | null>(null);
  const order = [...(pendingOpen ? pending : []), ...cleared]
    .filter((item) => item.actions.select)
    .map((item) => item.id);
  const checkTo = (id: string, value: boolean) => {
    const from = order.indexOf(anchor.current ?? selectedId ?? "");
    const to = order.indexOf(id);
    onCheck(
      from < 0 ? [id] : order.slice(Math.min(from, to), Math.max(from, to) + 1),
      value,
    );
    anchor.current = id;
  };
  // In the register the editor takes its transaction's row. A new one, or one
  // this month or filter hides, opens at the top.
  const editingId = session?.rowId;
  // A repayment opens in place too, as a note on what it is; it closes when
  // the selection moves on.
  const [repaymentId, setRepaymentId] = useState<string | null>(null);
  if (repaymentId && repaymentId !== selectedId) setRepaymentId(null);
  const fullySharedIds = new Set(
    entry.view.budget.transactions
      .filter((transaction) => {
        const lines = counterpartyLines(transaction);
        return lines.length > 0 && lines.every(isFullShare);
      })
      .map((transaction) => transaction.id),
  );
  const closeRepayment = () => {
    const id = repaymentId;
    setRepaymentId(null);
    requestAnimationFrame(() =>
      register.current
        ?.querySelector<HTMLButtonElement>(
          `[data-transaction-row="${CSS.escape(id ?? "")}"]`,
        )
        ?.focus(),
    );
  };
  const inPlace =
    session && rows.some((item) => item.id === editingId)
      ? editingId
      : undefined;
  const counterparty = accounts.find(
    (entry) => entry.id === accountId && isCounterparty(entry),
  );
  if (!rows.length && !session) {
    // A counterparty account's entries come from shares and settlements,
    // so its empty register says what will fill it.
    if (counterparty && !search)
      return (
        <Empty title="Nothing owed yet." icon={UsersIcon}>
          {counterparty.kind === "partner"
            ? `When you and ${counterparty.name} share a cost, what one of you owes the other shows here.`
            : "When you pay for someone, what they owe you shows here. Its envelope in People can set money aside to cover it."}
        </Empty>
      );
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
    if (item.id === repaymentId && item.repayment)
      return (
        <RepaymentEditor
          key={item.id}
          transaction={{ ...item, repayment: item.repayment }}
          accountName={
            accountColumn
              ? (accountName(item.accountId) ?? "Unlinked bank account")
              : undefined
          }
          onClose={closeRepayment}
        />
      );
    const statusKey = item.reconciled ? "reconciled" : item.status;
    const status = statusIcon[statusKey];
    const checkable = item.actions.select;
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
      <Fragment key={item.id}>
        <div
          className={`${styles.rowWrap} ${reviewStyles.checkable} ${selectionStyles.row}`}
          {...selectionStyle.rowProps(item.id)}
          onMouseDown={(event) => {
            // Shift would otherwise extend a text selection across rows.
            if (checkable && event.shiftKey) event.preventDefault();
          }}
        >
          {checkable && (
            <RowCheckbox
              label={`Select ${item.payee}`}
              state={isChecked}
              onChange={() => {
                anchor.current = item.id;
                onCheck([item.id], !isChecked);
              }}
              onShiftClick={() => checkTo(item.id, !isChecked)}
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
              if (checkable && event.shiftKey) {
                checkTo(item.id, !isChecked);
                return;
              }
              // Finishing a text selection in the row doesn't click it.
              if (event.detail > 0 && window.getSelection()?.toString()) return;
              anchor.current = item.id;
              // A pointer click; Enter and Space click with no position.
              if (selection.actions.edit?.id === item.id && event.detail > 0) {
                if (selection.actions.edit.kind === "repayment") {
                  setRepaymentId(item.id);
                  return;
                }
                const skip = item.categoryNotNeeded ? "category" : undefined;
                // The cell clicked, or the column nearest the pointer when the
                // click lands between cells.
                const clicked =
                  event.target instanceof Element
                    ? event.target.closest<HTMLElement>("[data-column]")
                        ?.dataset.column
                    : undefined;
                const column =
                  clicked && clicked in registerEditFields && clicked !== skip
                    ? clicked
                    : columnAt(event.currentTarget, event.clientX, skip);
                if (column && item.actions.edit === "transaction") {
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
            {/* The Share cell's control sits over the row, in ShareCell. */}
            <span data-column="share" aria-hidden />
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
          <ShareCell row={item} accountColumn={accountColumn} />
          {item.counterpart && (
            <div className={`${styles.txColumns} ${styles.rowActions}`}>
              <span className={styles.counterpartAction}>
                <IconButton
                  asChild
                  label={`View in ${item.counterpart.accountName}`}
                  size="sm"
                >
                  <a
                    href={`${SHELL_PATH}?${new URLSearchParams({
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
        {selectedId === item.id &&
          item.source === "budget" &&
          !fullySharedIds.has(item.id) && (
            <ShareDetail transactionId={item.id} />
          )}
      </Fragment>
    );
  };
  return (
    <div
      className={`${styles.list} ${styles.register} ${reviewStyles.register} ${selectionStyles.list}`}
      {...selectionStyle.listProps}
      ref={register}
      data-accounts={accountColumn || undefined}
      role="group"
      aria-label="Transactions"
      data-selecting={selection.selected.length > 0 || undefined}
      onKeyDown={(event) => {
        // x toggles the focused row's checkbox, like the plan.
        const id =
          document.activeElement instanceof HTMLElement
            ? document.activeElement.dataset.id
            : undefined;
        if (event.key === "x" && id) {
          event.preventDefault();
          anchor.current = id;
          onCheck([id], !checked.includes(id));
          return;
        }
        // e edits the selected row; a repayment's opens its note.
        if (
          event.key === "e" &&
          id === selectedId &&
          selection.actions.edit?.id === id &&
          selection.actions.edit?.kind === "repayment"
        ) {
          event.preventDefault();
          setRepaymentId(id);
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
        <span data-column="share" aria-hidden>
          Share
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
        <div className={styles.editorDock}>
          <TransactionEditor accountColumn={accountColumn} />
        </div>
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

export function Empty({
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
