"use client";

import {
  ArrowRightLeftIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  HandCoinsIcon,
  HeartHandshakeIcon,
  HistoryIcon,
  Link2Icon,
  ReceiptIcon,
  UsersIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { Tag } from "~/components/ui/tag";
import { shortDay } from "../app-shell/model";
import { ChoiceField, PayeeField } from "../app-shell/transaction-fields";
import shell from "../app-shell/shell.module.css";
import entry from "../app-shell/transaction-entry.module.css";
import {
  accountName,
  categoryName,
  expected,
  isPartner,
  ledger,
  money,
  other,
  PARTNER,
  partnerShareOf,
  payees,
  PEOPLE,
  reimbursementLedger,
  reimbursementPeople,
  requestProgress,
  sideMemory,
  spendingCategories,
  sum,
  TODAY,
  type LedgerEntry,
  type Person,
  type ReimbursementEntry,
  type Txn,
  type World,
} from "./model";
import { parseCents } from "./share";
import { useRevealed, useStore } from "./store";
import styles from "./shared-costs.module.css";

const longDay = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const plain = (cents: number) => (Math.abs(cents) / 100).toFixed(2);

// Sets a partner share on a transaction's one shared line, with history.
function setPartnerShare(
  world: World,
  txnId: string,
  amount: number,
  who: Person,
): World {
  return {
    ...world,
    txns: world.txns.map((item) => {
      if (item.id !== txnId) return item;
      const before = partnerShareOf(item);
      const lines = item.lines.map((line) =>
        isPartner(line.share)
          ? { ...line, share: { ...line.share!, amount } }
          : line,
      );
      return {
        ...item,
        lines,
        history: [
          ...item.history,
          {
            who,
            what: `${PEOPLE[other(item.owner)].name}'s share`,
            from: before,
            to: amount,
            when: TODAY,
          },
        ],
      };
    }),
  };
}

// ---------- Balance ----------

export function PartnerBalance() {
  const { world, viewer, budget, variants } = useStore();
  const partner = PEOPLE[budget.partner].name;
  const balance = budget.partnerBalance;
  const upcoming = expected(world, viewer);
  const after = balance + sum(upcoming.map((item) => item.effect));
  const sentence = (value: number) =>
    value === 0
      ? `You and ${partner} are even`
      : value > 0
        ? `${partner} owes you ${money(value)}`
        : `You owe ${partner} ${money(-value)}`;
  return (
    <div className={shell.accountSummary}>
      {variants.balance === "sentence" ? (
        <div className={styles.balanceHero}>
          <span className={styles.balanceCaption}>Balance with {partner}</span>
          <strong data-sign={Math.sign(balance)}>{sentence(balance)}</strong>
          {upcoming.length > 0 && (
            <span className={styles.balanceCaption}>
              With {upcoming.length} expected{" "}
              {upcoming.length === 1 ? "entry" : "entries"}:{" "}
              {sentence(after).replace(/^You /, "you ")}
            </span>
          )}
        </div>
      ) : (
        <dl className={shell.balances}>
          <div data-total>
            <dt>Balance</dt>
            <dd>{money(balance, true)}</dd>
          </div>
          <span className={shell.balanceOperator} aria-hidden>
            +
          </span>
          <div>
            <dt>Expected</dt>
            <dd>{money(after - balance, true)}</dd>
          </div>
          <span className={shell.balanceOperator} aria-hidden>
            =
          </span>
          <div>
            <dt>After scheduled</dt>
            <dd>{money(after, true)}</dd>
          </div>
          <p className={styles.signLegend}>
            Positive: {partner} owes you. Negative: you owe {partner}.
          </p>
        </dl>
      )}
      <div className={styles.ledgerAside}>
        <RequestStatus />
        <SplitSetting />
      </div>
    </div>
  );
}

function RequestStatus() {
  const { world, viewer, budget, update } = useStore();
  const partner = PEOPLE[budget.partner].name;
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState(
    budget.partnerBalance > 0 ? plain(budget.partnerBalance) : "",
  );
  const requests = world.requests.map((item) => ({
    ...item,
    ...requestProgress(world, item),
  }));
  const open = requests.find((item) => item.open);
  const closed = requests.filter((item) => !item.open);
  if (open) {
    const mine = open.askedBy === viewer;
    const left = open.amount - open.paid;
    return (
      <div className={styles.request}>
        <span className={styles.requestTitle}>
          <HandCoinsIcon size={13} aria-hidden />
          {mine
            ? `You asked ${partner} for ${money(open.amount)}`
            : `${partner} asked you for ${money(open.amount)}`}
          <span className={shell.faint}> · {shortDay(open.date)}</span>
        </span>
        <div className={shell.meter} data-state="snoozed">
          <span className={shell.meterTrack}>
            <span style={{ transform: `scaleX(${open.paid / open.amount})` }} />
          </span>
          <span>
            {money(open.paid)} paid since · {money(left)} to go
          </span>
        </div>
      </div>
    );
  }
  if (asking)
    return (
      <form
        className={styles.request}
        onSubmit={(event) => {
          event.preventDefault();
          const cents = parseCents(text);
          if (!cents) return;
          update(
            (current) => ({
              ...current,
              requests: [
                ...current.requests,
                {
                  id: `q-${Date.now()}`,
                  askedBy: viewer,
                  amount: cents,
                  date: TODAY,
                },
              ],
            }),
            `${partner} sees your request for ${money(cents)} on the ledger.`,
          );
          setAsking(false);
        }}
      >
        <span className={styles.requestTitle}>Ask {partner} for</span>
        <div className={styles.inlineForm}>
          <div className={`${entry.well} ${styles.shareAmount}`} data-amount>
            <span className={entry.prefix} aria-hidden>
              $
            </span>
            <input
              autoFocus
              className={entry.input}
              inputMode="decimal"
              aria-label="Amount to ask for"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <Button size="sm" onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Ask
          </Button>
        </div>
      </form>
    );
  return (
    <div className={styles.request}>
      {closed.length > 0 && (
        <span className={shell.faint}>
          Last request: {money(closed.at(-1)!.amount)} on{" "}
          {shortDay(closed.at(-1)!.date)}, paid
        </span>
      )}
      {budget.partnerBalance > 0 && (
        <div>
          <Button size="sm" onClick={() => setAsking(true)}>
            <HandCoinsIcon aria-hidden />
            Ask {partner} to settle
          </Button>
        </div>
      )}
    </div>
  );
}

function SplitSetting() {
  const { world, viewer, budget, update } = useStore();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(world.split[viewer]));
  const partner = PEOPLE[budget.partner].name;
  if (editing)
    return (
      <form
        className={styles.splitSetting}
        onSubmit={(event) => {
          event.preventDefault();
          const mine = Math.round(Number(text));
          if (!(mine >= 0 && mine <= 100)) return;
          update(
            (current) => ({
              ...current,
              split: {
                [viewer]: mine,
                [budget.partner]: 100 - mine,
              } as Record<Person, number>,
              splitEdit: { who: viewer, when: TODAY },
            }),
            `Splitting equally now means you ${mine}%, ${partner} ${100 - mine}%, in both budgets. Shares already entered stay as they are.`,
          );
          setEditing(false);
        }}
      >
        <span className={shell.faint}>Equal split: you</span>
        <div className={`${entry.well} ${styles.percent}`}>
          <input
            autoFocus
            className={entry.input}
            inputMode="numeric"
            aria-label="Your percent of an equal split"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <span className={entry.prefix}>%</span>
        </div>
        <span className={shell.faint}>
          {partner} {100 - (Number(text) || 0)}%
        </span>
        <Button size="sm" variant="primary" type="submit">
          Save
        </Button>
      </form>
    );
  return (
    <div className={styles.splitSetting}>
      <span className={shell.faint}>
        Equal split means you {world.split[viewer]}%, {partner}{" "}
        {world.split[budget.partner]}%
        {world.splitEdit &&
          ` · set by ${world.splitEdit.who === viewer ? "you" : PEOPLE[world.splitEdit.who].name}`}
      </span>
      <Button size="sm" variant="quiet" onClick={() => setEditing(true)}>
        Change
      </Button>
    </div>
  );
}

// ---------- The partner ledger ----------

export function PartnerLedger({
  openId,
  onOpen,
  recording,
  onRecording,
  reviewOnly,
}: {
  openId: string | null;
  onOpen: (id: string | null) => void;
  recording: boolean;
  onRecording: (on: boolean) => void;
  reviewOnly: boolean;
}) {
  const { world, viewer, budget } = useStore();
  const partner = PEOPLE[budget.partner].name;
  const all = ledger(world, viewer);
  const entries = reviewOnly
    ? all.filter((e) => entryNeedsReview(world, viewer, e))
    : all;
  const upcoming = expected(world, viewer);
  const [expectedOpen, setExpectedOpen] = useState(true);
  const row = (item: LedgerEntry) => (
    <div key={item.id}>
      <LedgerRow
        entry={item}
        current={openId === item.id}
        onClick={() => onOpen(openId === item.id ? null : item.id)}
      />
      {openId === item.id && (
        <EntryDetail entry={item} onClose={() => onOpen(null)} />
      )}
    </div>
  );
  return (
    <div
      className={`${shell.list} ${shell.register} ${styles.ledger}`}
      role="group"
      aria-label={`Ledger with ${partner}`}
    >
      <div className={`${shell.txColumns} ${shell.columnHeader}`} aria-hidden>
        <span>Date</span>
        <span>Payee</span>
        <span>Paid by</span>
        <span>Your category</span>
        <span className={shell.numeric}>Shared</span>
        <span className={shell.numeric}>{partner}</span>
        <span className={shell.numeric}>You</span>
        <span className={shell.numeric}>Balance</span>
        <span />
      </div>
      {recording && <RecordEntry onClose={() => onRecording(false)} />}
      {upcoming.length > 0 && !reviewOnly && (
        <div role="group" aria-label="Expected" className={shell.pendingGroup}>
          <button
            type="button"
            className={`${shell.dayRow} ${shell.groupRow} ${shell.pendingHeader}`}
            aria-expanded={expectedOpen}
            onClick={() => setExpectedOpen(!expectedOpen)}
          >
            <ChevronDownIcon
              size={12}
              strokeWidth={2.5}
              className={shell.groupCaret}
              aria-hidden
            />
            <span>Expected from scheduled transactions</span>
            <span className={shell.groupCount}>{upcoming.length}</span>
          </button>
          {expectedOpen && upcoming.map(row)}
        </div>
      )}
      {entries.map(row)}
      {!entries.length && !recording && (
        <div className={shell.empty} data-tone="done">
          <CircleCheckIcon size={18} aria-hidden />
          <div className={shell.emptyBody}>
            <p>
              <strong>Nothing to review.</strong>
              New entries from {partner} show up here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function entryNeedsReview(
  world: World,
  viewer: Person,
  item: LedgerEntry,
) {
  if (item.kind === "settlement") return !item.matched;
  if (!item.txn || item.paidBy === viewer) return false;
  return !world.side[item.txn.id]?.reviewed;
}

function LedgerRow({
  entry: item,
  current,
  onClick,
}: {
  entry: LedgerEntry;
  current: boolean;
  onClick: () => void;
}) {
  const { world, viewer, budget } = useStore();
  const partner = budget.partner;
  const review = entryNeedsReview(world, viewer, item);
  let category: ReactNode = null;
  if (item.kind === "settlement")
    category = (
      <span className={styles.transferCell}>
        <ArrowRightLeftIcon size={12} aria-hidden />
        <span className={shell.muted}>Settlement</span>
      </span>
    );
  else if (item.kind === "opening")
    category = <span className={shell.faint}>Not a purchase</span>;
  else if (item.kind === "expected")
    category = <span className={shell.faint}>Scheduled</span>;
  else if (item.txn && item.paidBy === viewer) {
    const names = item.txn.lines
      .filter((line) => isPartner(line.share))
      .map((line) => categoryName(viewer, line.categoryId))
      .filter(Boolean);
    category = names.length ? (
      <span className={`${shell.truncate} ${shell.muted}`}>
        {names.join(", ")}
      </span>
    ) : item.txn.imported ? (
      <Tag tone="attention">Needs category</Tag>
    ) : (
      <span className={shell.faint}>When it imports</span>
    );
  } else if (item.txn) {
    const side = world.side[item.txn.id];
    const name = categoryName(viewer, side?.categoryId ?? null);
    category = name ? (
      <span className={`${shell.truncate} ${shell.muted}`}>{name}</span>
    ) : (
      <Tag tone="attention">Needs category</Tag>
    );
  }
  const Icon =
    item.kind === "expected"
      ? CalendarClockIcon
      : item.kind === "opening"
        ? CircleCheckIcon
        : item.matched
          ? Link2Icon
          : CircleDashedIcon;
  const label =
    item.kind === "expected"
      ? "Expected"
      : item.matched
        ? "Matched to the bank import"
        : item.kind === "settlement"
          ? "Waiting for confirmation"
          : "Waiting for the bank import";
  const isMoney = item.kind === "settlement" || item.kind === "opening";
  return (
    <div className={shell.rowWrap}>
      <button
        type="button"
        data-row
        className={`${shell.txColumns} ${shell.row}`}
        data-pending={item.kind === "expected" || undefined}
        aria-current={current ? "true" : undefined}
        aria-expanded={current}
        onClick={onClick}
      >
        <span className={shell.rowName}>
          <span className={shell.reviewDot} data-on={review || undefined}>
            {review && <span className="sr-only">Needs review</span>}
          </span>
          <span className={`${shell.truncate} ${shell.muted}`}>
            {shortDay(item.date)}
          </span>
        </span>
        <span className={shell.rowName}>
          {item.kind === "refund" && (
            <ReceiptIcon
              size={12}
              className={shell.inlineIcon}
              aria-label="Refund"
            />
          )}
          <span className={shell.truncate}>{item.payee}</span>
        </span>
        <span className={`${shell.truncate} ${shell.muted}`}>
          {item.kind === "opening"
            ? ""
            : item.paidBy === viewer
              ? "You"
              : PEOPLE[partner].name}
        </span>
        <span className={styles.categoryCell}>{category}</span>
        <span className={shell.numeric}>{money(item.shared)}</span>
        <span className={`${shell.numeric} ${shell.muted}`}>
          {isMoney ? "" : money(item.shares[partner])}
        </span>
        <span className={`${shell.numeric} ${shell.muted}`}>
          {isMoney ? "" : money(item.shares[viewer])}
        </span>
        <span
          className={shell.numeric}
          data-inflow={item.effect > 0 || undefined}
        >
          {money(item.effect, true)}
        </span>
        <span className={shell.statusCell}>
          <Icon size={14} className={shell.statusIcon} aria-label={label} />
        </span>
      </button>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.detail}>
      <span className={styles.detailLabel}>{label}</span>
      <div className={styles.detailValue}>{children}</div>
    </div>
  );
}

function EntryDetail({
  entry: item,
  onClose,
}: {
  entry: LedgerEntry;
  onClose: () => void;
}) {
  const { world, viewer, budget, update } = useStore();
  const revealed = useRevealed<HTMLDivElement>();
  const partner = budget.partner;
  const name = (person: Person) =>
    person === viewer ? "You" : PEOPLE[person].name;
  const txn = item.txn;
  const consumer = other(item.paidBy);
  const shared = txn ? txn.lines.filter((line) => isPartner(line.share)) : [];
  const [shareText, setShareText] = useState(plain(item.shares[consumer] ?? 0));
  const side = txn ? world.side[txn.id] : undefined;
  const [category, setCategory] = useState(side?.categoryId ?? "");
  const mine = item.paidBy !== viewer && txn;
  const saveShare = (cents: number, writeOff = false) => {
    if (!txn) return;
    update(
      (current) =>
        setPartnerShare(
          current,
          txn.id,
          cents * Math.sign(item.shared || 1),
          viewer,
        ),
      writeOff
        ? `Written off: you consumed it after all. ${PEOPLE[consumer].name}'s budget dropped the ${money(item.shares[consumer])} too.`
        : `${PEOPLE[consumer].name}'s share is ${money(cents)} in both budgets now.`,
    );
  };
  let body: ReactNode;
  if (item.kind === "opening")
    body = (
      <>
        <Detail label="Entered">
          Once, by {name(item.recordedBy)}, when you partnered on{" "}
          {longDay(item.date)}
        </Detail>
        <Detail label="What it is">
          {PEOPLE[consumer].name} owed {PEOPLE[item.paidBy].name}{" "}
          {money(item.shared)} already. It&rsquo;s a balance, not a purchase:
          nothing was re-split, and no category in either budget changed.
        </Detail>
      </>
    );
  else if (item.kind === "expected")
    body = (
      <>
        <Detail label="From">
          {name(item.paidBy) === "You"
            ? "Your"
            : `${PEOPLE[item.paidBy].name}'s`}{" "}
          scheduled {item.payee}, {longDay(item.date)}
        </Detail>
        <Detail label="Shares">
          {PEOPLE.alan.name} {money(item.shares.alan)} · {PEOPLE.anna.name}{" "}
          {money(item.shares.anna)}
        </Detail>
        <Detail label="Balance">
          Not in the balance until it happens. The schedule carries the share,
          so the import arrives with it filled in.
        </Detail>
      </>
    );
  else if (item.kind === "settlement" && item.transfer) {
    const t = item.transfer;
    body = (
      <>
        <Detail label="Transfer">
          {PEOPLE[t.from].name} paid {PEOPLE[t.to].name} {money(t.amount)} on{" "}
          {longDay(t.date)}
        </Detail>
        <Detail label="Imports">
          {PEOPLE.alan.name}: {t.payee.alan} (
          {accountName("alan", t.accountId.alan)})
          <br />
          {PEOPLE.anna.name}: {t.payee.anna} (
          {accountName("anna", t.accountId.anna)})
        </Detail>
        <Detail label="Status">
          {t.confirmed ? (
            "Matched by amount, date, and direction. One confirmation cleared both sides."
          ) : (
            <span className={styles.detailRow}>
              Recognized on both sides; waiting for either of you to confirm.
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  update(
                    (current) => ({
                      ...current,
                      transfers: current.transfers.map((x) =>
                        x.id === t.id ? { ...x, confirmed: true } : x,
                      ),
                    }),
                    `Transfer confirmed in both budgets.`,
                  );
                  onClose();
                }}
              >
                Confirm transfer
              </Button>
            </span>
          )}
        </Detail>
      </>
    );
  } else if (txn) {
    const payerAccount = accountName(item.paidBy, txn.accountId);
    body = (
      <>
        <Detail label="Paid by">
          <span>
            {name(item.paidBy)}
            {item.paidBy === viewer && payerAccount ? `, ${payerAccount}` : ""}
            {item.paidBy !== viewer && (
              <span className={shell.faint}>
                {" "}
                · their category stays private
              </span>
            )}
          </span>
        </Detail>
        {item.kind === "refund" && (
          <Detail label="Refund">
            <span>
              Payee memory proposed the same share as the last {item.payee}{" "}
              purchase, so the refund reverses it in proportion. That purchase
              was settled already, so the balance swings{" "}
              {money(Math.abs(item.effect))} the other way.
            </span>
          </Detail>
        )}
        <Detail label="Recorded by">
          {name(item.recordedBy)} on {shortDay(txn.date)}
        </Detail>
        <Detail label="Bank import">
          {txn.imported ? (
            <span className={styles.detailRow}>
              <Link2Icon size={13} aria-hidden />
              Matched to{" "}
              {item.paidBy === viewer
                ? "your"
                : `${PEOPLE[item.paidBy].name}'s`}{" "}
              {payerAccount ?? "bank"} import
            </span>
          ) : (
            <span className={styles.detailRow}>
              <CircleDashedIcon size={13} aria-hidden />
              Waiting for{" "}
              {item.paidBy === viewer
                ? "your"
                : `${PEOPLE[item.paidBy].name}'s`}{" "}
              import. The balance already counts it.
            </span>
          )}
        </Detail>
        <Detail label="Shares">
          {shared.length > 1 || txn.lines.length > shared.length ? (
            <span>
              {money(item.shared)} of the{" "}
              {money(sum(txn.lines.map((l) => l.amount)))} receipt is shared
              {txn.lines.length > shared.length &&
                `; the other ${txn.lines.length - shared.length} line${txn.lines.length - shared.length > 1 ? "s stay" : " stays"} private to ${name(item.paidBy) === "You" ? "you" : PEOPLE[item.paidBy].name}`}
              .
            </span>
          ) : null}
          <form
            className={styles.shareEdit}
            onSubmit={(event) => {
              event.preventDefault();
              const cents = parseCents(shareText);
              if (cents === null || cents > Math.abs(item.shared)) return;
              saveShare(cents);
            }}
          >
            <span className={shell.muted}>
              {name(item.paidBy)} {money(item.shares[item.paidBy])} ·{" "}
              {PEOPLE[consumer].name === PEOPLE[viewer].name
                ? "Your"
                : `${PEOPLE[consumer].name}'s`}{" "}
              share
            </span>
            <div className={`${entry.well} ${styles.shareAmount}`} data-amount>
              <span className={entry.prefix} aria-hidden>
                $
              </span>
              <input
                className={entry.input}
                inputMode="decimal"
                aria-label={`${PEOPLE[consumer].name}'s share`}
                value={shareText}
                onChange={(event) => setShareText(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              type="submit"
              disabled={
                parseCents(shareText) === Math.abs(item.shares[consumer] ?? 0)
              }
            >
              Save share
            </Button>
            {item.paidBy === viewer && (item.shares[consumer] ?? 0) !== 0 && (
              <Button
                size="sm"
                variant="quiet"
                onClick={() => saveShare(0, true)}
              >
                Write off
              </Button>
            )}
          </form>
        </Detail>
        {mine && (
          <Detail label="Your category">
            <div className={styles.detailRow}>
              <div className={styles.sideCategory}>
                <ChoiceField
                  id={`${txn.id}-side`}
                  label="Your category"
                  value={category}
                  options={spendingCategories(viewer).map((c) => ({
                    value: c.id,
                    label: c.name,
                    group: c.group,
                  }))}
                  placeholder="Category"
                  wide={false}
                  onChange={setCategory}
                />
              </div>
              {(!side?.reviewed || category !== (side?.categoryId ?? "")) && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!category}
                  onClick={() =>
                    update(
                      (current) => ({
                        ...current,
                        side: {
                          ...current.side,
                          [txn.id]: { categoryId: category, reviewed: true },
                        },
                      }),
                      `Your ${money(Math.abs(item.shares[viewer]))} is in ${categoryName(viewer, category)}. ${PEOPLE[partner].name} doesn't see it.`,
                    )
                  }
                >
                  {side?.reviewed ? "Save" : "Approve"}
                </Button>
              )}
            </div>
            <span className={styles.hint}>
              {side?.prefill && !side.reviewed
                ? `Filled in from your last ${item.payee}. Only you see this.`
                : !side?.categoryId
                  ? `No ${item.payee} in your history yet. Only you see this.`
                  : "Only you see this."}
            </span>
          </Detail>
        )}
        <Detail label="History">
          {txn.history.length ? (
            <ul className={styles.history}>
              {txn.history.map((edit, index) => (
                <li key={index}>
                  <HistoryIcon size={12} aria-hidden />
                  {name(edit.who)} changed {edit.what} from{" "}
                  {money(Math.abs(edit.from))} to {money(Math.abs(edit.to))}
                  <span className={shell.faint}> · {shortDay(edit.when)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className={shell.faint}>
              No changes since it was recorded
            </span>
          )}
        </Detail>
      </>
    );
  }
  return (
    <div
      ref={revealed}
      className={`${entry.form} ${styles.detailCard}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className={styles.detailGrid}>{body}</div>
      <div className={entry.rowFooter}>
        <div className={entry.actions}>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// Either partner can record a shared cost, including one the other paid.
function RecordEntry({ onClose }: { onClose: () => void }) {
  const { world, viewer, budget, update } = useStore();
  const partner = budget.partner;
  const [payee, setPayee] = useState("");
  const [paidBy, setPaidBy] = useState<Person>(partner);
  const [amount, setAmount] = useState("");
  const [share, setShare] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const consumer = other(paidBy);
  const total = parseCents(amount) ?? 0;
  const equal = Math.round((total * world.split[consumer]) / 100);
  return (
    <form
      className={`${entry.form} ${styles.detailCard}`}
      aria-label="Record a shared cost"
      onSubmit={(event) => {
        event.preventDefault();
        const theirs = parseCents(share) ?? 0;
        if (!payee.trim()) return setError("Add a payee.");
        if (!total) return setError("Add the shared amount.");
        if (theirs > total)
          return setError("A share can't be more than the amount.");
        const txn: Txn = {
          id: `t-rec-${Date.now()}`,
          owner: paidBy,
          accountId: null,
          date: TODAY,
          payee: payee.trim(),
          lines: [
            {
              id: "l1",
              categoryId: paidBy === viewer ? category || null : null,
              amount: total,
              share: { who: PARTNER, amount: theirs },
            },
          ],
          recordedBy: viewer,
          imported: false,
          reviewed: true,
          history: [],
        };
        update(
          (current) => ({
            ...current,
            txns: [txn, ...current.txns],
            side:
              paidBy === viewer
                ? {
                    ...current.side,
                    [txn.id]: {
                      categoryId: sideMemory(current, partner, txn.payee),
                      reviewed: false,
                      prefill: Boolean(sideMemory(current, partner, txn.payee)),
                    },
                  }
                : {
                    ...current.side,
                    [txn.id]: {
                      categoryId: category || null,
                      reviewed: Boolean(category),
                    },
                  },
          }),
          `Recorded. It's on ${PEOPLE[partner].name}'s ledger now and matches ${paidBy === viewer ? "your" : "their"} bank import when it arrives.`,
        );
        onClose();
      }}
    >
      <div className={styles.recordGrid}>
        <span className={styles.detailLabel}>Paid by</span>
        <div className={styles.fit}>
          <SegmentedControl
            aria-label="Paid by"
            value={paidBy}
            onValueChange={(value) => setPaidBy(value as Person)}
          >
            <SegmentedControlItem value={partner}>
              {PEOPLE[partner].name}
            </SegmentedControlItem>
            <SegmentedControlItem value={viewer}>You</SegmentedControlItem>
          </SegmentedControl>
        </div>
        <label className={styles.detailLabel} htmlFor="record-payee">
          Payee
        </label>
        <div className={styles.recordField}>
          <PayeeField
            id="record-payee"
            label="Payee"
            value={payee}
            payees={payees(viewer)}
            placeholder="Payee"
            onChange={(value) => {
              setPayee(value);
              if (!category)
                setCategory(sideMemory(world, viewer, value) ?? "");
            }}
          />
        </div>
        <span className={styles.detailLabel}>Shared amount</span>
        <div className={styles.inlineForm}>
          <div className={`${entry.well} ${styles.shareAmount}`} data-amount>
            <span className={entry.prefix} aria-hidden>
              $
            </span>
            <input
              className={entry.input}
              inputMode="decimal"
              aria-label="Shared amount"
              placeholder="0.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <span className={shell.faint}>
            The shared lines only, not the whole receipt
          </span>
        </div>
        <span className={styles.detailLabel}>
          {consumer === viewer
            ? "Your share"
            : `${PEOPLE[consumer].name}'s share`}
        </span>
        <div className={styles.inlineForm}>
          <div className={`${entry.well} ${styles.shareAmount}`} data-amount>
            <span className={entry.prefix} aria-hidden>
              $
            </span>
            <input
              className={entry.input}
              inputMode="decimal"
              aria-label="Share"
              placeholder="0.00"
              value={share}
              onChange={(event) => setShare(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="quiet"
            disabled={!total}
            onClick={() => setShare(plain(equal))}
          >
            Split equally
          </Button>
        </div>
        <span className={styles.detailLabel}>Your category</span>
        <div className={styles.recordField}>
          <ChoiceField
            id="record-category"
            label="Your category"
            value={category}
            options={spendingCategories(viewer).map((c) => ({
              value: c.id,
              label: c.name,
              group: c.group,
            }))}
            placeholder="Category"
            wide={false}
            onChange={setCategory}
          />
        </div>
      </div>
      <div className={entry.rowFooter}>
        {error && (
          <p className={entry.formError} role="status">
            {error}
          </p>
        )}
        <div className={entry.actions}>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Record
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---------- Reimbursements ----------

export function ReimbursementBalance({ who }: { who: string }) {
  const { world, viewer, budget } = useStore();
  const people = reimbursementPeople(world, viewer);
  const shown =
    who === "all"
      ? budget.reimbursementBalance
      : (people.find((item) => item.name === who)?.balance ?? 0);
  return (
    <div className={shell.accountSummary}>
      <div className={styles.balanceHero}>
        <span className={styles.balanceCaption}>
          {who === "all" ? "Owed to you" : `${who} owes you`}
        </span>
        <strong data-sign={Math.sign(shown)}>{money(shown)}</strong>
        <span className={styles.balanceCaption}>
          Private to your budget. Each entry names who owes it.
        </span>
      </div>
    </div>
  );
}

// Per-person balance is a filter, not a separate account.
export function ReimbursementFilter({
  who,
  onWho,
}: {
  who: string;
  onWho: (who: string) => void;
}) {
  const { world, viewer } = useStore();
  const people = reimbursementPeople(world, viewer);
  if (!people.length) return null;
  return (
    <SegmentedControl aria-label="Show" value={who} onValueChange={onWho}>
      <SegmentedControlItem value="all">Everyone</SegmentedControlItem>
      {people.map((person) => (
        <SegmentedControlItem key={person.name} value={person.name}>
          {person.name} {money(person.balance)}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

export function ReimbursementLedger({
  who,
  openId,
  onOpen,
}: {
  who: string;
  openId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const { world, viewer } = useStore();
  const entries = reimbursementLedger(world, viewer).filter(
    (item) => who === "all" || item.who === who,
  );
  if (!entries.length)
    return (
      <div className={shell.empty}>
        <UsersIcon size={18} aria-hidden />
        <div className={shell.emptyBody}>
          <p>
            <strong>Nobody owes you anything.</strong>
            When you front a cost for a friend, family, or your employer, give
            that line a share and name them. It lands here, and their Venmo or
            check back clears it.
          </p>
        </div>
      </div>
    );
  return (
    <div
      className={`${shell.list} ${shell.register} ${styles.reimbursements}`}
      role="group"
      aria-label="Reimbursements"
    >
      <div className={`${shell.txColumns} ${shell.columnHeader}`} aria-hidden>
        <span>Date</span>
        <span>Payee</span>
        <span>Who</span>
        <span>Your category</span>
        <span className={shell.numeric}>Line</span>
        <span className={shell.numeric}>Balance</span>
        <span />
      </div>
      {entries.map((item) => (
        <div key={item.id}>
          <ReimbursementRow
            entry={item}
            current={openId === item.id}
            onClick={() => onOpen(openId === item.id ? null : item.id)}
          />
          {openId === item.id && (
            <ReimbursementDetail entry={item} onClose={() => onOpen(null)} />
          )}
        </div>
      ))}
    </div>
  );
}

function ReimbursementRow({
  entry: item,
  current,
  onClick,
}: {
  entry: ReimbursementEntry;
  current: boolean;
  onClick: () => void;
}) {
  const { viewer } = useStore();
  const line = item.txn?.lines.find(
    (l) => `${item.txn!.id}:${l.id}` === item.id,
  );
  return (
    <div className={shell.rowWrap}>
      <button
        type="button"
        data-row
        className={`${shell.txColumns} ${shell.row}`}
        aria-current={current ? "true" : undefined}
        aria-expanded={current}
        onClick={onClick}
      >
        <span className={shell.rowName}>
          <span
            className={shell.reviewDot}
            data-on={!item.confirmed || undefined}
          />
          <span className={`${shell.truncate} ${shell.muted}`}>
            {shortDay(item.date)}
          </span>
        </span>
        <span className={shell.rowName}>
          <span className={shell.truncate}>{item.payee}</span>
        </span>
        <span className={`${shell.truncate} ${shell.muted}`}>{item.who}</span>
        <span className={styles.categoryCell}>
          {item.kind === "received" ? (
            <span className={styles.transferCell}>
              <ArrowRightLeftIcon size={12} aria-hidden />
              <span className={shell.muted}>Paid back</span>
            </span>
          ) : (
            <span className={`${shell.truncate} ${shell.muted}`}>
              {categoryName(viewer, line?.categoryId ?? null)}
            </span>
          )}
        </span>
        <span className={`${shell.numeric} ${shell.muted}`}>
          {money(Math.abs(item.lineAmount))}
        </span>
        <span
          className={shell.numeric}
          data-inflow={item.effect > 0 || undefined}
        >
          {money(item.effect, true)}
        </span>
        <span className={shell.statusCell}>
          {item.confirmed ? (
            <Link2Icon
              size={14}
              className={shell.statusIcon}
              aria-label="Matched"
            />
          ) : (
            <CircleDashedIcon
              size={14}
              className={shell.statusIcon}
              aria-label="Waiting for confirmation"
            />
          )}
        </span>
      </button>
    </div>
  );
}

function ReimbursementDetail({
  entry: item,
  onClose,
}: {
  entry: ReimbursementEntry;
  onClose: () => void;
}) {
  const { viewer, update } = useStore();
  const revealed = useRevealed<HTMLDivElement>();
  const [text, setText] = useState(plain(item.effect));
  const txn = item.txn;
  const lineId = txn ? item.id.split(":")[1] : undefined;
  const save = (cents: number, writeOff = false) => {
    if (!txn) return;
    update(
      (current) => ({
        ...current,
        txns: current.txns.map((t) =>
          t.id !== txn.id
            ? t
            : {
                ...t,
                lines: t.lines.map((line) =>
                  line.id === lineId
                    ? {
                        ...line,
                        share: cents
                          ? {
                              who: item.who,
                              amount: Math.sign(item.lineAmount) * cents,
                            }
                          : undefined,
                      }
                    : line,
                ),
                history: [
                  ...t.history,
                  {
                    who: viewer,
                    what: `${item.who}'s share`,
                    from: item.effect,
                    to: Math.sign(item.lineAmount) * cents,
                    when: TODAY,
                  },
                ],
              },
        ),
      }),
      writeOff
        ? `Written off. ${item.who} owes nothing for ${item.payee}; it's your spending now.`
        : `${item.who}'s share is ${money(cents)}.`,
    );
    if (writeOff) onClose();
  };
  return (
    <div
      ref={revealed}
      className={`${entry.form} ${styles.detailCard}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className={styles.detailGrid}>
        {item.kind === "received" && item.transfer ? (
          <>
            <Detail label="Paid back">
              {item.who} sent {money(item.lineAmount)} to your{" "}
              {accountName(viewer, item.transfer.accountId)}
            </Detail>
            <Detail label="Where it went">
              Your Reimbursements envelope refilled by {money(item.lineAmount)}.
              Ready to Assign didn&rsquo;t change; move any surplus from the
              envelope.
            </Detail>
          </>
        ) : (
          <>
            <Detail label="Line">
              {money(Math.abs(item.lineAmount))} on{" "}
              {accountName(viewer, txn?.accountId ?? null)}, {item.who} owes{" "}
              {money(Math.abs(item.effect))} of it
            </Detail>
            <Detail label="Share">
              <form
                className={styles.shareEdit}
                onSubmit={(event) => {
                  event.preventDefault();
                  const cents = parseCents(text);
                  if (cents === null || cents > Math.abs(item.lineAmount))
                    return;
                  save(cents);
                }}
              >
                <div
                  className={`${entry.well} ${styles.shareAmount}`}
                  data-amount
                >
                  <span className={entry.prefix} aria-hidden>
                    $
                  </span>
                  <input
                    className={entry.input}
                    inputMode="decimal"
                    aria-label={`${item.who}'s share`}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                  />
                </div>
                <Button size="sm" type="submit">
                  Save share
                </Button>
                <Button size="sm" variant="quiet" onClick={() => save(0, true)}>
                  Write off
                </Button>
              </form>
            </Detail>
            <Detail label="History">
              {txn?.history.filter((edit) => edit.what.startsWith(item.who))
                .length ? (
                <ul className={styles.history}>
                  {txn.history
                    .filter((edit) => edit.what.startsWith(item.who))
                    .map((edit, index) => (
                      <li key={index}>
                        <HistoryIcon size={12} aria-hidden />
                        You changed {edit.what} from{" "}
                        {money(Math.abs(edit.from))} to{" "}
                        {money(Math.abs(edit.to))}
                        <span className={shell.faint}>
                          {" "}
                          · {shortDay(edit.when)}
                        </span>
                      </li>
                    ))}
                </ul>
              ) : (
                <span className={shell.faint}>
                  No changes since it was recorded
                </span>
              )}
            </Detail>
          </>
        )}
      </div>
      <div className={entry.rowFooter}>
        <div className={entry.actions}>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- Partnering ----------

export function PartnerSetup() {
  const { viewer, update } = useStore();
  const [step, setStep] = useState<"invite" | "code" | "opening">("invite");
  const [direction, setDirection] = useState<"none" | "them" | "me">("none");
  const [text, setText] = useState("");
  const partner = PEOPLE[other(viewer)].name;
  if (step !== "opening")
    return (
      <div className={shell.empty}>
        <HeartHandshakeIcon size={18} aria-hidden />
        <div className={shell.emptyBody}>
          <p>
            <strong>Share costs with your partner.</strong>
            Link budgets and each of you gets an account for the other. Only
            what you share shows up there: who paid, how much, and each
            person&rsquo;s share. Categories, balances, and everything else stay
            private.
          </p>
          {step === "invite" ? (
            <div>
              <Button variant="primary" onClick={() => setStep("code")}>
                Invite partner
              </Button>
            </div>
          ) : (
            <div className={styles.inviteRow}>
              <code className={styles.code}>CAI-7Q2K</code>
              <span className={shell.faint}>Works once, for 24 hours.</span>
              <Button size="sm" onClick={() => setStep("opening")}>
                {partner} joined (demo)
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  const cents = parseCents(text) ?? 0;
  return (
    <form
      className={styles.setup}
      onSubmit={(event) => {
        event.preventDefault();
        update(
          (current) => ({
            ...current,
            partnered: true,
            opening:
              direction !== "none" && cents
                ? {
                    owedTo: direction === "them" ? viewer : other(viewer),
                    amount: cents,
                    date: TODAY,
                    by: viewer,
                  }
                : undefined,
          }),
          `You're partnered with ${partner}. Your ${partner} account and envelope are ready.`,
        );
      }}
    >
      <h2 className={styles.setupTitle}>
        {partner} joined. Do you already owe each other anything?
      </h2>
      <p className={styles.setupText}>
        Enter it once, as a balance. It isn&rsquo;t split again and touches no
        category; from here on, the ledger keeps the running total.
      </p>
      <SegmentedControl
        aria-label="Who owes whom"
        value={direction}
        onValueChange={(value) => setDirection(value as typeof direction)}
      >
        <SegmentedControlItem value="none">
          We&rsquo;re even
        </SegmentedControlItem>
        <SegmentedControlItem value="them">
          {partner} owes me
        </SegmentedControlItem>
        <SegmentedControlItem value="me">I owe {partner}</SegmentedControlItem>
      </SegmentedControl>
      {direction !== "none" && (
        <div className={`${entry.well} ${styles.shareAmount}`} data-amount>
          <span className={entry.prefix} aria-hidden>
            $
          </span>
          <input
            autoFocus
            className={entry.input}
            inputMode="decimal"
            aria-label="Opening balance"
            placeholder="0.00"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
      )}
      <div>
        <Button
          variant="primary"
          type="submit"
          disabled={direction !== "none" && !cents}
        >
          Start the ledger
        </Button>
      </div>
    </form>
  );
}
