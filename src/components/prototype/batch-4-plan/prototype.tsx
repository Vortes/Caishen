"use client";

import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  ChevronDownIcon,
  LandmarkIcon,
  PanelLeftIcon,
  PanelRightIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  WalletCardsIcon,
  type LucideIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import Link from "next/link";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { Toast, ToastRegion } from "~/components/ui/toast";
import { TooltipProvider } from "~/components/ui/tooltip";
import {
  AddCategoryProvider,
  AddGroupButton,
  type AddCategory,
} from "../app-shell/add-category";
import { AssignMoneyProvider, type AssignMoney } from "../app-shell/assigned";
import { money, type Category } from "../app-shell/model";
import { MoveMoneyProvider, type MoveMoney } from "../app-shell/move-money";
import { findPalette, paletteVars } from "../app-shell/palettes";
import {
  PlanViews,
  type PlanView as PlanViewId,
} from "../app-shell/plan-views";
import { useSavedSettings, type Theme } from "../app-shell/settings";
import { ShellDataProvider } from "../app-shell/shell-data";
import { PlanView } from "../app-shell/views";
import shellStyles from "../app-shell/shell.module.css";
import {
  filterGroups,
  JumpSearch,
  NarrowSearch,
  type SearchBehavior,
} from "./category-search";
import type { IncomeEditing, IncomeOffer } from "./expected-income";
import {
  buildShellData,
  initialState,
  lastIncome,
  type PrototypeState,
} from "./fixture";
import { PlanInspector, type SnoozePlacement } from "./inspector";
import { MonthNav, type MonthPickerLayout } from "./month-picker";
import { SCENARIOS, type ScenarioId, type View } from "./scenarios";
import styles from "./batch-4.module.css";

export type Variants = {
  picker: MonthPickerLayout;
  search: SearchBehavior;
  snooze: SnoozePlacement;
  income: IncomeEditing;
  offer: IncomeOffer;
};

// The recommended choice of each pair leads.
const defaultVariants: Variants = {
  picker: "grid",
  search: "narrow",
  snooze: "switch",
  income: "edit",
  offer: "last",
};

const VARIANTS_KEY = "caishen.prototype.batch-4-plan.variants";

function readVariants(): Variants {
  try {
    const saved = localStorage.getItem(VARIANTS_KEY);
    return saved
      ? { ...defaultVariants, ...(JSON.parse(saved) as Partial<Variants>) }
      : defaultVariants;
  } catch {
    return defaultVariants;
  }
}

function saveVariants(variants: Variants) {
  try {
    localStorage.setItem(VARIANTS_KEY, JSON.stringify(variants));
  } catch {
    // A private window keeps the choice for this visit only.
  }
}

const holdOpen = () => () => undefined;

type Notice = { id: number; message: string };

const startingView = (scenario?: ScenarioId): View => {
  const base: View = {
    state: initialState,
    checked: [],
    planView: null,
    query: "",
  };
  const found = SCENARIOS.find((item) => item.id === scenario);
  return found ? { ...base, ...found.apply(base) } : base;
};

// The one selected category, brought into view.
const revealFor = (checked: string[]) =>
  checked.length === 1 ? { type: "category" as const, id: checked[0]! } : null;

const noSubscription = () => () => undefined;

// Drawn on the client only, like the shell, which mounts once its budget
// arrives: the layout and variants come from this browser's storage.
export function Batch4PlanPrototype({ scenario }: { scenario?: ScenarioId }) {
  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return mounted ? <PlanPrototype scenario={scenario} /> : null;
}

function PlanPrototype({ scenario }: { scenario?: ScenarioId }) {
  const saved = useSavedSettings();
  const [theme, setTheme] = useState<Theme | null>(null);
  const shownTheme = theme ?? saved.theme;
  const palette = shownTheme === "dark" ? findPalette(saved.palette) : null;
  const [variants, setVariants] = useState<Variants>(readVariants);
  const [view, setView] = useState<View>(() => startingView(scenario));
  // A reveal opens the category's group and focuses its row.
  const [reveal, setReveal] = useState<{ type: "category"; id: string } | null>(
    () => revealFor(view.checked),
  );
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);

  const { state, checked, planView, query } = view;
  const data = useMemo(() => buildShellData(state), [state]);
  const shown = useMemo(
    () =>
      variants.search === "narrow"
        ? { ...data, groups: filterGroups(data.groups, query) }
        : data,
    [data, query, variants.search],
  );

  const notify = useCallback(
    (message: string) => setNotice({ id: Date.now(), message }),
    [],
  );
  const unavailable = useCallback(
    (what: string) => notify(`${what} isn't part of this prototype.`),
    [notify],
  );
  const moveMoney = useMemo<MoveMoney>(
    () => ({
      move: () => {
        unavailable("Moving money");
        return null;
      },
      holdOpen,
    }),
    [unavailable],
  );
  const assignMoney = useMemo<AssignMoney>(
    () => ({
      assign: () => {
        unavailable("Assigning");
        return null;
      },
      alert: notify,
      holdOpen,
    }),
    [unavailable, notify],
  );
  const addCategory = useMemo<AddCategory>(
    () => ({
      add: () => {
        unavailable("Adding categories");
        return null;
      },
      reveal: () => undefined,
      holdOpen,
    }),
    [unavailable],
  );

  const setVariant = <K extends keyof Variants>(key: K, value: Variants[K]) => {
    const next = { ...variants, [key]: value };
    setVariants(next);
    saveVariants(next);
    if (key === "search") setView((current) => ({ ...current, query: "" }));
  };
  const setState = (change: (state: PrototypeState) => PrototypeState) =>
    setView((current) => ({ ...current, state: change(current.state) }));
  const goToMonth = (month: string) =>
    setState((current) => ({ ...current, month }));

  const snoozing = {
    placement: variants.snooze,
    isSnoozed: (category: Category, month: string) =>
      state.snoozed.has(`${category.id}:${month}`),
    setSnoozed: (category: Category, on: boolean) =>
      setState((current) => {
        const snoozed = new Set(current.snoozed);
        const key = `${category.id}:${current.month}`;
        if (on) snoozed.add(key);
        else snoozed.delete(key);
        return { ...current, snoozed };
      }),
  };
  const income = {
    editing: variants.income,
    offer: variants.offer,
    last: lastIncome(state.income, state.month),
    set: (amount: number | null) =>
      setState((current) => {
        const next = { ...current.income };
        if (amount === null) delete next[current.month];
        else next[current.month] = amount;
        return { ...current, income: next };
      }),
  };

  const selectOnly = (id: string) =>
    setView((current) => ({
      ...current,
      checked:
        current.checked.length === 1 && current.checked[0] === id ? [] : [id],
    }));
  const check = (ids: string[], value: boolean) =>
    setView((current) => ({
      ...current,
      checked: value
        ? [...new Set([...current.checked, ...ids])]
        : current.checked.filter((id) => !ids.includes(id)),
    }));
  const jumpTo = (category: Category) => {
    setInspectorOpen(true);
    setView((current) => ({
      ...current,
      // A view that hides it steps aside.
      planView: null,
      checked: [category.id],
    }));
    setReveal({ type: "category", id: category.id });
  };
  const reset = () => {
    setView(startingView());
    setReveal(null);
    setInspectorOpen(true);
    notify("Prototype reset to October 2026.");
  };
  const runScenario = (id: ScenarioId) => {
    const next = startingView(id);
    setView(next);
    setInspectorOpen(true);
    setReveal(revealFor(next.checked));
  };

  const searchEmpty =
    variants.search === "narrow" && query.trim() && !shown.groups.length;

  return (
    <div className={styles.stage}>
      <PrototypeBar
        variants={variants}
        onVariant={setVariant}
        theme={shownTheme}
        onTheme={setTheme}
        onScenario={runScenario}
        onReset={reset}
      />
      <ShellDataProvider value={shown}>
        <MoveMoneyProvider value={moveMoney}>
          <AssignMoneyProvider value={assignMoney}>
            <AddCategoryProvider value={addCategory}>
              <div
                ref={setRoot}
                className={`${shellStyles.root} ${styles.shellRoot}`}
                data-theme={shownTheme}
                data-palette={palette?.name}
                style={palette ? paletteVars(palette) : undefined}
              >
                <TooltipProvider container={root}>
                  <aside
                    className={shellStyles.sidebar}
                    style={{
                      width: saved.sidebar.collapsed ? 0 : saved.sidebar.width,
                    }}
                  >
                    <div
                      className={shellStyles.sidebarInner}
                      style={{ width: saved.sidebar.width }}
                    >
                      <StaticSidebar />
                    </div>
                  </aside>
                  <div className={shellStyles.main}>
                    <div className={shellStyles.panel}>
                      <header className={shellStyles.header}>
                        <div className={shellStyles.titleGroup}>
                          <h1 className={shellStyles.headerTitle}>Plan</h1>
                        </div>
                        <MonthNav
                          month={data.month}
                          layout={variants.picker}
                          onChange={goToMonth}
                        />
                      </header>
                      <div className={shellStyles.toolbar}>
                        <PlanViews
                          value={planView}
                          onChange={(next) =>
                            setView((current) => ({
                              ...current,
                              planView: next,
                            }))
                          }
                        />
                        <div className={shellStyles.toolbarActions}>
                          <AddGroupButton
                            open={false}
                            compact={false}
                            onOpenChange={() => unavailable("Adding groups")}
                          />
                          {variants.search === "narrow" ? (
                            <NarrowSearch
                              query={query}
                              onQueryChange={(next) =>
                                setView((current) => ({
                                  ...current,
                                  query: next,
                                  checked: [],
                                }))
                              }
                            />
                          ) : (
                            <JumpSearch
                              categories={data.categories}
                              onPick={jumpTo}
                            />
                          )}
                          <IconButton
                            label="Display options"
                            variant="secondary"
                            onClick={() => unavailable("Display options")}
                          >
                            <SlidersHorizontalIcon aria-hidden />
                          </IconButton>
                          <IconButton
                            label={
                              inspectorOpen ? "Hide details" : "Show details"
                            }
                            shortcut="]"
                            variant="secondary"
                            pressed={inspectorOpen}
                            onClick={() => setInspectorOpen((open) => !open)}
                          >
                            <PanelRightIcon aria-hidden />
                          </IconButton>
                        </div>
                      </div>
                      <div className={shellStyles.body}>
                        <main
                          id="prototype-content"
                          className={shellStyles.content}
                          tabIndex={-1}
                        >
                          {searchEmpty ? (
                            <NoMatches
                              query={query.trim()}
                              onClear={() =>
                                setView((current) => ({
                                  ...current,
                                  query: "",
                                }))
                              }
                            />
                          ) : (
                            <SearchAwarePlan
                              key={query ? "searching" : "all"}
                              planView={planView}
                              query={query}
                              checked={checked}
                              reveal={reveal}
                              onSelect={(id) => {
                                setInspectorOpen(true);
                                selectOnly(id);
                              }}
                              onCheck={check}
                              onShowAll={() =>
                                setView((current) => ({
                                  ...current,
                                  planView: null,
                                }))
                              }
                            />
                          )}
                        </main>
                        {inspectorOpen && (
                          <div className={shellStyles.inspectorSlot}>
                            <aside
                              className={shellStyles.inspector}
                              style={{ width: saved.inspector.width }}
                              aria-label="Details"
                            >
                              <div
                                className={shellStyles.inspectorInner}
                                style={{ width: saved.inspector.width }}
                              >
                                <PlanInspector
                                  checked={checked}
                                  snoozing={snoozing}
                                  income={income}
                                  onUnavailable={unavailable}
                                />
                              </div>
                            </aside>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <ToastRegion>
                    {notice && (
                      <Toast key={notice.id} onDismiss={() => setNotice(null)}>
                        {notice.message}
                      </Toast>
                    )}
                  </ToastRegion>
                </TooltipProvider>
              </div>
            </AddCategoryProvider>
          </AssignMoneyProvider>
        </MoveMoneyProvider>
      </ShellDataProvider>
    </div>
  );
}

// The plan, with a search-specific empty state when a view and a search
// leave nothing.
function SearchAwarePlan({
  planView,
  query,
  checked,
  reveal,
  onSelect,
  onCheck,
  onShowAll,
}: {
  planView: PlanViewId | null;
  query: string;
  checked: string[];
  reveal: { type: "category"; id: string } | null;
  onSelect: (id: string) => void;
  onCheck: (ids: string[], value: boolean) => void;
  onShowAll: () => void;
}) {
  const searching = query.trim().length > 0;
  return (
    <>
      {searching && (
        <p className={styles.searchStatus} role="status">
          Showing categories and groups matching &ldquo;{query.trim()}&rdquo;
          {planView && (
            <>
              {" "}
              in this view.{" "}
              <button
                type="button"
                className={styles.inlineLink}
                onClick={onShowAll}
              >
                Search every category
              </button>
            </>
          )}
        </p>
      )}
      <PlanView
        view={planView}
        onSelect={onSelect}
        checked={checked}
        onCheck={onCheck}
        reveal={reveal}
      />
    </>
  );
}

function NoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className={shellStyles.empty}>
      <div className={shellStyles.emptyBody}>
        <div>
          <strong>No categories match &ldquo;{query}&rdquo;.</strong>
          Search looks at category and group names.
        </div>
        <div>
          <Button size="sm" onClick={onClear}>
            Clear search
          </Button>
        </div>
      </div>
    </div>
  );
}

// The shell's sidebar, drawn without its live parts (banks, profile menu).
function StaticSidebar() {
  const groups: { label: string; items: [string, number][] }[] = [
    {
      label: "Cash",
      items: [
        ["Chase Total Checking", 2105514],
        ["Discover savings", 1257461],
      ],
    },
    {
      label: "Credit",
      items: [
        ["American Express", -169798],
        ["Discover It", -40078],
      ],
    },
    {
      label: "Loans",
      items: [
        ["Nelnet student loan", -2392325],
        ["SoFi personal loan", -625625],
      ],
    },
  ];
  return (
    <nav className={shellStyles.sidebarNav} aria-label="Budget navigation">
      <div className={shellStyles.sidebarHeader}>
        <span className={shellStyles.switcher}>
          <span className={shellStyles.avatar}>A</span>
          <span className={shellStyles.switcherName}>Alex&rsquo;s budget</span>
          <ChevronDownIcon size={12} aria-hidden />
        </span>
        <IconButton label="Hide sidebar" shortcut="[" disabled>
          <PanelLeftIcon aria-hidden />
        </IconButton>
      </div>
      <div className={shellStyles.sidebarScroll}>
        <ul className={shellStyles.navList}>
          <StaticNav icon={WalletCardsIcon} label="Plan" current />
          <StaticNav icon={ChartPieIcon} label="Reflect" />
          <StaticNav icon={ArrowLeftRightIcon} label="All accounts" />
          <StaticNav icon={ChartNoAxesCombinedIcon} label="Loans" />
        </ul>
        {groups.map((group) => (
          <section key={group.label} className={shellStyles.navSection}>
            <span className={shellStyles.sectionHeading}>{group.label}</span>
            <ul className={`${shellStyles.navList} ${shellStyles.nested}`}>
              {group.items.map(([label, value]) => (
                <StaticNav key={label} label={label} value={money(value)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className={shellStyles.sidebarFooter}>
        <span className={styles.staticBanks}>
          <LandmarkIcon size={14} aria-hidden />
          Banks
        </span>
      </div>
    </nav>
  );
}

function StaticNav({
  icon: Icon,
  label,
  value,
  current,
}: {
  icon?: LucideIcon;
  label: string;
  value?: string;
  current?: boolean;
}) {
  return (
    <li>
      <span
        className={shellStyles.navItem}
        aria-current={current ? "page" : undefined}
      >
        {Icon && <Icon size={14} className={shellStyles.navIcon} aria-hidden />}
        <span className={shellStyles.navLabel}>{label}</span>
        {value && <span className={shellStyles.navValue}>{value}</span>}
      </span>
    </li>
  );
}

// The prototype's own controls, above the shell: the variant of each
// choice, states to jump to, theme, and Reset.
function PrototypeBar({
  variants,
  onVariant,
  theme,
  onTheme,
  onScenario,
  onReset,
}: {
  variants: Variants;
  onVariant: <K extends keyof Variants>(key: K, value: Variants[K]) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onScenario: (id: ScenarioId) => void;
  onReset: () => void;
}) {
  const choices: {
    key: keyof Variants;
    label: string;
    options: [string, string][];
  }[] = [
    {
      key: "picker",
      label: "Month picker",
      options: [
        ["grid", "Year grid"],
        ["lists", "Two lists"],
      ],
    },
    {
      key: "search",
      label: "Search",
      options: [
        ["narrow", "Narrows"],
        ["jump", "Jumps"],
      ],
    },
    {
      key: "snooze",
      label: "Snooze",
      options: [
        ["switch", "Target tab"],
        ["menu", "⋯ menu"],
      ],
    },
    {
      key: "income",
      label: "Income",
      options: [
        ["edit", "Click to edit"],
        ["inline", "Always a field"],
      ],
    },
    {
      key: "offer",
      label: "Empty month",
      options: [
        ["last", "Offer last"],
        ["blank", "Blank"],
      ],
    },
  ];
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setBar} className={styles.bar} data-theme={theme}>
      <Link href="/prototype/batch-4-plan" className={styles.barTitle}>
        Batch 4 · Plan
      </Link>
      <div className={styles.barChoices}>
        {choices.map((choice) => (
          <div key={choice.key} className={styles.barChoice}>
            <span className={styles.barLabel}>{choice.label}</span>
            <SegmentedControl
              aria-label={`${choice.label} variant`}
              value={variants[choice.key]}
              onValueChange={(value) =>
                onVariant(choice.key, value as Variants[typeof choice.key])
              }
            >
              {choice.options.map(([value, label]) => (
                <SegmentedControlItem key={value} value={value}>
                  {label}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </div>
        ))}
      </div>
      <div className={styles.barActions}>
        <ScenarioMenu container={bar} onScenario={onScenario} />
        <SegmentedControl
          aria-label="Theme"
          value={theme}
          onValueChange={(value) => onTheme(value as Theme)}
        >
          <SegmentedControlItem value="dark">Dark</SegmentedControlItem>
          <SegmentedControlItem value="light">Light</SegmentedControlItem>
        </SegmentedControl>
        <Button size="sm" onClick={onReset}>
          <RotateCcwIcon aria-hidden />
          Reset
        </Button>
      </div>
    </div>
  );
}

function ScenarioMenu({
  container,
  onScenario,
}: {
  container: HTMLElement | null;
  onScenario: (id: ScenarioId) => void;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button size="sm">
          Jump to a state
          <ChevronDownIcon aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content
          className={`${shellStyles.menu} ${styles.barMenu}`}
          align="end"
          sideOffset={4}
        >
          {SCENARIOS.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              className={`${shellStyles.menuItem} ${styles.menuItemTall}`}
              onSelect={() => onScenario(item.id)}
            >
              <span className={styles.menuItemText}>
                <span>{item.label}</span>
                <span className={styles.snoozeHint}>{item.hint}</span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
