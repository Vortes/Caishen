"use client";

import { useClerk } from "@clerk/nextjs";
import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  LogOutIcon,
  PaletteIcon,
  CircleUserRoundIcon,
  PanelLeftIcon,
  SettingsIcon,
  UserPlusIcon,
  UsersIcon,
  WalletCardsIcon,
  type LucideIcon,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import {
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { newId } from "~/components/budget/format";
import { deleteStoredBudgets } from "~/components/sync/indexed-db";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { Menu, MenuItem, MenuSeparator } from "~/components/ui/menu";
import { AccountEntry } from "./account-entry";
import { useAddCategory } from "./add-category";
import { BanksPopover } from "./banks";
import { isCounterparty, money } from "./model";
import { isLinked, isSettled } from "./people";
import { type Screen, type SettingsPage } from "~/components/workspace/routes";
import { EASE, SETTLE_MS, useReorderDrag } from "./reorder-drag";
import { useShellData } from "./shell-data";
import { UserAvatar } from "./user-avatar";
import styles from "./shell.module.css";

export function Sidebar({
  screen,
  hrefFor,
  onNavigate,
  toggleLabel,
  onToggle,
  settingsHref,
  sectionOrder,
  onReorderSections,
}: {
  screen: Screen;
  hrefFor: (screen: Screen) => string;
  onNavigate: (href: string) => void;
  toggleLabel: string;
  onToggle: () => void;
  settingsHref: (page: SettingsPage) => string;
  sectionOrder: string[];
  onReorderSections: (order: string[]) => void;
}) {
  const { accounts, categories, loans, transactions } = useShellData();
  // Settled people stay out of the way until asked for, unless one is open.
  // The partner, on Caishen, always shows.
  const [showSettled, setShowSettled] = useState(false);
  const floatOf = (accountId: string) =>
    categories.find((category) => category.pairs?.accountId === accountId)
      ?.available ?? 0;
  const people = accounts.filter((account) => isCounterparty(account));
  const settled = people.filter(
    (account) =>
      !isLinked(account) &&
      isSettled(account, floatOf(account.id)) &&
      !(screen.type === "register" && screen.accountId === account.id),
  );
  const reviewCount = transactions.filter((item) => item.needsReview).length;
  const [closed, setClosed] = useState<string[]>([]);
  const toggle = (id: string) =>
    setClosed((values) =>
      values.includes(id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    );

  const sections = [
    {
      id: "cash",
      label: "Cash",
      empty: "No cash accounts yet",
      items: accounts
        .filter((account) => account.kind === "cash")
        .map((account) => ({
          id: account.id,
          label: account.name,
          value: account.balance,
          toReview: account.toReview,
          warning: Boolean(account.connection?.needsAttention),
          current:
            screen.type === "register" && screen.accountId === account.id,
          href: hrefFor({ type: "register", accountId: account.id }),
        })),
    },
    {
      id: "credit",
      label: "Credit",
      empty: "No credit cards yet",
      items: accounts
        .filter((account) => account.kind === "credit")
        .map((account) => ({
          id: account.id,
          label: account.name,
          value: account.balance,
          toReview: account.toReview,
          warning: Boolean(account.connection?.needsAttention),
          current:
            screen.type === "register" && screen.accountId === account.id,
          href: hrefFor({ type: "register", accountId: account.id }),
        })),
    },
    {
      id: "tracking",
      label: "Tracking",
      empty: undefined,
      items: accounts
        .filter((account) => account.kind === "tracking")
        .map((account) => ({
          id: account.id,
          label: account.name,
          value: account.balance,
          toReview: account.toReview,
          warning: false,
          current:
            screen.type === "register" && screen.accountId === account.id,
          href: hrefFor({ type: "register", accountId: account.id }),
        })),
    },
    {
      // Everyone who owes you or whom you owe: the partner first, then the
      // rest as ordered, then former partners' closed accounts.
      id: "people",
      label: "People",
      empty: undefined,
      more: settled.length ? (
        <div className={styles.navMore}>
          <Button
            variant="quiet"
            size="sm"
            aria-expanded={showSettled}
            onClick={() => setShowSettled((value) => !value)}
          >
            {showSettled ? "Hide settled" : `Show settled (${settled.length})`}
          </Button>
        </div>
      ) : undefined,
      items: [
        ...people.filter(isLinked),
        ...people.filter((account) => !isLinked(account) && !account.closed),
        ...people.filter((account) => account.closed),
      ]
        .filter((account) => showSettled || !settled.includes(account))
        .map((account) => ({
          id: account.id,
          label: account.name,
          value: account.balance,
          toReview: account.toReview,
          warning: false,
          current:
            screen.type === "register" && screen.accountId === account.id,
          href: hrefFor({ type: "register", accountId: account.id }),
        })),
    },
    {
      id: "loans",
      label: "Loans",
      empty: undefined,
      items: loans.map((loan) => ({
        id: loan.id,
        label: loan.name,
        value: -loan.balance,
        warning: false,
        current: screen.type === "loans" && screen.loanId === loan.id,
        href: hrefFor({ type: "loans", loanId: loan.id }),
      })),
    },
  ];

  const byId = new Map(sections.map((section) => [section.id, section]));
  const ordered = [
    ...new Set([...sectionOrder, ...sections.map((section) => section.id)]),
  ].flatMap((id) => {
    const section = byId.get(id);
    return section ? [section] : [];
  });
  const visible = ordered.filter(
    (section) =>
      section.items.length > 0 ||
      Boolean(section.empty) ||
      ("more" in section && Boolean(section.more)),
  );
  const reorder = useReorderDrag({
    ids: visible.map((section) => section.id),
    enabled: visible.length > 1,
    onDrop: (order, id, done) => {
      const showing = new Set(order);
      let next = 0;
      onReorderSections(
        ordered.map((section) =>
          showing.has(section.id) ? order[next++]! : section.id,
        ),
      );
      done();
      requestAnimationFrame(() => focusSection(id));
    },
  });
  const dragged = reorder.drag && byId.get(reorder.drag.id);
  const draggedTotal =
    dragged?.items.reduce((sum, item) => sum + item.value, 0) ?? 0;
  const focusSection = (id: string) =>
    reorder.listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-section="${CSS.escape(id)}"]`)
      ?.focus();
  const moveSection = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown"))
      return;
    event.preventDefault();
    reorder.nudge(id, event.key === "ArrowUp" ? -1 : 1);
    requestAnimationFrame(() => focusSection(id));
  };

  return (
    <nav className={styles.sidebarNav} aria-label="Budget navigation">
      <div className={styles.sidebarHeader}>
        <ProfileMenu hrefFor={settingsHref} onNavigate={onNavigate} />
        <IconButton label={toggleLabel} shortcut="[" onClick={onToggle}>
          <PanelLeftIcon aria-hidden />
        </IconButton>
      </div>

      <div className={styles.sidebarScroll}>
        <ul className={styles.navList}>
          <NavItem
            icon={WalletCardsIcon}
            label="Plan"
            current={screen.type === "plan"}
            href={hrefFor({ type: "plan" })}
            onNavigate={onNavigate}
          />
          <NavItem
            icon={ChartPieIcon}
            label="Reflect"
            current={screen.type === "reflect"}
            href={hrefFor({ type: "reflect" })}
            onNavigate={onNavigate}
          />
          <NavItem
            icon={ArrowLeftRightIcon}
            label="All accounts"
            toReview={reviewCount > 0}
            current={screen.type === "register" && !screen.accountId}
            href={hrefFor({ type: "register", accountId: null })}
            onNavigate={onNavigate}
          />
          <NavItem
            icon={ChartNoAxesCombinedIcon}
            label="Loans"
            current={screen.type === "loans" && !screen.loanId}
            href={hrefFor({ type: "loans", loanId: null })}
            onNavigate={onNavigate}
          />
        </ul>

        <MotionConfig reducedMotion="user">
          <div
            ref={reorder.listRef}
            className={styles.sidebarSections}
            data-dragging={reorder.drag ? true : undefined}
          >
            {reorder.order.map((id) => {
              const section = byId.get(id);
              if (!section) return null;
              const open = !closed.includes(section.id) && !reorder.drag;
              const total = section.items.reduce(
                (sum, item) => sum + item.value,
                0,
              );
              return (
                <motion.section
                  key={section.id}
                  className={styles.navSection}
                  data-reorder-slot
                  layout={reorder.animating ? "position" : false}
                  transition={{ duration: SETTLE_MS / 1000, ease: EASE }}
                >
                  {reorder.drag?.id === id ? (
                    <div className={styles.sectionDropSlot} aria-hidden />
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.sectionHeading}
                        aria-expanded={open}
                        onClick={() => toggle(section.id)}
                        data-section={section.id}
                        data-reorderable={reorder.enabled || undefined}
                        aria-keyshortcuts={
                          reorder.enabled
                            ? "Alt+ArrowUp Alt+ArrowDown"
                            : undefined
                        }
                        onPointerDown={(event) => reorder.start(event, id)}
                        onKeyDown={(event) => moveSection(event, id)}
                      >
                        <span>{section.label}</span>
                        <Caret />
                        <span
                          className={styles.sectionTotal}
                          data-negative={total < 0 || undefined}
                        >
                          {money(total)}
                        </span>
                      </button>
                      {/* Hidden rows stay mounted for the fold animation. */}
                      <div
                        className={styles.sectionBody}
                        data-open={open}
                        inert={!open}
                        aria-hidden={!open || undefined}
                      >
                        <div>
                          {section.items.length ? (
                            <AccountList
                              items={section.items}
                              loans={section.id === "loans"}
                              onNavigate={onNavigate}
                            />
                          ) : (
                            section.empty && (
                              <p className={styles.navEmpty}>{section.empty}</p>
                            )
                          )}
                          {"more" in section && section.more}
                        </div>
                      </div>
                    </>
                  )}
                </motion.section>
              );
            })}
            {dragged && (
              <motion.div
                className={`${styles.navGhost} ${styles.sectionGhost}`}
                style={{ y: reorder.y }}
                initial={{ scale: 1 }}
                animate={{ scale: 1.02 }}
                transition={{ duration: 0.15, ease: EASE }}
                aria-hidden
              >
                <div className={styles.sectionHeading}>
                  <span>{dragged.label}</span>
                  <Caret />
                  <span
                    className={styles.sectionTotal}
                    data-negative={draggedTotal < 0 || undefined}
                  >
                    {money(draggedTotal)}
                  </span>
                </div>
              </motion.div>
            )}
          </div>
        </MotionConfig>
      </div>

      <div className={styles.sidebarFooter}>
        <BanksPopover />
        <AccountEntry />
      </div>
    </nav>
  );
}

// Settings take over the sidebar, like Linear's, until Back to app.
export function SettingsNav({
  toggleLabel,
  onToggle,
  page,
  returnHref,
  hrefFor,
  onNavigate,
}: {
  toggleLabel: string;
  onToggle: () => void;
  page: SettingsPage;
  returnHref: string;
  hrefFor: (page: SettingsPage) => string;
  onNavigate: (href: string) => void;
}) {
  return (
    <nav className={styles.sidebarNav} aria-label="Settings navigation">
      <div className={styles.sidebarHeader}>
        <a
          href={returnHref}
          className={styles.switcher}
          onClick={(event) => followLink(event, onNavigate)}
        >
          <ChevronLeftIcon size={14} aria-hidden />
          <span className={styles.switcherName}>Back to app</span>
        </a>
        <IconButton label={toggleLabel} shortcut="[" onClick={onToggle}>
          <PanelLeftIcon aria-hidden />
        </IconButton>
      </div>
      <div className={styles.sidebarScroll}>
        <h2 className={styles.navHeading}>Settings</h2>
        <ul className={styles.navList}>
          <NavItem
            icon={CircleUserRoundIcon}
            label="Profile"
            current={page === "profile"}
            href={hrefFor("profile")}
            onNavigate={onNavigate}
          />
          <NavItem
            icon={PaletteIcon}
            label="Appearance"
            current={page === "appearance"}
            href={hrefFor("appearance")}
            onNavigate={onNavigate}
          />
          <NavItem
            icon={UsersIcon}
            label="People"
            current={page === "people"}
            href={hrefFor("people")}
            onNavigate={onNavigate}
          />
        </ul>
      </div>
    </nav>
  );
}

// Linear's workspace menu: the budget's name opens settings, the partner
// invitation, and sign out.
function ProfileMenu({
  hrefFor,
  onNavigate,
}: {
  hrefFor: (page: SettingsPage) => string;
  onNavigate: (href: string) => void;
}) {
  const { budgetName, partner } = useShellData();
  const { signOut } = useClerk();
  return (
    <Menu
      label={budgetName}
      motion="occasional"
      trigger={
        <button type="button" className={styles.switcher}>
          <UserAvatar fallback={budgetName} />
          <span className={styles.switcherName}>{budgetName}</span>
          <ChevronDownIcon size={12} aria-hidden />
        </button>
      }
    >
      <MenuItem
        icon={<SettingsIcon size={14} aria-hidden />}
        title="Settings"
        href={hrefFor("profile")}
        onNavigate={onNavigate}
      />
      <MenuItem
        icon={<UserPlusIcon size={14} aria-hidden />}
        title={partner ? "People" : "Invite someone to Caishen"}
        href={hrefFor("people")}
        onNavigate={onNavigate}
      />
      <MenuSeparator />
      <MenuItem
        icon={<LogOutIcon size={14} aria-hidden />}
        title="Log out"
        onSelect={() =>
          // The budget this browser kept goes before the session does.
          void deleteStoredBudgets().finally(
            () => void signOut({ redirectUrl: "/" }),
          )
        }
      />
    </Menu>
  );
}

// Linear's section caret: a small filled triangle that turns to point right
// when the section closes.
export function Caret() {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 8 8"
      className={styles.sectionCaret}
      aria-hidden
    >
      <path d="M1.5 2.5h5L4 5.5z" fill="currentColor" />
    </svg>
  );
}

type Item = {
  id: string;
  label: string;
  value: number;
  warning: boolean;
  toReview?: boolean;
  current: boolean;
  href: string;
};

// A section's accounts or loans. Dragging one moves it within its section,
// like the plan's groups, and Alt+Up and Alt+Down move the focused one.
function AccountList({
  items,
  loans,
  onNavigate,
}: {
  items: Item[];
  loans: boolean;
  onNavigate: (href: string) => void;
}) {
  const { send } = useAddCategory();
  const byId = new Map(items.map((item) => [item.id, item]));
  const drag = useReorderDrag<HTMLUListElement>({
    ids: items.map((item) => item.id),
    enabled: items.length > 1,
    onDrop: (order, id, done) => {
      const blocked = send(
        loans
          ? { type: "loan.reorder", id: newId(), loanIds: order }
          : { type: "account.reorder", id: newId(), accountIds: order },
        `Moved ${byId.get(id)?.label ?? "account"}`,
        done,
      );
      if (blocked) done();
    },
  });
  const focusAccount = (id: string) =>
    drag.listRef.current
      ?.querySelector<HTMLElement>(`[data-account="${CSS.escape(id)}"]`)
      ?.focus();
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const id =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.account
        : undefined;
    if (
      !event.altKey ||
      !id ||
      (event.key !== "ArrowUp" && event.key !== "ArrowDown")
    )
      return;
    event.preventDefault();
    drag.nudge(id, event.key === "ArrowUp" ? -1 : 1);
    requestAnimationFrame(() => focusAccount(id));
  };
  const dragged = drag.drag && byId.get(drag.drag.id);
  return (
    <MotionConfig reducedMotion="user">
      <ul
        ref={drag.listRef}
        className={`${styles.navList} ${styles.nested} ${styles.accountList}`}
        data-dragging={drag.drag ? true : undefined}
        onKeyDown={drag.enabled ? onKeyDown : undefined}
      >
        {drag.order.map((id) => {
          const item = byId.get(id);
          if (!item) return null;
          return (
            <motion.li
              key={id}
              data-reorder-slot
              layout={drag.animating ? "position" : false}
              transition={{ duration: SETTLE_MS / 1000, ease: EASE }}
            >
              {drag.drag?.id === id ? (
                <div className={styles.navDropSlot} aria-hidden />
              ) : (
                <NavLink
                  label={item.label}
                  value={item.value}
                  warning={item.warning}
                  toReview={item.toReview}
                  current={item.current}
                  href={item.href}
                  onNavigate={onNavigate}
                  draggable={false}
                  data-account={id}
                  aria-keyshortcuts={
                    drag.enabled ? "Alt+ArrowUp Alt+ArrowDown" : undefined
                  }
                  onPointerDown={(event) => drag.start(event, id)}
                />
              )}
            </motion.li>
          );
        })}
        {dragged && (
          <motion.li
            className={styles.navGhost}
            style={{ y: drag.y }}
            initial={{ scale: 1 }}
            animate={{ scale: 1.02 }}
            transition={{ duration: 0.15, ease: EASE }}
            aria-hidden
          >
            <div className={styles.navItem}>
              <NavContents label={dragged.label} value={dragged.value} />
            </div>
          </motion.li>
        )}
      </ul>
    </MotionConfig>
  );
}

type NavProps = {
  icon?: LucideIcon;
  label: string;
  current: boolean;
  // Transactions are waiting for review.
  toReview?: boolean;
  value?: number;
  warning?: boolean;
  href: string;
  onNavigate: (href: string) => void;
};

function NavItem(props: NavProps) {
  return (
    <li>
      <NavLink {...props} />
    </li>
  );
}

function NavLink({
  icon,
  label,
  current,
  toReview,
  value,
  warning,
  onNavigate,
  ...rest
}: NavProps & Omit<ComponentProps<"a">, "onClick">) {
  return (
    <a
      {...rest}
      onClick={(event) => followLink(event, onNavigate)}
      className={styles.navItem}
      aria-label={value === undefined ? label : `${label} ${money(value)}`}
      aria-description={
        [
          warning && "Connection needs attention",
          toReview && "Transactions to review",
        ]
          .filter(Boolean)
          .join(". ") || undefined
      }
      aria-current={current ? "page" : undefined}
    >
      <NavContents
        icon={icon}
        label={label}
        value={value}
        warning={warning}
        toReview={toReview}
      />
    </a>
  );
}

function NavContents({
  icon: Icon,
  label,
  toReview,
  value,
  warning,
}: Omit<NavProps, "current" | "href" | "onNavigate">) {
  return (
    <>
      {Icon && <Icon size={14} className={styles.navIcon} aria-hidden />}
      <span className={styles.navLabel}>{label}</span>
      {warning && (
        <span
          className={styles.warningDot}
          role="img"
          aria-label="Connection needs attention"
        />
      )}
      {value !== undefined && (
        <span
          className={styles.navValue}
          data-negative={value < 0 || undefined}
        >
          {money(value)}
        </span>
      )}
      {/* Rows with an amount keep the dot's slot when it's off, so the
        amounts line up in one column and the dots in their own. */}
      {(value !== undefined || toReview) && (
        <span
          className={styles.reviewDot}
          data-on={toReview ? "" : undefined}
          data-inline
          role={toReview ? "img" : undefined}
          aria-label={toReview ? "Transactions to review" : undefined}
          aria-hidden={toReview ? undefined : true}
        />
      )}
    </>
  );
}

function followLink(
  event: MouseEvent<HTMLAnchorElement>,
  navigate: (href: string) => void,
) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  navigate(event.currentTarget.getAttribute("href")!);
}
