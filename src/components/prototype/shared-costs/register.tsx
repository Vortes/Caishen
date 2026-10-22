"use client";

import {
  ArrowRightLeftIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleAlertIcon,
  Clock3Icon,
  PlusIcon,
  SplitIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { IconButton } from "~/components/ui/icon-button";
import { Tag } from "~/components/ui/tag";
import { Figure, Property, Title } from "../app-shell/cards";
import { shortDay } from "../app-shell/model";
import {
  ChoiceField,
  PayeeField,
  type ChoiceOption,
} from "../app-shell/transaction-fields";
import shell from "../app-shell/shell.module.css";
import entry from "../app-shell/transaction-entry.module.css";
import {
  accountName,
  categoryName,
  isPartner,
  money,
  partnerShareOf,
  payeeMemory,
  payees,
  PEOPLE,
  RTA,
  sideMemory,
  spendingCategories,
  sum,
  TODAY,
  type Edit,
  type Line,
  type PartnerTransfer,
  type ReimbursementTransfer,
  type Share,
  type Txn,
  type World,
} from "./model";
import { parseCents, ShareControl } from "./share";
import { useRevealed, useStore } from "./store";
import styles from "./shared-costs.module.css";

export type Row =
  | { kind: "txn"; id: string; date: string; txn: Txn }
  | { kind: "transfer"; id: string; date: string; transfer: PartnerTransfer }
  | {
      kind: "reimbursement";
      id: string;
      date: string;
      transfer: ReimbursementTransfer;
    };

export function registerRows(
  world: World,
  viewer: "alan" | "anna",
  accountId: string | null,
): Row[] {
  const here = (id: string | null) =>
    id !== null && (accountId === null || id === accountId);
  return [
    ...world.txns
      .filter((item) => item.owner === viewer && here(item.accountId))
      .map((txn) => ({
        kind: "txn" as const,
        id: txn.id,
        date: txn.date,
        txn,
      })),
    ...world.transfers
      .filter((item) => here(item.accountId[viewer]))
      .map((transfer) => ({
        kind: "transfer" as const,
        id: transfer.id,
        date: transfer.date,
        transfer,
      })),
    ...world.reimbursements
      .filter((item) => item.owner === viewer && here(item.accountId))
      .map((transfer) => ({
        kind: "reimbursement" as const,
        id: transfer.id,
        date: transfer.date,
        transfer,
      })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

export const needsReview = (row: Row) =>
  row.kind === "txn" ? !row.txn.reviewed : !row.transfer.confirmed;

const whoLabel = (share: Share, partner: "alan" | "anna") =>
  isPartner(share) ? PEOPLE[partner].name : share.who;

// ---------- The register ----------

export function BankRegister({
  accountId,
  openId,
  onOpen,
  adding,
  onAdding,
  reviewOnly,
}: {
  accountId: string | null;
  openId: string | null;
  onOpen: (id: string | null) => void;
  adding: boolean;
  onAdding: (adding: boolean) => void;
  reviewOnly: boolean;
}) {
  const { world, viewer, budget, variants, notify } = useStore();
  const all = registerRows(world, viewer, accountId);
  const rows = reviewOnly ? all.filter(needsReview) : all;
  const pending = rows.filter((row) => row.kind === "txn" && row.txn.pending);
  const cleared = rows.filter(
    (row) => !(row.kind === "txn" && row.txn.pending),
  );
  const scheduled = world.scheduled.filter(
    (item) =>
      item.owner === viewer &&
      (accountId === null || item.accountId === accountId),
  );
  const [pendingOpen, setPendingOpen] = useState(true);
  const [scheduledOpen, setScheduledOpen] = useState(true);
  const accountColumn = accountId === null;
  const inRow = variants.entry === "row";

  const row = (item: Row) => {
    const open = item.id === openId;
    if (open && inRow) {
      return item.kind === "txn" ? (
        <TxnEditor
          key={item.id}
          txn={item.txn}
          accountId={item.txn.accountId}
          accountColumn={accountColumn}
          onClose={() => onOpen(null)}
        />
      ) : (
        <TransferReview key={item.id} row={item} onClose={() => onOpen(null)} />
      );
    }
    return (
      <RegisterRow
        key={item.id}
        row={item}
        current={open}
        accountColumn={accountColumn}
        onClick={() => onOpen(open && !inRow ? null : item.id)}
      />
    );
  };

  return (
    <div
      className={`${shell.list} ${shell.register} ${styles.register}`}
      data-accounts={accountColumn || undefined}
      role="group"
      aria-label="Transactions"
    >
      <div className={`${shell.txColumns} ${shell.columnHeader}`} aria-hidden>
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
        <span className={shell.numeric} data-column="outflow" data-wide>
          Outflow
        </span>
        <span className={shell.numeric} data-column="inflow" data-wide>
          Inflow
        </span>
        <span className={shell.numeric} data-narrow>
          Amount
        </span>
        <span data-column="status" />
      </div>
      {adding && (
        <TxnEditor
          txn={null}
          accountId={accountId ?? budget.shell.accounts[1]!.id}
          accountColumn={accountColumn}
          onClose={() => onAdding(false)}
        />
      )}
      {scheduled.length > 0 && !reviewOnly && (
        <div role="group" aria-label="Scheduled" className={shell.pendingGroup}>
          <button
            type="button"
            className={`${shell.dayRow} ${shell.groupRow} ${shell.pendingHeader}`}
            aria-expanded={scheduledOpen}
            onClick={() => setScheduledOpen(!scheduledOpen)}
          >
            <ChevronDownIcon
              size={12}
              strokeWidth={2.5}
              className={shell.groupCaret}
              aria-hidden
            />
            <span>Scheduled</span>
            <span className={shell.groupCount}>{scheduled.length}</span>
          </button>
          {scheduledOpen &&
            scheduled.map((item) => (
              <div key={item.id} className={shell.rowWrap}>
                <button
                  type="button"
                  className={`${shell.txColumns} ${shell.row}`}
                  data-pending
                  onClick={() =>
                    notify(
                      `${item.payee} is scheduled for ${shortDay(item.date)}. When its import arrives, it comes in with this category and share.`,
                    )
                  }
                >
                  {accountColumn && (
                    <span className={shell.rowName} data-optional>
                      <span className={`${shell.truncate} ${shell.faint}`}>
                        {accountName(viewer, item.accountId)}
                      </span>
                    </span>
                  )}
                  <span className={shell.rowName} data-optional>
                    <span className={`${shell.truncate} ${shell.muted}`}>
                      {shortDay(item.date)}
                    </span>
                  </span>
                  <span className={shell.rowName}>
                    <span className={shell.truncate}>{item.payee}</span>
                  </span>
                  <span className={styles.categoryCell}>
                    <span className={`${shell.truncate} ${shell.muted}`}>
                      {categoryName(viewer, item.categoryId)}
                    </span>
                    {item.share && (
                      <ShareChip
                        who={whoLabel(item.share, budget.partner)}
                        amount={item.share.amount}
                      />
                    )}
                  </span>
                  <span className={shell.numeric}>{money(item.amount)}</span>
                  <span className={shell.numeric} data-empty />
                  <span className={shell.statusCell}>
                    <CalendarClockIcon
                      size={14}
                      className={shell.statusIcon}
                      aria-label="Scheduled"
                    />
                  </span>
                </button>
              </div>
            ))}
        </div>
      )}
      {pending.length > 0 && (
        <div role="group" aria-label="Pending" className={shell.pendingGroup}>
          <button
            type="button"
            className={`${shell.dayRow} ${shell.groupRow} ${shell.pendingHeader}`}
            aria-expanded={pendingOpen}
            onClick={() => setPendingOpen(!pendingOpen)}
          >
            <ChevronDownIcon
              size={12}
              strokeWidth={2.5}
              className={shell.groupCaret}
              aria-hidden
            />
            <span>Pending</span>
            <span className={shell.groupCount}>{pending.length}</span>
          </button>
          {pendingOpen && pending.map(row)}
        </div>
      )}
      {cleared.map(row)}
      {!rows.length && !adding && (
        <div className={shell.empty} data-tone="done">
          <CircleCheckIcon size={18} aria-hidden />
          <div className={shell.emptyBody}>
            <p>
              <strong>Everything here is reviewed.</strong>
              New bank imports show up as they arrive.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ShareChip({ who, amount }: { who: string; amount: number }) {
  return (
    <span className={styles.shareChip}>
      <UsersIcon size={12} aria-hidden />
      <span className={shell.truncate}>
        {who} {money(Math.abs(amount))}
      </span>
    </span>
  );
}

function RegisterRow({
  row,
  current,
  accountColumn,
  onClick,
}: {
  row: Row;
  current: boolean;
  accountColumn: boolean;
  onClick: () => void;
}) {
  const { viewer, budget } = useStore();
  const review = needsReview(row);
  const pending = row.kind === "txn" && Boolean(row.txn.pending);
  let payee: string;
  let category: ReactNode;
  let amount: number;
  let accountId: string | null;
  let status: "pending" | "posted" | "manual";
  if (row.kind === "txn") {
    const { txn } = row;
    payee = txn.payee;
    amount = -sum(txn.lines.map((line) => line.amount));
    accountId = txn.accountId;
    status = !txn.imported ? "manual" : txn.pending ? "pending" : "posted";
    const shares = txn.lines.filter((line) => line.share);
    const label =
      txn.lines.length > 1
        ? `Split (${txn.lines.length})`
        : categoryName(viewer, txn.lines[0]!.categoryId);
    category = (
      <>
        {label ? (
          <span className={`${shell.truncate} ${shell.muted}`}>{label}</span>
        ) : (
          <Tag tone="attention">Needs category</Tag>
        )}
        {sum(shares.map((line) => line.share!.amount)) !== 0 && (
          <ShareChip
            who={whoLabel(shares[0]!.share!, budget.partner)}
            amount={sum(shares.map((line) => line.share!.amount))}
          />
        )}
      </>
    );
  } else {
    const { transfer } = row;
    const partnerSide = row.kind === "transfer";
    const toMe = partnerSide
      ? row.transfer.to === viewer
      : row.transfer.amount > 0;
    payee = partnerSide ? row.transfer.payee[viewer] : row.transfer.payee;
    amount = partnerSide
      ? toMe
        ? transfer.amount
        : -transfer.amount
      : transfer.amount;
    accountId = partnerSide
      ? row.transfer.accountId[viewer]
      : row.transfer.accountId;
    status = "posted";
    const name = partnerSide
      ? PEOPLE[budget.partner].name
      : `Reimbursements, ${row.transfer.who}`;
    category = (
      <span className={styles.transferCell}>
        <ArrowRightLeftIcon size={12} aria-hidden />
        <span className={`${shell.truncate} ${shell.muted}`}>
          {toMe ? `Transfer from ${name}` : `Transfer to ${name}`}
        </span>
      </span>
    );
  }
  const Icon =
    status === "manual"
      ? CircleDashedIcon
      : status === "pending"
        ? Clock3Icon
        : CircleCheckIcon;
  return (
    <div className={shell.rowWrap}>
      <button
        type="button"
        data-row
        className={`${shell.txColumns} ${shell.row}`}
        data-pending={pending || undefined}
        aria-current={current ? "true" : undefined}
        onClick={onClick}
      >
        {accountColumn && (
          <span className={shell.rowName} data-column="account" data-optional>
            <span className={shell.reviewDot} data-on={review || undefined} />
            <span className={`${shell.truncate} ${shell.faint}`}>
              {accountName(viewer, accountId)}
            </span>
          </span>
        )}
        <span className={shell.rowName} data-column="date" data-optional>
          {!accountColumn && (
            <span className={shell.reviewDot} data-on={review || undefined}>
              {review && <span className="sr-only">Needs review</span>}
            </span>
          )}
          <span className={`${shell.truncate} ${shell.muted}`}>
            {shortDay(row.date)}
          </span>
        </span>
        <span className={shell.rowName} data-column="payee">
          <span className={shell.truncate}>{payee}</span>
        </span>
        <span className={styles.categoryCell} data-column="category">
          {category}
        </span>
        <span
          className={shell.numeric}
          data-column="outflow"
          data-empty={amount < 0 ? undefined : true}
        >
          {amount < 0 && money(-amount)}
        </span>
        <span
          className={shell.numeric}
          data-column="inflow"
          data-empty={amount > 0 ? undefined : true}
          data-inflow={amount > 0 || undefined}
        >
          {amount > 0 && money(amount)}
        </span>
        <span className={shell.statusCell} data-column="status">
          <Icon
            size={14}
            className={shell.statusIcon}
            data-status={status}
            aria-label={
              status === "manual"
                ? "Waiting for the bank import"
                : status === "pending"
                  ? "Pending"
                  : "Cleared"
            }
          />
        </span>
      </button>
    </div>
  );
}

// ---------- Settlement review ----------

export function TransferReview({
  row,
  onClose,
  layout = "row",
}: {
  row: Extract<Row, { kind: "transfer" | "reimbursement" }>;
  onClose: () => void;
  layout?: "row" | "panel";
}) {
  const { viewer, budget, update } = useStore();
  const revealed = useRevealed<HTMLDivElement>();
  const partner = PEOPLE[budget.partner].name;
  const confirmed = row.transfer.confirmed;
  let title: string;
  let body: ReactNode;
  let amount: number;
  if (row.kind === "transfer") {
    const t = row.transfer;
    const toMe = t.to === viewer;
    amount = toMe ? t.amount : -t.amount;
    const onCard =
      budget.shell.accounts.find((item) => item.id === t.accountId[viewer])
        ?.kind === "credit";
    title = toMe ? `Transfer from ${partner}` : `Transfer to ${partner}`;
    body = (
      <>
        <p>
          {onCard
            ? `${partner} paid your ${accountName(viewer, t.accountId[viewer])} directly. Your card debt drops ${money(t.amount)}, ${partner}'s account drops ${money(t.amount)}, and your paired envelope gets it back from the card payment reserve.`
            : toMe
              ? `Money from ${partner}: not income and not spending, so it needs no category. ${partner}'s account drops ${money(t.amount)} and your paired envelope refills by as much.`
              : `Money to ${partner}: not spending, so it needs no category. It comes out of your paired envelope, where what you owe was held.`}
        </p>
        <p className={styles.reviewFoot}>
          {confirmed
            ? `Matched with ${partner}'s ${t.payee[budget.partner]} import, by amount, date, and direction.`
            : `${partner}'s ${t.payee[budget.partner]} import matches by amount, date, and direction. Confirming clears it there too.`}
        </p>
      </>
    );
  } else {
    const t = row.transfer;
    amount = t.amount;
    title = `Transfer from Reimbursements, ${t.who}`;
    body = (
      <p>
        {t.who} paid you back. It refills your Reimbursements envelope, not
        Ready to Assign; move anything extra from there. {t.who}&rsquo;s balance
        drops {money(t.amount)}.
      </p>
    );
  }
  const confirm = () => {
    update(
      (world) =>
        row.kind === "transfer"
          ? {
              ...world,
              transfers: world.transfers.map((item) =>
                item.id === row.id ? { ...item, confirmed: true } : item,
              ),
            }
          : {
              ...world,
              reimbursements: world.reimbursements.map((item) =>
                item.id === row.id ? { ...item, confirmed: true } : item,
              ),
            },
      row.kind === "transfer"
        ? `Transfer confirmed. It's cleared in ${partner}'s budget too.`
        : "Transfer confirmed.",
    );
    onClose();
  };
  const actions = (
    <div className={entry.actions}>
      <Button size="sm" onClick={onClose}>
        {confirmed ? "Close" : "Not now"}
      </Button>
      {!confirmed && (
        <Button size="sm" variant="primary" onClick={confirm}>
          Confirm transfer
        </Button>
      )}
    </div>
  );
  if (layout === "panel") {
    return (
      <>
        <Card>
          <Title
            title={title}
            subtitle={`${shortDay(row.date)} · ${
              row.kind === "transfer"
                ? row.transfer.payee[viewer]
                : row.transfer.payee
            }`}
          />
          <Figure
            value={money(amount, true)}
            caption={
              confirmed ? "Confirmed transfer" : "Recognized as a transfer"
            }
          />
        </Card>
        <Card>
          <div className={styles.panelText}>{body}</div>
          <div className={styles.panelActions}>{actions}</div>
        </Card>
      </>
    );
  }
  return (
    <div ref={revealed} className={`${entry.form} ${styles.reviewCard}`}>
      <div className={styles.reviewHead}>
        <ArrowRightLeftIcon size={14} aria-hidden />
        <strong>{title}</strong>
        <span className={styles.reviewAmount}>{money(amount, true)}</span>
      </div>
      <div className={styles.reviewBody}>{body}</div>
      <div className={entry.rowFooter}>{actions}</div>
    </div>
  );
}

// ---------- The editor ----------

type DraftLine = {
  id: string;
  categoryId: string | null;
  amount: string;
  share?: Share;
  // From payee memory: the share as a part of the amount, kept as the
  // amount is typed.
  ratio?: { who: string; part: number };
};

const plain = (cents: number) => (Math.abs(cents) / 100).toFixed(2);

const toDraft = (line: Line): DraftLine => ({
  id: line.id,
  categoryId: line.categoryId,
  amount: plain(line.amount),
  share: line.share,
});

let lineCount = 0;
const nextLineId = () => `n${++lineCount}`;

export function TxnEditor({
  txn,
  accountId,
  accountColumn = false,
  onClose,
  layout = "row",
}: {
  txn: Txn | null;
  accountId: string | null;
  accountColumn?: boolean;
  onClose: () => void;
  layout?: "row" | "panel";
}) {
  const { world, viewer, budget, update } = useStore();
  const revealed = useRevealed<HTMLFormElement>();
  const partner = PEOPLE[budget.partner].name;
  const inflow = txn ? sum(txn.lines.map((line) => line.amount)) < 0 : false;
  const [payee, setPayee] = useState(txn?.payee ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    txn
      ? txn.lines.map(toDraft)
      : [{ id: nextLineId(), categoryId: null, amount: "" }],
  );
  const [touched, setTouched] = useState(Boolean(txn));
  const [hint, setHint] = useState<string | null>(
    txn?.prefill === "memory"
      ? `Category and share filled in from your last ${txn.payee}.`
      : txn?.prefill === "schedule"
        ? `Category and share filled in from your scheduled ${txn.payee}.`
        : txn && !txn.reviewed && !txn.lines.some((line) => line.share)
          ? `New payee, so the line starts as all yours.`
          : null,
  );
  const [error, setError] = useState<string | null>(null);
  // Bumped when payee memory fills the line, so the share control restarts.
  const [filled, setFilled] = useState(0);
  const split = lines.length > 1;
  const fixedTotal = txn?.imported
    ? Math.abs(sum(txn.lines.map((l) => l.amount)))
    : null;
  const sign = inflow ? -1 : 1;
  const cents = (line: DraftLine) => parseCents(line.amount) ?? 0;
  const total = split
    ? (fixedTotal ?? sum(lines.map(cents)))
    : cents(lines[0]!);
  const left = fixedTotal !== null ? fixedTotal - sum(lines.map(cents)) : 0;

  const categoryOptions: ChoiceOption[] = [
    ...(inflow
      ? [{ value: RTA, label: "Ready to Assign", group: "Inflow" }]
      : []),
    ...spendingCategories(viewer).map((item) => ({
      value: item.id,
      label: item.name,
      group: item.group,
      amount: budget.shell.categories.find((c) => c.id === item.id)?.available,
    })),
  ];
  const setLine = (id: string, change: Partial<DraftLine>) =>
    setLines((list) =>
      list.map((line) => (line.id === id ? { ...line, ...change } : line)),
    );
  const prefill = (name: string) => {
    if (touched || txn) return;
    const amount = cents(lines[0]!);
    const memory = payeeMemory(world, viewer, name, amount || 0);
    if (memory.source === "none") {
      setHint(
        name.trim() ? "New payee, so the line starts as all yours." : null,
      );
      return;
    }
    const probe = payeeMemory(world, viewer, name, 1_000_000).share;
    setLines([
      {
        id: lines[0]!.id,
        categoryId: memory.categoryId,
        amount: lines[0]!.amount,
        share: memory.share?.amount ? memory.share : undefined,
        ratio: probe && { who: probe.who, part: probe.amount / 1_000_000 },
      },
    ]);
    setHint(`Category and share filled in from your last ${name}.`);
    setFilled((count) => count + 1);
  };
  const splitUp = () => {
    const first = lines[0]!;
    const whole = cents(first);
    setTouched(true);
    // The first line keeps what it had; the second starts empty, and
    // takes whatever the first gives up.
    setLines([
      first,
      { id: nextLineId(), categoryId: null, amount: whole ? "0.00" : "" },
    ]);
  };

  const save = () => {
    if (!payee.trim()) return setError("Add a payee.");
    const built: Line[] = lines.map((line) => ({
      id: line.id,
      categoryId: line.categoryId,
      amount: sign * cents(line),
      share: line.share?.amount
        ? { who: line.share.who, amount: line.share.amount }
        : undefined,
    }));
    if (built.some((line) => !line.amount))
      return setError("Every line needs an amount.");
    if (split && fixedTotal !== null && left !== 0)
      return setError(
        `The lines add up to ${money(fixedTotal - left)}; the bank says ${money(fixedTotal)}.`,
      );
    if (
      built.some(
        (line) =>
          line.share && Math.abs(line.share.amount) > Math.abs(line.amount),
      )
    )
      return setError("A share can't be more than its line.");
    const before = txn ? partnerShareOf(txn) : 0;
    const draftTxn: Txn = txn
      ? { ...txn, payee: payee.trim(), lines: built, reviewed: true }
      : {
          id: `t-new-${Date.now()}`,
          owner: viewer,
          accountId,
          date: TODAY,
          payee: payee.trim(),
          lines: built,
          recordedBy: viewer,
          imported: false,
          reviewed: true,
          history: [],
        };
    const after = partnerShareOf(draftTxn);
    const edits: Edit[] = [];
    if (txn && before !== after)
      edits.push({
        who: viewer,
        what: `${partner}'s share`,
        from: before,
        to: after,
        when: TODAY,
      });
    if (txn) {
      const named = (item: Txn) =>
        new Map(
          item.lines
            .filter((line) => line.share && !isPartner(line.share))
            .map((line) => [line.share!.who, line.share!.amount]),
        );
      const was = named(txn);
      const now = named(draftTxn);
      for (const name of new Set([...was.keys(), ...now.keys()]))
        if ((was.get(name) ?? 0) !== (now.get(name) ?? 0))
          edits.push({
            who: viewer,
            what: `${name}'s share`,
            from: was.get(name) ?? 0,
            to: now.get(name) ?? 0,
            when: TODAY,
          });
    }
    draftTxn.history = [...draftTxn.history, ...edits];
    update(
      (current) => {
        const txns = txn
          ? current.txns.map((item) => (item.id === txn.id ? draftTxn : item))
          : [draftTxn, ...current.txns];
        const side = { ...current.side };
        if (after && !side[draftTxn.id]) {
          const category = sideMemory(current, budget.partner, draftTxn.payee);
          side[draftTxn.id] = {
            categoryId: category,
            reviewed: false,
            prefill: Boolean(category),
          };
        }
        return { ...current, txns, side };
      },
      before !== after
        ? after
          ? `Saved. ${partner}'s budget shows a ${money(Math.abs(after))} share now.`
          : `Saved. ${partner}'s share is gone from both budgets.`
        : txn
          ? "Saved."
          : "Transaction added.",
    );
    onClose();
  };

  const payeeField = (
    <div
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) prefill(payee);
      }}
    >
      <PayeeField
        id={`${txn?.id ?? "new"}-payee`}
        label="Payee"
        value={payee}
        payees={payees(viewer)}
        placeholder="Payee"
        readOnly={Boolean(txn?.imported)}
        onChange={(value) => {
          setPayee(value);
          setError(null);
        }}
        onPicked={(value) => prefill(value)}
      />
    </div>
  );
  const categoryField = (line: DraftLine) => (
    <ChoiceField
      id={`${txn?.id ?? "new"}-${line.id}-category`}
      label="Category"
      value={line.categoryId ?? ""}
      options={categoryOptions}
      placeholder="Category"
      onChange={(value) => {
        setTouched(true);
        setLine(line.id, { categoryId: value });
      }}
    />
  );
  const amountField = (line: DraftLine, label: string, fixed = false) => (
    <div className={entry.well} data-amount data-disabled={fixed || undefined}>
      <span className={entry.prefix} aria-hidden>
        $
      </span>
      <input
        className={entry.input}
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        placeholder={inflow ? "Inflow" : "Outflow"}
        disabled={fixed}
        value={line.amount}
        onChange={(event) => {
          const value = event.target.value;
          const now = parseCents(value) ?? 0;
          const was = cents(line);
          // A share follows its line's amount: half stays half.
          const share = line.ratio
            ? now
              ? {
                  who: line.ratio.who,
                  amount: Math.round(now * line.ratio.part),
                }
              : undefined
            : line.share && was
              ? {
                  ...line.share,
                  amount: Math.round((line.share.amount * now) / was),
                }
              : line.share;
          if (share?.amount !== line.share?.amount)
            setFilled((count) => count + 1);
          setLines((list) => {
            const next = list.map((item) =>
              item.id === line.id ? { ...item, amount: value, share } : item,
            );
            // With two lines on a bank amount, the other takes the rest.
            if (next.length !== 2 || fixedTotal === null) return next;
            const rest = fixedTotal - (parseCents(value) ?? 0);
            return next.map((item) =>
              item.id === line.id || rest < 0
                ? item
                : { ...item, amount: plain(rest) },
            );
          });
        }}
      />
    </div>
  );
  const shareControl = (line: DraftLine, stack = false) => (
    <ShareControl
      key={`${line.id}-${filled}`}
      id={`${txn?.id ?? "new"}-${line.id}-share`}
      lineAmount={sign * cents(line)}
      share={line.share}
      layout={stack ? "stack" : "row"}
      onChange={(share) => {
        setTouched(true);
        setHint(null);
        setLine(line.id, { share, ratio: undefined });
      }}
    />
  );
  const lineRows = split && (
    <div className={styles.splitLines} data-layout={layout}>
      {lines.map((line, index) => (
        <div key={line.id} className={styles.splitLine}>
          <div className={styles.splitLineFields}>
            <span className={styles.lineLabel}>Line {index + 1}</span>
            <div className={styles.lineCategory}>{categoryField(line)}</div>
            <div className={styles.lineAmount}>
              {amountField(line, `Line ${index + 1} amount`)}
            </div>
            <IconButton
              size="sm"
              label={`Remove line ${index + 1}`}
              disabled={lines.length <= 2}
              onClick={() =>
                setLines((list) => list.filter((item) => item.id !== line.id))
              }
            >
              <XIcon aria-hidden />
            </IconButton>
          </div>
          <div className={styles.splitLineShare}>{shareControl(line)}</div>
        </div>
      ))}
      <div className={styles.splitFoot}>
        <Button
          size="sm"
          variant="quiet"
          onClick={() =>
            setLines((list) => [
              ...list,
              {
                id: nextLineId(),
                categoryId: null,
                amount: left > 0 ? plain(left) : "",
              },
            ])
          }
        >
          <PlusIcon aria-hidden />
          Add line
        </Button>
        {fixedTotal !== null && (
          <span className={styles.splitLeft} data-off={left !== 0 || undefined}>
            {left === 0
              ? `Lines add up to ${money(fixedTotal)}`
              : left > 0
                ? `${money(left)} left to put on a line`
                : `${money(-left)} more than the bank's ${money(fixedTotal)}`}
          </span>
        )}
      </div>
    </div>
  );
  const footer = (
    <div className={entry.rowFooter}>
      {error ? (
        <p className={entry.formError} role="status">
          <CircleAlertIcon size={13} aria-hidden />
          {error}
        </p>
      ) : (
        hint && <p className={styles.hint}>{hint}</p>
      )}
      <div className={entry.actions}>
        {!split && (
          <Button size="sm" variant="quiet" onClick={splitUp}>
            <SplitIcon aria-hidden />
            Split
          </Button>
        )}
        <Button size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit">
          {txn && !txn.reviewed ? "Save and approve" : "Save"}
        </Button>
      </div>
    </div>
  );
  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    save();
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.stopPropagation();
    onClose();
  };

  if (layout === "panel") {
    return (
      <form
        className={styles.panelForm}
        onSubmit={onSubmit}
        onKeyDown={onKeyDown}
        noValidate
        aria-label={txn ? `Edit ${txn.payee}` : "New transaction"}
      >
        <Card>
          <Title
            title={txn ? txn.payee : "New transaction"}
            subtitle={
              txn
                ? `${shortDay(txn.date)} · ${accountName(viewer, txn.accountId) ?? "Not imported yet"}`
                : (accountName(viewer, accountId) ?? undefined)
            }
          />
          <Figure
            value={money(total)}
            caption={
              txn?.imported
                ? txn.pending
                  ? "Pending at the bank"
                  : "Cleared by the bank"
                : "Entered by hand"
            }
          />
        </Card>
        <Card>
          <div className={styles.panelFields}>
            <span className={styles.panelLabel}>Payee</span>
            {payeeField}
            {!split && (
              <>
                <span className={styles.panelLabel}>Category</span>
                {categoryField(lines[0]!)}
                <span className={styles.panelLabel}>Amount</span>
                {amountField(lines[0]!, "Amount", Boolean(txn?.imported))}
                <div className={styles.panelShare}>
                  <span className={styles.panelLabel}>Share</span>
                  {shareControl(lines[0]!, true)}
                </div>
              </>
            )}
          </div>
          {lineRows}
          {footer}
        </Card>
      </form>
    );
  }

  return (
    <form
      ref={revealed}
      className={entry.form}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      noValidate
      aria-label={txn ? `Edit ${txn.payee}` : "New transaction"}
    >
      <div
        className={`${shell.txColumns} ${entry.entryRow}`}
        data-accounts={accountColumn || undefined}
      >
        {accountColumn && (
          <div className={entry.cell} data-column="account">
            <div className={entry.well} data-disabled>
              <input
                className={entry.input}
                aria-label="Account"
                value={accountName(viewer, accountId) ?? ""}
                disabled
              />
            </div>
          </div>
        )}
        <div className={entry.cell} data-column="date">
          <div className={entry.well} data-disabled>
            <input
              className={entry.input}
              aria-label="Date"
              value={shortDay(txn?.date ?? TODAY)}
              disabled
            />
          </div>
        </div>
        <div className={entry.cell} data-column="payee">
          {payeeField}
        </div>
        <div className={entry.cell} data-column="category">
          {split ? (
            <div className={entry.well} data-disabled>
              <input
                className={entry.input}
                aria-label="Category"
                value={`Split (${lines.length})`}
                disabled
              />
            </div>
          ) : (
            categoryField(lines[0]!)
          )}
        </div>
        <div className={entry.cell} data-column="outflow">
          {!inflow &&
            (split ? (
              <div className={entry.well} data-amount data-disabled>
                <input
                  className={entry.input}
                  aria-label="Outflow"
                  value={plain(total)}
                  disabled
                />
              </div>
            ) : (
              amountField(lines[0]!, "Outflow", Boolean(txn?.imported))
            ))}
        </div>
        <div className={entry.cell} data-column="inflow">
          {inflow &&
            amountField(lines[0]!, "Inflow", Boolean(txn?.imported) || split)}
        </div>
        <span data-column="status" aria-hidden />
      </div>
      {!split && (
        <div className={`${shell.txColumns} ${styles.shareRow}`}>
          <span className={styles.shareLabel}>Share</span>
          <div className={styles.shareSpan}>{shareControl(lines[0]!)}</div>
        </div>
      )}
      {lineRows}
      {footer}
    </form>
  );
}

// The selected row's details beside the register, for the panel variant.
export function RegisterPanel({
  openId,
  adding,
  accountId,
  onClose,
}: {
  openId: string | null;
  adding: boolean;
  accountId: string | null;
  onClose: () => void;
}) {
  const { world, viewer, budget } = useStore();
  if (adding)
    return (
      <TxnEditor
        txn={null}
        accountId={accountId ?? budget.shell.accounts[1]!.id}
        layout="panel"
        onClose={onClose}
      />
    );
  const row = registerRows(world, viewer, accountId).find(
    (item) => item.id === openId,
  );
  if (!row)
    return (
      <Card>
        <Title
          title="Nothing selected"
          subtitle="Pick a transaction to see its lines and shares."
        />
        <Property label="Shared">
          {
            registerRows(world, viewer, accountId).filter(
              (item) =>
                item.kind === "txn" &&
                item.txn.lines.some((line) => line.share),
            ).length
          }{" "}
          transactions here
        </Property>
      </Card>
    );
  if (row.kind === "txn")
    return (
      <TxnEditor
        key={row.id}
        txn={row.txn}
        accountId={row.txn.accountId}
        layout="panel"
        onClose={onClose}
      />
    );
  return (
    <TransferReview key={row.id} row={row} layout="panel" onClose={onClose} />
  );
}
