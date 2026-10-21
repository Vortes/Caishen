"use client";

// Throwaway: the sidebar's Banks popover in every state that's hard to reach
// with a real Plaid sandbox. Hardcoded banks, no Plaid, no budget. Delete once
// the popover is signed off.

import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  PlusIcon,
  WalletCardsIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { State } from "~/components/budget/types";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { Toast, ToastRegion } from "~/components/ui/toast";
import { TooltipProvider } from "~/components/ui/tooltip";
import {
  BankConnectionsProvider,
  BanksPopover,
  type BankConnections,
} from "../app-shell/banks";
import banks from "../app-shell/banks.module.css";
import shell from "../app-shell/shell.module.css";
import styles from "./prototype.module.css";

type Connection = State["connections"][number];

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

function account(
  id: string,
  name: string,
  mask: string,
  type: string,
  subtype: string,
  balance: number,
): Connection["accounts"][number] {
  return {
    accountId: id,
    name,
    officialName: null,
    mask,
    type,
    subtype,
    currentBalance: balance,
    availableBalance: balance,
    currency: "USD",
  };
}

function connection(
  id: string,
  name: string,
  accounts: Connection["accounts"],
  added: string[],
  {
    error = null,
    synced = 2,
  }: { error?: string | null; synced?: number | null } = {},
): Connection {
  return {
    id,
    itemId: `item-${id}`,
    institutionId: `ins-${id}`,
    institutionName: name,
    lastSyncedAt: synced === null ? null : hoursAgo(synced),
    lastAttemptAt: hoursAgo(1),
    error,
    transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
    synchronizedAccountIds: accounts.map((item) => item.accountId),
    accounts,
    accountMappings: Object.fromEntries(
      added.map((accountId) => [
        accountId,
        { accountId: `budget-${accountId}`, startDate: "2026-09-01" },
      ]),
    ),
  };
}

export const chase = connection(
  "chase",
  "Chase",
  [
    account("c1", "Total Checking", "4821", "depository", "checking", 4_210.55),
    account("c2", "Premier Savings", "0937", "depository", "savings", 12_840),
    account(
      "c3",
      "Sapphire Preferred",
      "1184",
      "credit",
      "credit card",
      1_684.04,
    ),
  ],
  ["c1", "c2", "c3"],
);
export const amex = connection(
  "amex",
  "American Express",
  [
    account(
      "a1",
      "Blue Cash Everyday",
      "31007",
      "credit",
      "credit card",
      400.78,
    ),
  ],
  ["a1"],
  {
    error:
      "Your bank needs you to sign in again before it can send new activity.",
    synced: 72,
  },
);
export const platypus = connection(
  "platypus",
  "First Platypus Balance Bank",
  [
    account("p1", "Plaid Checking", "0000", "depository", "checking", 110),
    account("p2", "Plaid Saving", "1111", "depository", "savings", 210),
    account("p3", "Plaid CD", "2222", "depository", "cd", 1_000),
    account("p4", "Plaid Credit Card", "3333", "credit", "credit card", 410),
    account(
      "p5",
      "Plaid Money Market",
      "4444",
      "depository",
      "money market",
      43_200,
    ),
    account("p6", "Plaid IRA", "5555", "investment", "ira", 320.76),
    account("p7", "Plaid 401k", "6666", "investment", "401k", 23_631.98),
    account("p8", "Plaid Student Loan", "7777", "loan", "student", 65_262),
    account("p9", "Plaid Mortgage", "8888", "loan", "mortgage", 56_302.06),
    account("p10", "Plaid HSA", "9001", "depository", "hsa", 6_009),
    account(
      "p11",
      "Plaid Cash Management",
      "9002",
      "depository",
      "cash management",
      12_060,
    ),
    account("p12", "Plaid Auto Loan", "9003", "loan", "auto", 23_211.33),
    account(
      "p13",
      "Plaid Home Equity Line of Credit",
      "9004",
      "loan",
      "home equity",
      13_500.5,
    ),
    account(
      "p14",
      "Plaid Business Credit Card",
      "9999",
      "credit",
      "credit card",
      5_020,
    ),
  ],
  ["p1", "p2"],
  { synced: 0.2 },
);

const chaseSignedOut = {
  ...chase,
  error:
    "Your bank needs you to sign in again before it can send new activity.",
  lastSyncedAt: hoursAgo(26),
};

const scenarios = {
  mixed: {
    label: "Three banks",
    connections: [chase, amex, platypus],
    available: true,
  },
  two: {
    label: "Two to reconnect",
    connections: [chaseSignedOut, amex, platypus],
    available: true,
  },
  one: { label: "One bank", connections: [chase], available: true },
  none: { label: "No banks", connections: [], available: true },
  off: { label: "Plaid not set up", connections: [], available: false },
} satisfies Record<
  string,
  { label: string; connections: Connection[]; available: boolean }
>;
type Scenario = keyof typeof scenarios;

export function BankConnectPrototype() {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [scenario, setScenario] = useState<Scenario>("mixed");
  // Bumped by Reset and the scenarios, so the footer re-mounts closed.
  const [mount, setMount] = useState(0);
  const [plaid, setPlaid] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(
    null,
  );

  const { connections, available } = scenarios[scenario];
  const context = {
    connections,
    available,
    opening: false,
    plaidOpen: plaid !== null,
    busy: false,
    reconnecting: undefined,
    view: null,
    state: {} as State,
    notify: (text: string) => setNotice({ id: Date.now(), text }),
    start: (connectionId?: string) =>
      setPlaid(
        connections.find((item) => item.id === connectionId)?.institutionName ??
          "",
      ),
    setUp: (connectionId: string) =>
      setNotice({
        id: Date.now(),
        text: `Account setup for ${connections.find((item) => item.id === connectionId)?.institutionName} opens here`,
      }),
    retrySync: () => undefined,
    close: () => undefined,
  } satisfies BankConnections;

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
                      <button
                        type="button"
                        className={shell.navItem}
                        aria-current={label === "Plan" ? "page" : undefined}
                      >
                        <Icon size={14} className={shell.navIcon} aria-hidden />
                        <span className={shell.navLabel}>{label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <MockAccounts
                  attention={connections.some((item) => item.error)}
                />
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
              <p className={styles.hint}>
                Open Banks at the bottom left. Switch the data at the top right.
              </p>
            </div>
          </div>

          {plaid !== null && (
            <MockPlaid bank={plaid} onClose={() => setPlaid(null)} />
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
        {(Object.keys(scenarios) as Scenario[]).map((key) => (
          <button
            key={key}
            type="button"
            className={styles.control}
            data-active={key === scenario || undefined}
            onClick={() => {
              setScenario(key);
              setMount((value) => value + 1);
            }}
          >
            {scenarios[key].label}
          </button>
        ))}
        <span className={styles.controlDivider} aria-hidden />
        <button
          type="button"
          className={styles.control}
          onClick={() => {
            setScenario("mixed");
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

function MockAccounts({ attention }: { attention: boolean }) {
  const sections = [
    {
      label: "Cash",
      rows: [
        ["Chase Total Checking", "$4,210.55"],
        ["Chase Premier Savings", "$12,840.00"],
        ["Plaid Checking", "$110.00"],
        ["Plaid Saving", "$210.00"],
      ],
    },
    {
      label: "Credit",
      rows: [
        ["Sapphire Preferred", "-$1,684.04"],
        ["Amex Blue Cash", "-$400.78"],
      ],
    },
  ];
  return sections.map((section) => (
    <section key={section.label} className={shell.navSection}>
      <div className={shell.sectionHeading}>{section.label}</div>
      <ul className={`${shell.navList} ${shell.nested}`}>
        {section.rows.map(([name, value]) => (
          <li key={name}>
            <button type="button" className={shell.navItem}>
              <span className={shell.navLabel}>{name}</span>
              {attention && name === "Amex Blue Cash" && (
                <span
                  className={shell.warningDot}
                  role="img"
                  aria-label="Connection needs attention"
                />
              )}
              <span className={shell.navValue}>{value}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  ));
}

export function MockPlaid({
  bank,
  onClose,
}: {
  bank: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <>
      <div className={banks.overlay} data-state="open" onClick={onClose} />
      <div className={styles.plaid} role="dialog" aria-label="Plaid">
        <strong>Plaid</strong>
        <p>
          {bank
            ? `Plaid’s window opens here to sign back in to ${bank}.`
            : "Plaid’s window opens here to pick a bank and sign in."}
        </p>
        <Button onClick={onClose}>Close</Button>
      </div>
    </>
  );
}
