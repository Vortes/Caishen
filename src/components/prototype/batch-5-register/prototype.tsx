"use client";

import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ListFilterIcon,
  PanelLeftIcon,
  PlusIcon,
  RotateCcwIcon,
  SlidersHorizontalIcon,
  WalletCardsIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useMediaQuery } from "~/components/shared/use-media-query";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { Toast, ToastRegion } from "~/components/ui/toast";
import { TooltipProvider } from "~/components/ui/tooltip";
import { SearchField } from "~/components/prototype/app-shell/account";
import { Caret } from "~/components/prototype/app-shell/sidebar";
import shell from "~/components/prototype/app-shell/shell.module.css";
import { accounts, money, type AccountId } from "./data";
import { RegisterView, emptyUi, type RegisterUi } from "./register";
import {
  BookProvider,
  defaultVariants,
  useBookState,
  type Variants,
} from "./state";
import styles from "./batch-5.module.css";

// Where a link from the index page starts: the account, the selection, and
// which variant is showing.
function fromUrl() {
  const params = new URLSearchParams(window.location.search);
  const account = params.get("account");
  const accountId = accounts.some((item) => item.id === account)
    ? (account as AccountId)
    : null;
  const select = params.get("select");
  const edit = params.get("edit");
  const variants = { ...defaultVariants };
  for (const key of Object.keys(variants) as (keyof Variants)[]) {
    const value = params.get(key);
    if (value) (variants as Record<string, string>)[key] = value;
  }
  const ui: RegisterUi = edit
    ? {
        checked: [edit],
        selectedId: edit,
        editing: {
          id: edit,
          history: params.get("panel") === "history",
        },
      }
    : select
      ? {
          checked: select.split(","),
          selectedId: select.split(",")[0]!,
          editing: null,
        }
      : emptyUi;
  return {
    accountId,
    ui,
    variants,
    reviewOnly: params.get("review") === "1",
  };
}

const subscribeNever = () => () => undefined;

// Starts from the address, so it renders on the client only.
export function Batch5Prototype() {
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  return hydrated ? <Prototype /> : null;
}

function Prototype() {
  const [start] = useState(fromUrl);
  const state = useBookState();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [variants, setVariants] = useState<Variants>(start.variants);
  const [accountId, setAccountId] = useState<AccountId | null>(start.accountId);
  const [ui, setUiState] = useState<RegisterUi>(start.ui);
  const [reviewOnly, setReviewOnly] = useState(start.reviewOnly);
  const [query, setQuery] = useState("");
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  // The real shell turns both panels into drawers here; the prototype just
  // hides them so the register can be judged at phone width.
  const narrow = useMediaQuery("(max-width: 860px)");
  const sidebarWidth = narrow ? 0 : 280;
  const [controlsOpen, setControlsOpen] = useState(!narrow);
  const setUi = useCallback(
    (update: (ui: RegisterUi) => RegisterUi) => setUiState(update),
    [],
  );
  const { book, notice, actions } = state;
  const toReview = book.transactions.filter((item) => item.needsReview);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setUiState((value) =>
        value.editing ? value : { ...value, checked: [] },
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = (next: AccountId | null) => {
    setAccountId(next);
    setUiState(emptyUi);
    setQuery("");
  };
  const reset = () => {
    actions.reset();
    setVariants(start.variants);
    setAccountId(start.accountId);
    setUiState(start.ui);
    setReviewOnly(start.reviewOnly);
    setQuery("");
  };
  const account = accountId
    ? accounts.find((item) => item.id === accountId)
    : undefined;
  const shown = account ? [account] : accounts;
  const working = shown.reduce((sum, item) => sum + item.balance, 0);
  const uncleared = book.transactions
    .filter(
      (item) =>
        item.status === "pending" &&
        item.source === "budget" &&
        shown.some((entry) => entry.id === item.accountId),
    )
    .reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className={shell.root} data-theme={theme} data-ready ref={setRoot}>
      <TooltipProvider container={root}>
        <BookProvider value={{ ...state, variants }}>
          <aside className={shell.sidebar} style={{ width: sidebarWidth }}>
            <div className={shell.sidebarInner} style={{ width: 280 }}>
              <nav className={shell.sidebarNav} aria-label="Budget">
                <div className={shell.sidebarHeader}>
                  <span className={shell.switcher}>
                    <span
                      className={shell.avatar}
                      data-size="badge"
                      aria-hidden
                    >
                      A
                    </span>
                    <span className={shell.switcherName}>Alex’s budget</span>
                  </span>
                  <IconButton label="Hide sidebar">
                    <PanelLeftIcon aria-hidden />
                  </IconButton>
                </div>
                <div className={shell.sidebarScroll}>
                  <ul className={shell.navList}>
                    <NavItem icon={WalletCardsIcon} label="Plan" />
                    <NavItem icon={ChartPieIcon} label="Reflect" />
                    <NavItem
                      icon={ArrowLeftRightIcon}
                      label="All accounts"
                      current={!accountId}
                      toReview={toReview.length > 0}
                      onClick={() => go(null)}
                    />
                    <NavItem icon={ChartNoAxesCombinedIcon} label="Loans" />
                  </ul>
                  {(["cash", "credit"] as const).map((kind) => (
                    <section key={kind} className={shell.navSection}>
                      <span className={shell.sectionHeading}>
                        <span>{kind === "cash" ? "Cash" : "Credit"}</span>
                        <Caret />
                      </span>
                      <div className={shell.sectionBody}>
                        <div>
                          <ul className={`${shell.navList} ${shell.nested}`}>
                            {accounts
                              .filter((item) => item.kind === kind)
                              .map((item) => (
                                <NavItem
                                  key={item.id}
                                  label={item.name}
                                  value={money(item.balance)}
                                  current={accountId === item.id}
                                  onClick={() => go(item.id)}
                                />
                              ))}
                          </ul>
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              </nav>
            </div>
          </aside>

          <div className={shell.main}>
            <div className={shell.panel}>
              <header className={shell.header}>
                <div className={shell.titleGroup}>
                  <h1 className={shell.headerTitle}>
                    {account?.name ?? "All accounts"}
                  </h1>
                </div>
                <div className={shell.monthNav}>
                  <IconButton label="Previous month">
                    <ChevronLeftIcon aria-hidden />
                  </IconButton>
                  <span className={shell.monthButton}>October 2026</span>
                  <IconButton label="Next month" disabled>
                    <ChevronRightIcon aria-hidden />
                  </IconButton>
                </div>
              </header>

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

              <div className={shell.toolbar} data-wrap>
                <Button
                  size="sm"
                  aria-pressed={reviewOnly}
                  onClick={() => {
                    setReviewOnly((value) => !value);
                    setUiState(emptyUi);
                  }}
                >
                  <span className={shell.reviewDot} data-on data-inline />
                  To review
                  <span className={shell.numeric}>
                    {
                      toReview.filter(
                        (item) => !accountId || item.accountId === accountId,
                      ).length
                    }
                  </span>
                </Button>
                <Button size="sm">
                  <PlusIcon aria-hidden />
                  Add transaction
                </Button>
                <div className={shell.toolbarActions}>
                  <SearchField
                    value={query}
                    onChange={setQuery}
                    placeholder={`Search ${account?.name ?? "all accounts"}`}
                  />
                  <IconButton label="Filter" shortcut="F" variant="secondary">
                    <ListFilterIcon aria-hidden />
                  </IconButton>
                  <IconButton label="Display options" variant="secondary">
                    <SlidersHorizontalIcon aria-hidden />
                  </IconButton>
                </div>
              </div>

              <div className={shell.body}>
                <main className={shell.content}>
                  <RegisterView
                    key={`${accountId ?? "all"}-${reviewOnly}`}
                    accountId={accountId}
                    reviewOnly={reviewOnly}
                    query={query}
                    ui={ui}
                    setUi={setUi}
                  />
                </main>
              </div>
            </div>
          </div>

          <ToastRegion>
            {notice && (
              <Toast
                key={notice.id}
                onDismiss={() => actions.dismissNotice()}
                action={
                  notice.undo && (
                    <Button
                      size="sm"
                      onClick={() => actions.undo(notice.undo!)}
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

          <div className={`${shell.controls} ${styles.controls}`}>
            <button
              type="button"
              className={shell.controlsTag}
              aria-expanded={controlsOpen}
              onClick={() => setControlsOpen((value) => !value)}
            >
              Prototype
            </button>
            {controlsOpen && (
              <>
                <Segmented
                  label="History"
                  value={variants.history}
                  options={[
                    ["editor", "In editor"],
                    ["popover", "Row popover"],
                  ]}
                  onChange={(history) => {
                    setVariants((value) => ({ ...value, history }));
                  }}
                />
                <Segmented
                  label="Match"
                  value={variants.match}
                  options={[
                    ["suggest", "Suggested"],
                    ["select", "Select both"],
                  ]}
                  onChange={(match) => {
                    setVariants((value) => ({ ...value, match }));
                    setUiState(emptyUi);
                  }}
                />
                <Segmented
                  label="Theme"
                  value={theme}
                  options={[
                    ["dark", "Dark"],
                    ["light", "Light"],
                  ]}
                  onChange={setTheme}
                />
                <a
                  className={shell.resetButton}
                  href="/prototype/batch-5-register"
                >
                  Scenes
                </a>
                <button
                  type="button"
                  className={shell.resetButton}
                  onClick={reset}
                >
                  <RotateCcwIcon size={12} aria-hidden />
                  Reset
                </button>
              </>
            )}
          </div>
        </BookProvider>
      </TooltipProvider>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  current = false,
  toReview,
  value,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  current?: boolean;
  toReview?: boolean;
  value?: string;
  onClick?: () => void;
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
            aria-label="Transactions to review"
          />
        )}
      </button>
    </li>
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
    <div className={shell.segmented} role="radiogroup" aria-label={label}>
      <span className={shell.segmentedLabel}>{label}</span>
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
