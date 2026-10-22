"use client";

import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  FolderIcon,
  ListFilterIcon,
  PanelLeftIcon,
  PanelRightIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  TargetIcon,
  WalletCardsIcon,
  ZapIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { IconButton } from "~/components/ui/icon-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Toast, ToastRegion } from "~/components/ui/toast";
import { TooltipProvider, usePortalContainer } from "~/components/ui/tooltip";
import { AddCategoryProvider } from "../app-shell/add-category";
import { AssignMoneyProvider } from "../app-shell/assigned";
import { Figure, Property } from "../app-shell/cards";
import { money, type Category, type ShellData } from "../app-shell/model";
import { MoveMoneyProvider } from "../app-shell/move-money";
import { PlanViews } from "../app-shell/plan-views";
import type { PlanView as PlanViewId } from "../app-shell/plan-view";
import { RtaCardLayout } from "../app-shell/ready-to-assign";
import { ShellDataProvider } from "../app-shell/shell-data";
import { FundingRing, PlanView } from "../app-shell/views";
import shell from "../app-shell/shell.module.css";
import {
  monthOnly,
  PARTNER,
  scenarios,
  shellData,
  type Scenario,
  type ScenarioKey,
} from "./data";
import { shortDate } from "./fields";
import { SharedCard, shareMenuItems, type ShareEditing } from "./share-card";
import { SharedTab } from "./shared-tab";
import {
  accountName,
  BLOCKED,
  net,
  ProtoProvider,
  sharedFor,
  splitLabel,
  type Actions,
  type Notice,
  useProto,
} from "./state";
import {
  choices,
  defaultVariants,
  type ChoiceKey,
  type Variants,
} from "./choices";
import styles from "./batch2.module.css";

const READY_TO_ASSIGN = 248650;

type Params = {
  scenario: ScenarioKey;
  select: string | null;
  open: string | null;
  tab: string;
  variants: Variants;
};

function readParams(): Params {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get("scenario");
  const variants = { ...defaultVariants };
  for (const key of Object.keys(choices) as ChoiceKey[]) {
    const value = params.get(key);
    if (
      value &&
      (choices[key].options as readonly (readonly string[])[]).some(
        ([option]) => option === value,
      )
    )
      (variants as Record<string, string>)[key] = value;
  }
  return {
    scenario:
      scenario && scenario in scenarios ? (scenario as ScenarioKey) : "owe",
    select: params.get("select"),
    open: params.get("open"),
    tab: params.get("tab") ?? "shared",
    variants,
  };
}

const clone = (scenario: Scenario): Scenario => structuredClone(scenario);

export function Batch2Prototype() {
  const [params, setParams] = useState<Params | null>(null);
  useEffect(() => setParams(readParams()), []);
  if (!params) return null;
  return <Harness initial={params} />;
}

function Harness({ initial }: { initial: Params }) {
  const [round, setRound] = useState(0);
  const [scenarioKey, setScenarioKey] = useState(initial.scenario);
  const [variants, setVariants] = useState(initial.variants);
  const [failing, setFailing] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [opened, setOpened] = useState({
    select: initial.select,
    open: initial.open,
    tab: initial.tab,
  });

  // Variants and the scenario live in the URL, so a link reopens the same
  // state.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("scenario", scenarioKey);
    for (const [key, value] of Object.entries(variants))
      url.searchParams.set(key, value);
    window.history.replaceState(null, "", url);
  }, [scenarioKey, variants]);

  const reset = () => {
    setOpened({ select: initial.select, open: initial.open, tab: initial.tab });
    setScenarioKey(initial.scenario);
    setFailing(false);
    setRound((value) => value + 1);
  };

  return (
    <>
      <ControlBar
        scenario={scenarioKey}
        onScenario={(key) => {
          setScenarioKey(key);
          setOpened({ select: null, open: null, tab: "shared" });
          setRound((value) => value + 1);
        }}
        variants={variants}
        onVariant={(key, value) =>
          setVariants((current) => ({ ...current, [key]: value }))
        }
        failing={failing}
        onFailing={setFailing}
        theme={theme}
        onTheme={setTheme}
        onReset={reset}
      />
      <Shell
        key={`${scenarioKey}-${round}`}
        scenarioKey={scenarioKey}
        variants={variants}
        failing={failing}
        theme={theme}
        opened={opened}
      />
    </>
  );
}

function Shell({
  scenarioKey,
  variants,
  failing,
  theme,
  opened,
}: {
  scenarioKey: ScenarioKey;
  variants: Variants;
  failing: boolean;
  theme: "dark" | "light";
  opened: { select: string | null; open: string | null; tab: string };
}) {
  const [scenario, setScenario] = useState(() => clone(scenarios[scenarioKey]));
  const [rta, setRta] = useState(READY_TO_ASSIGN);
  const [checked, setChecked] = useState<string[]>(
    opened.select ? [opened.select] : [],
  );
  const [planView, setPlanView] = useState<PlanViewId | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const noticeId = useRef(0);
  const data = useMemo(() => shellData(scenario, rta), [scenario, rta]);

  const notify = useCallback(
    (message: string, undo?: () => void, tone?: "attention") =>
      setNotice({ id: ++noticeId.current, message, undo, tone }),
    [],
  );

  // Applies a change at once, as the shell does, with Undo back to what
  // was there before.
  const apply = useCallback(
    (
      change: (draft: Scenario) => void,
      message: string,
      rtaChange = 0,
    ): string | null => {
      if (failing) return BLOCKED;
      const before = scenario;
      const beforeRta = rta;
      const next = clone(scenario);
      change(next);
      setScenario(next);
      setRta((value) => value + rtaChange);
      notify(message, () => {
        setScenario(before);
        setRta(beforeRta);
        notify("Action undone.");
      });
      return null;
    },
    [failing, notify, rta, scenario],
  );

  const nameOf = useCallback(
    (categoryId: string) =>
      data.categories.find((item) => item.id === categoryId)?.name ??
      categoryId,
    [data.categories],
  );

  const actions: Actions = {
    share: (categoryId, percent) =>
      apply(
        (draft) =>
          draft.shared.push({
            id: `shared-${categoryId}`,
            categoryId,
            yourPercent: percent,
            purchases: [],
            opening: [],
            history: false,
          }),
        `Shared ${nameOf(categoryId)} with ${PARTNER}, ${splitLabel(percent)}. It's in ${PARTNER}'s budget under Shared.`,
      ),
    setSplit: (categoryId, percent) =>
      apply(
        (draft) => {
          sharedFor(draft, categoryId)!.yourPercent = percent;
        },
        `${nameOf(categoryId)} now splits ${splitLabel(percent)} for new purchases.`,
      ),
    stopSharing: (categoryId) =>
      apply(
        (draft) => {
          draft.shared = draft.shared.filter(
            (item) => item.categoryId !== categoryId,
          );
        },
        `Stopped sharing ${nameOf(categoryId)}. You and ${PARTNER} each keep the category and its money.`,
      ),
    settle: (amount, accountId, date) => {
      const offset = scenario.owedToYou;
      return apply(
        (draft) => {
          draft.repayments.push({
            id: `r-you-${Date.now()}`,
            date,
            amount,
            from: "you",
          });
          draft.youOwe = draft.youOwe - draft.owedToYou - amount;
          draft.owedToYou = 0;
        },
        `Recorded ${money(amount)} to ${PARTNER} from ${accountName(accountId)}.${
          offset ? ` ${money(offset)} went back to Ready to Assign.` : ""
        }`,
        offset,
      );
    },
    receive: (repaymentId, accountId, date) => {
      const repayment = scenario.repayments.find(
        (item) => item.id === repaymentId,
      )!;
      return apply(
        (draft) => {
          const item = draft.repayments.find(
            (entry) => entry.id === repaymentId,
          )!;
          item.receivedOn = date;
          item.into = accountId;
        },
        `Confirmed ${money(repayment.amount)} from ${PARTNER} into ${accountName(accountId)}, ${shortDate(date)}. It's in Ready to Assign.`,
        repayment.amount,
      );
    },
    addOpening: (sharedId, youOwe, amount) =>
      apply(
        (draft) => {
          const shared = draft.shared.find((item) => item.id === sharedId)!;
          shared.opening.push({
            id: `o-${Date.now()}`,
            effect: youOwe ? amount : -amount,
          });
          if (youOwe) draft.youOwe += amount;
          else draft.owedToYou += amount;
        },
        `Added an opening amount: ${youOwe ? `you owe ${PARTNER}` : `${PARTNER} owes you`} ${money(amount)}.`,
      ),
    inviteHint: () =>
      notify(
        "Opens Settings › Partner, where you create a code for your partner. Batch 1 covers joining.",
      ),
  };

  const holdOpen = useCallback(() => () => undefined, []);
  const notInScope = useCallback(() => {
    notify("Moving and assigning money aren't part of this prototype.");
    return null;
  }, [notify]);

  return (
    <ShellDataProvider value={data}>
      <ProtoProvider
        value={{
          scenario,
          variants,
          actions,
          canRecord: scenario.month >= "2026-10",
          initialOpen: opened.open,
        }}
      >
        <MoveMoneyProvider value={{ move: notInScope, holdOpen }}>
          <AssignMoneyProvider
            value={{ assign: notInScope, alert: notify, holdOpen }}
          >
            <AddCategoryProvider
              value={{ add: notInScope, reveal: () => undefined, holdOpen }}
            >
              <div
                ref={setRoot}
                className={`${shell.root} ${styles.root}`}
                data-theme={theme}
                data-ready
              >
                <TooltipProvider container={root}>
                  <SidebarReplica data={data} />
                  <div className={shell.main}>
                    <div className={shell.panel}>
                      <header className={shell.header}>
                        <div className={shell.titleGroup}>
                          <h1 className={shell.headerTitle}>Plan</h1>
                        </div>
                        <div className={shell.monthNav}>
                          <IconButton label="Previous month">
                            <ChevronLeftIcon aria-hidden />
                          </IconButton>
                          <button type="button" className={shell.monthButton}>
                            {data.month.label}
                          </button>
                          <IconButton label="Next month">
                            <ChevronRightIcon aria-hidden />
                          </IconButton>
                        </div>
                      </header>
                      <div className={shell.toolbar}>
                        <PlanViews value={planView} onChange={setPlanView} />
                        <div className={shell.toolbarActions}>
                          <IconButton label="Filter" variant="secondary">
                            <ListFilterIcon aria-hidden />
                          </IconButton>
                          <IconButton
                            label="Display options"
                            variant="secondary"
                          >
                            <SlidersHorizontalIcon aria-hidden />
                          </IconButton>
                          <IconButton
                            label="Hide details"
                            variant="secondary"
                            pressed
                          >
                            <PanelRightIcon aria-hidden />
                          </IconButton>
                        </div>
                      </div>
                      <div className={shell.body}>
                        <main className={shell.content} tabIndex={-1}>
                          <PlanView
                            view={planView}
                            onSelect={(id) => setChecked([id])}
                            checked={checked}
                            onCheck={(ids, value) =>
                              setChecked((current) =>
                                value
                                  ? [...new Set([...current, ...ids])]
                                  : current.filter((id) => !ids.includes(id)),
                              )
                            }
                            reveal={null}
                          />
                        </main>
                        <div className={shell.inspectorSlot}>
                          <aside
                            className={`${shell.inspector} ${styles.inspector}`}
                            aria-label="Details"
                          >
                            <div className={shell.inspectorInner}>
                              <RtaCardLayout amount={data.readyToAssign} />
                              {checked.length === 1 &&
                              data.categories.some(
                                (item) => item.id === checked[0],
                              ) ? (
                                <CategoryInspector
                                  key={checked[0]}
                                  category={data.categories.find(
                                    (item) => item.id === checked[0],
                                  )!}
                                  initialEditing={
                                    opened.select === checked[0] &&
                                    (opened.open === "share" ||
                                      opened.open === "split")
                                      ? opened.open
                                      : null
                                  }
                                />
                              ) : (
                                <MonthInspector
                                  data={data}
                                  initialTab={opened.tab}
                                  onPick={(id) => setChecked([id])}
                                />
                              )}
                            </div>
                          </aside>
                        </div>
                      </div>
                    </div>
                  </div>
                  <ToastRegion>
                    {notice && (
                      <Toast
                        key={notice.id}
                        tone={notice.tone}
                        onDismiss={() => setNotice(null)}
                        action={
                          notice.undo && (
                            <Button
                              size="sm"
                              onClick={() => {
                                notice.undo?.();
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
            </AddCategoryProvider>
          </AssignMoneyProvider>
        </MoveMoneyProvider>
      </ProtoProvider>
    </ShellDataProvider>
  );
}

// The shell's sidebar, drawn statically: navigation isn't part of this
// prototype.
function SidebarReplica({ data }: { data: ShellData }) {
  const cash = data.accounts.filter((item) => item.kind === "cash");
  const credit = data.accounts.filter((item) => item.kind === "credit");
  const section = (label: string, items: typeof cash) => (
    <section className={shell.navSection}>
      <div className={shell.sectionHeading}>
        <span>{label}</span>
        <span className={shell.sectionTotal}>
          {money(items.reduce((sum, item) => sum + item.balance, 0))}
        </span>
      </div>
      <div className={shell.sectionBody} data-open>
        <div>
          <ul className={`${shell.navList} ${shell.nested}`}>
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" className={shell.navItem}>
                  <span className={shell.navLabel}>{item.name}</span>
                  <span className={shell.navValue}>{money(item.balance)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
  const nav = [
    { icon: WalletCardsIcon, label: "Plan", current: true },
    { icon: ChartPieIcon, label: "Reflect" },
    { icon: ArrowLeftRightIcon, label: "All accounts" },
    { icon: ChartNoAxesCombinedIcon, label: "Loans" },
  ];
  return (
    <aside className={shell.sidebar} style={{ width: 272 }}>
      <div className={shell.sidebarInner} style={{ width: 272 }}>
        <nav className={shell.sidebarNav} aria-label="Budget navigation">
          <div className={shell.sidebarHeader}>
            <button type="button" className={shell.switcher}>
              <span className={styles.avatar} aria-hidden>
                A
              </span>
              <span className={shell.switcherName}>{data.budgetName}</span>
            </button>
            <IconButton label="Hide sidebar">
              <PanelLeftIcon aria-hidden />
            </IconButton>
          </div>
          <div className={shell.sidebarScroll}>
            <ul className={shell.navList}>
              {nav.map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    className={shell.navItem}
                    aria-current={item.current ? "page" : undefined}
                  >
                    <item.icon
                      size={14}
                      className={shell.navIcon}
                      aria-hidden
                    />
                    <span className={shell.navLabel}>{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
            {section("Cash", cash)}
            {section("Credit", credit)}
          </div>
        </nav>
      </div>
    </aside>
  );
}

function MonthInspector({
  data,
  initialTab,
  onPick,
}: {
  data: ShellData;
  initialTab: string;
  onPick: (id: string) => void;
}) {
  const sum = (pick: (item: Category) => number) =>
    data.categories.reduce((total, item) => total + pick(item), 0);
  const tabs = ["auto-assign", "cost-to-be-me"];
  if (data.partner) tabs.push("shared");
  const [tab, setTab] = useState(
    tabs.includes(initialTab) ? initialTab : tabs[tabs.length - 1]!,
  );
  return (
    <>
      <Card>
        <Property label="Assigned">
          {money(sum((item) => item.assigned))}
        </Property>
        <Property label="Activity">
          {money(sum((item) => item.activity))}
        </Property>
        <Property label="Available">
          {money(sum((item) => item.available))}
        </Property>
      </Card>
      <Card>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Month details">
            <TabsTrigger value="auto-assign">Auto-Assign</TabsTrigger>
            <TabsTrigger value="cost-to-be-me">Cost to Be Me</TabsTrigger>
            {data.partner && <TabsTrigger value="shared">Shared</TabsTrigger>}
          </TabsList>
          <TabsContent value="auto-assign">
            <StaticAutoAssign />
          </TabsContent>
          <TabsContent value="cost-to-be-me">
            <div className={shell.tabBody}>
              <Figure
                value={money(data.costToBeMe)}
                caption={`What your targets ask for in ${data.month.short}`}
              />
            </div>
          </TabsContent>
          {data.partner && (
            <TabsContent value="shared">
              <SharedTab categories={data.categories} />
            </TabsContent>
          )}
        </Tabs>
      </Card>
      {!data.partner && (
        <p className={styles.aside}>
          No Shared tab without a partner, as in the shell today. Pick a
          category to see how sharing invites one.{" "}
          <button
            type="button"
            className={styles.inlineLink}
            onClick={() => onPick("rent")}
          >
            Open Rent
          </button>
        </p>
      )}
    </>
  );
}

function StaticAutoAssign() {
  const rows: [string, number][] = [
    ["Underfunded", 34169],
    ["Assigned last month", 536500],
    ["Spent last month", 266981],
    ["Average assigned", 536500],
  ];
  return (
    <ul className={shell.actionList}>
      {rows.map(([label, amount]) => (
        <li key={label}>
          <div className={shell.actionItem}>
            <ZapIcon size={13} aria-hidden />
            <span>{label}</span>
            <span className={shell.numeric}>{money(amount)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CategoryInspector({
  category,
  initialEditing,
}: {
  category: Category;
  initialEditing: ShareEditing;
}) {
  const { scenario, variants, actions } = useProto();
  const [editing, setEditing] = useState<ShareEditing>(initialEditing);
  const shared = Boolean(sharedFor(scenario, category.id));
  const items = shareMenuItems(category, variants, scenario.partner, shared);
  return (
    <>
      <Card>
        <div className={shell.cardTitle}>
          <div className={shell.cardTitleRow}>
            <FundingRing category={category} size={15} />
            <h2 className={shell.truncate}>{category.name}</h2>
            <CategoryMenu
              name={category.name}
              items={items.map((item) => ({
                label: item.label,
                onSelect: () =>
                  item.editing === "invite"
                    ? actions.inviteHint()
                    : setEditing(item.editing),
              }))}
            />
          </div>
          <p>{category.group}</p>
        </div>
        <Figure
          value={money(category.available)}
          caption={category.status}
          tone={category.funding}
        />
        <div className={shell.cardActions}>
          {category.available < 0 ? (
            <Button variant="primary">Cover overspending</Button>
          ) : (
            <Button>Move money</Button>
          )}
        </div>
      </Card>
      <Card>
        <Property label="Assigned">{money(category.assigned)}</Property>
        <Property label="Activity">{money(category.activity)}</Property>
        <Property label="Last month">{money(category.carryover)}</Property>
        <Property label="Group" icon={FolderIcon}>
          {category.group}
        </Property>
      </Card>
      <SharedCard category={category} editing={editing} onEdit={setEditing} />
      <Card>
        <Tabs defaultValue="target">
          <TabsList aria-label="Category details">
            <TabsTrigger value="target">Target</TabsTrigger>
            <TabsTrigger value="auto-assign">Auto-Assign</TabsTrigger>
          </TabsList>
          <TabsContent value="target">
            {category.assigned > 0 ? (
              <div className={shell.tabBody}>
                <Property label="Goal" icon={TargetIcon}>
                  Refill up to {money(category.assigned)} each month
                </Property>
                <Property label="Due">By the end of the month</Property>
              </div>
            ) : (
              <p className={shell.tabEmpty}>No target yet.</p>
            )}
          </TabsContent>
          <TabsContent value="auto-assign">
            <StaticAutoAssign />
          </TabsContent>
        </Tabs>
      </Card>
    </>
  );
}

// The card title's ⋯ menu. Inert in the shell today; here it carries the
// sharing items when the entry point is the menu.
function CategoryMenu({
  name,
  items,
}: {
  name: string;
  items: { label: string; onSelect: () => void }[];
}) {
  const container = usePortalContainer();
  if (!items.length)
    return (
      <IconButton label={`${name} actions`}>
        <EllipsisIcon aria-hidden />
      </IconButton>
    );
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <IconButton label={`${name} actions`}>
          <EllipsisIcon aria-hidden />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content
          className={shell.menu}
          align="end"
          sideOffset={4}
          collisionPadding={12}
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.label}
              className={shell.menuItem}
              onSelect={item.onSelect}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ControlBar({
  scenario,
  onScenario,
  variants,
  onVariant,
  failing,
  onFailing,
  theme,
  onTheme,
  onReset,
}: {
  scenario: ScenarioKey;
  onScenario: (key: ScenarioKey) => void;
  variants: Variants;
  onVariant: (key: ChoiceKey, value: string) => void;
  failing: boolean;
  onFailing: (value: boolean) => void;
  theme: "dark" | "light";
  onTheme: (theme: "dark" | "light") => void;
  onReset: () => void;
}) {
  const current = scenarios[scenario];
  const ref = useRef<HTMLDivElement>(null);
  // The shell starts below the bar, however many lines it wraps to.
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const observer = new ResizeObserver(() =>
      document.documentElement.style.setProperty(
        "--proto-bar",
        `${bar.offsetHeight}px`,
      ),
    );
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={styles.bar}
      role="region"
      aria-label="Prototype controls"
    >
      <div className={styles.barRow}>
        <Link href="/prototype/batch-2-shared" className={styles.barLink}>
          ‹ Batch 2 index
        </Link>
        <label className={styles.barField}>
          <span>Scenario</span>
          <select
            value={scenario}
            onChange={(event) => onScenario(event.target.value as ScenarioKey)}
          >
            {Object.values(scenarios).map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <span className={styles.barHint}>
          {current.hint} · net {money(Math.abs(net(current)))}
          {net(current) > 0
            ? " you owe"
            : net(current) < 0
              ? " owed to you"
              : ""}
          {current.month !== "2026-10" && ` · ${monthOnly(current.month)}`}
        </span>
        <span className={styles.barSpacer} />
        <label className={styles.barCheck}>
          <input
            type="checkbox"
            checked={failing}
            onChange={(event) => onFailing(event.target.checked)}
          />
          Saves fail
        </label>
        <div className={styles.barToggle} role="group" aria-label="Theme">
          {(["dark", "light"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={theme === value}
              onClick={() => onTheme(value)}
            >
              {value === "dark" ? "Dark" : "Light"}
            </button>
          ))}
        </div>
        <button type="button" className={styles.barReset} onClick={onReset}>
          <RotateCcwIcon size={13} aria-hidden />
          Reset
        </button>
      </div>
      <div className={styles.barRow}>
        {(Object.keys(choices) as ChoiceKey[]).map((key) => (
          <div
            key={key}
            className={styles.barChoice}
            role="group"
            aria-label={choices[key].variable}
          >
            <span>{choices[key].variable}</span>
            <div className={styles.barToggle}>
              {choices[key].options.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={variants[key] === value}
                  onClick={() => onVariant(key, value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
