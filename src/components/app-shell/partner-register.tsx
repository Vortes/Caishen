"use client";

import {
  CheckIcon,
  CopyIcon,
  HistoryIcon,
  LinkIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useId, useState } from "react";
import { newId, today } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { Button } from "~/components/ui/button";
import { Tag } from "~/components/ui/tag";
import { usePortalContainer } from "~/components/ui/tooltip";
import type { PartnerEntryChange } from "~/domain/partner-ledger";
import { money, shortDay, type Account } from "./model";
import { RecordPurchase } from "./partner-record";
import moveStyles from "./move-money.module.css";
import { AmountWell, halfOf, parseCents } from "./share-field";
import { useShellData } from "./shell-data";
import { useTransactionEntry } from "./transaction-entry";
import { ChoiceField, type ChoiceOption } from "./transaction-fields";
import { Empty, moveSelection } from "./views";
import styles from "./shell.module.css";
import share from "./share.module.css";
import local from "./partner-register.module.css";

type Row = View["partnerLedger"][number];

function owedSentence(name: string, balance: number) {
  if (balance > 0) return `${name} owes you`;
  if (balance < 0) return `You owe ${name}`;
  return `You and ${name} are even`;
}

// The Partner account: the one ledger both budgets share. Its balance is
// what's owed, live, and the envelope beside it holds money against it.
export function PartnerSummary({ account }: { account: Account }) {
  const { categories } = useShellData();
  const { view } = useTransactionEntry();
  const envelope = categories.find(
    (category) => category.pairs?.accountId === account.id,
  );
  const request = view.partnerRequest;
  const asker =
    request?.requesterId === view.budget.userId ? "You" : account.name;
  return (
    <>
      <div className={styles.accountSummary}>
        <dl className={styles.balances}>
          <div data-total>
            <dt>{owedSentence(account.name, account.balance)}</dt>
            <dd className={local.owed}>{money(Math.abs(account.balance))}</dd>
          </div>
          {request && (
            <div>
              <dt>
                {asker} asked for {money(request.amount)} on{" "}
                {shortDay(request.date)}
              </dt>
              <dd>
                {request.left > 0
                  ? `${money(request.left)} left`
                  : "Paid in full"}
              </dd>
            </div>
          )}
          {envelope && (
            <div>
              <dt>
                {envelope.name} envelope
                {envelope.assigned > 0 &&
                  ` · ${money(envelope.assigned)} float`}
              </dt>
              <dd className={local.envelope} data-state={envelope.funding}>
                {money(envelope.available)}
              </dd>
            </div>
          )}
        </dl>
        <div className={styles.summaryActions}>
          <RecordPurchase account={account} />
          {account.balance > 0 ? (
            <RequestPopover account={account} />
          ) : account.balance < 0 ? (
            <PayPopover account={account} />
          ) : null}
        </div>
      </div>
      {request && request.left > 0 && (
        <RequestProgress
          request={request}
          asker={asker === "You" ? "you" : asker}
          today={today(view.budget.settings.timezone)}
        />
      )}
    </>
  );
}

// A request is a record, not a reminder: how much, when, and what's been
// paid toward it since.
function RequestProgress({
  request,
  asker,
  today,
}: {
  request: NonNullable<View["partnerRequest"]>;
  asker: string;
  today: string;
}) {
  const ratio = Math.min(1, request.paid / request.amount);
  const days = Math.round(
    (Date.parse(`${today}T12:00:00Z`) -
      Date.parse(`${request.date}T12:00:00Z`)) /
      86_400_000,
  );
  return (
    <div className={local.requestStrip}>
      <span className={local.requestTrack} aria-hidden>
        <span style={{ transform: `scaleX(${ratio})` }} />
      </span>
      <span>
        {money(request.paid)} of {money(request.amount)} paid since {asker}{" "}
        asked{" "}
        {days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}
      </span>
    </div>
  );
}

// Asking the partner to pay: an amount, dated today. Settlements from them
// count toward it until it's paid.
function RequestPopover({ account }: { account: Account }) {
  const id = useId();
  const { view, saveCommand } = useTransactionEntry();
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setText((account.balance / 100).toFixed(2));
        setError("");
      }}
    >
      <Popover.Trigger asChild>
        <Button size="sm" variant="primary">
          Request money
        </Button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={moveStyles.popover}
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label={`Request money from ${account.name}`}
        >
          <form
            className={moveStyles.form}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const cents = parseCents(text);
              if (!cents) return setError("Enter an amount, like 250.00.");
              const failure = saveCommand(
                {
                  type: "partner.request",
                  id: newId(),
                  requestId: newId(),
                  date: today(view.budget.settings.timezone),
                  amount: cents,
                },
                `Asked ${account.name} for ${money(cents)}. It’s on both ledgers.`,
              );
              if (failure) return setError(failure);
              setOpen(false);
            }}
          >
            <div className={moveStyles.header}>
              <strong>Request from {account.name}</strong>
            </div>
            <div className={moveStyles.field}>
              <label htmlFor={id}>Amount</label>
              <AmountWell
                id={id}
                value={text}
                autoFocus
                invalid={Boolean(error)}
                onChange={(value) => {
                  setText(value);
                  if (error) setError("");
                }}
              />
              {error && <p className={moveStyles.error}>{error}</p>}
              <p className={share.formHint}>
                {account.name} sees it on the ledger with today&rsquo;s date.
                Settlements count toward it until it&rsquo;s paid. No deadline,
                no reminders.
              </p>
            </div>
            <div className={moveStyles.footer}>
              <Button size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" type="submit">
                Request
              </Button>
            </div>
          </form>
          <Popover.Arrow className={moveStyles.arrow} width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Paying the partner happens in your bank. This says how it'll be
// recognized, and copies the amount to send.
function PayPopover({ account }: { account: Account }) {
  const { view } = useTransactionEntry();
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const amount = -account.balance;
  const request = view.partnerRequest;
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button size="sm" variant="primary">
          Pay {account.name}
        </Button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={moveStyles.popover}
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label={`Pay ${account.name}`}
        >
          <div className={moveStyles.form}>
            <div className={moveStyles.header}>
              <strong>Pay {account.name}</strong>
              <span className={moveStyles.balance}>{money(amount)}</span>
            </div>
            <div className={local.popoverBody}>
              <p>
                Send it from your bank, by Zelle or a transfer, in any amount.
                When it imports to both budgets, it&rsquo;s matched by amount,
                date, and direction, and the balance updates for you both.
              </p>
              {request &&
                request.requesterId !== view.budget.userId &&
                request.left > 0 && (
                  <p className={styles.faint}>
                    {account.name} asked for {money(request.amount)} on{" "}
                    {shortDay(request.date)}. {money(request.left)} is left.
                  </p>
                )}
              <p className={styles.faint}>
                The {money(amount)} is already held in your {account.name}{" "}
                envelope, so paying won&rsquo;t touch any other category.
              </p>
            </div>
            <div className={moveStyles.footer}>
              <Button
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(
                    (amount / 100).toFixed(2),
                  );
                  setCopied(true);
                }}
              >
                {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
                {copied ? "Copied" : "Copy amount"}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => setOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
          <Popover.Arrow className={moveStyles.arrow} width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function PartnerRegister({
  account,
  query,
}: {
  account: Account;
  query: string;
}) {
  const { view } = useTransactionEntry();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const name = (id: string | undefined) =>
    view.categories.find((item) => item.id === id)?.name;
  const search = query.trim().toLowerCase();
  const payee = (row: Row) => settlementPayee(row, view, account.name);
  const rows = view.partnerLedger.filter(
    (row) =>
      !search ||
      [payee(row), name(row.categoryId), money(row.shared), money(row.change)]
        .join(" ")
        .toLowerCase()
        .includes(search),
  );
  if (!view.partnerLedger.length)
    return (
      <Empty title="Nothing owed yet." icon={UsersIcon}>
        When you and {account.name} share a cost, what one of you owes the other
        shows here, in both budgets.
      </Empty>
    );
  if (!rows.length)
    return (
      <Empty title={`No entries match “${query.trim()}”.`} icon={SearchIcon}>
        Search looks at payees, categories, and amounts.
      </Empty>
    );
  return (
    <div
      className={`${styles.list} ${styles.register} ${local.register}`}
      role="group"
      aria-label={`${account.name} ledger`}
      onKeyDown={moveSelection}
    >
      <div className={`${styles.txColumns} ${styles.columnHeader}`} aria-hidden>
        <span data-optional>Date</span>
        <span>Payee</span>
        <span>Your category</span>
        <span className={styles.numeric} data-optional>
          Shared
        </span>
        <span className={styles.numeric}>Amount</span>
        <span className={styles.numeric}>Balance</span>
        <span />
      </div>
      {rows.map((row) => {
        const selected = selectedId === row.id;
        const settlement = Boolean(row.settlementId);
        const unconfirmed = row.confirmed === false;
        const opens = Boolean(row.entryId ?? row.lineId ?? row.settlementId);
        const paidBy =
          row.kind === "repayment" || settlement
            ? null
            : row.payerId === view.budget.userId
              ? "You paid"
              : `${account.name} paid`;
        return (
          <div
            key={row.id}
            className={styles.rowWrap}
            data-open={selected || undefined}
          >
            <button
              type="button"
              data-row
              className={`${styles.txColumns} ${styles.row}`}
              aria-current={selected ? "true" : undefined}
              aria-expanded={opens ? selected : undefined}
              onClick={(event) => {
                // Finishing a text selection in the row doesn't click it.
                if (event.detail > 0 && window.getSelection()?.toString())
                  return;
                setSelectedId(selected ? null : row.id);
              }}
            >
              <span className={styles.rowName} data-optional>
                <span
                  className={styles.reviewDot}
                  data-on={row.needsCategory || unconfirmed ? "" : undefined}
                >
                  {(row.needsCategory || unconfirmed) && (
                    <span className="sr-only">
                      {unconfirmed ? "Needs confirming" : "Needs a category"}
                    </span>
                  )}
                </span>
                <span className={`${styles.truncate} ${styles.muted}`}>
                  {shortDay(row.date)}
                </span>
              </span>
              <span className={styles.rowName}>
                <span className={styles.truncate}>{payee(row)}</span>
                {paidBy && (
                  <span className={`${local.paidBy} ${styles.faint}`}>
                    {paidBy}
                  </span>
                )}
                {row.awaitingImport && (
                  <LinkIcon
                    size={12}
                    className={styles.inlineIcon}
                    role="img"
                    aria-label="Waiting for a bank import to match"
                  />
                )}
              </span>
              <span className={styles.truncate}>
                {row.needsCategory ? (
                  <Tag tone="attention">Needs category</Tag>
                ) : settlement ? (
                  unconfirmed ? (
                    <Tag tone="attention">Confirm</Tag>
                  ) : (
                    <span className={styles.faint}>Settlement</span>
                  )
                ) : row.awaitingImport && row.payerId === view.budget.userId ? (
                  <span className={styles.faint}>Waiting for your import</span>
                ) : row.kind === "repayment" ? (
                  <span className={styles.faint}>Repayment</span>
                ) : row.you === 0 ? (
                  <span className={styles.faint}>Not yours</span>
                ) : (
                  <span className={styles.muted}>
                    {name(row.categoryId) ?? "No category"}
                  </span>
                )}
              </span>
              <span
                className={`${styles.numeric} ${styles.faint}`}
                data-optional
              >
                {opens && !settlement ? money(row.shared) : ""}
              </span>
              <span className={styles.numeric}>{money(row.change, true)}</span>
              <span className={`${styles.numeric} ${styles.muted}`}>
                {money(row.balance)}
              </span>
              <span />
            </button>
            {selected && settlement && (
              <SettlementDetail row={row} partnerName={account.name} />
            )}
            {selected && opens && !settlement && (
              <EntryDetail
                key={`${row.id}-${row.partner}-${row.you}`}
                row={row}
                partnerName={account.name}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// How a settlement reads in either budget: how it was sent, and to or from
// whom.
function settlementPayee(row: Row, view: View, partnerName: string) {
  if (row.kind !== "settlement") return row.payee;
  const sent = row.payerId === view.budget.userId;
  return `${row.method} ${sent ? "to" : "from"} ${partnerName}`;
}

// A settlement, opened: what it moved, how both budgets recognized it, and
// the one confirmation that resolves both sides.
function SettlementDetail({
  row,
  partnerName,
}: {
  row: Row;
  partnerName: string;
}) {
  const { saveCommand } = useTransactionEntry();
  const [error, setError] = useState("");
  return (
    <div
      className={share.detail}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className={share.detailMain}>
        <dl className={share.facts}>
          <div>
            <dt>
              {row.change >= 0
                ? `You paid ${partnerName}`
                : `${partnerName} paid you`}
            </dt>
            <dd>{money(Math.abs(row.change))}</dd>
          </div>
        </dl>
        <p className={local.source}>
          <LinkIcon size={13} aria-hidden />
          {row.confirmed
            ? "Matched in both budgets"
            : "Imported in both budgets. Confirm it in either one."}
          {" Reject a wrong match to review both bank imports separately."}
        </p>
        <div className={local.detailActions}>
          {!row.confirmed && (
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                setError(
                  saveCommand(
                    {
                      type: "partner.settlement.confirm",
                      id: newId(),
                      settlementId: row.settlementId!,
                    },
                    `Confirmed. ${partnerName}’s side is confirmed too.`,
                  ) ?? "",
                )
              }
            >
              Confirm settlement
            </Button>
          )}
          <Button
            size="sm"
            onClick={() =>
              setError(
                saveCommand(
                  {
                    type: "partner.settlement.reject",
                    id: newId(),
                    settlementId: row.settlementId!,
                  },
                  "Match rejected. Both bank imports are back in review.",
                ) ?? "",
              )
            }
          >
            Reject match
          </Button>
        </div>
        {error && <p className={moveStyles.error}>{error}</p>}
      </div>
    </div>
  );
}

// An entry, opened: who consumed what, your side's category, the share
// (either partner can change it), and its history.
function EntryDetail({ row, partnerName }: { row: Row; partnerName: string }) {
  const id = useId();
  const entry = useTransactionEntry();
  const { view } = entry;
  const paid = row.payerId === view.budget.userId;
  const refund = row.kind === "refund";
  // The share is the part of the one who didn't pay.
  const theirShare = paid ? row.partner : row.you;
  const shareLabel = paid ? `${partnerName}'s share` : "Your share";
  const [text, setText] = useState((theirShare / 100).toFixed(2));
  const [error, setError] = useState("");
  const apply = (cents: number) => {
    const notice =
      cents === 0
        ? `Wrote off the share of ${row.payee}. Both ledgers show $0.00 now.`
        : `${shareLabel} of ${row.payee} is ${money(cents)}. Both budgets updated.`;
    // Your own imported purchase saves like its Share cell; anything else
    // goes through the shared entry, which changes the payer's transaction.
    const failure = row.transactionId
      ? entry.saveShare(
          row.transactionId,
          row.lineId!,
          shareOf(view, row, cents),
          notice,
        )
      : entry.saveCommand(
          {
            type: "partner.edit",
            id: newId(),
            entryId: row.entryId!,
            share: cents,
            recordedAt: new Date().toISOString(),
          },
          notice,
        );
    if (failure) return setError(failure);
    setError("");
    setText((cents / 100).toFixed(2));
  };
  return (
    <div
      className={share.detail}
      // The register moves its selection with the arrow keys; in here they
      // belong to the fields.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className={share.detailMain}>
        <dl className={share.facts}>
          <div>
            <dt>{refund ? "Refunded" : "Shared"}</dt>
            <dd>{money(row.shared)}</dd>
          </div>
          <div>
            <dt>You</dt>
            <dd>{money(row.you)}</dd>
          </div>
          <div>
            <dt>{partnerName}</dt>
            <dd>{money(row.partner)}</dd>
          </div>
          <div>
            <dt>
              {row.change >= 0
                ? `${partnerName} owes you`
                : `You owe ${partnerName}`}
            </dt>
            <dd>{money(Math.abs(row.change))}</dd>
          </div>
        </dl>
        <Source row={row} partnerName={partnerName} />
        <div className={share.detailField}>
          <label htmlFor={`${id}-category`}>Your category</label>
          {paid && !row.awaitingImport ? (
            <p className={local.readOnly}>
              {view.categories.find((item) => item.id === row.categoryId)
                ?.name ?? "No category"}
              <span className={styles.faint}> · on your {row.payee} line</span>
            </p>
          ) : (
            <SideCategory row={row} id={`${id}-category`} />
          )}
        </div>
        {row.shareMode.mode === "read" ? (
          <div className={share.detailField}>
            <span>{shareLabel}</span>
            <p className={local.readOnly}>{money(theirShare)}</p>
            <p className={share.formHint}>{row.shareMode.reason}</p>
          </div>
        ) : (
          <form
            className={share.detailField}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const cents = parseCents(text);
              if (cents === null)
                return setError("Enter an amount, like 24.50.");
              if (cents > row.shared)
                return setError(`A share can be at most ${money(row.shared)}.`);
              apply(cents);
            }}
          >
            <label htmlFor={`${id}-share`}>{shareLabel}</label>
            <div className={share.shareEdit}>
              <AmountWell
                id={`${id}-share`}
                value={text}
                invalid={Boolean(error)}
                onChange={(value) => {
                  setText(value);
                  if (error) setError("");
                }}
              />
              <Button size="sm" type="submit">
                Update
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => apply(halfOf(row.shared))}
              >
                Split evenly
              </Button>
              {paid && (
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={theirShare === 0}
                  onClick={() => apply(0)}
                >
                  Write off
                </Button>
              )}
            </div>
            {error && <p className={moveStyles.error}>{error}</p>}
            <p className={share.formHint}>
              Changes apply to both budgets at once and stay in the
              entry&rsquo;s history.
            </p>
          </form>
        )}
      </div>
      {row.history.length > 0 && (
        <div className={share.history}>
          <h3>
            <HistoryIcon size={13} aria-hidden />
            History
          </h3>
          <ol>
            {row.history.map((change, index) => (
              <li key={index}>
                <span className={styles.faint}>
                  {change.at ? day(view, change.at) : shortDay(row.date)} ·{" "}
                  {change.actorId === view.budget.userId ? "You" : partnerName}
                </span>
                <span>
                  {describe(change, {
                    row,
                    you: view.budget.userId,
                    partnerName,
                    shareLabel: paid ? shareLabel : "your share",
                    account: accountOf(view, row),
                  })}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// Your side of your partner's purchase. Until you pick one, your payee
// memory fills in the category you gave this payee last time.
function SideCategory({ row, id }: { row: Row; id: string }) {
  const entry = useTransactionEntry();
  const { view } = entry;
  const [value, setValue] = useState(
    row.categoryId ?? row.suggestedCategoryId ?? "",
  );
  const [error, setError] = useState("");
  const options: ChoiceOption[] = view.categories
    .filter(
      (category) =>
        !category.pairedAccountId &&
        !category.pairedLoanId &&
        !category.counterpartyAccountId,
    )
    .map((category) => ({
      value: category.id,
      label: category.name,
      group: category.group,
      amount: category.available,
    }));
  const save = (categoryId: string) => {
    const label = options.find((option) => option.value === categoryId)?.label;
    const failure = entry.saveCommand(
      {
        type: "partner.categorize",
        id: newId(),
        entryId: row.entryId!,
        categoryId,
      },
      paid
        ? `Your import of ${row.payee} will go in ${label}. Only you see that.`
        : `Your ${money(row.you)} of ${row.payee} is in ${label}. Only you see that.`,
    );
    setError(failure ?? "");
  };
  const prefilled = row.needsCategory && Boolean(value);
  const paid = row.payerId === view.budget.userId;
  return (
    <>
      <div className={local.categoryEdit}>
        <ChoiceField
          id={id}
          label="Your category"
          value={value}
          options={options}
          placeholder="Pick a category"
          invalid={Boolean(error)}
          onChange={(next) => {
            setValue(next);
            save(next);
          }}
        />
        {prefilled && (
          <Button size="sm" variant="primary" onClick={() => save(value)}>
            Categorize
          </Button>
        )}
      </div>
      {error ? (
        <p className={moveStyles.error}>{error}</p>
      ) : prefilled ? (
        <p className={share.formHint}>
          Filled in from {row.payee} last time. Only you see your category.
        </p>
      ) : paid && !row.categoryId && value ? (
        <p className={share.formHint}>
          Filled in from {row.payee} last time. Your import takes it when it
          arrives, and only you see it.
        </p>
      ) : (
        paid && (
          <p className={share.formHint}>
            Your import takes this category when it arrives. Only you see it.
          </p>
        )
      )}
    </>
  );
}

// The payer's line share, as the register's share menu saves it.
function shareOf(view: View, row: Row, cents: number) {
  const transaction = view.budget.transactions.find(
    (item) => item.id === row.transactionId,
  );
  const line =
    transaction?.lines?.find((item) => item.id === row.lineId) ?? transaction;
  return { ...line!.counterpartyShare!, amount: cents };
}

function day(view: View, at: string) {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: view.budget.settings.timezone,
  });
}

// The account the viewer paid a shared purchase from, when they did.
function accountOf(view: View, row: Row) {
  const transaction = view.budget.transactions.find(
    (item) => item.id === row.transactionId,
  );
  return view.accounts.find((item) => item.id === transaction?.accountId);
}

// Where an entry's facts come from: the payer's bank import, or a partner
// who recorded it before the import arrived.
function Source({ row, partnerName }: { row: Row; partnerName: string }) {
  const { view } = useTransactionEntry();
  const you = view.budget.userId;
  const paid = row.payerId === you;
  const recorder = row.recordedBy === you ? "You" : partnerName;
  const account = accountOf(view, row);
  const transaction = view.budget.transactions.find(
    (item) => item.id === row.transactionId,
  );
  const text = row.awaitingImport
    ? `${recorder} recorded this. ${paid ? "Your" : `${partnerName}'s`} bank import will match it when it arrives.`
    : row.recordedBy
      ? `${recorder} recorded this first. Matched to ${paid ? `your ${account?.name ?? "bank"} import` : `${partnerName}'s bank import`}.`
      : paid && transaction?.providerId && account
        ? `From your ${account.name} import`
        : undefined;
  if (!text) return null;
  return (
    <p className={local.source}>
      <LinkIcon size={13} aria-hidden />
      {text}
    </p>
  );
}

// What an entry's amount and share were when it was recorded: its facts
// now, with every later change undone.
function recordedFacts(row: Row, you: string, from: number) {
  const facts: Record<string, string | number> = {
    amount: row.shared,
    // The share is the part of the one who didn't pay.
    share: row.payerId === you ? row.partner : row.you,
  };
  for (const change of row.history.slice(from + 1).reverse())
    for (const { field, previous } of change.changes ?? [])
      facts[field] = previous;
  return {
    amount: Math.abs(Number(facts.amount)),
    share: Number(facts.share),
  };
}

// One change to an entry, in words.
function describe(
  change: PartnerEntryChange,
  context: {
    row: Row;
    you: string;
    partnerName: string;
    shareLabel: string;
    account?: { name: string };
  },
) {
  const { row, you, partnerName, shareLabel } = context;
  if (change.reason === "created") return "Shared";
  if (change.reason === "removed") return "Removed from the ledger";
  if (change.reason === "recorded") {
    const { amount, share } = recordedFacts(
      row,
      you,
      row.history.indexOf(change),
    );
    const paid = row.payerId === you;
    return `Recorded: ${paid ? "You" : partnerName} paid ${money(amount)}, ${paid ? `${partnerName}'s` : "your"} share ${money(share)}`;
  }
  const parts = (change.changes ?? []).map(({ field, previous, next }) => {
    if (field === "share")
      return Number(next) === 0
        ? `Changed ${shareLabel} from ${money(Number(previous))} to $0.00 (written off)`
        : `Changed ${shareLabel} from ${money(Number(previous))} to ${money(Number(next))}`;
    if (field === "amount")
      return `Changed the amount from ${money(Math.abs(Number(previous)))} to ${money(Math.abs(Number(next)))}`;
    if (field === "date")
      return `Moved it from ${shortDay(String(previous))} to ${shortDay(String(next))}`;
    if (field === "payee") return `Renamed it from ${previous} to ${next}`;
    return next === "posted" ? "Posted" : `Marked ${next}`;
  });
  if (change.reason === "restored")
    return ["Shared again", ...parts].join(". ");
  if (change.reason === "matched")
    return [
      row.payerId === you
        ? `Matched to your ${context.account?.name ?? "bank"} import`
        : `Matched to ${partnerName}'s bank import`,
      ...parts,
    ].join(". ");
  return parts.join(". ") || "Updated";
}
