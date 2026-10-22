"use client";

import {
  ArrowLeftRightIcon,
  ChevronRightIcon,
  WalletCardsIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Button } from "~/components/ui/button";
import { Toast, ToastRegion } from "~/components/ui/toast";
import { TooltipProvider } from "~/components/ui/tooltip";
import shell from "../app-shell/shell.module.css";
import { initialState, MONTH, names, type Person } from "./data";
import { Harness, type HarnessEvent } from "./harness";
import { derive, money, type AccountView, type Budget } from "./ledger";
import { PartnerRegister, ReimbursementsRegister } from "./people";
import { PlanInspector, PlanList } from "./plan";
import { BankRegister, type ShareVariant } from "./register";
import { reducer, type Action } from "./store";
import styles from "./shared-costs.module.css";

type Screen = { type: "plan" } | { type: "register"; accountId: string | null };

const SIDEBAR_WIDTH = 252;
const INSPECTOR_WIDTH = 360;

// Accounts in one budget and their counterparts in the other, so switching
// who you're viewing as keeps you on the same kind of screen.
const counterpartAccount: Record<string, string> = {
  "alan-chase": "anna-ally",
  "alan-sapphire": "anna-amex",
  "alan-partner": "anna-partner",
  "alan-reimbursements": "anna-reimbursements",
};
for (const [from, to] of Object.entries(counterpartAccount))
  counterpartAccount[to] = from;

const events: HarnessEvent[] = [
  { id: "anna-zelle", label: "Anna sends $300.00 by Zelle" },
  { id: "birite-import", label: "Anna's Bi-Rite import arrives" },
  { id: "costco-refund", label: "A $35.00 Costco refund imports" },
  { id: "northwind-reimburses", label: "Northwind repays the flight" },
];

const simulated: Record<HarnessEvent["id"], string> = {
  "anna-zelle":
    "Imported to both budgets: Zelle from Anna, $300.00. Confirm it in either one.",
  "birite-import":
    "Anna's Amex import matched the Bi-Rite entry Alan recorded. Nothing changed on the ledger.",
  "costco-refund":
    "Alan's Sapphire imported a $35.00 Costco refund. Payee memory proposed Anna's half back.",
  "northwind-reimburses":
    "Alan's checking imported $412.00 from Northwind, matched to the Reimbursements account.",
};

type Initial = { viewer: Person; variant: ShareVariant; screen: Screen };

// Who you're viewing as, the share variant, and the screen live in the
// address, so a reload or a shared link opens the same view.
function readInitial(): Initial {
  const params = new URLSearchParams(window.location.search);
  const viewer: Person = params.get("as") === "anna" ? "anna" : "alan";
  const account = params.get("account");
  const screen: Screen =
    account === "plan"
      ? { type: "plan" }
      : account === "all"
        ? { type: "register", accountId: null }
        : account?.startsWith(`${viewer}-`) && account in counterpartAccount
          ? { type: "register", accountId: account }
          : {
              type: "register",
              accountId: viewer === "alan" ? "alan-sapphire" : "anna-amex",
            };
  return {
    viewer,
    variant: params.get("v") === "2" ? "editor" : "column",
    screen,
  };
}

export function SharedCostsPrototype() {
  const [initial, setInitial] = useState<Initial | null>(null);
  useEffect(() => setInitial(readInitial()), []);
  return initial ? <Prototype initial={initial} /> : null;
}

function Prototype({ initial }: { initial: Initial }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [viewer, setViewer] = useState<Person>(initial.viewer);
  const [variant, setVariant] = useState<ShareVariant>(initial.variant);
  const [screen, setScreen] = useState<Screen>(initial.screen);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(
    null,
  );
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const budget = useMemo(() => derive(state, viewer), [state, viewer]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("as", viewer);
    url.searchParams.set("v", variant === "column" ? "1" : "2");
    url.searchParams.set(
      "account",
      screen.type === "plan" ? "plan" : (screen.accountId ?? "all"),
    );
    window.history.replaceState(null, "", url);
  }, [viewer, variant, screen]);

  const notify = useCallback(
    (message: string) => setNotice({ id: Date.now(), message }),
    [],
  );

  const navigate = (next: Screen) => {
    setScreen(next);
    setSelectedId(null);
    setEditingId(null);
    setReviewOnly(false);
  };

  const switchViewer = (next: Person) => {
    if (next === viewer) return;
    setViewer(next);
    setSelectedId(null);
    setEditingId(null);
    if (screen.type === "register" && screen.accountId)
      setScreen({
        type: "register",
        accountId: counterpartAccount[screen.accountId]!,
      });
  };

  const account =
    screen.type === "register"
      ? budget.accounts.find((item) => item.id === screen.accountId)
      : undefined;
  const bankScreen =
    screen.type === "register" &&
    (!account || account.kind === "cash" || account.kind === "credit");
  const reviewCount = budget.bank.filter(
    (row) => !row.reviewed && (!account || row.accountId === account.id),
  ).length;

  const run = (action: Action) => dispatch(action);

  return (
    <>
      <div
        ref={setRoot}
        className={shell.root}
        data-theme="dark"
        data-ready
        style={{ bottom: 72 }}
      >
        <TooltipProvider container={root}>
          <aside
            className={shell.sidebar}
            style={{ width: SIDEBAR_WIDTH }}
            data-open
          >
            <div
              className={shell.sidebarInner}
              style={{ width: SIDEBAR_WIDTH }}
            >
              <Sidebar budget={budget} screen={screen} onNavigate={navigate} />
            </div>
          </aside>
          <div className={shell.main}>
            <div className={shell.panel}>
              <header className={shell.header}>
                <div className={shell.titleGroup}>
                  {screen.type === "register" && account && (
                    <>
                      <span className={shell.crumb}>Accounts</span>
                      <ChevronRightIcon
                        size={12}
                        className={shell.crumbSeparator}
                        aria-hidden
                      />
                    </>
                  )}
                  <h1 className={shell.headerTitle}>
                    {screen.type === "plan"
                      ? "Plan"
                      : (account?.name ?? "All accounts")}
                  </h1>
                </div>
                <span className={styles.headerMonth}>{MONTH}</span>
              </header>

              {bankScreen && (
                <div className={shell.toolbar}>
                  <Button
                    size="sm"
                    aria-pressed={reviewOnly}
                    onClick={() => {
                      setReviewOnly((value) => !value);
                      setSelectedId(null);
                      setEditingId(null);
                    }}
                  >
                    <span className={shell.reviewDot} data-on data-inline />
                    To review
                    <span className={shell.numeric}>{reviewCount}</span>
                  </Button>
                  <p className={styles.toolbarHint}>
                    {variant === "column"
                      ? "Click a Share cell to split. Click a selected row to edit it."
                      : "Click a row, then click it again to edit its category and share."}
                  </p>
                </div>
              )}

              <div className={shell.body}>
                <main
                  id="prototype-content"
                  className={shell.content}
                  tabIndex={-1}
                >
                  {screen.type === "plan" && (
                    <PlanList
                      budget={budget}
                      selectedId={selectedId}
                      onSelect={(id) =>
                        setSelectedId(selectedId === id ? null : id)
                      }
                    />
                  )}
                  {bankScreen && screen.type === "register" && (
                    <BankRegister
                      key={`${viewer}-${screen.accountId ?? "all"}`}
                      budget={budget}
                      accountId={screen.accountId}
                      variant={variant}
                      reviewOnly={reviewOnly}
                      selectedId={selectedId}
                      editingId={editingId}
                      onSelect={setSelectedId}
                      onEdit={(id) => {
                        setEditingId(id);
                        if (id) setSelectedId(id);
                      }}
                      dispatch={run}
                      notify={notify}
                    />
                  )}
                  {account?.kind === "partner" && (
                    <PartnerRegister
                      key={viewer}
                      budget={budget}
                      state={state}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      dispatch={run}
                      notify={notify}
                    />
                  )}
                  {account?.kind === "reimbursements" && (
                    <ReimbursementsRegister key={viewer} budget={budget} />
                  )}
                </main>
                {screen.type === "plan" && (
                  <div className={shell.inspectorSlot}>
                    <aside
                      className={shell.inspector}
                      style={{ width: INSPECTOR_WIDTH }}
                      aria-label="Details"
                    >
                      <div
                        className={shell.inspectorInner}
                        style={{ width: INSPECTOR_WIDTH }}
                      >
                        <PlanInspector
                          budget={budget}
                          selectedId={selectedId}
                          onOpenAccount={(accountId) =>
                            navigate({ type: "register", accountId })
                          }
                          dispatch={run}
                          notify={notify}
                        />
                      </div>
                    </aside>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className={styles.toastLayer}>
            <ToastRegion>
              {notice && (
                <Toast key={notice.id} onDismiss={() => setNotice(null)}>
                  {notice.message}
                </Toast>
              )}
            </ToastRegion>
          </div>
        </TooltipProvider>
      </div>
      <Harness
        viewer={viewer}
        onViewer={switchViewer}
        variant={variant}
        onVariant={setVariant}
        events={events.map((event) => ({
          ...event,
          disabled:
            (event.id === "birite-import" &&
              Boolean(
                state.txns.find((txn) => txn.id === "u-birite")?.accountId,
              )) ||
            (event.id === "costco-refund" &&
              state.txns.some((txn) => txn.id.startsWith("refund"))) ||
            (event.id === "northwind-reimburses" &&
              state.txns.some(
                (txn) =>
                  txn.from === "Northwind" && txn.kind === "reimbursement",
              )),
        }))}
        onSimulate={(id) => {
          dispatch({ type: "simulate", event: id });
          notify(simulated[id]);
        }}
        onReset={() => {
          dispatch({ type: "reset", state: initialState });
          setSelectedId(null);
          setEditingId(null);
          setReviewOnly(false);
          notify("Reset to Alan and Anna's October.");
        }}
      />
    </>
  );
}

function Sidebar({
  budget,
  screen,
  onNavigate,
}: {
  budget: Budget;
  screen: Screen;
  onNavigate: (screen: Screen) => void;
}) {
  const sections: { label: string; items: AccountView[] }[] = [
    {
      label: "Cash",
      items: budget.accounts.filter((item) => item.kind === "cash"),
    },
    {
      label: "Credit",
      items: budget.accounts.filter((item) => item.kind === "credit"),
    },
    {
      label: "People",
      items: budget.accounts.filter(
        (item) => item.kind === "partner" || item.kind === "reimbursements",
      ),
    },
  ];
  const current = (id: string | null) =>
    screen.type === "register" && screen.accountId === id;
  return (
    <nav className={shell.sidebarNav} aria-label="Budget navigation">
      <div className={shell.sidebarHeader}>
        <span className={shell.switcher}>
          <span className={shell.avatar} aria-hidden>
            {names[budget.person].charAt(0)}
          </span>
          <span className={shell.switcherName}>
            {names[budget.person]}&rsquo;s budget
          </span>
        </span>
      </div>
      <div className={shell.sidebarScroll}>
        <ul className={shell.navList}>
          <NavItem
            icon={WalletCardsIcon}
            label="Plan"
            current={screen.type === "plan"}
            onClick={() => onNavigate({ type: "plan" })}
          />
          <NavItem
            icon={ArrowLeftRightIcon}
            label="All accounts"
            toReview={budget.bank.some((row) => !row.reviewed)}
            current={current(null)}
            onClick={() => onNavigate({ type: "register", accountId: null })}
          />
        </ul>
        {sections.map((section) => (
          <section key={section.label} className={shell.navSection}>
            <h2 className={`${shell.sectionHeading} ${styles.sectionLabel}`}>
              <span>{section.label}</span>
              <span className={styles.sectionTotal}>
                {money(
                  section.items.reduce((sum, item) => sum + item.balance, 0),
                )}
              </span>
            </h2>
            <ul className={`${shell.navList} ${shell.nested}`}>
              {section.items.map((item) => (
                <NavItem
                  key={item.id}
                  label={item.name}
                  value={money(item.balance)}
                  toReview={item.toReview}
                  current={current(item.id)}
                  onClick={() =>
                    onNavigate({ type: "register", accountId: item.id })
                  }
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}

function NavItem({
  icon: Icon,
  label,
  value,
  current,
  toReview,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  value?: string;
  current: boolean;
  toReview?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={shell.navItem}
        aria-current={current ? "page" : undefined}
        onClick={onClick}
      >
        {Icon && <Icon size={14} className={shell.navIcon} aria-hidden />}
        <span className={shell.navLabel}>{label}</span>
        {value && <span className={shell.navValue}>{value}</span>}
        {toReview && (
          <span
            className={shell.reviewDot}
            data-on
            data-inline
            role="img"
            aria-label="Something to review"
          />
        )}
      </button>
    </li>
  );
}
