"use client";

import {
  CalendarClockIcon,
  CheckIcon,
  CopyIcon,
  HistoryIcon,
  LinkIcon,
  PlusIcon,
} from "lucide-react";
import { Popover } from "radix-ui";
import {
  Fragment,
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Button } from "~/components/ui/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { Tag } from "~/components/ui/tag";
import { usePortalContainer } from "~/components/ui/tooltip";
import moveStyles from "../app-shell/move-money.module.css";
import shell from "../app-shell/shell.module.css";
import {
  ChoiceField,
  type ChoiceOption,
} from "../app-shell/transaction-fields";
import {
  EQUAL_SPLIT,
  names,
  PARTNER,
  partnerOf,
  TODAY,
  type Person,
  type State,
} from "./data";
import {
  categoryName,
  equalShare,
  money,
  parseCents,
  shortDay,
  type Budget,
  type LedgerRow,
} from "./ledger";
import { AmountWell } from "./share";
import { rememberedCategory, type Action } from "./store";
import styles from "./shared-costs.module.css";

const ledgerColumns = {
  "--tx-columns":
    "5.5rem minmax(0, 1.4fr) minmax(0, 1fr) 6.5rem 7rem 7rem 16px",
} as CSSProperties;

function owedSentence(budget: Budget) {
  const balance = budget.partnerBalance;
  if (balance > 0) return `${budget.partnerName} owes you`;
  if (balance < 0) return `You owe ${budget.partnerName}`;
  return `You and ${budget.partnerName} are even`;
}

// The partner account: the one ledger both budgets share. Its balance is
// what's owed, live; every entry is paired with the envelope beside it.
export function PartnerRegister({
  budget,
  state,
  selectedId,
  onSelect,
  dispatch,
  notify,
}: {
  budget: Budget;
  state: State;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  dispatch: (action: Action) => void;
  notify: (message: string) => void;
}) {
  const envelope = budget.categories.find((item) => item.paired === "partner")!;
  const balance = budget.partnerBalance;
  const request = budget.request;
  const owesYou = balance > 0;
  return (
    <>
      <div className={shell.accountSummary}>
        <dl className={shell.balances}>
          <div data-total>
            <dt>{owedSentence(budget)}</dt>
            <dd className={styles.owed}>{money(Math.abs(balance))}</dd>
          </div>
          {request && (
            <div>
              <dt>
                {request.by === budget.person
                  ? "You asked for"
                  : `${names[request.by]} asked for`}{" "}
                {money(request.amount)} on {shortDay(request.date)}
              </dt>
              <dd>
                {request.left > 0
                  ? `${money(request.left)} left`
                  : "Paid in full"}
              </dd>
            </div>
          )}
          <div>
            <dt>
              {envelope.name} envelope
              {envelope.assigned > 0 && ` · ${money(envelope.assigned)} float`}
            </dt>
            <dd className={styles.envelopeFigure} data-state={envelope.funding}>
              {money(envelope.available)}
            </dd>
          </div>
        </dl>
        <div className={shell.summaryActions}>
          <RecordPopover
            budget={budget}
            state={state}
            dispatch={dispatch}
            notify={notify}
          />
          {owesYou ? (
            <RequestPopover
              budget={budget}
              dispatch={dispatch}
              notify={notify}
            />
          ) : balance < 0 ? (
            <PayPopover budget={budget} />
          ) : null}
        </div>
      </div>
      {request && request.left > 0 && <RequestProgress budget={budget} />}
      <div
        className={`${shell.list} ${shell.register} ${styles.ledger}`}
        style={ledgerColumns}
        role="group"
        aria-label={`${budget.partnerName} ledger`}
      >
        <div className={`${shell.txColumns} ${shell.columnHeader}`} aria-hidden>
          <span>Date</span>
          <span>Payee</span>
          <span>Your category</span>
          <span className={shell.numeric}>Shared</span>
          <span className={shell.numeric}>Amount</span>
          <span className={shell.numeric}>Balance</span>
          <span />
        </div>
        {budget.upcoming.length > 0 && (
          <div className={shell.pendingGroup}>
            <div
              className={`${shell.dayRow} ${shell.groupRow} ${shell.pendingHeader}`}
            >
              <CalendarClockIcon size={13} aria-hidden />
              <span>Expected</span>
              <span className={shell.groupCount}>{budget.upcoming.length}</span>
            </div>
            {budget.upcoming.map((row) => (
              <LedgerItem
                key={row.id}
                row={row}
                budget={budget}
                state={state}
                selected={selectedId === row.id}
                onSelect={onSelect}
                dispatch={dispatch}
                notify={notify}
              />
            ))}
          </div>
        )}
        {budget.ledger.map((row) => (
          <LedgerItem
            key={row.id}
            row={row}
            budget={budget}
            state={state}
            selected={selectedId === row.id}
            onSelect={onSelect}
            dispatch={dispatch}
            notify={notify}
          />
        ))}
      </div>
    </>
  );
}

// A request is a record, not a reminder: how much, when, and what's been
// paid toward it since.
function RequestProgress({ budget }: { budget: Budget }) {
  const request = budget.request!;
  const ratio = Math.min(1, request.paid / request.amount);
  const days = Math.round(
    (new Date(`${TODAY}T12:00:00`).getTime() -
      new Date(`${request.date}T12:00:00`).getTime()) /
      86_400_000,
  );
  return (
    <div className={styles.requestStrip}>
      <span className={styles.requestTrack} aria-hidden>
        <span style={{ transform: `scaleX(${ratio})` }} />
      </span>
      <span>
        {money(request.paid)} of {money(request.amount)} paid since{" "}
        {request.by === budget.person ? "you" : names[request.by]} asked{" "}
        {days === 0 ? "today" : `${days} days ago`}
      </span>
    </div>
  );
}

function LedgerItem({
  row,
  budget,
  state,
  selected,
  onSelect,
  dispatch,
  notify,
}: {
  row: LedgerRow;
  budget: Budget;
  state: State;
  selected: boolean;
  onSelect: (id: string | null) => void;
  dispatch: (action: Action) => void;
  notify: (message: string) => void;
}) {
  const paidBy =
    row.paidBy === null
      ? null
      : row.paidBy === budget.person
        ? "You paid"
        : `${names[row.paidBy]} paid`;
  return (
    <div className={shell.rowWrap} data-open={selected || undefined}>
      <button
        type="button"
        data-row
        className={`${shell.txColumns} ${shell.row}`}
        data-pending={row.kind === "expected" || undefined}
        aria-current={selected ? "true" : undefined}
        aria-expanded={selected}
        onClick={() => onSelect(selected ? null : row.id)}
      >
        <span className={shell.rowName}>
          <span
            className={shell.reviewDot}
            data-on={
              row.needsCategory || row.confirmed === false ? "" : undefined
            }
          />
          <span className={`${shell.truncate} ${shell.muted}`}>
            {shortDay(row.date)}
          </span>
        </span>
        <span className={shell.rowName}>
          <span className={shell.truncate}>{row.payee}</span>
          {row.kind === "purchase" && paidBy && (
            <span className={`${styles.paidBy} ${shell.faint}`}>{paidBy}</span>
          )}
          {row.kind === "purchase" && row.txn && !row.txn.accountId && (
            <LinkIcon
              size={12}
              className={shell.inlineIcon}
              aria-label="Waiting for a bank import to match"
            />
          )}
        </span>
        <span className={shell.truncate}>
          {row.needsCategory ? (
            <Tag tone="attention">Needs category</Tag>
          ) : row.kind === "settlement" ? (
            row.confirmed ? (
              <span className={shell.faint}>Settlement</span>
            ) : (
              <Tag tone="attention">Confirm</Tag>
            )
          ) : row.kind === "opening" ? (
            <span className={shell.faint}>Owed before linking</span>
          ) : row.kind === "expected" && !row.categoryId ? (
            <span className={shell.faint}>Categorize when it posts</span>
          ) : row.txn && !row.txn.accountId && row.paidBy === budget.person ? (
            <span className={shell.faint}>Waiting for your import</span>
          ) : row.mine === 0 && row.kind === "purchase" ? (
            <span className={shell.faint}>Not yours</span>
          ) : (
            <span className={shell.muted}>
              {categoryName(row.categoryId) ?? "No category"}
            </span>
          )}
        </span>
        <span className={`${shell.numeric} ${shell.faint}`}>
          {row.kind === "purchase" || row.kind === "expected"
            ? money(row.shared)
            : ""}
        </span>
        <span className={shell.numeric}>{money(row.change, true)}</span>
        <span className={`${shell.numeric} ${shell.muted}`}>
          {money(row.balance)}
        </span>
        <span />
      </button>
      {selected && (
        <EntryDetail
          key={`${row.id}-${row.change}`}
          row={row}
          budget={budget}
          state={state}
          dispatch={dispatch}
          notify={notify}
        />
      )}
    </div>
  );
}

// An entry, opened: who consumed what, where it came from, your side's
// category, its share (either partner can change it), and its history.
function EntryDetail({
  row,
  budget,
  state,
  dispatch,
  notify,
}: {
  row: LedgerRow;
  budget: Budget;
  state: State;
  dispatch: (action: Action) => void;
  notify: (message: string) => void;
}) {
  const id = useId();
  const txn = row.txn;
  const line = txn?.lines.find((item) => item.share?.with === PARTNER);
  const consumer: Person | null = txn ? partnerOf(txn.owner) : null;
  const consumerName =
    consumer === budget.person
      ? "Your share"
      : `${names[consumer ?? "anna"]}'s share`;
  const [text, setText] = useState(
    line?.share ? (line.share.amount / 100).toFixed(2) : "",
  );
  const [error, setError] = useState("");
  const options: ChoiceOption[] = budget.categories
    .filter((item) => !item.paired)
    .map((item) => ({
      value: item.id,
      label: item.name,
      group: item.group,
      amount: item.available,
    }));
  const facts = (
    <dl className={styles.facts}>
      {row.kind !== "opening" && row.kind !== "settlement" && (
        <>
          <div>
            <dt>Shared</dt>
            <dd>{money(row.shared)}</dd>
          </div>
          <div>
            <dt>You</dt>
            <dd>{money(row.mine)}</dd>
          </div>
          <div>
            <dt>{budget.partnerName}</dt>
            <dd>{money(row.theirs)}</dd>
          </div>
        </>
      )}
      <div>
        <dt>
          {row.change >= 0
            ? `${budget.partnerName} owes you`
            : `You owe ${budget.partnerName}`}
        </dt>
        <dd>{money(Math.abs(row.change))}</dd>
      </div>
    </dl>
  );
  const apply = (cents: number) => {
    if (!txn || !line) return;
    dispatch({
      type: "share",
      txnId: txn.id,
      lineId: line.id,
      share: { with: PARTNER, amount: cents },
      by: budget.person,
    });
    setText((cents / 100).toFixed(2));
    notify(
      cents === 0
        ? `Wrote off the share of ${txn.payee}. Both ledgers show $0.00 now.`
        : `${consumerName} of ${txn.payee} is ${money(cents)}. Both budgets updated.`,
    );
  };
  return (
    <div className={styles.detail}>
      <div className={styles.detailMain}>
        {facts}
        <p className={styles.source}>
          <LinkIcon size={13} aria-hidden />
          {row.source}
        </p>
        {row.kind === "settlement" && !row.confirmed && row.settlementId && (
          <div className={styles.detailActions}>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                dispatch({ type: "confirmSettlement", id: row.settlementId! });
                notify(
                  `Confirmed. ${budget.partnerName}'s side is confirmed too.`,
                );
              }}
            >
              Confirm settlement
            </Button>
          </div>
        )}
        {row.kind === "purchase" && txn && line && (
          <div className={styles.detailFields}>
            <div className={styles.detailField}>
              <label htmlFor={`${id}-category`}>Your category</label>
              {row.categorizable ? (
                <ChoiceField
                  id={`${id}-category`}
                  label="Your category"
                  value={row.categoryId ?? ""}
                  options={options}
                  placeholder={
                    rememberedCategory(state, budget.person, txn.payee)
                      ? "Category"
                      : "Pick a category"
                  }
                  onChange={(categoryId) => {
                    dispatch({
                      type: "categorizeSide",
                      txnId: txn.id,
                      categoryId,
                    });
                    notify(
                      `Your ${money(row.mine)} of ${txn.payee} is in ${categoryName(categoryId)}. Only you see that.`,
                    );
                  }}
                />
              ) : (
                <p className={styles.readOnly}>
                  {categoryName(row.categoryId) ?? "No category"}
                  <span className={shell.faint}>
                    {" "}
                    · on your {txn.payee} line
                  </span>
                </p>
              )}
            </div>
            <form
              className={styles.detailField}
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                const cents = parseCents(text);
                if (cents === null)
                  return setError("Enter an amount, like 24.50.");
                if (cents > line.amount)
                  return setError(
                    `A share can be at most ${money(line.amount)}.`,
                  );
                setError("");
                apply(cents);
              }}
            >
              <label htmlFor={`${id}-share`}>{consumerName}</label>
              <div className={styles.shareEdit}>
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
                  onClick={() => apply(equalShare(line.amount, EQUAL_SPLIT))}
                >
                  Split evenly
                </Button>
                {txn.owner === budget.person && (
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={line.share?.amount === 0}
                    onClick={() => apply(0)}
                  >
                    Write off
                  </Button>
                )}
              </div>
              {error && <p className={moveStyles.error}>{error}</p>}
              <p className={styles.formHint}>
                Changes apply to both budgets at once and stay in the
                entry&rsquo;s history.
              </p>
            </form>
          </div>
        )}
      </div>
      {row.history.length > 0 && (
        <div className={styles.history}>
          <h3>
            <HistoryIcon size={13} aria-hidden />
            History
          </h3>
          <ol>
            {row.history.map((change, index) => (
              <li key={index}>
                <span className={shell.faint}>
                  {shortDay(change.at)} ·{" "}
                  {change.by === budget.person ? "You" : names[change.by]}
                </span>
                <span>{change.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function SummaryPopover({
  label,
  trigger,
  children,
  open,
  onOpenChange,
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const container = usePortalContainer();
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={moveStyles.popover}
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
        >
          {children}
          <Popover.Arrow className={moveStyles.arrow} width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RequestPopover({
  budget,
  dispatch,
  notify,
}: {
  budget: Budget;
  dispatch: (action: Action) => void;
  notify: (message: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  return (
    <SummaryPopover
      label={`Request money from ${budget.partnerName}`}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setText((budget.partnerBalance / 100).toFixed(2));
          setError("");
        }
      }}
      trigger={
        <Button size="sm" variant="primary">
          Request money
        </Button>
      }
    >
      <form
        className={moveStyles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          const cents = parseCents(text);
          if (!cents) return setError("Enter an amount, like 250.00.");
          dispatch({ type: "request", by: budget.person, amount: cents });
          notify(
            `Asked ${budget.partnerName} for ${money(cents)}. It's on both ledgers.`,
          );
          setOpen(false);
        }}
      >
        <div className={moveStyles.header}>
          <strong>Request from {budget.partnerName}</strong>
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
          <p className={styles.formHint}>
            {budget.partnerName} sees it on the ledger with today&rsquo;s date.
            Settlements count toward it until it&rsquo;s paid. No deadline, no
            reminders.
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
    </SummaryPopover>
  );
}

function PayPopover({ budget }: { budget: Budget }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const amount = -budget.partnerBalance;
  const request = budget.request;
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <SummaryPopover
      label={`Pay ${budget.partnerName}`}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button size="sm" variant="primary">
          Pay {budget.partnerName}
        </Button>
      }
    >
      <div className={moveStyles.form}>
        <div className={moveStyles.header}>
          <strong>Pay {budget.partnerName}</strong>
          <span className={moveStyles.balance}>{money(amount)}</span>
        </div>
        <div className={styles.popoverBody}>
          <p>
            Send it from your bank, by Zelle or a transfer, in any amount. When
            it imports to both budgets, it&rsquo;s matched by amount, date, and
            direction, and the balance updates for you both.
          </p>
          {request && request.by !== budget.person && request.left > 0 && (
            <p className={shell.faint}>
              {names[request.by]} asked for {money(request.amount)} on{" "}
              {shortDay(request.date)}. {money(request.left)} is left.
            </p>
          )}
          <p className={shell.faint}>
            The {money(amount)} is already held in your {budget.partnerName}{" "}
            envelope, so paying won&rsquo;t touch any other category.
          </p>
        </div>
        <div className={moveStyles.footer}>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText((amount / 100).toFixed(2));
              setCopied(true);
            }}
          >
            {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            {copied ? "Copied" : "Copy amount"}
          </Button>
          <Button size="sm" variant="primary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </div>
    </SummaryPopover>
  );
}

// Either partner can record a shared purchase, including one the other
// paid. It counts at once; the payer's bank import matches it later.
function RecordPopover({
  budget,
  state,
  dispatch,
  notify,
}: {
  budget: Budget;
  state: State;
  dispatch: (action: Action) => void;
  notify: (message: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [payee, setPayee] = useState("");
  const [amountText, setAmountText] = useState("");
  const [paidBy, setPaidBy] = useState<Person>(budget.partner);
  const [even, setEven] = useState(true);
  const [shareText, setShareText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState("");
  const amount = parseCents(amountText) ?? 0;
  const consumer = partnerOf(paidBy);
  const consumerLabel =
    consumer === budget.person ? "Your share" : `${names[consumer]}'s share`;
  const options: ChoiceOption[] = budget.categories
    .filter((item) => !item.paired)
    .map((item) => ({
      value: item.id,
      label: item.name,
      group: item.group,
      amount: item.available,
    }));
  const reset = () => {
    setPayee("");
    setAmountText("");
    setPaidBy(budget.partner);
    setEven(true);
    setShareText("");
    setCategoryId("");
    setError("");
  };
  return (
    <SummaryPopover
      label="Record a shared purchase"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
      trigger={
        <Button size="sm">
          <PlusIcon aria-hidden />
          Record purchase
        </Button>
      }
    >
      <form
        className={moveStyles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!payee.trim()) return setError("Add who was paid.");
          if (!amount) return setError("Enter the amount, like 54.00.");
          const share = even
            ? equalShare(amount, EQUAL_SPLIT)
            : parseCents(shareText);
          if (share === null || share > amount)
            return setError(`A share can be at most ${money(amount)}.`);
          dispatch({
            type: "record",
            by: budget.person,
            paidBy,
            payee: payee.trim(),
            date: TODAY,
            amount,
            share,
            categoryId: categoryId || null,
          });
          notify(
            paidBy === budget.person
              ? `Recorded ${payee.trim()}. ${budget.partnerName} owes you ${money(share)}; your bank import will match it.`
              : `Recorded ${payee.trim()}. You owe ${budget.partnerName} ${money(share)}; ${budget.partnerName}'s bank import will match it.`,
          );
          setOpen(false);
        }}
      >
        <div className={moveStyles.header}>
          <strong>Record a shared purchase</strong>
        </div>
        <div className={moveStyles.field}>
          <span id={`${id}-paid`}>Who paid</span>
          <SegmentedControl
            fill
            aria-labelledby={`${id}-paid`}
            value={paidBy}
            onValueChange={(next) => setPaidBy(next as Person)}
          >
            <SegmentedControlItem value={budget.partner}>
              {budget.partnerName}
            </SegmentedControlItem>
            <SegmentedControlItem value={budget.person}>
              You
            </SegmentedControlItem>
          </SegmentedControl>
        </div>
        <div className={moveStyles.field}>
          <label htmlFor={`${id}-payee`}>Payee</label>
          <div className={moveStyles.amountInput}>
            <input
              id={`${id}-payee`}
              value={payee}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="Bi-Rite Market"
              onChange={(event) => {
                setPayee(event.target.value);
                const remembered = rememberedCategory(
                  state,
                  budget.person,
                  event.target.value.trim(),
                );
                if (remembered) setCategoryId(remembered);
              }}
            />
          </div>
        </div>
        <div className={styles.fieldPair}>
          <div className={moveStyles.field}>
            <label htmlFor={`${id}-amount`}>Total paid</label>
            <AmountWell
              id={`${id}-amount`}
              value={amountText}
              onChange={setAmountText}
            />
          </div>
          <div className={moveStyles.field}>
            <label htmlFor={`${id}-share`}>{consumerLabel}</label>
            {even ? (
              <button
                type="button"
                id={`${id}-share`}
                className={`${moveStyles.amountInput} ${styles.evenButton}`}
                onClick={() => {
                  setEven(false);
                  setShareText(
                    (equalShare(amount, EQUAL_SPLIT) / 100).toFixed(2),
                  );
                }}
              >
                <span>Half</span>
                <span className={styles.evenAmount}>
                  {money(equalShare(amount, EQUAL_SPLIT))}
                </span>
              </button>
            ) : (
              <AmountWell
                id={`${id}-share`}
                value={shareText}
                autoFocus
                onChange={setShareText}
              />
            )}
          </div>
        </div>
        <div className={moveStyles.field}>
          <label htmlFor={`${id}-category`}>
            Your category{paidBy === budget.person ? "" : " for your share"}
          </label>
          <div className={styles.choiceWell}>
            <ChoiceField
              id={`${id}-category`}
              label="Your category"
              value={categoryId}
              options={options}
              placeholder="Pick later"
              onChange={setCategoryId}
            />
          </div>
        </div>
        {error && (
          <div className={moveStyles.formError}>
            <p className={moveStyles.error}>{error}</p>
          </div>
        )}
        <div className={moveStyles.footer}>
          <Button size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            Record
          </Button>
        </div>
      </form>
    </SummaryPopover>
  );
}

// Everyone who isn't the partner, in one private account. Who owes what is
// a filter on it, not an account each.
export function ReimbursementsRegister({ budget }: { budget: Budget }) {
  const [who, setWho] = useState<string | null>(null);
  const envelope = budget.categories.find(
    (item) => item.paired === "reimbursements",
  )!;
  const rows = budget.reimbursements.filter((row) => !who || row.who === who);
  // Running balances for one person, recomputed under the filter.
  let running = 0;
  const balances = [...rows]
    .reverse()
    .map((row) => (running += row.change))
    .reverse();
  const columns = {
    "--tx-columns":
      "5.5rem minmax(0, 1.3fr) minmax(0, 0.8fr) minmax(0, 0.8fr) 7rem 7rem 16px",
  } as CSSProperties;
  return (
    <>
      <div className={shell.accountSummary}>
        <dl className={shell.balances}>
          <div data-total>
            <dt>Owed to you</dt>
            <dd className={styles.owed}>
              {money(budget.reimbursementBalance)}
            </dd>
          </div>
          <div>
            <dt>
              Reimbursements envelope
              {envelope.assigned > 0 && ` · ${money(envelope.assigned)} float`}
            </dt>
            <dd className={styles.envelopeFigure} data-state={envelope.funding}>
              {money(envelope.available)}
            </dd>
          </div>
        </dl>
        <p className={styles.privateNote}>Only you see this account.</p>
      </div>
      <div className={shell.toolbar}>
        <Button
          size="sm"
          aria-pressed={who === null}
          onClick={() => setWho(null)}
        >
          Everyone
        </Button>
        {budget.owedBy.map((item) => (
          <Button
            key={item.who}
            size="sm"
            aria-pressed={who === item.who}
            onClick={() => setWho(who === item.who ? null : item.who)}
          >
            {item.who}
            <span className={shell.numeric}>{money(item.balance)}</span>
          </Button>
        ))}
      </div>
      <div
        className={`${shell.list} ${shell.register}`}
        style={columns}
        role="group"
        aria-label="Reimbursements"
      >
        <div className={`${shell.txColumns} ${shell.columnHeader}`} aria-hidden>
          <span>Date</span>
          <span>Payee</span>
          <span>Who</span>
          <span>Category</span>
          <span className={shell.numeric}>Amount</span>
          <span className={shell.numeric}>Balance</span>
          <span />
        </div>
        {rows.map((row, index) => (
          <Fragment key={row.id}>
            <div className={shell.rowWrap}>
              <div className={`${shell.txColumns} ${shell.row}`}>
                <span className={shell.rowName}>
                  <span
                    className={shell.reviewDot}
                    data-on={row.txn.reviewed ? undefined : ""}
                  />
                  <span className={`${shell.truncate} ${shell.muted}`}>
                    {shortDay(row.date)}
                  </span>
                </span>
                <span className={shell.truncate}>{row.payee}</span>
                <span className={shell.truncate}>{row.who}</span>
                <span className={`${shell.truncate} ${shell.muted}`}>
                  {row.categoryLabel}
                </span>
                <span className={shell.numeric}>{money(row.change, true)}</span>
                <span className={`${shell.numeric} ${shell.muted}`}>
                  {money(balances[index]!)}
                </span>
                <span />
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    </>
  );
}
