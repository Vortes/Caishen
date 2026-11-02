"use client";

import { PlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Account, ShellData } from "~/components/app-shell/model";
import { money } from "~/components/app-shell/model";
import { ShellDataProvider } from "~/components/app-shell/shell-data";
import {
  halfOf,
  ShareChoices,
  ShareLabel,
  useShareParties,
} from "~/components/app-shell/share-field";
import {
  TransactionEntryProvider,
  type TransactionEntry,
} from "~/components/app-shell/transaction-entry";
import { Popover } from "~/components/ui/popover";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { SurfaceProvider } from "~/components/ui/surface";
import type { ShareBasis } from "~/components/transactions/transaction-share";
import type { CounterpartyShare } from "~/domain/engine";
import shell from "~/components/app-shell/shell.module.css";
import shareStyles from "~/components/app-shell/share.module.css";
import { dataSets, linesIn, peopleIn, type DataSet, type Line } from "./data";
import { Inline } from "./inline";
import { Picker } from "./picker";
import { TwoPanes } from "./two-panes";
import styles from "./lab.module.css";

const variants = ["Baseline", "Two panes", "Inline"];

// What the shell would save: the share on every line of the transaction.
function totalOf(line: Line) {
  const share = line.share;
  if (!share?.amount) return 0;
  if (line.amounts.length === 1) return share.amount;
  if (line.basis === "half")
    return line.amounts.reduce((sum, cents) => sum + halfOf(cents), 0);
  if (line.basis === "full")
    return line.amounts.reduce((sum, cents) => sum + cents, 0);
  return share.amount * line.amounts.length;
}

export function SharePickerLab({
  variant: initialVariant,
  data: initialData,
  theme: initialTheme,
}: {
  variant: number;
  data: DataSet;
  theme: "dark" | "light";
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [variant, setVariant] = useState(initialVariant);
  const [data, setData] = useState(initialData);
  const [theme, setTheme] = useState(initialTheme);
  const [accounts, setAccounts] = useState<Account[]>(peopleIn[initialData]);
  const [lines, setLines] = useState<Line[]>(linesIn[initialData]);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("v", String(variant + 1));
    url.searchParams.set("data", data);
    url.searchParams.set("theme", theme);
    history.replaceState(null, "", url);
  }, [variant, data, theme]);

  const switchData = (next: DataSet) => {
    setData(next);
    setAccounts(peopleIn[next]);
    setLines(linesIn[next]);
    setNotice(null);
  };
  const pickVariant = useCallback((index: number) => setVariant(index), []);

  // Just enough of the shell for the share picker's hooks: the people, and a
  // saveCommand that adds a person the way person.add would.
  const shellData = { accounts } as unknown as ShellData;
  const entry = {
    view: { budget: { transactions: [] } },
    saveCommand: (command: {
      type: string;
      accountId: string;
      name: string;
    }) => {
      if (command.type !== "person.add") return null;
      setAccounts((list) => [
        ...list,
        {
          id: command.accountId,
          name: command.name,
          kind: "person",
          balance: 0,
          uncleared: 0,
          cleared: 0,
        },
      ]);
      return null;
    },
  } as unknown as TransactionEntry;

  return (
    <div ref={setRoot} className={styles.lab} data-theme={theme}>
      <SurfaceProvider container={root}>
        <ShellDataProvider value={shellData}>
          <TransactionEntryProvider value={entry}>
            <div className={styles.bar}>
              <h1 className={styles.title}>Share picker</h1>
              <p className={styles.hint}>
                Open a Share cell. 1–3 or ←/→ switch variants.
              </p>
              <SegmentedControl
                aria-label="Data"
                value={data}
                onValueChange={(value) => switchData(value as DataSet)}
              >
                {dataSets.map((set) => (
                  <SegmentedControlItem key={set.value} value={set.value}>
                    {set.label}
                  </SegmentedControlItem>
                ))}
              </SegmentedControl>
              <SegmentedControl
                aria-label="Theme"
                value={theme}
                onValueChange={(value) => setTheme(value as "dark" | "light")}
              >
                <SegmentedControlItem value="dark">Dark</SegmentedControlItem>
                <SegmentedControlItem value="light">Light</SegmentedControlItem>
              </SegmentedControl>
            </div>
            <section className={`${shell.panel} ${shell.register}`}>
              <div className={styles.rows}>
                <div className={`${shell.txColumns} ${shell.columnHeader}`}>
                  <span>Date</span>
                  <span>Payee</span>
                  <span>Category</span>
                  <span>Share</span>
                  <span className={shell.numeric}>Outflow</span>
                  <span className={shell.numeric}>Inflow</span>
                  <span />
                </div>
                {lines.map((line) => (
                  <RegisterRow
                    key={`${data}-${line.id}`}
                    line={line}
                    variant={variant}
                    onApply={(share, basis) => {
                      const next = { ...line, share, basis };
                      setLines((list) =>
                        list.map((item) => (item.id === line.id ? next : item)),
                      );
                      return next;
                    }}
                    onNotice={setNotice}
                  />
                ))}
              </div>
            </section>
            <p className={styles.notice} role="status">
              {notice && <NoticeText notice={notice} />}
            </p>
            <Picker
              names={variants}
              current={variant}
              onChange={pickVariant}
            />
          </TransactionEntryProvider>
        </ShellDataProvider>
      </SurfaceProvider>
    </div>
  );
}

type Notice = {
  share: CounterpartyShare | null;
  payee: string;
  total: number;
};

// What the last pick did, named once a new person has landed.
function NoticeText({ notice: { share, payee, total } }: { notice: Notice }) {
  const { who } = useShareParties();
  return share && total > 0
    ? `${who(share)}’s share of ${payee} is ${money(total)}.`
    : `${payee} is all yours now.`;
}

function RegisterRow({
  line,
  variant,
  onApply,
  onNotice,
}: {
  line: Line;
  variant: number;
  onApply: (share: CounterpartyShare | null, basis: ShareBasis) => Line;
  onNotice: (notice: Notice) => void;
}) {
  const [open, setOpen] = useState(false);
  const { who } = useShareParties();
  const total = totalOf(line);
  const label =
    total > 0 && line.share ? (
      <ShareLabel share={{ ...line.share, amount: total }} />
    ) : null;
  const sum = line.amounts.reduce((all, cents) => all + cents, 0);
  const onChange = (share: CounterpartyShare | null, basis: ShareBasis) => {
    const next = onApply(share, basis);
    onNotice({ share, payee: line.payee, total: totalOf(next) });
    setOpen(false);
    return null;
  };
  const props = {
    amounts: line.amounts,
    share: line.share,
    saved: line.share,
    onChange,
    onClose: () => setOpen(false),
  };
  return (
    <div className={shell.rowWrap}>
      <div className={`${shell.txColumns} ${shell.row}`}>
        <span className={`${shell.truncate} ${shell.muted}`}>{line.date}</span>
        <span className={shell.truncate}>{line.payee}</span>
        <span className={`${shell.truncate} ${shell.muted}`}>
          {line.category}
        </span>
        <span aria-hidden />
        <span className={shell.numeric}>{money(sum)}</span>
        <span className={shell.numeric} />
        <span />
      </div>
      <div className={`${shell.txColumns} ${shareStyles.shareActions}`}>
        <span className={shareStyles.shareSlot}>
          <Popover
            label="Who this is for"
            trigger={
              <button
                type="button"
                className={shareStyles.shareButton}
                data-empty={!label || undefined}
                aria-label={
                  label && line.share
                    ? `${who(line.share)}’s share of ${line.payee}: ${money(total)}. Change`
                    : `Share ${line.payee}`
                }
              >
                {label ?? (
                  <>
                    <PlusIcon size={12} aria-hidden />
                    Share
                  </>
                )}
              </button>
            }
            open={open}
            onOpenChange={setOpen}
            size={variant === 1 ? "wide" : "form"}
            arrow
          >
            {variant === 0 ? (
              <ShareChoices {...props} />
            ) : variant === 1 ? (
              <TwoPanes {...props} />
            ) : (
              <Inline {...props} />
            )}
          </Popover>
        </span>
      </div>
    </div>
  );
}
