"use client";

import {
  ChevronRightIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
} from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMediaQuery } from "~/components/shared/use-media-query";
import { transactionSelectionActions } from "~/components/transactions/transaction-actions";
import { AccountSummary, SearchField } from "./account";
import type { Reconciling } from "./reconcile";
import {
  AddCategoryProvider,
  AddGroupButton,
  type AddCategory,
  type Added,
} from "./add-category";
import { AppearanceSettings } from "./appearance";
import { PartnerSettings } from "~/components/settings/partner";
import { ProfileSettings } from "~/components/settings/profile";
import { Inspector } from "./inspector";
import { MonthNav } from "./month-picker";
import { findPalette, paletteVars } from "./palettes";
import { isCounterparty, type ShellData } from "./model";
import { MoveMoneyProvider, type MoveMoney } from "./move-money";
import { TargetEditingProvider, type TargetEditing } from "./target-editor";
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
import { SettingsNav, Sidebar } from "./sidebar";
import { PanelWidthDials, usePanelWidths } from "./panel-widths";
import { usePanel } from "./use-panel";
import { LoansView, PlanView, RegisterView } from "./views";
import { PartnerRegister } from "./partner-register";
import {
  ReimbursementFilters,
  ReimbursementsRegister,
} from "./reimbursements-register";
import type { Highlight } from "./reflect/chart-utils";
import { SpendingList, SpendingListSkeleton } from "./reflect/spending-list";
import { ReflectFilters } from "./reflect/filters";
import { ReflectView } from "./reflect/reflect-view";
import {
  defaultFilters,
  levelOf,
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
import {
  settingsPageAt,
  settingsHref,
  settingsReturnHref,
  screenAt,
  screenHref,
  SHELL_PATH,
  type Screen,
  type SettingsPage,
} from "~/components/workspace/routes";
import styles from "./shell.module.css";
import type { UpdatePreferences } from "~/components/entry/profile-preferences";

const settingsTitles: Record<SettingsPage, string> = {
  profile: "Profile",
  appearance: "Appearance",
  partner: "Partner",
};

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function AppShell({
  data,
  onMonthChange,
  moveMoney,
  categoryAdder,
  transactionSaver,
  targetEditing,
  renameBudget,
  updatePreferences,
  joinBlocked,
  reconciling,
  overlays,
}: {
  data: ShellData;
  onMonthChange: (month: string) => void;
  moveMoney: MoveMoney;
  categoryAdder: CategoryAdder;
  transactionSaver: TransactionSaver;
  targetEditing: TargetEditing;
  // Returns why the rename can't run yet, or null once it's sent.
  renameBudget: (name: string) => string | null;
  updatePreferences?: UpdatePreferences;
  joinBlocked?: string;
  reconciling: Reconciling;
  // Dialogs and the ToastRegion, rendered inside the themed root.
  overlays: ReactNode;
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
  const pathname = usePathname() ?? SHELL_PATH;
  const searchParams = useSearchParams();
  const search = new URLSearchParams(searchParams?.toString());
  const settingsPage = settingsPageAt(pathname);
  const settingsOpen = settingsPage !== null;
  const returnHref = settingsReturnHref(search);
  const budgetAddress = new URL(
    settingsOpen ? returnHref : `${pathname}?${search}`,
    window.location.origin,
  );
  const budgetHref = `${budgetAddress.pathname}${budgetAddress.search}`;
  const budgetPathname = budgetAddress.pathname;
  const screen = useMemo<Screen>(
    () => screenAt(budgetPathname) ?? { type: "plan" },
    [budgetPathname],
  );
  const account =
    screen.type === "register"
      ? accounts.find((item) => item.id === screen.accountId)
      : undefined;
  // Partner and Reimbursements fill from shares and settlements, not from
  // entries or bank statements.
  const recordable =
    screen.type === "register" && !(account && isCounterparty(account));
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
  const routeSelection =
    screen.type === "loans"
      ? screen.loanId
      : budgetAddress.searchParams.get("transaction");
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const id = routeSelection;
    if (screen.type === "loans") return id;
    return transactions.some((item) => item.id === id) ? id : null;
  });
  const [checked, setChecked] = useState<string[]>(() =>
    screen.type === "register" && selectedId ? [selectedId] : [],
  );
  const check = (ids: string[], value: boolean) =>
    setChecked((current) =>
      value
        ? [...new Set([...current, ...ids])]
        : current.filter((id) => !ids.includes(id)),
    );
  const selectedActions = transactionSelectionActions(
    transactions.filter((transaction) => checked.includes(transaction.id)),
  );
  const reviewOnly = budgetAddress.searchParams.get("view") === "review";
  const routeQuery = budgetAddress.searchParams.get("q") ?? "";
  // Keep the input responsive while Next applies its URL transition.
  const [query, setQuery] = useState(routeQuery);
  const deferredQuery = useDeferredValue(query);
  const registerPath = budgetAddress.pathname;
  useEffect(() => setQuery(routeQuery), [registerPath, routeQuery]);
  // The person or organization the Reimbursements register is narrowed to.
  const [owedBy, setOwedBy] = useState<string | null>(null);
  // Transient selections and filters belong to the address they were opened on.
  const selectionSearch = new URLSearchParams(budgetAddress.searchParams);
  selectionSearch.delete("month");
  const selectionAddress = `${budgetAddress.pathname}?${selectionSearch}`;
  const previousAddress = useRef(selectionAddress);
  useEffect(() => {
    if (previousAddress.current === selectionAddress) return;
    previousAddress.current = selectionAddress;
    setSelectedId(routeSelection);
    setChecked(
      routeSelection && screen.type === "register" ? [routeSelection] : [],
    );
    setOwedBy(null);
  }, [selectionAddress, routeSelection, screen.type]);
  const [addingGroup, setAddingGroup] = useState(false);
  const [revealed, setRevealed] = useState<Added | null>(null);
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

  // Laptop and tablet screens use fixed widths instead of the saved ones.
  const tuned = usePanelWidths();
  const sidebarWidth = tuned?.sidebar ?? settings.sidebar.width;
  const inspectorWidth = tuned?.inspector ?? settings.inspector.width;
  const sidebarState = narrow
    ? { width: sidebarWidth, collapsed: !drawer.sidebar }
    : { ...settings.sidebar, width: sidebarWidth };
  const inspectorState = narrow
    ? {
        width: phone ? INSPECTOR.min : inspectorWidth,
        collapsed: !drawer.inspector,
      }
    : { ...settings.inspector, width: inspectorWidth };

  const sidebar = usePanel({
    side: "left",
    ...SIDEBAR,
    min: Math.min(SIDEBAR.min, sidebarWidth),
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
    min: Math.min(INSPECTOR.min, inspectorWidth),
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

  const closeSettings = useCallback(
    () => window.history.pushState(null, "", returnHref),
    [returnHref],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey) return;
      // A popover handles its own keys; Escape there closes it and nothing else.
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="menu"]')
      )
        return;
      if (settingsOpen) {
        if (event.key === "[") sidebar.toggle();
        else if (event.key === "Escape") closeSettings();
        else return;
        event.preventDefault();
        return;
      }
      if (event.key === "[") sidebar.toggle();
      else if (event.key === "]" && screen.type !== "register")
        inspector.toggle();
      else if (event.key === "n" && screen.type === "plan")
        setAddingGroup(true);
      else if (event.key === "n" && recordable) {
        if (!entry.start({ accountId: screen.accountId })) return;
      } else if (
        event.key === "e" &&
        screen.type === "register" &&
        selectedActions.edit?.id === selectedId &&
        selectedActions.edit?.kind === "transaction"
      ) {
        if (!entry.start({ transactionId: selectedActions.edit.id })) return;
      } else if (event.key === "Escape") {
        if (peekOpen) setPeek(false);
        else if (narrow && (drawer.sidebar || drawer.inspector)) {
          setDrawer({ sidebar: false, inspector: false });
        } else if (screen.type === "loans" && screen.loanId) {
          window.history.pushState(
            null,
            "",
            screenHref(
              { type: "loans", loanId: null },
              new URLSearchParams(window.location.search),
            ),
          );
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
    recordable,
    path,
    entry,
    selectedId,
    selectedActions,
    settingsOpen,
    closeSettings,
  ]);

  const navigateTo = (href: string) => {
    if (entry.holdForDraft()) return;
    if (`${window.location.pathname}${window.location.search}` !== href)
      window.history.pushState(null, "", href);
    const next = screenAt(href.split("?")[0]!);
    if (narrow)
      setDrawer({
        sidebar: false,
        inspector: next?.type === "loans" && Boolean(next.loanId),
      });
    closePeek(0);
  };

  const hrefFor = (next: Screen) => {
    const query = new URLSearchParams(budgetAddress.searchParams);
    query.set("month", data.month.key);
    return screenHref(next, query);
  };
  const navigate = (next: Screen, id?: string, month?: string) => {
    const address = new URL(hrefFor(next), window.location.origin);
    if (id) address.searchParams.set("transaction", id);
    if (month) address.searchParams.set("month", month);
    navigateTo(`${address.pathname}${address.search}`);
  };

  const setRegisterFilter = (
    key: "view" | "q",
    value: string,
    replace = false,
  ) => {
    const address = new URL(window.location.href);
    if (value) address.searchParams.set(key, value);
    else address.searchParams.delete(key);
    address.searchParams.delete("transaction");
    const href = `${address.pathname}${address.search}`;
    if (replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
  };

  // Opens a transaction in its own account's register, selected, for the
  // month it happened.
  const jump = (transaction: {
    id: string;
    accountId: string;
    date: string;
  }) => {
    if (entry.holdForDraft()) return;
    navigate(
      { type: "register", accountId: transaction.accountId },
      transaction.id,
      transaction.date.slice(0, 7),
    );
  };

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

  // What was just added shows in every category, so no view hides it. A new
  // category is selected with its details open, as if its row was clicked.
  const addCategory: AddCategory = {
    ...categoryAdder,
    reveal: (added) => {
      setSettings((value) => ({ ...value, planView: null }));
      if (added.type === "category") {
        if (inspectorState.collapsed) inspector.toggle();
        setSelectedId(added.id);
        setChecked([added.id]);
      }
      setRevealed(added);
    },
  };

  // Run from settings, so they stay open over the restored shell.
  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    switchColors(defaults);
    setSelectedId(null);
    setChecked([]);
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

  // The sidebar's contents, pinned or peeking.
  const navigation = (toggleLabel: string, onToggle: () => void) =>
    settingsPage ? (
      <SettingsNav
        toggleLabel={toggleLabel}
        onToggle={onToggle}
        page={settingsPage}
        returnHref={returnHref}
        hrefFor={(page) => settingsHref(page, returnHref)}
        onNavigate={navigateTo}
      />
    ) : (
      <Sidebar
        screen={screen}
        hrefFor={hrefFor}
        onNavigate={navigateTo}
        toggleLabel={toggleLabel}
        onToggle={onToggle}
        settingsHref={(page) => {
          const address = new URL(budgetHref, window.location.origin);
          address.searchParams.set("month", data.month.key);
          return settingsHref(page, `${address.pathname}${address.search}`);
        }}
      />
    );

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
        targetEditing={targetEditing}
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
            <a className={styles.skipLink} href="#app-content">
              Skip to content
            </a>

            <aside
              id="app-sidebar"
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
                {navigation("Hide sidebar", sidebar.toggle)}
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
                  style={{ width: sidebarWidth }}
                  aria-hidden={!peekOpen || undefined}
                  inert={!peekOpen}
                  onPointerEnter={openPeek}
                  onPointerLeave={() => closePeek()}
                >
                  {/* The peek floats a collapsed sidebar; its toggle pins
                      it open. */}
                  {navigation("Show sidebar", () => {
                    closePeek(0);
                    sidebar.toggle();
                  })}
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
                aria-controls="app-sidebar"
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
                  {settingsOpen ? (
                    <div className={styles.titleGroup}>
                      <span className={styles.crumb}>Settings</span>
                      <ChevronRightIcon
                        size={12}
                        className={styles.crumbSeparator}
                        aria-hidden
                      />
                      <h1 className={styles.headerTitle}>
                        {settingsTitles[settingsPage]}
                      </h1>
                    </div>
                  ) : (
                    <HeaderTitle screen={screen} accountName={account?.name} />
                  )}
                  {settingsOpen ? null : screen.type === "reflect" ? (
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
                </header>

                {settingsOpen ? (
                  <div className={styles.body}>
                    <main
                      id="app-content"
                      className={styles.content}
                      tabIndex={-1}
                    >
                      {settingsPage === "partner" ? (
                        <PartnerSettings blocked={joinBlocked} />
                      ) : settingsPage === "profile" ? (
                        <ProfileSettings
                          onRename={renameBudget}
                          onUpdate={updatePreferences}
                        />
                      ) : (
                        <AppearanceSettings
                          settings={settings}
                          onChange={switchColors}
                          onReset={reset}
                        />
                      )}
                    </main>
                  </div>
                ) : (
                  <>
                    {screen.type === "register" && (
                      <AccountSummary
                        key={account?.id ?? "all"}
                        accounts={account ? [account] : accounts}
                        account={account}
                        reconciling={reconciling}
                        owedBy={owedBy}
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
                      {account?.kind === "reimbursements" && (
                        <ReimbursementFilters
                          account={account}
                          value={owedBy}
                          onChange={setOwedBy}
                        />
                      )}
                      {recordable && (
                        <Button
                          size="sm"
                          aria-pressed={reviewOnly}
                          onClick={() => {
                            setRegisterFilter(
                              "view",
                              reviewOnly ? "" : "review",
                            );
                            setSelectedId(null);
                            setChecked([]);
                          }}
                        >
                          <span
                            className={styles.reviewDot}
                            data-on
                            data-inline
                          />
                          To review
                          <span className={styles.numeric}>{reviewCount}</span>
                        </Button>
                      )}
                      {recordable && (
                        <AddTransactionTooltip editing={Boolean(entry.session)}>
                          <Button
                            size="sm"
                            aria-label={phone ? "Add transaction" : undefined}
                            data-transaction-opener="new"
                            disabled={
                              Boolean(entry.session) || !accounts.length
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
                      <div className={styles.toolbarActions}>
                        {screen.type === "plan" && (
                          <AddGroupButton
                            open={addingGroup}
                            onOpenChange={setAddingGroup}
                            compact={phone}
                          />
                        )}
                        {screen.type === "register" && (
                          <SearchField
                            value={query}
                            onChange={(next) => {
                              setQuery(next);
                              setRegisterFilter("q", next, true);
                              setSelectedId(null);
                              setChecked([]);
                            }}
                            placeholder={`Search ${account?.name ?? "all accounts"}`}
                          />
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
                        id="app-content"
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
                            reveal={revealed}
                          />
                        )}
                        {screen.type === "register" && (
                          <>
                            {account?.kind === "partner" ? (
                              <PartnerRegister
                                key={account.id}
                                account={account}
                                query={deferredQuery}
                              />
                            ) : account?.kind === "reimbursements" ? (
                              <ReimbursementsRegister
                                key={account.id}
                                account={account}
                                who={owedBy}
                                query={deferredQuery}
                                onJump={jump}
                              />
                            ) : (
                              <RegisterView
                                key={screen.accountId ?? "all"}
                                accountId={screen.accountId}
                                reviewOnly={reviewOnly}
                                query={deferredQuery}
                                selectedId={selectedId}
                                onSelect={selectOnly}
                                checked={checked}
                                onCheck={check}
                                onJump={jump}
                              />
                            )}
                          </>
                        )}
                        {screen.type === "loans" && (
                          <LoansView
                            selectedId={selectedId}
                            onSelect={(id) =>
                              navigate({ type: "loans", loanId: id })
                            }
                          />
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
                              navigate(
                                {
                                  type: "register",
                                  accountId: entry.accountId ?? null,
                                },
                                entry.transactionId,
                                entry.date.slice(0, 7),
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
                                spending.report ? (
                                  <Card>
                                    <SpendingList
                                      report={spending.report}
                                      path={path}
                                      highlight={highlight}
                                    />
                                  </Card>
                                ) : (
                                  !spending.error && (
                                    // Announced by the report's own status.
                                    <div aria-hidden inert>
                                      <Card>
                                        <SpendingListSkeleton
                                          level={levelOf(path, grouping)}
                                        />
                                      </Card>
                                    </div>
                                  )
                                )
                              ) : (
                                <Inspector
                                  screen={screen}
                                  selectedId={selectedId}
                                  checked={checked}
                                  view={settings.planView}
                                />
                              )}
                            </div>
                          </aside>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {overlays}
          </TooltipProvider>
          <PanelWidthDials />
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

// The shell's real actions: moving money, adding category groups and
// categories, entering transactions, and editing targets.
function ActionProviders({
  moveMoney,
  addCategory,
  transactionEntry,
  targetEditing,
  children,
}: {
  moveMoney: MoveMoney;
  addCategory: AddCategory;
  transactionEntry: TransactionEntry;
  targetEditing: TargetEditing;
  children: ReactNode;
}) {
  return (
    <MoveMoneyProvider value={moveMoney}>
      <AddCategoryProvider value={addCategory}>
        <TransactionEntryProvider value={transactionEntry}>
          <TargetEditingProvider value={targetEditing}>
            {children}
          </TargetEditingProvider>
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
  if (screen.type === "plan") return <h1 className="sr-only">Plan</h1>;

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
        {screen.type === "reflect"
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
          aria-controls="app-content"
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
