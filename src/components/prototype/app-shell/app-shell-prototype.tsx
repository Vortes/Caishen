"use client";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  FileUpIcon,
  ListFilterIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMediaQuery } from "~/components/shared/use-media-query";
import { moveMonth } from "~/components/budget/format";
import { AccountSummary, SearchField } from "./account";
import {
  AddCategoryPopover,
  AddCategoryProvider,
  isPaymentGroup,
  type AddCategory,
} from "./add-category";
import { Inspector } from "./inspector";
import { findPalette, PalettePicker, paletteVars } from "./palette-picker";
import type { ShellData } from "./model";
import { MoveMoneyProvider, type MoveMoney } from "./move-money";
import { PlanViews } from "./plan-views";
import { ShellDataProvider } from "./shell-data";
import {
  TransactionEntryProvider,
  useTransactionEntryController,
  type TransactionEntry,
  type TransactionSaver,
} from "./transaction-entry";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { IconButton } from "~/components/ui/icon-button";
import { Tooltip, TooltipProvider } from "~/components/ui/tooltip";
import { Sidebar, type Screen } from "./sidebar";
import { usePanel } from "./use-panel";
import { LoansView, PlanView, RegisterView } from "./views";
import type { Highlight } from "./reflect/chart-utils";
import { SpendingList } from "./reflect/spending-list";
import { ReflectFilters } from "./reflect/filters";
import { ReflectView } from "./reflect/reflect-view";
import {
  defaultFilters,
  type DrillPath,
  type Grouping,
  type ReflectFilters as Filters,
  type ReportKind,
} from "./reflect/report";
import { useSpendingReport } from "./reflect/use-spending-report";
import {
  defaults,
  INSPECTOR,
  readSettings,
  SIDEBAR,
  STORAGE_KEY,
  type Settings,
} from "./settings";
import styles from "./shell.module.css";

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function AppShellPrototype({
  data,
  loadingMonth,
  onMonthChange,
  moveMoney,
  categoryAdder,
  transactionSaver,
  notifications,
}: {
  data: ShellData;
  loadingMonth: boolean;
  onMonthChange: (month: string) => void;
  moveMoney: MoveMoney;
  categoryAdder: CategoryAdder;
  transactionSaver: TransactionSaver;
  // The shell's ToastRegion, rendered inside its themed root.
  notifications: ReactNode;
}) {
  const { accounts, transactions } = data;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  const attachRoot = useCallback((element: HTMLDivElement | null) => {
    rootRef.current = element;
    setRootElement(element);
  }, []);
  // The shell mounts on the client once the budget arrives, so it starts
  // from the saved layout the loading skeleton already showed.
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>(() => {
    const params = new URLSearchParams(window.location.search);
    const accountId = params.get("account");
    return accountId &&
      (accountId === "all" || accounts.some((item) => item.id === accountId))
      ? { type: "register", accountId: accountId === "all" ? null : accountId }
      : { type: "plan" };
  });
  const [reportKind, setReportKind] = useState<ReportKind>("breakdown");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [path, setPath] = useState<DrillPath>({});
  const [grouping, setGrouping] = useState<Grouping>("categories");
  const spending = useSpendingReport({
    data,
    filters,
    path,
    grouping,
    enabled: screen.type === "reflect",
  });
  // Pointing at a chart item, in the chart or in either list, spotlights it
  // everywhere it appears.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlight: Highlight = {
    id: highlighted,
    set: setHighlighted,
    drill: (next) => {
      setHighlighted(null);
      setPath(next);
    },
  };
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const id = new URLSearchParams(window.location.search).get("transaction");
    return transactions.some((item) => item.id === id) ? id : null;
  });
  const [checked, setChecked] = useState<string[]>(() =>
    selectedId ? [selectedId] : [],
  );
  const check = (ids: string[], value: boolean) =>
    setChecked((current) =>
      value
        ? [...new Set([...current, ...ids])]
        : current.filter((id) => !ids.includes(id)),
    );
  const [reviewOnly, setReviewOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [controlsOpen, setControlsOpen] = useState(true);
  const [addingCategory, setAddingCategory] = useState(false);
  const [revealId, setRevealId] = useState<string | null>(null);
  // Below this width both panels float over the content instead of
  // taking space from it, and start closed.
  const narrow = useMediaQuery("(max-width: 860px)");
  // A phone is too narrow for the details panel's saved width.
  const phone = useMediaQuery("(max-width: 560px)");
  const [drawer, setDrawer] = useState({ sidebar: false, inspector: false });
  // Linear-style peek: with the sidebar collapsed, hovering the left edge or
  // the sidebar button floats it over the content until the pointer leaves.
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const openPeek = () => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek(true), 250);
  };
  const closePeek = (delay = 200) => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek(false), delay);
  };

  // Enable transitions only after the first paint, so a saved collapsed
  // state doesn't animate on load.
  useEffect(() => {
    requestAnimationFrame(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings, ready]);

  const sidebarState = narrow
    ? { ...settings.sidebar, collapsed: !drawer.sidebar }
    : settings.sidebar;
  const inspectorState = narrow
    ? {
        width: phone ? INSPECTOR.min : settings.inspector.width,
        collapsed: !drawer.inspector,
      }
    : settings.inspector;

  const sidebar = usePanel({
    side: "left",
    ...SIDEBAR,
    state: sidebarState,
    onChange: (next) =>
      narrow
        ? setDrawer((value) => ({ ...value, sidebar: !next.collapsed }))
        : setSettings((value) => ({ ...value, sidebar: next })),
  });
  const peekable = !narrow && sidebarState.collapsed;
  const peekOpen = peekable && peek && !sidebar.dragging;

  const inspector = usePanel({
    side: "right",
    ...INSPECTOR,
    state: inspectorState,
    onChange: (next) =>
      narrow
        ? setDrawer((value) => ({ ...value, inspector: !next.collapsed }))
        : setSettings((value) => ({ ...value, inspector: next })),
  });

  const entry = useTransactionEntryController({
    saver: transactionSaver,
    // On a narrow screen the drawers cover the register.
    reveal: () => {
      if (narrow) setDrawer({ sidebar: false, inspector: false });
    },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey) return;
      // A popover handles its own keys; Escape there closes it and nothing else.
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"]')
      )
        return;
      if (event.key === "[") sidebar.toggle();
      else if (event.key === "]" && screen.type !== "register")
        inspector.toggle();
      else if (event.key === "n" && screen.type === "plan")
        setAddingCategory(true);
      else if (event.key === "n" && screen.type === "register") {
        if (!entry.start({ accountId: screen.accountId })) return;
      } else if (
        event.key === "e" &&
        screen.type === "register" &&
        selectedId
      ) {
        if (!entry.start({ transactionId: selectedId })) return;
      } else if (event.key === "Escape") {
        if (peekOpen) setPeek(false);
        else if (narrow && (drawer.sidebar || drawer.inspector)) {
          setDrawer({ sidebar: false, inspector: false });
        } else if (checked.length) {
          setChecked([]);
          setSelectedId(null);
        } else if (screen.type === "reflect" && (path.group ?? path.categoryId))
          // Escape climbs one level of the report, like its breadcrumbs.
          setPath(path.categoryId && path.group ? { group: path.group } : {});
        else setSelectedId(null);
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    sidebar,
    inspector,
    narrow,
    drawer,
    peekOpen,
    checked.length,
    screen,
    path,
    entry,
    selectedId,
  ]);

  const navigate = (next: Screen, id?: string) => {
    if (entry.holdForDraft()) return;
    setScreen(next);
    setSelectedId(id ?? null);
    setChecked([]);
    setReviewOnly(false);
    setQuery("");
    if (narrow)
      setDrawer({
        sidebar: false,
        inspector: next.type !== "register" && Boolean(id),
      });
    closePeek(0);
  };

  const select = (id: string) => setSelectedId(id);
  // Like YNAB, clicking a row selects just that row: its checkbox ticks and
  // any others clear. Clicking a selected row deselects it. Checkboxes add
  // to or remove from the selection.
  const selectOnly = (id: string) => {
    if (checked.includes(id)) {
      setChecked(checked.filter((item) => item !== id));
      setSelectedId(null);
    } else {
      setSelectedId(id);
      setChecked([id]);
    }
  };

  // A category just added: every category shows, so no view hides it, and
  // it's selected with its details open, as if its row was clicked.
  const addCategory: AddCategory = {
    ...categoryAdder,
    reveal: (id) => {
      setSettings((value) => ({ ...value, planView: null }));
      if (inspectorState.collapsed) inspector.toggle();
      setSelectedId(id);
      setChecked([id]);
      setRevealId(id);
    },
  };

  const reset = () => {
    if (entry.holdForDraft()) return;
    localStorage.removeItem(STORAGE_KEY);
    setSettings(defaults);
    setScreen({ type: "plan" });
    setSelectedId(null);
    setChecked([]);
    setReviewOnly(false);
    setQuery("");
    setReportKind("breakdown");
    setFilters(defaultFilters);
    setPath({});
    setGrouping("categories");
    setDrawer({ sidebar: false, inspector: false });
  };

  // Flip colors in one frame instead of letting each control run its own
  // color transition.
  const switchColors = (change: Partial<Settings>) => {
    const root = rootRef.current;
    if (root) root.dataset.switching = "";
    setSettings((value) => ({ ...value, ...change }));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (root) delete root.dataset.switching;
      }),
    );
  };
  const palette =
    settings.theme === "dark" ? findPalette(settings.palette) : null;

  const account =
    screen.type === "register"
      ? accounts.find((item) => item.id === screen.accountId)
      : undefined;
  const reviewCount = transactions.filter(
    (item) => item.needsReview && (!account || item.accountId === account.id),
  ).length;
  // An account's register is the whole screen: its balances, actions, and
  // review notice replace the details panel.
  const register = screen.type === "register";

  return (
    <ShellDataProvider value={data}>
      <ActionProviders
        moveMoney={moveMoney}
        addCategory={addCategory}
        transactionEntry={entry}
      >
        <div
          ref={attachRoot}
          className={styles.root}
          data-theme={settings.theme}
          data-palette={palette?.name}
          style={palette ? paletteVars(palette) : undefined}
          data-ready={ready || undefined}
          data-narrow={narrow || undefined}
          data-has-selection={(register && checked.length > 0) || undefined}
          data-dragging={sidebar.dragging || inspector.dragging || undefined}
          data-peekable={peekable || undefined}
        >
          <TooltipProvider container={rootElement}>
            <a className={styles.skipLink} href="#prototype-content">
              Skip to content
            </a>

            <aside
              id="prototype-sidebar"
              className={styles.sidebar}
              style={{ width: sidebar.width }}
              data-open={sidebar.width > 0 || undefined}
              aria-hidden={sidebar.width === 0 || undefined}
              inert={sidebar.width === 0}
            >
              <div
                className={styles.sidebarInner}
                style={{ width: sidebar.contentWidth }}
              >
                <Sidebar
                  screen={screen}
                  selectedId={selectedId}
                  onNavigate={navigate}
                  toggleLabel="Hide sidebar"
                  onToggle={sidebar.toggle}
                />
              </div>
            </aside>

            {peekable && (
              <>
                <div
                  className={styles.peekScrim}
                  data-open={peekOpen || undefined}
                  aria-hidden
                  onClick={() => closePeek(0)}
                />
                <div
                  className={styles.peek}
                  data-open={peekOpen || undefined}
                  style={{ width: settings.sidebar.width }}
                  aria-hidden={!peekOpen || undefined}
                  inert={!peekOpen}
                  onPointerEnter={openPeek}
                  onPointerLeave={() => closePeek()}
                >
                  <Sidebar
                    screen={screen}
                    selectedId={selectedId}
                    onNavigate={navigate}
                    // The peek floats a collapsed sidebar; its toggle pins
                    // it open.
                    toggleLabel="Show sidebar"
                    onToggle={() => {
                      closePeek(0);
                      sidebar.toggle();
                    }}
                  />
                </div>
              </>
            )}

            {narrow && (drawer.sidebar || (!register && drawer.inspector)) && (
              <div
                className={styles.scrim}
                data-testid="drawer-backdrop"
                aria-hidden
                onClick={() => setDrawer({ sidebar: false, inspector: false })}
              />
            )}

            <div className={styles.main}>
              <div
                {...sidebar.handleProps}
                className={styles.handle}
                data-side="left"
                aria-label="Resize sidebar"
                aria-controls="prototype-sidebar"
                data-active={sidebar.dragging || undefined}
                onPointerEnter={peekable ? openPeek : undefined}
                onPointerLeave={peekable ? () => closePeek() : undefined}
              />
              <div className={styles.panel}>
                <header className={styles.header}>
                  <div
                    className={styles.toggleSlot}
                    data-show={sidebarState.collapsed || undefined}
                    onPointerEnter={peekable ? openPeek : undefined}
                    onPointerLeave={peekable ? () => closePeek() : undefined}
                  >
                    <div>
                      <IconButton
                        label="Show sidebar"
                        shortcut="["
                        onClick={() => {
                          closePeek(0);
                          sidebar.toggle();
                        }}
                      >
                        <PanelLeftIcon aria-hidden />
                      </IconButton>
                    </div>
                  </div>
                  <HeaderTitle screen={screen} accountName={account?.name} />
                  {screen.type === "reflect" ? (
                    <ReportTabs value={reportKind} onChange={setReportKind} />
                  ) : (
                    <MonthNav
                      month={data.month}
                      onChange={(next) => {
                        if (screen.type === "register") {
                          setSelectedId(null);
                          setChecked([]);
                        }
                        onMonthChange(next);
                      }}
                    />
                  )}
                  {loadingMonth && (
                    <div className={styles.monthLoading} role="status">
                      <span className="sr-only">
                        Loading {data.month.label}
                      </span>
                    </div>
                  )}
                </header>

                {screen.type === "register" && (
                  <AccountSummary
                    accounts={account ? [account] : accounts}
                    single={Boolean(account)}
                  />
                )}

                <div
                  className={styles.toolbar}
                  data-wrap={register || undefined}
                >
                  {screen.type === "plan" && (
                    <PlanViews
                      value={settings.planView}
                      onChange={(planView) =>
                        setSettings((value) => ({ ...value, planView }))
                      }
                    />
                  )}
                  {screen.type === "reflect" && (
                    <ReflectFilters
                      filters={filters}
                      onChange={(next) => {
                        setFilters(next);
                        setPath({});
                      }}
                    />
                  )}
                  {screen.type === "register" && (
                    <Button
                      size="sm"
                      aria-pressed={reviewOnly}
                      onClick={() => {
                        setReviewOnly((value) => !value);
                        setSelectedId(null);
                        setChecked([]);
                      }}
                    >
                      <span className={styles.reviewDot} data-on data-inline />
                      To review
                      <span className={styles.numeric}>{reviewCount}</span>
                    </Button>
                  )}
                  {screen.type === "register" && (
                    <AddTransactionTooltip editing={Boolean(entry.session)}>
                      <Button
                        size="sm"
                        aria-label={phone ? "Add transaction" : undefined}
                        data-transaction-opener="new"
                        disabled={
                          Boolean(entry.session) ||
                          entry.busy ||
                          !accounts.length
                        }
                        onClick={() =>
                          entry.start({ accountId: screen.accountId })
                        }
                      >
                        <PlusIcon aria-hidden />
                        {phone ? "Add" : "Add transaction"}
                      </Button>
                    </AddTransactionTooltip>
                  )}
                  {screen.type === "register" && account && (
                    <Button size="sm">
                      <FileUpIcon aria-hidden />
                      File import
                    </Button>
                  )}
                  <div className={styles.toolbarActions}>
                    {screen.type === "plan" && (
                      <AddCategoryPopover
                        open={addingCategory}
                        onOpenChange={setAddingCategory}
                        defaultGroup={defaultGroup(data, selectedId)}
                        align="end"
                        shortcut="N"
                      >
                        <Button
                          size="sm"
                          aria-label={phone ? "Add category" : undefined}
                        >
                          <PlusIcon aria-hidden />
                          {phone ? "Add" : "Add category"}
                        </Button>
                      </AddCategoryPopover>
                    )}
                    {screen.type === "register" && (
                      <SearchField
                        value={query}
                        onChange={(next) => {
                          setQuery(next);
                          setSelectedId(null);
                          setChecked([]);
                        }}
                        placeholder={`Search ${account?.name ?? "all accounts"}`}
                      />
                    )}
                    {screen.type !== "reflect" && (
                      <>
                        <IconButton
                          label="Filter"
                          shortcut="F"
                          variant="secondary"
                        >
                          <ListFilterIcon aria-hidden />
                        </IconButton>
                        <IconButton label="Display options" variant="secondary">
                          <SlidersHorizontalIcon aria-hidden />
                        </IconButton>
                      </>
                    )}
                    {!register && (
                      <IconButton
                        label={
                          inspectorState.collapsed
                            ? "Show details"
                            : "Hide details"
                        }
                        shortcut="]"
                        variant="secondary"
                        pressed={!inspectorState.collapsed}
                        onClick={inspector.toggle}
                      >
                        <PanelRightIcon aria-hidden />
                      </IconButton>
                    )}
                  </div>
                </div>

                <div className={styles.body}>
                  <main
                    id="prototype-content"
                    className={styles.content}
                    tabIndex={-1}
                  >
                    {screen.type === "plan" && (
                      <PlanView
                        view={settings.planView}
                        // Opens the details panel, then selects just that row,
                        // like the register.
                        onSelect={(id) => {
                          if (inspectorState.collapsed) inspector.toggle();
                          selectOnly(id);
                        }}
                        checked={checked}
                        onCheck={check}
                        revealId={revealId}
                      />
                    )}
                    {screen.type === "register" && (
                      <>
                        <RegisterView
                          key={screen.accountId ?? "all"}
                          accountId={screen.accountId}
                          reviewOnly={reviewOnly}
                          query={query}
                          selectedId={selectedId}
                          onSelect={selectOnly}
                          checked={checked}
                          onCheck={check}
                          onJump={(transaction) => {
                            if (entry.holdForDraft()) return;
                            navigate(
                              {
                                type: "register",
                                accountId: transaction.accountId,
                              },
                              transaction.id,
                            );
                            onMonthChange(transaction.date.slice(0, 7));
                            setChecked([transaction.id]);
                          }}
                        />
                      </>
                    )}
                    {screen.type === "loans" && (
                      <LoansView selectedId={selectedId} onSelect={select} />
                    )}
                    {screen.type === "reflect" && (
                      <ReflectView
                        spending={spending}
                        highlight={highlight}
                        grouping={grouping}
                        onGroupingChange={(next) => {
                          setGrouping(next);
                          setPath({});
                        }}
                        showList={inspectorState.collapsed}
                        kind={reportKind}
                        filters={filters}
                        path={path}
                        onPath={setPath}
                        onFiltersChange={setFilters}
                        onOpenTransaction={(entry) => {
                          // Like YNAB: the transaction, selected, in its own
                          // account's register for the month it happened.
                          onMonthChange(entry.date.slice(0, 7));
                          navigate(
                            {
                              type: "register",
                              accountId: entry.accountId ?? null,
                            },
                            entry.transactionId,
                          );
                        }}
                      />
                    )}
                  </main>

                  {!register && (
                    <div className={styles.inspectorSlot}>
                      <div
                        {...inspector.handleProps}
                        className={styles.handle}
                        data-side="right"
                        aria-label="Resize details panel"
                        data-active={inspector.dragging || undefined}
                      />
                      <aside
                        className={styles.inspector}
                        style={{ width: inspector.width }}
                        aria-label="Details"
                        aria-hidden={inspector.width === 0 || undefined}
                        inert={inspector.width === 0}
                      >
                        <div
                          className={styles.inspectorInner}
                          style={{ width: inspector.contentWidth }}
                        >
                          {screen.type === "reflect" ? (
                            spending.report && (
                              <Card>
                                <SpendingList
                                  report={spending.report}
                                  path={path}
                                  highlight={highlight}
                                />
                              </Card>
                            )
                          ) : (
                            <Inspector
                              screen={screen}
                              selectedId={selectedId}
                              checked={checked}
                            />
                          )}
                        </div>
                      </aside>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              className={styles.controls}
              data-open={controlsOpen || undefined}
            >
              <button
                type="button"
                className={styles.controlsTag}
                aria-expanded={controlsOpen}
                onClick={() => setControlsOpen((value) => !value)}
              >
                Prototype
                {controlsOpen ? (
                  <ChevronDownIcon size={12} aria-hidden />
                ) : (
                  <ChevronUpIcon size={12} aria-hidden />
                )}
              </button>
              {controlsOpen && (
                <>
                  <Segmented
                    label="Theme"
                    value={settings.theme}
                    options={[
                      ["dark", "Dark"],
                      ["light", "Light"],
                    ]}
                    onChange={(theme) => switchColors({ theme })}
                  />
                  <PalettePicker
                    value={settings.palette}
                    // Monkeytype's palettes are dark, so picking one leaves
                    // light mode.
                    onChange={(name) =>
                      switchColors({ palette: name, theme: "dark" })
                    }
                  />
                  <span className={styles.readout} aria-live="polite">
                    Sidebar{" "}
                    {sidebarState.collapsed
                      ? "closed"
                      : `${Math.round(sidebar.width)}px`}
                    {" · "}
                    Details{" "}
                    {register || inspectorState.collapsed
                      ? "closed"
                      : `${Math.round(inspector.width)}px`}
                  </span>
                  <span className={styles.keys}>
                    <kbd>[</kbd>
                    <kbd>]</kbd>
                    <kbd>↑</kbd>
                    <kbd>↓</kbd>
                    <kbd>Esc</kbd>
                  </span>
                  <button
                    type="button"
                    className={styles.resetButton}
                    onClick={reset}
                  >
                    <RotateCcwIcon size={12} aria-hidden />
                    Reset
                  </button>
                </>
              )}
            </div>
            {notifications}
          </TooltipProvider>
        </div>
      </ActionProviders>
    </ShellDataProvider>
  );
}

// While the editor is open Add is disabled, and its tooltip, left open
// under the pointer that clicked it, would take the editor's Escape.
function AddTransactionTooltip({
  editing,
  children,
}: {
  editing: boolean;
  children: ReactNode;
}) {
  if (editing) return children;
  return (
    <Tooltip label="Add a transaction" shortcut="N">
      {children}
    </Tooltip>
  );
}

// What the shell needs to add a category; it shows the category itself.
export type CategoryAdder = Omit<AddCategory, "reveal">;

// A new category starts in the selected category's group, or the first one
// it can go in.
function defaultGroup(data: ShellData, selectedId: string | null) {
  const groups = data.groups.filter((group) => !isPaymentGroup(group));
  const selected = data.categories.find((item) => item.id === selectedId);
  return (
    groups.find((group) => group.name === selected?.group)?.name ??
    groups[0]?.name ??
    ""
  );
}

// The shell's real actions: moving money, adding categories, and entering
// transactions.
function ActionProviders({
  moveMoney,
  addCategory,
  transactionEntry,
  children,
}: {
  moveMoney: MoveMoney;
  addCategory: AddCategory;
  transactionEntry: TransactionEntry;
  children: ReactNode;
}) {
  return (
    <MoveMoneyProvider value={moveMoney}>
      <AddCategoryProvider value={addCategory}>
        <TransactionEntryProvider value={transactionEntry}>
          {children}
        </TransactionEntryProvider>
      </AddCategoryProvider>
    </MoveMoneyProvider>
  );
}

function HeaderTitle({
  screen,
  accountName,
}: {
  screen: Screen;
  accountName?: string;
}) {
  return (
    <div className={styles.titleGroup}>
      {screen.type === "register" && accountName && (
        <>
          <span className={styles.crumb}>Accounts</span>
          <ChevronRightIcon
            size={12}
            className={styles.crumbSeparator}
            aria-hidden
          />
        </>
      )}
      <h1 className={styles.headerTitle}>
        {screen.type === "plan"
          ? "Plan"
          : screen.type === "reflect"
            ? "Reflect"
            : screen.type === "loans"
              ? "Loans"
              : (accountName ?? "All accounts")}
      </h1>
    </div>
  );
}

// YNAB's report switcher. Both reports share the filters and drill level.
function ReportTabs({
  value,
  onChange,
}: {
  value: ReportKind;
  onChange: (kind: ReportKind) => void;
}) {
  const tabs: [ReportKind, string][] = [
    ["breakdown", "Spending Breakdown"],
    ["trends", "Spending Trends"],
  ];
  return (
    <div className={styles.reportTabs} role="tablist" aria-label="Report">
      {tabs.map(([kind, label]) => (
        <button
          type="button"
          role="tab"
          key={kind}
          id={`report-tab-${kind}`}
          aria-selected={value === kind}
          aria-controls="prototype-content"
          tabIndex={value === kind ? 0 : -1}
          className={styles.reportTab}
          onClick={() => onChange(kind)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            const [next] = tabs.find(([id]) => id !== kind)!;
            onChange(next);
            document.getElementById(`report-tab-${next}`)?.focus();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Every screen reads the same budget month, so the picker lives in the
// header rather than on the plan alone.
function MonthNav({
  month,
  onChange,
}: {
  month: ShellData["month"];
  onChange: (month: string) => void;
}) {
  return (
    <div className={styles.monthNav}>
      <IconButton
        label="Previous month"
        disabled={!month.canGoBack}
        onClick={() => onChange(moveMonth(month.key, -1))}
      >
        <ChevronLeftIcon aria-hidden />
      </IconButton>
      <Tooltip label="Go to this month">
        <button
          type="button"
          className={styles.monthButton}
          onClick={() => onChange(month.current)}
        >
          {month.label}
        </button>
      </Tooltip>
      <IconButton
        label="Next month"
        onClick={() => onChange(moveMonth(month.key, 1))}
      >
        <ChevronRightIcon aria-hidden />
      </IconButton>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      <span className={styles.segmentedLabel}>{label}</span>
      {options.map(([option, text]) => (
        <button
          type="button"
          role="radio"
          key={option}
          aria-checked={value === option}
          onClick={() => onChange(option)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
