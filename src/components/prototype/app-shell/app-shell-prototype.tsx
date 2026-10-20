"use client";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ListFilterIcon,
  PanelLeftIcon,
  PanelRightIcon,
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
import { Inspector } from "./inspector";
import { findPalette, PalettePicker, paletteVars } from "./palette-picker";
import type { ShellData } from "./model";
import { MoveMoneyProvider, type MoveMoney } from "./move-money";
import { PlanViews, type PlanView as PlanViewId } from "./plan-views";
import { ShellDataProvider } from "./shell-data";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { IconButton } from "~/components/ui/icon-button";
import { Tooltip, TooltipProvider } from "~/components/ui/tooltip";
import { Sidebar, type Screen } from "./sidebar";
import { usePanel, type PanelState } from "./use-panel";
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
import styles from "./shell.module.css";

// v2: the layout variants were settled, so earlier saved settings no longer
// apply.
const STORAGE_KEY = "caishen.prototype.app-shell.v2";

const SIDEBAR = { defaultWidth: 320, min: 200, max: 360 };
const INSPECTOR = { defaultWidth: 520, min: 288, max: 520 };

type Theme = "dark" | "light";
type Settings = {
  sidebar: PanelState;
  inspector: PanelState;
  theme: Theme;
  // A Monkeytype palette name, applied over the dark theme; null keeps the
  // shell's own colors.
  palette: string | null;
  // The plan's focused view; like YNAB, remembered on this device.
  planView: PlanViewId | null;
};

const defaults: Settings = {
  sidebar: { width: SIDEBAR.defaultWidth, collapsed: false },
  inspector: { width: INSPECTOR.defaultWidth, collapsed: false },
  theme: "dark",
  palette: null,
  planView: null,
};

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
  notifications,
}: {
  data: ShellData;
  loadingMonth: boolean;
  onMonthChange: (month: string) => void;
  moveMoney: MoveMoney;
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
  const [settings, setSettings] = useState<Settings>(defaults);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>({ type: "plan" });
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const check = (ids: string[], value: boolean) =>
    setChecked((current) =>
      value
        ? [...new Set([...current, ...ids])]
        : current.filter((id) => !ids.includes(id)),
    );
  const [reviewOnly, setReviewOnly] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(true);
  // Below this width both panels float over the content instead of
  // taking space from it, and start closed.
  const narrow = useMediaQuery("(max-width: 860px)");
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

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved)
      setSettings({ ...defaults, ...(JSON.parse(saved) as Partial<Settings>) });
    // Enable transitions only after restoring, so a saved collapsed state
    // doesn't animate on load.
    requestAnimationFrame(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings, ready]);

  const sidebarState = narrow
    ? { ...settings.sidebar, collapsed: !drawer.sidebar }
    : settings.sidebar;
  const inspectorState = narrow
    ? { ...settings.inspector, collapsed: !drawer.inspector }
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
      else if (event.key === "]") inspector.toggle();
      else if (event.key === "Escape") {
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
    screen.type,
    path,
  ]);

  const navigate = (next: Screen, id?: string) => {
    setScreen(next);
    setSelectedId(id ?? null);
    setChecked([]);
    setReviewOnly(false);
    if (narrow) setDrawer({ sidebar: false, inspector: Boolean(id) });
    closePeek(0);
  };

  const select = (id: string) => setSelectedId(id);

  const reset = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSettings(defaults);
    setScreen({ type: "plan" });
    setSelectedId(null);
    setChecked([]);
    setReviewOnly(false);
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

  return (
    <ShellDataProvider value={data}>
      <MoveMoneyProvider value={moveMoney}>
        <div
          ref={attachRoot}
          className={styles.root}
          data-theme={settings.theme}
          data-palette={palette?.name}
          style={palette ? paletteVars(palette) : undefined}
          data-ready={ready || undefined}
          data-narrow={narrow || undefined}
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

            {narrow && (drawer.sidebar || drawer.inspector) && (
              <div
                className={styles.scrim}
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

                <div className={styles.toolbar}>
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
                  <div className={styles.toolbarActions}>
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
                        // Like YNAB, clicking a row selects just that row: its
                        // checkbox ticks and any others clear. Clicking a
                        // selected row deselects it. Checkboxes add to or
                        // remove from the selection.
                        onSelect={(id) => {
                          if (checked.includes(id)) {
                            setChecked(checked.filter((item) => item !== id));
                            setSelectedId(null);
                          } else {
                            setSelectedId(id);
                            setChecked([id]);
                          }
                        }}
                        checked={checked}
                        onCheck={check}
                      />
                    )}
                    {screen.type === "register" && (
                      <RegisterView
                        accountId={screen.accountId}
                        reviewOnly={reviewOnly}
                        selectedId={selectedId}
                        onSelect={select}
                        checked={checked}
                        onCheck={check}
                      />
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
                    {inspectorState.collapsed
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
      </MoveMoneyProvider>
    </ShellDataProvider>
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
