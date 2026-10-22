"use client";

import {
  CircleCheckIcon,
  Clock3Icon,
  PlusIcon,
  SplitIcon,
  XIcon,
} from "lucide-react";
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { Tag } from "~/components/ui/tag";
import shell from "../app-shell/shell.module.css";
import entry from "../app-shell/transaction-entry.module.css";
import {
  ChoiceField,
  type ChoiceOption,
} from "../app-shell/transaction-fields";
import { PARTNER, type Line, type Share } from "./data";
import {
  accountName,
  counterpartyLabel,
  money,
  parseCents,
  shortDay,
  type BankRow,
  type Budget,
} from "./ledger";
import { ShareBar, ShareMenu, shareLabel } from "./share";
import type { Action } from "./store";
import styles from "./shared-costs.module.css";

export type ShareVariant = "column" | "editor";

const statusIcon = {
  pending: { icon: Clock3Icon, label: "Pending" },
  posted: { icon: CircleCheckIcon, label: "Cleared" },
};

function columns(accounts: boolean, share: boolean) {
  return [
    accounts && "minmax(0, 0.8fr)",
    "5.5rem",
    "minmax(0, 1.3fr)",
    "minmax(0, 1fr)",
    share && "10.5rem",
    "6.5rem",
    "6.5rem",
    "16px",
  ]
    .filter(Boolean)
    .join(" ");
}

export function BankRegister({
  budget,
  accountId,
  variant,
  reviewOnly,
  selectedId,
  editingId,
  onSelect,
  onEdit,
  dispatch,
  notify,
}: {
  budget: Budget;
  accountId: string | null;
  variant: ShareVariant;
  reviewOnly: boolean;
  selectedId: string | null;
  editingId: string | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
  dispatch: (action: Action) => void;
  notify: (message: string) => void;
}) {
  const accountColumn = !accountId;
  const shareColumn = variant === "column";
  const rows = budget.bank.filter(
    (row) =>
      (!accountId || row.accountId === accountId) &&
      (!reviewOnly || !row.reviewed || row.id === editingId),
  );
  const pending = rows.filter((row) => row.status === "pending");
  const cleared = rows.filter((row) => row.status !== "pending");
  const people = budget.owedBy.map((item) => item.who);
  const style = {
    "--tx-columns": columns(accountColumn, shareColumn),
  } as CSSProperties;

  const setShare = (row: BankRow, line: Line, share: Share | null) => {
    dispatch({
      type: "share",
      txnId: row.txn!.id,
      lineId: line.id,
      share,
      by: budget.person,
    });
    notify(shareNotice(budget, row.payee, share));
  };

  const shareCell = (row: BankRow) => {
    if (row.kind !== "spend" || !row.txn) return null;
    const label = shareLabel(row.share, budget.partnerName);
    const button = (
      <button
        type="button"
        className={styles.shareButton}
        data-empty={!label || undefined}
        aria-label={
          row.share
            ? `${row.share.label}'s share of ${row.payee}: ${money(row.share.amount)}. Change`
            : `Share ${row.payee}`
        }
        onClick={row.split ? () => onEdit(row.id) : undefined}
      >
        {label ?? (
          <>
            <PlusIcon size={12} aria-hidden />
            Share
          </>
        )}
      </button>
    );
    if (row.split) return button;
    const line = row.txn.lines[0]!;
    return (
      <ShareMenu
        amount={line.amount}
        share={line.share}
        partnerName={budget.partnerName}
        people={people}
        remembered={row.txn.remembered ? row.payee : undefined}
        onChange={(share) => setShare(row, line, share)}
      >
        {button}
      </ShareMenu>
    );
  };

  const renderRow = (row: BankRow) => {
    if (row.id === editingId)
      return (
        <RowEditor
          key={row.id}
          row={row}
          budget={budget}
          variant={variant}
          accountColumn={accountColumn}
          onClose={() => onEdit(null)}
          dispatch={dispatch}
          notify={notify}
        />
      );
    const status = statusIcon[row.status];
    const selected = selectedId === row.id;
    const shareColumnIndex = (accountColumn ? 1 : 0) + 4;
    return (
      <div
        key={row.id}
        className={shell.rowWrap}
        data-shareable={row.kind === "spend" || undefined}
      >
        <button
          type="button"
          data-row
          className={`${shell.txColumns} ${shell.row}`}
          data-pending={row.status === "pending" || undefined}
          aria-current={selected ? "true" : undefined}
          onClick={() => {
            if (selected && row.kind !== "income") onEdit(row.id);
            else onSelect(row.id);
          }}
        >
          {accountColumn && (
            <span className={shell.rowName} data-optional>
              <ReviewDot on={!row.reviewed} />
              <span className={`${shell.truncate} ${shell.faint}`}>
                {accountName(row.accountId)}
              </span>
            </span>
          )}
          <span className={shell.rowName}>
            {!accountColumn && <ReviewDot on={!row.reviewed} />}
            <span className={`${shell.truncate} ${shell.muted}`}>
              {shortDay(row.date)}
            </span>
          </span>
          <span className={shell.rowName}>
            <span className={shell.truncate}>{row.payee}</span>
          </span>
          <span className={`${shell.truncate} ${styles.categoryCell}`}>
            {row.needsCategory ? (
              <Tag tone="attention">Needs category</Tag>
            ) : (
              <span className={shell.muted}>{row.categoryLabel}</span>
            )}
            {!shareColumn && row.share && (
              <span className={styles.inlineShare}>
                {shareLabel(row.share, budget.partnerName)}
              </span>
            )}
          </span>
          {shareColumn && <span aria-hidden />}
          <span className={shell.numeric}>
            {row.amount < 0 && money(-row.amount)}
          </span>
          <span
            className={shell.numeric}
            data-inflow={row.amount > 0 || undefined}
          >
            {row.amount > 0 && money(row.amount)}
          </span>
          <span className={shell.statusCell}>
            <status.icon
              size={14}
              className={shell.statusIcon}
              data-status={row.status}
              aria-label={status.label}
            />
          </span>
        </button>
        {shareColumn && row.kind === "spend" && (
          <div className={`${shell.txColumns} ${shell.rowActions}`}>
            <span
              className={styles.shareSlot}
              style={{ gridColumn: shareColumnIndex }}
            >
              {shareCell(row)}
            </span>
          </div>
        )}
      </div>
    );
  };

  if (!rows.length)
    return (
      <div className={shell.empty} data-tone="done">
        <CircleCheckIcon size={18} aria-hidden />
        <div className={shell.emptyBody}>
          <p>
            <strong>Everything here is reviewed.</strong>
            New bank imports show up as they arrive.
          </p>
        </div>
      </div>
    );

  return (
    <div
      className={`${shell.list} ${shell.register}`}
      style={style}
      role="group"
      aria-label="Transactions"
    >
      <div className={`${shell.txColumns} ${shell.columnHeader}`} aria-hidden>
        {accountColumn && <span data-optional>Account</span>}
        <span>Date</span>
        <span>Payee</span>
        <span>Category</span>
        {shareColumn && <span>Share</span>}
        <span className={shell.numeric}>Outflow</span>
        <span className={shell.numeric}>Inflow</span>
        <span />
      </div>
      {pending.length > 0 && (
        <div className={shell.pendingGroup}>
          <div
            className={`${shell.dayRow} ${shell.groupRow} ${shell.pendingHeader}`}
          >
            <span>Pending</span>
            <span className={shell.groupCount}>{pending.length}</span>
          </div>
          {pending.map(renderRow)}
        </div>
      )}
      {cleared.map(renderRow)}
    </div>
  );
}

function ReviewDot({ on }: { on: boolean }) {
  return (
    <span className={shell.reviewDot} data-on={on ? "" : undefined}>
      {on && <span className="sr-only">Needs review</span>}
    </span>
  );
}

function shareNotice(budget: Budget, payee: string, share: Share | null) {
  if (!share) return `${payee} is all yours now.`;
  const who = counterpartyLabel(budget.person, share.with);
  return share.with === PARTNER
    ? `${who}'s share of ${payee} is ${money(share.amount)}. It's on ${who}'s ledger now.`
    : `${who} owes you ${money(share.amount)} for ${payee}.`;
}

// The open row: its bank facts stay as they were imported; the category and
// share on each line are what you fill in. Splitting adds a line.
function RowEditor({
  row,
  budget,
  variant,
  accountColumn,
  onClose,
  dispatch,
  notify,
}: {
  row: BankRow;
  budget: Budget;
  variant: ShareVariant;
  accountColumn: boolean;
  onClose: () => void;
  dispatch: (action: Action) => void;
  notify: (message: string) => void;
}) {
  const formId = useId();
  const txn = row.txn;
  const [lines, setLines] = useState<Line[]>(() => txn?.lines ?? []);
  const [amounts, setAmounts] = useState<string[]>(() =>
    (txn?.lines ?? []).map((line) => (line.amount / 100).toFixed(2)),
  );
  const [error, setError] = useState("");
  const shareColumn = variant === "column";
  const people = budget.owedBy.map((item) => item.who);
  const total = Math.abs(row.amount);
  const options: ChoiceOption[] = budget.categories
    .filter((item) => !item.paired)
    .map((item) => ({
      value: item.id,
      label: item.name,
      group: item.group,
      amount: item.available,
    }));

  const update = (index: number, change: Partial<Line>) =>
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...change } : line)),
    );

  if (row.kind !== "spend" || !txn) {
    const settlement = row.kind === "settlement";
    return (
      <form
        className={entry.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (row.settlementId)
            dispatch({ type: "confirmSettlement", id: row.settlementId });
          else if (txn) dispatch({ type: "review", txnId: txn.id });
          notify(
            settlement
              ? `Confirmed. ${budget.partnerName}'s side is confirmed too.`
              : `Confirmed ${money(row.amount)} from ${txn?.from}.`,
          );
          onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <StaticRow
          row={row}
          accountColumn={accountColumn}
          share={shareColumn}
        />
        <p className={styles.editorNote}>
          {settlement
            ? `A transfer ${row.amount > 0 ? "from" : "to"} ${budget.partnerName}, recognized in both budgets by amount, date, and direction. It moves your ${budget.partnerName} account, not Ready to Assign. Confirming here confirms ${budget.partnerName}'s side too.`
            : `A transfer from your Reimbursements account: ${txn?.from} paid you back. It refills the Reimbursements envelope, not Ready to Assign.`}
        </p>
        <div className={entry.rowFooter}>
          <div className={entry.actions}>
            <Button size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit" autoFocus>
              Confirm transfer
            </Button>
          </div>
        </div>
      </form>
    );
  }

  const split = lines.length > 1;
  const save = () => {
    const parsed = split ? amounts.map((text) => parseCents(text)) : [total];
    if (parsed.some((value) => value === null || value === 0))
      return setError("Give every line an amount.");
    const sum = parsed.reduce<number>((acc, value) => acc + (value ?? 0), 0);
    if (sum !== total)
      return setError(
        `The lines add up to ${money(sum)}; the transaction is ${money(total)}.`,
      );
    if (lines.some((line) => !line.categoryId))
      return setError("Pick a category for every line.");
    const next = lines.map((line, index) => ({
      ...line,
      amount: parsed[index]!,
      share:
        line.share && line.share.amount > parsed[index]!
          ? { ...line.share, amount: parsed[index]! }
          : line.share,
    }));
    dispatch({ type: "save", txnId: txn.id, lines: next, by: budget.person });
    const shared = next.filter((line) => line.share?.with === PARTNER);
    notify(
      shared.length
        ? `Saved ${row.payee}. ${budget.partnerName}'s share is ${money(shared.reduce((acc, line) => acc + line.share!.amount, 0))}, on both ledgers now.`
        : `Saved ${row.payee}.`,
    );
    onClose();
  };

  const shareControl = (line: Line, index: number, amount: number) => (
    <ShareMenu
      amount={amount}
      share={line.share}
      partnerName={budget.partnerName}
      people={people}
      remembered={txn.remembered ? txn.payee : undefined}
      onChange={(share) => update(index, { share })}
    >
      <button
        type="button"
        className={`${entry.well} ${styles.shareWell}`}
        aria-label={`Share of line ${index + 1}`}
      >
        {shareLabel(line.share, budget.partnerName) ?? (
          <span className={shell.faint}>Just mine</span>
        )}
      </button>
    </ShareMenu>
  );

  return (
    <form
      id={formId}
      className={entry.form}
      aria-label={`Edit ${row.payee}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {lines.map((line, index) => {
        const amount = split ? (parseCents(amounts[index] ?? "") ?? 0) : total;
        return (
          <div key={line.id} className={styles.editorLine}>
            <div className={`${shell.txColumns} ${entry.entryRow}`}>
              {accountColumn && (
                <StaticCell>
                  {index === 0 && (
                    <span className={shell.faint}>
                      {accountName(row.accountId)}
                    </span>
                  )}
                </StaticCell>
              )}
              <StaticCell>
                {index === 0 && (
                  <span className={shell.muted}>{shortDay(row.date)}</span>
                )}
              </StaticCell>
              <StaticCell>
                {index === 0 ? (
                  row.payee
                ) : (
                  <span className={shell.faint}>Line {index + 1}</span>
                )}
              </StaticCell>
              <div className={entry.cell}>
                <ChoiceField
                  id={`${formId}-category-${index}`}
                  label="Category"
                  value={line.categoryId ?? ""}
                  options={options}
                  placeholder="Category"
                  onChange={(categoryId) => update(index, { categoryId })}
                />
              </div>
              {shareColumn && (
                <div className={entry.cell}>
                  {shareControl(line, index, amount)}
                </div>
              )}
              <div className={entry.cell}>
                {split ? (
                  <div className={entry.well} data-amount>
                    <span className={entry.prefix} aria-hidden>
                      $
                    </span>
                    <input
                      className={entry.input}
                      aria-label={`Line ${index + 1} amount`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={amounts[index]}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) =>
                        setAmounts((current) =>
                          current.map((text, i) =>
                            i === index ? event.target.value : text,
                          ),
                        )
                      }
                    />
                  </div>
                ) : (
                  <StaticCell numeric>
                    {row.amount < 0 && money(total)}
                  </StaticCell>
                )}
              </div>
              <StaticCell numeric>
                {index === 0 && row.amount > 0 && (
                  <span className={styles.inflow}>{money(total)}</span>
                )}
              </StaticCell>
              <span className={styles.lineRemove}>
                {split && (
                  <IconButton
                    size="sm"
                    label={`Remove line ${index + 1}`}
                    onClick={() => {
                      setLines((current) =>
                        current.filter((_, i) => i !== index),
                      );
                      setAmounts((current) =>
                        current.filter((_, i) => i !== index),
                      );
                    }}
                  >
                    <XIcon aria-hidden />
                  </IconButton>
                )}
              </span>
            </div>
            {!shareColumn && (
              <ShareBar
                key={`${line.id}-${amount}`}
                amount={amount}
                share={line.share}
                partnerName={budget.partnerName}
                people={people}
                remembered={txn.remembered ? txn.payee : undefined}
                onChange={(share) => update(index, { share })}
              />
            )}
          </div>
        );
      })}
      {error && (
        <p className={`${entry.formError} ${styles.editorError}`} role="alert">
          {error}
        </p>
      )}
      <div className={entry.rowFooter}>
        <Button
          size="sm"
          variant="quiet"
          onClick={() => {
            const used = split
              ? amounts.reduce((acc, text) => acc + (parseCents(text) ?? 0), 0)
              : total;
            const remaining = Math.max(0, total - (split ? used : 0));
            setLines((current) => [
              ...current,
              {
                id: `${txn.id}-line-${current.length + 1}-${Date.now()}`,
                categoryId: null,
                amount: remaining,
                share: null,
              },
            ]);
            setAmounts((current) =>
              split
                ? [...current, (remaining / 100).toFixed(2)]
                : [(total / 100).toFixed(2), "0.00"],
            );
          }}
        >
          <SplitIcon aria-hidden />
          Split
        </Button>
        {txn.remembered && (
          <span className={styles.footerHint}>
            Category and share filled in from {txn.payee} last time
          </span>
        )}
        <div className={entry.actions}>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit">
            {txn.reviewed ? "Save" : "Save and mark reviewed"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function StaticCell({
  numeric,
  children,
}: {
  numeric?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={`${entry.cell} ${styles.staticCell}`}
      data-numeric={numeric ? "" : undefined}
    >
      <span className={shell.truncate}>{children}</span>
    </div>
  );
}

function StaticRow({
  row,
  accountColumn,
  share,
}: {
  row: BankRow;
  accountColumn: boolean;
  share: boolean;
}) {
  return (
    <div className={`${shell.txColumns} ${entry.entryRow}`}>
      {accountColumn && (
        <StaticCell>
          <span className={shell.faint}>{accountName(row.accountId)}</span>
        </StaticCell>
      )}
      <StaticCell>
        <span className={shell.muted}>{shortDay(row.date)}</span>
      </StaticCell>
      <StaticCell>{row.payee}</StaticCell>
      <StaticCell>
        <span className={shell.muted}>{row.categoryLabel}</span>
      </StaticCell>
      {share && <StaticCell />}
      <StaticCell numeric>{row.amount < 0 && money(-row.amount)}</StaticCell>
      <StaticCell numeric>
        {row.amount > 0 && (
          <span className={styles.inflow}>{money(row.amount)}</span>
        )}
      </StaticCell>
      <span />
    </div>
  );
}
