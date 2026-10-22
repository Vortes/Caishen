"use client";

// Throwaway: an account whose bank signed out. Reconnect sits in the header,
// after the account's name; the sidebar row carries the amber alert tip after
// the name and holds Reconnect too. Hardcoded data, no Plaid. Delete once
// it's built into the shell.

import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  FileUpIcon,
  PlusIcon,
  WalletCardsIcon,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { State } from "~/components/budget/types";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { Toast, ToastRegion } from "~/components/ui/toast";
import { TooltipProvider, usePortalContainer } from "~/components/ui/tooltip";
import {
  BankConnectionsProvider,
  BankStatus,
  BanksPopover,
  type BankConnections,
} from "../app-shell/banks";
import banks from "../app-shell/banks.module.css";
import { syncedLabel } from "../app-shell/model";
import shell from "../app-shell/shell.module.css";
import { amex, chase, MockPlaid, platypus } from "./bank-connect-prototype";
import styles from "./prototype.module.css";

type Connection = State["connections"][number];

const amexHealthy: Connection = {
  ...amex,
  error: null,
  lastSyncedAt: new Date(Date.now() - 20 * 60_000),
};

// The long card name is the worst case for the header and the sidebar row.
const ACCOUNT = "Amex Blue Cash Everyday";

const register = [
  ["Oct 18", "Whole Foods Market", "Groceries", "-$86.42"],
  ["Oct 17", "Shell", "Gas", "-$48.10"],
  ["Oct 16", "Netflix", "Subscriptions", "-$15.49"],
  ["Oct 14", "Trader Joe’s", "Groceries", "-$62.37"],
  ["Oct 12", "Payment, thank you", "Transfer: Chase Total Checking", "$500.00"],
  ["Oct 9", "Blue Bottle Coffee", "Eating out", "-$7.25"],
];

export function AccountReconnectPrototype() {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [signedOut, setSignedOut] = useState(true);
  const [mount, setMount] = useState(0);
  const [plaid, setPlaid] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(
    null,
  );

  const connection = signedOut ? amex : amexHealthy;
  const connections = [chase, connection, platypus];
  const context = {
    connections,
    available: true,
    opening: false,
    plaidOpen: plaid !== null,
    busy: false,
    reconnecting: undefined,
    view: null,
    state: {} as State,
    notify: (text: string) => setNotice({ id: Date.now(), text }),
    // Account setup needs the server; this prototype never saves.
    runOnServer: () => Promise.resolve(),
    start: (connectionId?: string) =>
      setPlaid(
        connections.find((item) => item.id === connectionId)?.institutionName ??
          "",
      ),
    // The real setup form needs the server; the stand-in says where it goes.
    setUp: (connectionId: string) =>
      setNotice({
        id: Date.now(),
        text: `In the live app, this opens account setup for ${connections.find((item) => item.id === connectionId)?.institutionName}`,
      }),
    retrySync: () => undefined,
    close: () => undefined,
  } satisfies BankConnections;
  const reconnect = () => context.start(connection.id);
  const broken = Boolean(connection.error);

  return (
    <div ref={setRoot} className={shell.root} data-theme="dark">
      <TooltipProvider container={root}>
        <BankConnectionsProvider value={context}>
          <div className={styles.sidebar}>
            <nav className={shell.sidebarNav} aria-label="Budget navigation">
              <div className={styles.budgetName}>Official Budget 2026</div>
              <div className={shell.sidebarScroll}>
                <ul className={shell.navList}>
                  {(
                    [
                      [WalletCardsIcon, "Plan"],
                      [ChartPieIcon, "Reflect"],
                      [ArrowLeftRightIcon, "All accounts"],
                      [ChartNoAxesCombinedIcon, "Loans"],
                    ] as const
                  ).map(([Icon, label]) => (
                    <li key={label}>
                      <button type="button" className={shell.navItem}>
                        <Icon size={14} className={shell.navIcon} aria-hidden />
                        <span className={shell.navLabel}>{label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <section className={shell.navSection}>
                  <div className={shell.sectionHeading}>Cash</div>
                  <ul className={`${shell.navList} ${shell.nested}`}>
                    <NavRow name="Chase Total Checking" value="$4,210.55" />
                    <NavRow name="Chase Premier Savings" value="$12,840.00" />
                    <NavRow name="Plaid Checking" value="$110.00" />
                  </ul>
                </section>
                <section className={shell.navSection}>
                  <div className={shell.sectionHeading}>Credit</div>
                  <ul className={`${shell.navList} ${shell.nested}`}>
                    <NavRow name="Sapphire Preferred" value="-$1,684.04" />
                    {broken ? (
                      <AlertRow
                        connection={connection}
                        onReconnect={reconnect}
                      />
                    ) : (
                      <NavRow name={ACCOUNT} value="-$400.78" current />
                    )}
                  </ul>
                </section>
              </div>
              <div className={shell.sidebarFooter} key={mount}>
                <BanksPopover />
                <IconButton label="Add account">
                  <PlusIcon aria-hidden />
                </IconButton>
              </div>
            </nav>
          </div>

          <div className={styles.main}>
            <div className={shell.panel}>
              <header className={shell.header}>
                <div className={shell.titleGroup}>
                  <span className={shell.crumb}>Accounts</span>
                  <ChevronRightIcon
                    size={12}
                    className={shell.crumbSeparator}
                    aria-hidden
                  />
                  <h1 className={shell.headerTitle}>{ACCOUNT}</h1>
                  {broken && (
                    <span className={styles.headerFix}>
                      <BankStatus connection={connection} />
                      <Button
                        size="sm"
                        variant="quiet-primary"
                        onClick={reconnect}
                      >
                        Reconnect
                      </Button>
                    </span>
                  )}
                </div>
                <div className={styles.monthNav}>
                  <IconButton label="Previous month" size="sm">
                    <ChevronLeftIcon aria-hidden />
                  </IconButton>
                  <span>October 2026</span>
                  <IconButton label="Next month" size="sm">
                    <ChevronRightIcon aria-hidden />
                  </IconButton>
                </div>
              </header>

              <div className={shell.accountSummary}>
                <dl className={shell.balances}>
                  <div>
                    <dt>Cleared</dt>
                    <dd>-$400.78</dd>
                  </div>
                  <span className={shell.balanceOperator} aria-hidden>
                    +
                  </span>
                  <div>
                    <dt>Uncleared</dt>
                    <dd>-$42.10</dd>
                  </div>
                  <span className={shell.balanceOperator} aria-hidden>
                    =
                  </span>
                  <div data-total>
                    <dt>Working balance</dt>
                    <dd>-$442.88</dd>
                  </div>
                </dl>
                <div className={shell.summaryActions}>
                  <span className={shell.reconciledLabel}>
                    Reconciled 12 days ago
                  </span>
                  <Button size="sm">Reconcile</Button>
                </div>
              </div>

              <div className={shell.toolbar}>
                <Button size="sm">To review 3</Button>
                <Button size="sm">
                  <PlusIcon aria-hidden />
                  Add transaction
                </Button>
                <Button size="sm">
                  <FileUpIcon aria-hidden />
                  File import
                </Button>
              </div>

              <ul className={styles.register}>
                {register.map(([date, payee, category, amount]) => (
                  <li key={`${date}${payee}`}>
                    <span>{date}</span>
                    <span>{payee}</span>
                    <span>{category}</span>
                    <span>{amount}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {plaid !== null && (
            <MockPlaid
              bank={plaid}
              onClose={() => {
                setPlaid(null);
                setSignedOut(false);
                setNotice({
                  id: Date.now(),
                  text: "Reconnected American Express",
                });
              }}
            />
          )}

          <ToastRegion>
            {notice && (
              <Toast key={notice.id} onDismiss={() => setNotice(null)}>
                {notice.text}
              </Toast>
            )}
          </ToastRegion>
        </BankConnectionsProvider>
      </TooltipProvider>

      <div className={styles.controls} aria-label="Prototype data">
        <button
          type="button"
          className={styles.control}
          data-active={signedOut || undefined}
          onClick={() => {
            setSignedOut(true);
            setMount((value) => value + 1);
          }}
        >
          Signed out
        </button>
        <button
          type="button"
          className={styles.control}
          data-active={!signedOut || undefined}
          onClick={() => {
            setSignedOut(false);
            setMount((value) => value + 1);
          }}
        >
          Connected
        </button>
        <span className={styles.controlDivider} aria-hidden />
        <button
          type="button"
          className={styles.control}
          onClick={() => {
            setSignedOut(true);
            setPlaid(null);
            setNotice(null);
            setMount((value) => value + 1);
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function NavRow({
  name,
  value,
  current = false,
}: {
  name: string;
  value: string;
  current?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        className={shell.navItem}
        aria-current={current ? "page" : undefined}
      >
        <span className={shell.navLabel}>{name}</span>
        <span className={shell.navValue}>{value}</span>
      </button>
    </li>
  );
}

// The row's link stays one button; the alert tip is a sibling after the
// name, raised over the link's stretched hit area, since a button can't hold
// another.
function AlertRow({
  connection,
  onReconnect,
}: {
  connection: Connection;
  onReconnect: () => void;
}) {
  return (
    <li className={styles.alertRow} data-current>
      <button type="button" className={styles.alertLink} aria-current="page">
        {ACCOUNT}
      </button>
      <ActionTip connection={connection} onReconnect={onReconnect} />
      <span className={shell.navValue}>-$400.78</span>
    </li>
  );
}

// The Banks popover's alert tip with Reconnect inside: hover previews it and the pointer can
// cross onto it, a click or tap pins it, and pinning it from the keyboard
// moves focus in so Reconnect is reachable.
function ActionTip({
  connection,
  onReconnect,
}: {
  connection: Connection;
  onReconnect: () => void;
}) {
  const container = usePortalContainer();
  const [open, setOpen] = useState(false);
  const [byKeyboard, setByKeyboard] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const later = (next: boolean, delay: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), delay);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const hover = {
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType === "mouse" && !pinned.current) later(true, 250);
    },
    onPointerLeave: (event: PointerEvent) => {
      // A little longer than the info tip's, so the pointer can reach the
      // button.
      if (event.pointerType === "mouse" && !pinned.current) later(false, 250);
    },
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        clearTimeout(timer.current);
        pinned.current = false;
        setOpen(false);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={banks.status}
          data-attention
          aria-label="Why American Express needs attention"
          {...hover}
          onClick={(event) => {
            event.preventDefault();
            clearTimeout(timer.current);
            const next = !(open && pinned.current);
            pinned.current = next;
            // A click from Enter or Space has no pointer position.
            setByKeyboard(next && event.detail === 0);
            setOpen(next);
          }}
        >
          <CircleAlertIcon size={13} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          className={`${banks.tip} ${styles.rowTip}`}
          side="top"
          sideOffset={6}
          collisionPadding={8}
          {...hover}
          onOpenAutoFocus={(event) => {
            if (!byKeyboard) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            if (!byKeyboard) event.preventDefault();
          }}
        >
          <div className={styles.rowTipText}>
            <p>{connection.error}</p>
            <p className={banks.tipMeta}>
              Last updated {syncedLabel(connection.lastSyncedAt, null)}
            </p>
          </div>
          <div className={styles.rowTipAction}>
            <Button
              size="sm"
              variant="quiet-primary"
              onClick={() => {
                setOpen(false);
                onReconnect();
              }}
            >
              Reconnect
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
