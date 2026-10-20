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
import { useCallback, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "~/components/shared/use-media-query";
import { accounts, month, transactions } from "./data";
import { BarDials } from "./bar-dials";
import { Inspector } from "./inspector";
import { TooltipLayer } from "./tooltip";
import { type RtaState } from "./ready-to-assign";
import { IconButton, Sidebar, type Screen } from "./sidebar";
import { usePanel, type PanelState } from "./use-panel";
import { LoansView, PlanView, RegisterView } from "./views";
import styles from "./shell.module.css";

const STORAGE_KEY = "caishen.prototype.app-shell.v1";

const SIDEBAR = { defaultWidth: 244, min: 200, max: 360 };
const INSPECTOR = { defaultWidth: 340, min: 288, max: 520 };

type Theme = "dark" | "light";
type Tint = "neutral" | "indigo";
type Density = "compact" | "comfortable";
type Indicator = "ring" | "bar";
type Settings = {
  sidebar: PanelState;
  inspector: PanelState;
  theme: Theme;
  tint: Tint;
  density: Density;
  indicator: Indicator;
  rtaState: RtaState;
};

const defaults: Settings = {
  sidebar: { width: SIDEBAR.defaultWidth, collapsed: false },
  inspector: { width: INSPECTOR.defaultWidth, collapsed: false },
  theme: "dark",
  tint: "neutral",
  density: "compact",
  indicator: "ring",
  rtaState: "positive",
};

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function AppShellPrototype() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  const attachRoot = useCallback((element: HTMLDivElement | null) => {
    rootRef.current = element;
    setRootElement(element);
  }, []);
  const [settings, setSettings] = useState<Settings>(defaults);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>({ type: "plan" });
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
  const [resetKey, setResetKey] = useState(0);
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
    if (saved) setSettings({ ...defaults, ...(JSON.parse(saved) as Settings) });
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
      if (event.key === "[") sidebar.toggle();
      else if (event.key === "]") inspector.toggle();
      else if (event.key === "Escape") {
        if (peekOpen) setPeek(false);
        else if (narrow && (drawer.sidebar || drawer.inspector)) {
          setDrawer({ sidebar: false, inspector: false });
        } else if (checked.length) setChecked([]);
        else setSelectedId(null);
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebar, inspector, narrow, drawer, peekOpen, checked.length]);

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
    setResetKey((value) => value + 1);
    setSettings(defaults);
    setScreen({ type: "plan" });
    setSelectedId(null);
    setChecked([]);
    setReviewOnly(false);
    setDrawer({ sidebar: false, inspector: false });
  };

  const account =
    screen.type === "register"
      ? accounts.find((item) => item.id === screen.accountId)
      : undefined;
  const reviewCount = transactions.filter(
    (item) => item.needsReview && (!account || item.accountId === account.id),
  ).length;

  return (
    <div
      ref={attachRoot}
      className={styles.root}
      data-theme={settings.theme}
      data-tint={settings.tint}
      data-density={settings.density}
      data-indicator={settings.indicator}
      data-ready={ready || undefined}
      data-narrow={narrow || undefined}
      data-dragging={sidebar.dragging || inspector.dragging || undefined}
      data-peekable={peekable || undefined}
    >
      <TooltipLayer container={rootElement}>
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
                    icon={PanelLeftIcon}
                    onClick={() => {
                      closePeek(0);
                      sidebar.toggle();
                    }}
                  />
                </div>
              </div>
              <HeaderTitle screen={screen} accountName={account?.name} />
            </header>

            <div className={styles.toolbar}>
              {screen.type === "register" && (
                <button
                  type="button"
                  className={`${styles.control} ${styles.filterChip}`}
                  aria-pressed={reviewOnly}
                  onClick={() => {
                    setReviewOnly((value) => !value);
                    setSelectedId(null);
                  }}
                >
                  <span className={styles.reviewDot} data-on />
                  To review
                  <span className={styles.numeric}>{reviewCount}</span>
                </button>
              )}
              <div className={styles.toolbarActions}>
                <IconButton
                  label="Filter"
                  shortcut="F"
                  icon={ListFilterIcon}
                  className={styles.control}
                />
                <IconButton
                  label="Display options"
                  icon={SlidersHorizontalIcon}
                  className={styles.control}
                />
                <IconButton
                  label={
                    inspectorState.collapsed ? "Show details" : "Hide details"
                  }
                  shortcut="]"
                  icon={PanelRightIcon}
                  pressed={!inspectorState.collapsed}
                  onClick={inspector.toggle}
                  className={styles.control}
                />
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
                    selectedId={selectedId}
                    onSelect={select}
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
                  />
                )}
                {screen.type === "loans" && (
                  <LoansView selectedId={selectedId} onSelect={select} />
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
                    <Inspector
                      screen={screen}
                      selectedId={selectedId}
                      checked={checked}
                      rtaState={settings.rtaState}
                    />
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </div>

        <BarDials
          target={rootRef}
          visible={settings.indicator === "bar"}
          resetKey={resetKey}
        />

        <div className={styles.controls} data-open={controlsOpen || undefined}>
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
                label="Ready to Assign"
                value={settings.rtaState}
                options={[
                  ["positive", "Positive"],
                  ["zero", "Zero"],
                  ["over", "Over"],
                ]}
                onChange={(rtaState) =>
                  setSettings((value) => ({ ...value, rtaState }))
                }
              />
              <Segmented
                label="Theme"
                value={settings.theme}
                options={[
                  ["dark", "Dark"],
                  ["light", "Light"],
                ]}
                onChange={(theme) => {
                  // Flip colors in one frame instead of letting each control
                  // run its own color transition.
                  const root = rootRef.current;
                  if (root) root.dataset.switching = "";
                  setSettings((value) => ({ ...value, theme }));
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                      if (root) delete root.dataset.switching;
                    }),
                  );
                }}
              />
              <Segmented
                label="Chrome tint"
                value={settings.tint}
                options={[
                  ["neutral", "Neutral"],
                  ["indigo", "Indigo"],
                ]}
                onChange={(tint) =>
                  setSettings((value) => ({ ...value, tint }))
                }
              />
              <Segmented
                label="Funding"
                value={settings.indicator}
                options={[
                  ["ring", "Ring"],
                  ["bar", "Bar"],
                ]}
                onChange={(indicator) =>
                  setSettings((value) => ({ ...value, indicator }))
                }
              />
              <Segmented
                label="Density"
                value={settings.density}
                options={[
                  ["compact", "Compact"],
                  ["comfortable", "Comfortable"],
                ]}
                onChange={(density) =>
                  setSettings((value) => ({ ...value, density }))
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
      </TooltipLayer>
    </div>
  );
}

function HeaderTitle({
  screen,
  accountName,
}: {
  screen: Screen;
  accountName?: string;
}) {
  if (screen.type === "plan") {
    return (
      <div className={styles.titleGroup}>
        <h1 className={styles.headerTitle}>Plan</h1>
        <div className={styles.monthNav}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Previous month"
          >
            <ChevronLeftIcon size={14} aria-hidden />
          </button>
          <button type="button" className={styles.monthButton}>
            {month.label}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Next month"
          >
            <ChevronRightIcon size={14} aria-hidden />
          </button>
        </div>
      </div>
    );
  }
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
        {screen.type === "loans" ? "Loans" : (accountName ?? "All accounts")}
      </h1>
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
