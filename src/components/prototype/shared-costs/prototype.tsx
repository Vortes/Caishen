"use client";

import {
  ArrowLeftRightIcon,
  ChartPieIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LandmarkIcon,
  ListFilterIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PenLineIcon,
  PlusIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  UserPlusIcon,
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
import type { Command } from "~/domain/engine";
import {
  AddCategoryProvider,
  type AddCategory,
} from "../app-shell/add-category";
import { AssignMoneyProvider, type AssignMoney } from "../app-shell/assigned";
import { MoveMoneyProvider, type MoveMoney } from "../app-shell/move-money";
import { findPalette, paletteVars } from "../app-shell/palettes";
import {
  PlanViews,
  type PlanView as PlanViewId,
} from "../app-shell/plan-views";
import { useSavedSettings, type Theme } from "../app-shell/settings";
import { ShellDataProvider } from "../app-shell/shell-data";
import { PlanView } from "../app-shell/views";
import shell from "../app-shell/shell.module.css";
import {
  ACCOUNTS,
  buildBudget,
  ledger,
  money,
  PEOPLE,
  seedWorld,
  sum,
  TODAY,
  type Person,
  type World,
} from "./model";
import {
  entryNeedsReview,
  PartnerBalance,
  PartnerLedger,
  PartnerSetup,
  ReimbursementBalance,
  ReimbursementFilter,
  ReimbursementLedger,
} from "./ledger";
import { PlanInspector } from "./plan";
import {
  BankRegister,
  needsReview,
  RegisterPanel,
  registerRows,
} from "./register";
import { SCENARIOS, type Scenario } from "./scenarios";
import {
  defaultVariants,
  StoreProvider,
  useStore,
  type Screen,
  type Store,
  type Variants,
} from "./store";
import styles from "./shared-costs.module.css";

const VARIANTS_KEY = "caishen.prototype.shared-costs.variants";

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
const noSubscription = () => () => undefined;

type View = {
  world: World;
  viewer: Person;
  screen: Screen;
  openId: string | null;
  selectedId: string | null;
  adding: boolean;
  recording: boolean;
  reviewOnly: boolean;
  who: string;
  planView: PlanViewId | null;
};

function startingView(scenario?: Scenario): View {
  return {
    world: scenario?.world?.() ?? seedWorld(),
    viewer: scenario?.viewer ?? "alan",
    screen: scenario?.screen ?? { type: "plan" },
    openId: scenario?.openId ?? null,
    selectedId: scenario?.selectedId ?? null,
    adding: scenario?.adding ?? false,
    recording: false,
    reviewOnly: false,
    who: scenario?.who ?? "all",
    planView: null,
  };
}

// Drawn on the client only, like the shell: the layout and variants come
// from this browser's storage.
export function SharedCostsPrototype({ scenario }: { scenario?: string }) {
  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  return mounted ? (
    <Prototype scenario={SCENARIOS.find((item) => item.id === scenario)} />
  ) : null;
}

// The same account in the other budget, so switching whose budget is shown
// keeps the screen.
const mirrorAccount: Record<string, string> = {
  checking: "ally",
  amex: "sapphire",
  ally: "checking",
  sapphire: "amex",
};

function Prototype({ scenario }: { scenario?: Scenario }) {
  const saved = useSavedSettings();
  const [theme, setTheme] = useState<Theme | null>(null);
  const shownTheme = theme ?? saved.theme;
  const palette = shownTheme === "dark" ? findPalette(saved.palette) : null;
  const [variants, setVariants] = useState<Variants>(readVariants);
  const [view, setView] = useState<View>(() => startingView(scenario));
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(
    null,
  );
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const { world, viewer, screen } = view;
  const budget = useMemo(() => buildBudget(world, viewer), [world, viewer]);

  const notify = useCallback(
    (message: string) => setNotice({ id: Date.now(), message }),
    [],
  );
  const update = useCallback(
    (change: (world: World) => World, message?: string) => {
      setView((current) => ({ ...current, world: change(current.world) }));
      if (message) notify(message);
    },
    [notify],
  );
  const navigate = useCallback((next: Screen) => {
    setView((current) => ({
      ...current,
      screen: next,
      openId: null,
      adding: false,
      recording: false,
      reviewOnly: false,
    }));
  }, []);
  const store: Store = {
    world,
    viewer,
    budget,
    variants,
    screen,
    update,
    notify,
    navigate,
  };

  // The plan's assign and move work on the prototype's own numbers.
  const apply = useCallback(
    (command: Command, summary: string) => {
      const set = (assigned: Record<string, number>) => {
        if (command.type === "assign.set")
          return { ...assigned, [command.categoryId]: command.amount };
        if (command.type === "assign")
          return {
            ...assigned,
            [command.categoryId]:
              (assigned[command.categoryId] ?? 0) + command.amount,
          };
        if (command.type === "cover")
          return {
            ...assigned,
            [command.fromCategoryId]:
              (assigned[command.fromCategoryId] ?? 0) - command.amount,
            [command.toCategoryId]:
              (assigned[command.toCategoryId] ?? 0) + command.amount,
          };
        return assigned;
      };
      update(
        (current) => ({
          ...current,
          assigned: {
            ...current.assigned,
            [viewer]: set(current.assigned[viewer]),
          },
        }),
        summary,
      );
      return null;
    },
    [update, viewer],
  );
  const moveMoney = useMemo<MoveMoney>(
    () => ({ move: apply, holdOpen }),
    [apply],
  );
  const assignMoney = useMemo<AssignMoney>(
    () => ({ assign: apply, alert: notify, holdOpen }),
    [apply, notify],
  );
  const addCategory = useMemo<AddCategory>(
    () => ({
      add: () => {
        notify("Adding categories isn't part of this prototype.");
        return null;
      },
      reveal: () => undefined,
      holdOpen,
    }),
    [notify],
  );

  const setVariant = <K extends keyof Variants>(key: K, value: Variants[K]) => {
    const next = { ...variants, [key]: value };
    setVariants(next);
    saveVariants(next);
  };
  const runScenario = (next: Scenario) => {
    setView(startingView(next));
    setInspectorOpen(true);
  };
  const reset = () => {
    setView(startingView());
    setInspectorOpen(true);
    notify("Prototype reset: Alan's budget, October 2026.");
  };
  const switchViewer = (next: Person) => {
    if (next === viewer) return;
    setView((current) => ({
      ...current,
      viewer: next,
      openId: null,
      selectedId: null,
      adding: false,
      recording: false,
      who: "all",
      screen:
        current.screen.type === "register"
          ? current.screen.accountId && mirrorAccount[current.screen.accountId]
            ? {
                type: "register",
                accountId: mirrorAccount[current.screen.accountId]!,
              }
            : current.screen.accountId === null
              ? current.screen
              : { type: "plan" }
          : current.screen,
    }));
  };
  const set = (change: Partial<View>) =>
    setView((current) => ({ ...current, ...change }));

  const account =
    screen.type === "register"
      ? budget.shell.accounts.find((item) => item.id === screen.accountId)
      : undefined;
  const partnerName = PEOPLE[budget.partner].name;
  const panel =
    screen.type === "plan" ||
    (screen.type === "register" && variants.entry === "panel");
  const reviewCount =
    screen.type === "register"
      ? registerRows(world, viewer, screen.accountId).filter(needsReview).length
      : screen.type === "partner"
        ? ledger(world, viewer).filter((entry) =>
            entryNeedsReview(world, viewer, entry),
          ).length
        : 0;
  const section = variants.placement === "section" ? "Shared" : "Tracking";

  return (
    <div className={styles.stage}>
      <PrototypeBar
        variants={variants}
        onVariant={setVariant}
        viewer={viewer}
        partnered={world.partnered}
        onViewer={switchViewer}
        theme={shownTheme}
        onTheme={setTheme}
        onScenario={runScenario}
        world={world}
        onSimulate={update}
        onReset={reset}
      />
      <StoreProvider value={store}>
        <ShellDataProvider value={budget.shell}>
          <MoveMoneyProvider value={moveMoney}>
            <AssignMoneyProvider value={assignMoney}>
              <AddCategoryProvider value={addCategory}>
                <div
                  ref={setRoot}
                  className={`${shell.root} ${styles.shellRoot}`}
                  data-theme={shownTheme}
                  data-palette={palette?.name}
                  style={palette ? paletteVars(palette) : undefined}
                >
                  <TooltipProvider container={root}>
                    <aside
                      className={shell.sidebar}
                      style={{ width: saved.sidebar.width }}
                    >
                      <div
                        className={shell.sidebarInner}
                        style={{ width: saved.sidebar.width }}
                      >
                        <Sidebar screen={screen} onNavigate={navigate} />
                      </div>
                    </aside>
                    <div className={shell.main}>
                      <div className={shell.panel}>
                        <header className={shell.header}>
                          <div className={shell.titleGroup}>
                            {screen.type !== "plan" && (
                              <>
                                <span className={shell.crumb}>
                                  {screen.type === "register"
                                    ? "Accounts"
                                    : section}
                                </span>
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
                                : screen.type === "register"
                                  ? (account?.name ?? "All accounts")
                                  : screen.type === "partner"
                                    ? world.partnered
                                      ? partnerName
                                      : "Partner"
                                    : "Reimbursements"}
                            </h1>
                          </div>
                          {screen.type === "plan" ||
                          screen.type === "register" ? (
                            <div className={shell.monthNav}>
                              <IconButton
                                label="Previous month"
                                onClick={() =>
                                  notify("This prototype shows October 2026.")
                                }
                              >
                                <ChevronLeftIcon aria-hidden />
                              </IconButton>
                              <span className={shell.monthButton}>
                                October 2026
                              </span>
                              <IconButton
                                label="Next month"
                                onClick={() =>
                                  notify("This prototype shows October 2026.")
                                }
                              >
                                <ChevronRightIcon aria-hidden />
                              </IconButton>
                            </div>
                          ) : (
                            <span className={styles.allMonths}>
                              Running total, every month
                            </span>
                          )}
                        </header>
                        {screen.type === "register" && (
                          <AccountStrip accountId={screen.accountId} />
                        )}
                        {screen.type === "partner" && world.partnered && (
                          <PartnerBalance />
                        )}
                        {screen.type === "reimbursements" && (
                          <ReimbursementBalance who={view.who} />
                        )}
                        {!(screen.type === "partner" && !world.partnered) && (
                          <div
                            className={shell.toolbar}
                            data-wrap={screen.type !== "plan" || undefined}
                          >
                            {screen.type === "reimbursements" && (
                              <ReimbursementFilter
                                who={view.who}
                                onWho={(who) => set({ who, openId: null })}
                              />
                            )}
                            {screen.type === "plan" && (
                              <PlanViews
                                value={view.planView}
                                onChange={(planView) => set({ planView })}
                              />
                            )}
                            {(screen.type === "register" ||
                              screen.type === "partner") && (
                              <Button
                                size="sm"
                                aria-pressed={view.reviewOnly}
                                onClick={() =>
                                  set({
                                    reviewOnly: !view.reviewOnly,
                                    openId: null,
                                  })
                                }
                              >
                                <span
                                  className={shell.reviewDot}
                                  data-on
                                  data-inline
                                />
                                To review
                                <span className={shell.numeric}>
                                  {reviewCount}
                                </span>
                              </Button>
                            )}
                            {screen.type === "register" && (
                              <Button
                                size="sm"
                                disabled={view.adding}
                                onClick={() =>
                                  set({ adding: true, openId: null })
                                }
                              >
                                <PlusIcon aria-hidden />
                                Add transaction
                              </Button>
                            )}
                            {screen.type === "partner" && (
                              <Button
                                size="sm"
                                disabled={view.recording}
                                onClick={() =>
                                  set({ recording: true, openId: null })
                                }
                              >
                                <PenLineIcon aria-hidden />
                                Record a shared cost
                              </Button>
                            )}
                            <div className={shell.toolbarActions}>
                              <IconButton
                                label="Filter"
                                shortcut="F"
                                variant="secondary"
                                onClick={() =>
                                  notify(
                                    "Filters aren't part of this prototype.",
                                  )
                                }
                              >
                                <ListFilterIcon aria-hidden />
                              </IconButton>
                              <IconButton
                                label="Display options"
                                variant="secondary"
                                onClick={() =>
                                  notify(
                                    "Display options aren't part of this prototype.",
                                  )
                                }
                              >
                                <SlidersHorizontalIcon aria-hidden />
                              </IconButton>
                              {panel && (
                                <IconButton
                                  label={
                                    inspectorOpen
                                      ? "Hide details"
                                      : "Show details"
                                  }
                                  shortcut="]"
                                  variant="secondary"
                                  pressed={inspectorOpen}
                                  onClick={() =>
                                    setInspectorOpen((open) => !open)
                                  }
                                >
                                  <PanelRightIcon aria-hidden />
                                </IconButton>
                              )}
                            </div>
                          </div>
                        )}
                        <div className={shell.body}>
                          <main
                            id="prototype-content"
                            className={shell.content}
                            tabIndex={-1}
                          >
                            {screen.type === "plan" && (
                              <PlanView
                                view={view.planView}
                                onSelect={(id) => {
                                  setInspectorOpen(true);
                                  set({
                                    selectedId:
                                      view.selectedId === id ? null : id,
                                  });
                                }}
                                checked={
                                  view.selectedId ? [view.selectedId] : []
                                }
                                onCheck={(ids, value) =>
                                  set({
                                    selectedId: value
                                      ? (ids.at(-1) ?? null)
                                      : null,
                                  })
                                }
                                reveal={
                                  view.selectedId
                                    ? { type: "category", id: view.selectedId }
                                    : null
                                }
                              />
                            )}
                            {screen.type === "register" && (
                              <BankRegister
                                key={`${viewer}-${screen.accountId}`}
                                accountId={screen.accountId}
                                openId={view.openId}
                                onOpen={(openId) => {
                                  setInspectorOpen(true);
                                  set({ openId, adding: false });
                                }}
                                adding={view.adding && variants.entry === "row"}
                                onAdding={(adding) => set({ adding })}
                                reviewOnly={view.reviewOnly}
                              />
                            )}
                            {screen.type === "partner" &&
                              (world.partnered ? (
                                <PartnerLedger
                                  key={viewer}
                                  openId={view.openId}
                                  onOpen={(openId) =>
                                    set({ openId, recording: false })
                                  }
                                  recording={view.recording}
                                  onRecording={(recording) =>
                                    set({ recording })
                                  }
                                  reviewOnly={view.reviewOnly}
                                />
                              ) : (
                                <PartnerSetup />
                              ))}
                            {screen.type === "reimbursements" && (
                              <ReimbursementLedger
                                key={viewer}
                                who={view.who}
                                openId={view.openId}
                                onOpen={(openId) => set({ openId })}
                              />
                            )}
                          </main>
                          {panel && inspectorOpen && (
                            <div className={shell.inspectorSlot}>
                              <aside
                                className={shell.inspector}
                                style={{ width: 360 }}
                                aria-label="Details"
                              >
                                <div
                                  className={shell.inspectorInner}
                                  style={{ width: 360 }}
                                >
                                  {screen.type === "plan" ? (
                                    <PlanInspector
                                      selectedId={view.selectedId}
                                    />
                                  ) : (
                                    screen.type === "register" && (
                                      <RegisterPanel
                                        key={`${view.openId}-${view.adding}`}
                                        openId={view.openId}
                                        adding={view.adding}
                                        accountId={screen.accountId}
                                        onClose={() =>
                                          set({ openId: null, adding: false })
                                        }
                                      />
                                    )
                                  )}
                                </div>
                              </aside>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <ToastRegion>
                      {notice && (
                        <Toast
                          key={notice.id}
                          onDismiss={() => setNotice(null)}
                        >
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
      </StoreProvider>
    </div>
  );
}

// YNAB's balance equation for the account on screen.
function AccountStrip({ accountId }: { accountId: string | null }) {
  const { budget } = useStore();
  const accounts = budget.shell.accounts.filter(
    (item) =>
      item.kind !== "tracking" && (accountId === null || item.id === accountId),
  );
  const working = sum(accounts.map((item) => item.balance));
  const uncleared = sum(accounts.map((item) => item.pending));
  return (
    <div className={shell.accountSummary}>
      <dl className={shell.balances}>
        <div>
          <dt>Cleared</dt>
          <dd>{money(working - uncleared)}</dd>
        </div>
        <span className={shell.balanceOperator} aria-hidden>
          +
        </span>
        <div>
          <dt>Uncleared</dt>
          <dd>{money(uncleared)}</dd>
        </div>
        <span className={shell.balanceOperator} aria-hidden>
          =
        </span>
        <div data-total>
          <dt>Working balance</dt>
          <dd>{money(working)}</dd>
        </div>
      </dl>
    </div>
  );
}

// The shell's sidebar, with the two counterparty accounts placed by the
// variant.
function Sidebar({
  screen,
  onNavigate,
}: {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
}) {
  const { world, viewer, budget, variants, notify } = useStore();
  const [closed, setClosed] = useState<string[]>([]);
  const toggle = (id: string) =>
    setClosed((values) =>
      values.includes(id) ? values.filter((v) => v !== id) : [...values, id],
    );
  const reviewIn = (accountId: string) =>
    registerRows(world, viewer, accountId).some(needsReview);
  const accountItem = (id: string, name: string, balance: number) => ({
    id,
    label: name,
    value: balance,
    review: reviewIn(id),
    current: screen.type === "register" && screen.accountId === id,
    go: () => onNavigate({ type: "register", accountId: id }),
  });
  const partnerReview = ledger(world, viewer).some((entry) =>
    entryNeedsReview(world, viewer, entry),
  );
  const shared = [
    world.partnered
      ? {
          id: "partner",
          label: PEOPLE[budget.partner].name,
          value: budget.partnerBalance,
          review: partnerReview,
          current: screen.type === "partner",
          go: () => onNavigate({ type: "partner" }),
        }
      : {
          id: "partner",
          label: "Add partner",
          icon: UserPlusIcon,
          review: false,
          current: screen.type === "partner",
          go: () => onNavigate({ type: "partner" }),
        },
    {
      id: "reimbursements",
      label: "Reimbursements",
      value: budget.reimbursementBalance,
      review: world.reimbursements.some(
        (item) => item.owner === viewer && !item.confirmed,
      ),
      current: screen.type === "reimbursements",
      go: () => onNavigate({ type: "reimbursements" }),
    },
  ];
  const of = (kind: "cash" | "credit" | "tracking") =>
    ACCOUNTS[viewer]
      .filter((item) => item.kind === kind)
      .map((item) =>
        accountItem(item.id, item.name, budget.balances[item.id]!),
      );
  const tracking = of("tracking");
  const sections: {
    id: string;
    label: string;
    items: (ReturnType<typeof accountItem> & { icon?: LucideIcon })[];
    note?: string;
  }[] = [
    { id: "cash", label: "Cash", items: of("cash") },
    { id: "credit", label: "Credit", items: of("credit") },
    ...(variants.placement === "section"
      ? [
          { id: "shared", label: "Shared", items: shared as never[] },
          ...(tracking.length
            ? [{ id: "tracking", label: "Tracking", items: tracking }]
            : []),
        ]
      : [
          {
            id: "tracking",
            label: "Tracking",
            items: [...(shared as never[]), ...tracking],
          },
        ]),
  ];
  const totalReview = [
    ...ACCOUNTS[viewer].map((item) => reviewIn(item.id)),
    partnerReview,
  ].some(Boolean);
  return (
    <nav className={shell.sidebarNav} aria-label="Budget navigation">
      <div className={shell.sidebarHeader}>
        <span className={shell.switcher}>
          <span className={shell.avatar} data-size="badge">
            {PEOPLE[viewer].name[0]}
          </span>
          <span className={shell.switcherName}>{budget.shell.budgetName}</span>
          <ChevronDownIcon size={12} aria-hidden />
        </span>
        <IconButton
          label="Hide sidebar"
          shortcut="["
          onClick={() => notify("The sidebar stays open in this prototype.")}
        >
          <PanelLeftIcon aria-hidden />
        </IconButton>
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
            icon={ChartPieIcon}
            label="Reflect"
            current={false}
            onClick={() => notify("Reflect isn't part of this prototype.")}
          />
          <NavItem
            icon={ArrowLeftRightIcon}
            label="All accounts"
            review={totalReview}
            current={screen.type === "register" && screen.accountId === null}
            onClick={() => onNavigate({ type: "register", accountId: null })}
          />
        </ul>
        {sections.map((section) => {
          const open = !closed.includes(section.id);
          const total = sum(
            section.items.map((item) => ("value" in item ? item.value : 0)),
          );
          return (
            <section key={section.id} className={shell.navSection}>
              <button
                type="button"
                className={shell.sectionHeading}
                aria-expanded={open}
                onClick={() => toggle(section.id)}
              >
                <span>{section.label}</span>
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  className={shell.sectionCaret}
                  aria-hidden
                >
                  <path d="M1.5 2.5h5L4 5.5z" fill="currentColor" />
                </svg>
                <span className={shell.sectionTotal}>{money(total)}</span>
              </button>
              <div
                className={shell.sectionBody}
                data-open={open}
                inert={!open}
                aria-hidden={!open || undefined}
              >
                <div>
                  <ul className={`${shell.navList} ${shell.nested}`}>
                    {section.items.map((item) => (
                      <NavItem
                        key={item.id}
                        icon={item.icon}
                        label={item.label}
                        value={
                          "value" in item && item.value !== undefined
                            ? money(item.value)
                            : undefined
                        }
                        review={item.review}
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
      <div className={shell.sidebarFooter}>
        <span className={styles.staticBanks}>
          <LandmarkIcon size={14} aria-hidden />
          Banks
        </span>
      </div>
    </nav>
  );
}

function NavItem({
  icon: Icon,
  label,
  value,
  current,
  review,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  value?: string;
  current: boolean;
  review?: boolean;
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
        {review && (
          <span
            className={shell.reviewDot}
            data-on
            data-inline
            role="img"
            aria-label="Entries to review"
          />
        )}
      </button>
    </li>
  );
}

// ---------- The prototype's own controls ----------

const choices: {
  key: keyof Variants;
  label: string;
  options: [string, string][];
}[] = [
  {
    key: "entry",
    label: "Share entry",
    options: [
      ["row", "In the row"],
      ["panel", "Details panel"],
    ],
  },
  {
    key: "input",
    label: "Share input",
    options: [
      ["presets", "Presets"],
      ["amount", "Amount"],
    ],
  },
  {
    key: "balance",
    label: "Balance",
    options: [
      ["sentence", "Sentence"],
      ["signed", "Signed"],
    ],
  },
  {
    key: "placement",
    label: "Sidebar",
    options: [
      ["section", "Own section"],
      ["tracking", "In Tracking"],
    ],
  },
];

type Simulation = {
  label: string;
  done: (world: World) => boolean;
  run: (world: World) => World;
  message: string;
};

const simulations: Simulation[] = [
  {
    label: "Anna pays $350.00 by Zelle",
    done: (world) => world.transfers.some((item) => item.id === "s-sim"),
    run: (world) => ({
      ...world,
      transfers: [
        ...world.transfers,
        {
          id: "s-sim",
          date: TODAY,
          from: "anna",
          to: "alan",
          amount: 35000,
          payee: { alan: "Zelle from Anna Li", anna: "Zelle to Alan Wu" },
          accountId: { alan: "checking", anna: "ally" },
          confirmed: false,
        },
      ],
    }),
    message:
      "Both banks imported Anna's $350.00 Zelle. It's recognized as a transfer on both sides, waiting for one confirmation.",
  },
  {
    label: "Acme Corp reimburses $412.18",
    done: (world) => world.reimbursements.some((item) => item.id === "r-acme"),
    run: (world) => ({
      ...world,
      reimbursements: [
        ...world.reimbursements,
        {
          id: "r-acme",
          owner: "alan",
          date: TODAY,
          who: "Acme Corp",
          amount: 41218,
          payee: "ACME CORP EXP REIMB",
          accountId: "checking",
          confirmed: false,
        },
      ],
    }),
    message:
      "Acme Corp's $412.18 arrived in Alan's Chase Checking, recognized as a transfer from Reimbursements.",
  },
  {
    label: "Anna's PG&E import arrives",
    done: (world) =>
      world.txns.some((item) => item.id === "t-pge" && item.imported),
    run: (world) => ({
      ...world,
      txns: world.txns.map((item) =>
        item.id === "t-pge"
          ? {
              ...item,
              accountId: "ally",
              imported: true,
              reviewed: false,
              prefill: "memory" as const,
              lines: item.lines.map((line) => ({
                ...line,
                categoryId: "a-utilities",
              })),
            }
          : item,
      ),
    }),
    message:
      "Anna's PG&E import matched the entry Alan recorded. The balance didn't move; it was right already.",
  },
];

function PrototypeBar({
  variants,
  onVariant,
  viewer,
  partnered,
  onViewer,
  theme,
  onTheme,
  onScenario,
  world,
  onSimulate,
  onReset,
}: {
  variants: Variants;
  onVariant: <K extends keyof Variants>(key: K, value: Variants[K]) => void;
  viewer: Person;
  partnered: boolean;
  onViewer: (viewer: Person) => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onScenario: (scenario: Scenario) => void;
  world: World;
  onSimulate: (change: (world: World) => World, message?: string) => void;
  onReset: () => void;
}) {
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setBar} className={styles.bar} data-theme={theme}>
      <Link href="/prototype/shared-costs" className={styles.barTitle}>
        Shared costs
      </Link>
      <div className={styles.barChoice}>
        <span className={styles.barLabel}>Viewing as</span>
        <SegmentedControl
          aria-label="Viewing as"
          value={viewer}
          onValueChange={(value) => onViewer(value as Person)}
        >
          <SegmentedControlItem value="alan">Alan</SegmentedControlItem>
          <SegmentedControlItem value="anna" disabled={!partnered}>
            Anna
          </SegmentedControlItem>
        </SegmentedControl>
      </div>
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
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <Button size="sm" disabled={!partnered}>
              Simulate
              <ChevronDownIcon aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal container={bar}>
            <DropdownMenu.Content
              className={`${shell.menu} ${styles.barMenu}`}
              align="end"
              sideOffset={4}
            >
              {simulations.map((item) => (
                <DropdownMenu.Item
                  key={item.label}
                  className={shell.menuItem}
                  disabled={item.done(world)}
                  onSelect={() => onSimulate(item.run, item.message)}
                >
                  {item.label}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <Button size="sm">
              Jump to a state
              <ChevronDownIcon aria-hidden />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal container={bar}>
            <DropdownMenu.Content
              className={`${shell.menu} ${styles.barMenu} ${styles.scenarioMenu}`}
              align="end"
              sideOffset={4}
            >
              {SCENARIOS.map((item) => (
                <DropdownMenu.Item
                  key={item.id}
                  className={`${shell.menuItem} ${styles.menuItemTall}`}
                  onSelect={() => onScenario(item)}
                >
                  <span className={styles.menuItemText}>
                    <span>{item.label}</span>
                    <span className={styles.menuHint}>
                      {PEOPLE[item.viewer].name} · {item.hint}
                    </span>
                  </span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
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
