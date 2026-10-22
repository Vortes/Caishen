"use client";

// Batch 3 (loans) design prototype: the shell's Loans screen with adding a
// loan, confirming a variable rate, previewing an extra payment, and
// recording a lender payment. Hardcoded data on its own page; nothing here
// reaches a budget. Delete once the owner signs off and the shell has it.

import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LandmarkIcon,
  ListFilterIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  WalletCardsIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { Toast, ToastRegion } from "~/components/ui/toast";
import { Tooltip, TooltipProvider } from "~/components/ui/tooltip";
import { Caret } from "../app-shell/sidebar";
import shell from "../app-shell/shell.module.css";
import {
  addMonths,
  balanceOn,
  dayLabel,
  endOf,
  longMonthLabel,
  money,
  percent,
  scenarios,
  THIS_MONTH,
  type Loan,
  type ScenarioId,
  type State,
} from "./data";
import { Harness } from "./harness";
import { LoansInspector } from "./inspector";
import { LoansList } from "./list";
import { Register } from "./register";
import {
  defaultVariants,
  StoreProvider,
  type Editor,
  type NewPayment,
  type Screen,
  type Store,
  type Tab,
  type Variants,
  useStore,
} from "./store";
import styles from "./loans.module.css";

type Snapshot = { state: State; paidFrom: Record<string, string> };
type Notice = { id: number; message: string; undo: Snapshot | null };

export type Setup = {
  scenario: ScenarioId;
  variants: Variants;
  loan: string | null;
  tab: Tab;
  editor: Editor | null;
  screen: Screen;
};

export function readSetup(params: URLSearchParams): Setup {
  const pick = <T extends string>(
    key: string,
    options: readonly T[],
    fallback: T,
  ) => {
    const value = params.get(key) as T | null;
    return value && options.includes(value) ? value : fallback;
  };
  const scenario = pick<ScenarioId>(
    "scenario",
    ["household", "empty", "underwater"],
    "household",
  );
  const variants: Variants = {
    add: pick("add", ["panel", "row"], defaultVariants.add),
    compare: pick("compare", ["numbers", "chart"], defaultVariants.compare),
    cadence: pick("cadence", ["once", "both"], defaultVariants.cadence),
    pay: pick("pay", ["panel", "register"], defaultVariants.pay),
  };
  const loan = params.get("loan");
  const open = params.get("open");
  const tab = pick<Tab>("tab", ["extra", "payments", "rates"], "extra");
  const editor: Editor | null =
    open === "add"
      ? { kind: "add" }
      : open === "rate" && loan
        ? { kind: "rate", loanId: loan }
        : open === "payment" && loan
          ? variants.pay === "register"
            ? { kind: "register-payment", loanId: loan, accountId: "chase" }
            : { kind: "payment", loanId: loan }
          : null;
  const screen: Screen =
    editor?.kind === "register-payment"
      ? { type: "register", accountId: "chase" }
      : params.get("account")
        ? {
            type: "register",
            accountId:
              params.get("account") === "all" ? null : params.get("account"),
          }
        : { type: "loans" };
  return {
    scenario,
    variants,
    loan,
    tab:
      editor?.kind === "rate"
        ? "rates"
        : editor?.kind === "payment"
          ? "payments"
          : tab,
    editor,
    screen,
  };
}

export function LoansPrototype() {
  // Read once on the client; the page renders nothing on the server.
  const [setup] = useState(() =>
    readSetup(new URLSearchParams(window.location.search)),
  );
  const [scenario, setScenario] = useState<ScenarioId>(setup.scenario);
  const [variants, setVariants] = useState<Variants>(setup.variants);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    state: scenarios[setup.scenario].state(),
    paidFrom: {},
  }));
  const [month, setMonth] = useState(THIS_MONTH);
  const [screen, setScreen] = useState<Screen>(setup.screen);
  const [selected, setSelected] = useState<string | null>(setup.loan);
  const [editor, setEditor] = useState<Editor | null>(setup.editor);
  const [tab, setTab] = useState<Tab>(setup.tab);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);

  const { state, paidFrom } = snapshot;

  // Keeps the address in step with the variants, so a link opens the same
  // design.
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("scenario", scenario);
    for (const [key, value] of Object.entries(variants)) params.set(key, value);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [scenario, variants]);

  const reset = useCallback(
    (next: ScenarioId = scenario) => {
      setScenario(next);
      setSnapshot({ state: scenarios[next].state(), paidFrom: {} });
      setMonth(THIS_MONTH);
      setScreen({ type: "loans" });
      setSelected(null);
      setEditor(null);
      setTab("extra");
      setJustSaved(null);
      setNotice(null);
      setInspectorOpen(true);
    },
    [scenario],
  );

  const notify = (message: string, undo: Snapshot | null) =>
    setNotice({ id: Date.now(), message, undo });

  const store: Store = {
    state,
    month,
    variants,
    paidFrom,
    balance: (accountId) => {
      const account = state.accounts.find((item) => item.id === accountId)!;
      const spent = state.loans
        .flatMap((loan) => loan.payments)
        .filter((payment) => paidFrom[payment.id] === accountId)
        .reduce(
          (sum, payment) => sum + payment.principal + payment.interest,
          0,
        );
      return account.opening - spent;
    },
    screen,
    navigate: (next, loanId = null) => {
      setScreen(next);
      setSelected(loanId);
      setJustSaved(null);
    },
    selected,
    select: (loanId) => {
      if (loanId !== selected) {
        setTab("extra");
        if (editor && editor.kind !== "add") setEditor(null);
      }
      setSelected(loanId);
      if (editor?.kind === "add" && variants.add === "panel") setEditor(null);
    },
    editor,
    open: setEditor,
    tab,
    setTab: (next) => {
      setTab(next);
      if (editor && editor.kind !== "add" && editor.kind !== "register-payment")
        setEditor(null);
    },
    justSaved,
    addLoan: (loan: Loan) => {
      const before = snapshot;
      const categoryName =
        state.categories.find((item) => item.id === loan.categoryId)?.name ??
        `${loan.name} payment`;
      setSnapshot({
        paidFrom,
        state: {
          ...state,
          loans: [...state.loans, loan],
          categories: state.categories.filter(
            (item) => item.id !== loan.categoryId,
          ),
        },
      });
      setEditor(null);
      setSelected(loan.id);
      setTab("extra");
      setInspectorOpen(true);
      notify(`Added ${loan.name}, paid from ${categoryName}`, before);
    },
    confirmRate: (loanId, annualRateBps, date) => {
      const before = snapshot;
      const loan = state.loans.find((item) => item.id === loanId)!;
      setSnapshot({
        paidFrom,
        state: {
          ...state,
          loans: state.loans.map((item) =>
            item.id === loanId
              ? {
                  ...item,
                  rates: [
                    ...item.rates,
                    { effectiveDate: date, annualRateBps },
                  ],
                }
              : item,
          ),
        },
      });
      setEditor(null);
      notify(
        `Confirmed ${percent(annualRateBps)} for ${loan.name} from ${dayLabel(date)}`,
        before,
      );
    },
    recordPayment: (loanId, payment: NewPayment) => {
      const before = snapshot;
      const id = `${loanId}-new-${Date.now()}`;
      const loan = state.loans.find((item) => item.id === loanId)!;
      const amount = payment.principal + payment.interest;
      const account = state.accounts.find(
        (item) => item.id === payment.accountId,
      )!;
      setSnapshot({
        paidFrom: { ...paidFrom, [id]: payment.accountId },
        state: {
          ...state,
          loans: state.loans.map((item) =>
            item.id === loanId
              ? {
                  ...item,
                  funded: Math.max(0, item.funded - amount),
                  payments: [
                    ...item.payments,
                    {
                      id,
                      date: payment.date,
                      principal: payment.principal,
                      interest: payment.interest,
                    },
                  ],
                }
              : item,
          ),
        },
      });
      setEditor(null);
      if (screen.type === "register") setJustSaved(id);
      notify(
        `Recorded ${money(amount)} to ${loan.name} from ${account.name}`,
        before,
      );
      return id;
    },
  };

  // N adds a loan on the Loans screen, like the plan and register.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.metaKey ||
        event.ctrlKey ||
        target.closest("input, select, textarea, [role='dialog']")
      )
        return;
      if (event.key === "n" && screen.type === "loans" && !editor) {
        event.preventDefault();
        setEditor({ kind: "add" });
        setSelected(null);
      } else if (event.key === "]" && screen.type === "loans") {
        setInspectorOpen((value) => !value);
      } else if (event.key === "Escape" && !editor && selected) {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen, editor, selected]);

  const startAdd = () => {
    setEditor({ kind: "add" });
    if (variants.add === "panel") {
      setSelected(null);
      setInspectorOpen(true);
    }
  };
  const registerAccount =
    screen.type === "register"
      ? state.accounts.find((item) => item.id === screen.accountId)
      : undefined;

  return (
    <StoreProvider value={store}>
      <div
        ref={setRoot}
        className={`${shell.root} ${styles.root}`}
        data-theme={theme}
        data-ready
      >
        <TooltipProvider container={root}>
          <aside className={shell.sidebar} style={{ width: 320 }}>
            <div className={shell.sidebarInner} style={{ width: 320 }}>
              <SidebarReplica />
            </div>
          </aside>
          <div className={shell.main}>
            <div className={shell.panel}>
              <header className={shell.header}>
                <div className={shell.titleGroup}>
                  {screen.type === "register" && (
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
                    {screen.type === "loans"
                      ? "Loans"
                      : screen.type === "register"
                        ? (registerAccount?.name ?? "All accounts")
                        : screen.type === "plan"
                          ? "Plan"
                          : "Reflect"}
                  </h1>
                </div>
                <div className={shell.monthNav}>
                  <IconButton
                    label="Previous month"
                    onClick={() => setMonth(addMonths(month, -1))}
                  >
                    <ChevronLeftIcon aria-hidden />
                  </IconButton>
                  <Tooltip label="Go to this month">
                    <button
                      type="button"
                      className={shell.monthButton}
                      onClick={() => setMonth(THIS_MONTH)}
                    >
                      {longMonthLabel(month)}
                    </button>
                  </Tooltip>
                  <IconButton
                    label="Next month"
                    onClick={() => setMonth(addMonths(month, 1))}
                  >
                    <ChevronRightIcon aria-hidden />
                  </IconButton>
                </div>
              </header>

              {screen.type === "register" && (
                <AccountBalances accountId={screen.accountId} />
              )}

              <div className={shell.toolbar}>
                {screen.type === "loans" && (
                  <Tooltip label="Add a loan" shortcut="N">
                    <Button
                      size="sm"
                      disabled={editor?.kind === "add"}
                      onClick={startAdd}
                    >
                      <PlusIcon aria-hidden />
                      Add loan
                    </Button>
                  </Tooltip>
                )}
                {screen.type === "register" && (
                  <Button size="sm" disabled>
                    <PlusIcon aria-hidden />
                    Add transaction
                  </Button>
                )}
                <div className={shell.toolbarActions}>
                  <IconButton label="Filter" shortcut="F" variant="secondary">
                    <ListFilterIcon aria-hidden />
                  </IconButton>
                  <IconButton label="Display options" variant="secondary">
                    <SlidersHorizontalIcon aria-hidden />
                  </IconButton>
                  {screen.type === "loans" && (
                    <IconButton
                      label={inspectorOpen ? "Hide details" : "Show details"}
                      shortcut="]"
                      variant="secondary"
                      pressed={inspectorOpen}
                      onClick={() => setInspectorOpen((value) => !value)}
                    >
                      <PanelRightIcon aria-hidden />
                    </IconButton>
                  )}
                </div>
              </div>

              <div className={shell.body}>
                <main className={shell.content} tabIndex={-1}>
                  {screen.type === "loans" && <LoansList />}
                  {screen.type === "register" && (
                    <Register accountId={screen.accountId} />
                  )}
                  {(screen.type === "plan" || screen.type === "reflect") && (
                    <div className={shell.empty}>
                      <LandmarkIcon size={18} aria-hidden />
                      <div className={shell.emptyBody}>
                        <p>
                          <strong>Not part of this prototype.</strong>
                          Loans and the account registers are; open Loans in the
                          sidebar.
                        </p>
                      </div>
                    </div>
                  )}
                </main>
                {screen.type === "loans" && inspectorOpen && (
                  <div className={shell.inspectorSlot}>
                    <aside
                      className={shell.inspector}
                      style={{ width: 520 }}
                      aria-label="Details"
                    >
                      <div
                        className={shell.inspectorInner}
                        style={{ width: 520 }}
                      >
                        <LoansInspector />
                      </div>
                    </aside>
                  </div>
                )}
              </div>
            </div>
          </div>

          <Harness
            scenario={scenario}
            onScenario={(next) => reset(next)}
            variants={variants}
            onVariants={(next) => {
              setVariants(next);
              setEditor(null);
            }}
            theme={theme}
            onTheme={setTheme}
            onReset={() => reset()}
          />

          <ToastRegion>
            {notice && (
              <Toast
                key={notice.id}
                onDismiss={() => setNotice(null)}
                action={
                  notice.undo && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setSnapshot(notice.undo!);
                        setJustSaved(null);
                        setNotice({
                          id: Date.now(),
                          message: "Action undone.",
                          undo: null,
                        });
                      }}
                    >
                      Undo
                    </Button>
                  )
                }
              >
                {notice.message}
              </Toast>
            )}
          </ToastRegion>
        </TooltipProvider>
      </div>
    </StoreProvider>
  );
}

function AccountBalances({ accountId }: { accountId: string | null }) {
  const store = useStore();
  const balance = store.state.accounts
    .filter((item) => !accountId || item.id === accountId)
    .reduce((sum, item) => sum + store.balance(item.id), 0);
  return (
    <div className={shell.accountSummary}>
      <dl className={shell.balances}>
        <div>
          <dt>Cleared</dt>
          <dd>{money(balance)}</dd>
        </div>
        <span className={shell.balanceOperator} aria-hidden>
          +
        </span>
        <div>
          <dt>Uncleared</dt>
          <dd>{money(0)}</dd>
        </div>
        <span className={shell.balanceOperator} aria-hidden>
          =
        </span>
        <div data-total>
          <dt>Working balance</dt>
          <dd>{money(balance)}</dd>
        </div>
      </dl>
    </div>
  );
}

// The shell's sidebar, drawn from the prototype's data. The budget menu,
// Banks, and Add account are inert here.
function SidebarReplica() {
  const store = useStore();
  const { state, screen, selected, month } = store;
  const [closed, setClosed] = useState<string[]>([]);
  const sections = [
    {
      id: "cash",
      label: "Cash",
      items: state.accounts
        .filter((item) => item.kind === "cash")
        .map((item) => ({
          id: item.id,
          label: item.name,
          value: store.balance(item.id),
          current: screen.type === "register" && screen.accountId === item.id,
          go: () => store.navigate({ type: "register", accountId: item.id }),
        })),
    },
    {
      id: "credit",
      label: "Credit",
      items: state.accounts
        .filter((item) => item.kind === "credit")
        .map((item) => ({
          id: item.id,
          label: item.name,
          value: store.balance(item.id),
          current: screen.type === "register" && screen.accountId === item.id,
          go: () => store.navigate({ type: "register", accountId: item.id }),
        })),
    },
    {
      id: "loans",
      label: "Loans",
      items: state.loans.map((loan) => ({
        id: loan.id,
        label: loan.name,
        value: -balanceOn(loan, endOf(month)),
        current: screen.type === "loans" && selected === loan.id,
        go: () => store.navigate({ type: "loans" }, loan.id),
      })),
    },
  ].filter((section) => section.items.length);
  return (
    <nav className={shell.sidebarNav} aria-label="Budget navigation">
      <div className={shell.sidebarHeader}>
        <button type="button" className={shell.switcher}>
          <span className={shell.avatar} aria-hidden>
            A
          </span>
          <span className={shell.switcherName}>Demo · Alex’s budget</span>
          <ChevronDownIcon size={12} aria-hidden />
        </button>
        <IconButton label="Hide sidebar" shortcut="[">
          <PanelLeftIcon aria-hidden />
        </IconButton>
      </div>
      <div className={shell.sidebarScroll}>
        <ul className={shell.navList}>
          <NavItem
            icon={WalletCardsIcon}
            label="Plan"
            current={screen.type === "plan"}
            onClick={() => store.navigate({ type: "plan" })}
          />
          <NavItem
            icon={ChartPieIcon}
            label="Reflect"
            current={screen.type === "reflect"}
            onClick={() => store.navigate({ type: "reflect" })}
          />
          <NavItem
            icon={ArrowLeftRightIcon}
            label="All accounts"
            current={screen.type === "register" && !screen.accountId}
            onClick={() =>
              store.navigate({ type: "register", accountId: null })
            }
          />
          <NavItem
            icon={ChartNoAxesCombinedIcon}
            label="Loans"
            current={screen.type === "loans" && !selected}
            onClick={() => store.navigate({ type: "loans" })}
          />
        </ul>
        {sections.map((section) => {
          const open = !closed.includes(section.id);
          return (
            <section key={section.id} className={shell.navSection}>
              <button
                type="button"
                className={shell.sectionHeading}
                aria-expanded={open}
                onClick={() =>
                  setClosed((values) =>
                    open
                      ? [...values, section.id]
                      : values.filter((value) => value !== section.id),
                  )
                }
              >
                <span>{section.label}</span>
                <Caret />
                <span className={shell.sectionTotal}>
                  {money(
                    section.items.reduce((sum, item) => sum + item.value, 0),
                  )}
                </span>
              </button>
              <div className={shell.sectionBody} data-open={open} inert={!open}>
                <div>
                  <ul className={`${shell.navList} ${shell.nested}`}>
                    {section.items.map((item) => (
                      <NavItem
                        key={item.id}
                        label={item.label}
                        value={money(item.value)}
                        current={item.current}
                        onClick={item.go}
                      />
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </nav>
  );
}

function NavItem({
  icon: Icon,
  label,
  value,
  current,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  value?: string;
  current: boolean;
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
      </button>
    </li>
  );
}
