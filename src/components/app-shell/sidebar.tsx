"use client";

import { useClerk } from "@clerk/nextjs";
import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  HeartHandshakeIcon,
  LogOutIcon,
  PaletteIcon,
  CircleUserRoundIcon,
  PanelLeftIcon,
  SettingsIcon,
  UserPlusIcon,
  WalletCardsIcon,
  type LucideIcon,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import { DropdownMenu } from "radix-ui";
import {
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";
import { newId } from "~/components/budget/format";
import { deleteStoredBudgets } from "~/components/sync/indexed-db";
import { IconButton } from "~/components/ui/icon-button";
import { usePortalContainer } from "~/components/ui/tooltip";
import { AccountEntry } from "./account-entry";
import { useAddCategory } from "./add-category";
import { BanksPopover } from "./banks";
import { money } from "./model";
import { type SettingsPage } from "~/components/workspace/routes";
import { EASE, SETTLE_MS, useReorderDrag } from "./reorder-drag";
import { useShellData } from "./shell-data";
import { UserAvatar } from "./user-avatar";
import styles from "./shell.module.css";

export type Screen =
  | { type: "plan" }
  | { type: "reflect" }
  | { type: "register"; accountId: string | null }
  | { type: "loans" };

export function Sidebar({
  screen,
  selectedId,
  onNavigate,
  toggleLabel,
  onToggle,
  onOpenSettings,
}: {
  screen: Screen;
  selectedId: string | null;
  onNavigate: (screen: Screen, selectedId?: string) => void;
  toggleLabel: string;
  onToggle: () => void;
  onOpenSettings: (page: SettingsPage) => void;
}) {
  const { accounts, loans, transactions } = useShellData();
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
          go: () => onNavigate({ type: "register", accountId: account.id }),
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
          go: () => onNavigate({ type: "register", accountId: account.id }),
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
          go: () => onNavigate({ type: "register", accountId: account.id }),
        })),
    },
    {
      // The counterparty accounts: the partner and Reimbursements.
      id: "people",
      label: "People",
      empty: undefined,
      items: accounts
        .filter(
          (account) =>
            account.kind === "partner" || account.kind === "reimbursements",
        )
        .map((account) => ({
          id: account.id,
          label: account.name,
          value: account.balance,
          toReview: account.toReview,
          warning: false,
          current:
            screen.type === "register" && screen.accountId === account.id,
          go: () => onNavigate({ type: "register", accountId: account.id }),
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
        current: screen.type === "loans" && selectedId === loan.id,
        go: () => onNavigate({ type: "loans" }, loan.id),
      })),
    },
  ].filter((section) => section.items.length || section.empty);

  return (
    <nav className={styles.sidebarNav} aria-label="Budget navigation">
      <div className={styles.sidebarHeader}>
        <ProfileMenu onOpenSettings={onOpenSettings} />
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
            onClick={() => onNavigate({ type: "plan" })}
          />
          <NavItem
            icon={ChartPieIcon}
            label="Reflect"
            current={screen.type === "reflect"}
            onClick={() => onNavigate({ type: "reflect" })}
          />
          <NavItem
            icon={ArrowLeftRightIcon}
            label="All accounts"
            toReview={reviewCount > 0}
            current={screen.type === "register" && !screen.accountId}
            onClick={() => onNavigate({ type: "register", accountId: null })}
          />
          <NavItem
            icon={ChartNoAxesCombinedIcon}
            label="Loans"
            current={screen.type === "loans" && !selectedId}
            onClick={() => onNavigate({ type: "loans" })}
          />
        </ul>

        {sections.map((section) => {
          const open = !closed.includes(section.id);
          const total = section.items.reduce(
            (sum, item) => sum + item.value,
            0,
          );
          return (
            <section key={section.id} className={styles.navSection}>
              <button
                type="button"
                className={styles.sectionHeading}
                aria-expanded={open}
                onClick={() => toggle(section.id)}
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
              {/* Stays mounted so it can animate closed; inert while hidden
                  so its rows drop out of the tab order. */}
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
                    />
                  ) : (
                    <p className={styles.navEmpty}>{section.empty}</p>
                  )}
                </div>
              </div>
            </section>
          );
        })}
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
  onBack,
  onSelect,
}: {
  toggleLabel: string;
  onToggle: () => void;
  page: SettingsPage;
  onBack: () => void;
  onSelect: (page: SettingsPage) => void;
}) {
  return (
    <nav className={styles.sidebarNav} aria-label="Settings navigation">
      <div className={styles.sidebarHeader}>
        <button type="button" className={styles.switcher} onClick={onBack}>
          <ChevronLeftIcon size={14} aria-hidden />
          <span className={styles.switcherName}>Back to app</span>
        </button>
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
            onClick={() => onSelect("profile")}
          />
          <NavItem
            icon={PaletteIcon}
            label="Appearance"
            current={page === "appearance"}
            onClick={() => onSelect("appearance")}
          />
          <NavItem
            icon={HeartHandshakeIcon}
            label="Partner"
            current={page === "partner"}
            onClick={() => onSelect("partner")}
          />
        </ul>
      </div>
    </nav>
  );
}

// Linear's workspace menu: the budget's name opens settings, the partner
// invitation, and sign out.
function ProfileMenu({
  onOpenSettings,
}: {
  onOpenSettings: (page: SettingsPage) => void;
}) {
  const { budgetName, partner } = useShellData();
  const { signOut } = useClerk();
  const container = usePortalContainer();
  // A menu opened from the keyboard appears at once; only a click animates.
  const [byKeyboard, setByKeyboard] = useState(false);
  const pointer = useRef(false);
  return (
    <DropdownMenu.Root
      modal={false}
      onOpenChange={(open) => {
        if (open) setByKeyboard(!pointer.current);
        pointer.current = false;
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={styles.switcher}
          onPointerDown={() => (pointer.current = true)}
        >
          <UserAvatar fallback={budgetName} />
          <span className={styles.switcherName}>{budgetName}</span>
          <ChevronDownIcon size={12} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content
          className={styles.menu}
          data-instant={byKeyboard || undefined}
          align="start"
          sideOffset={4}
          collisionPadding={12}
        >
          <DropdownMenu.Item
            className={styles.menuItem}
            onSelect={() => onOpenSettings("profile")}
          >
            <SettingsIcon size={14} aria-hidden />
            Settings
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={styles.menuItem}
            onSelect={() => onOpenSettings("partner")}
          >
            <UserPlusIcon size={14} aria-hidden />
            {partner ? "Partner" : "Invite partner"}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className={styles.menuSeparator} />
          <DropdownMenu.Item
            className={styles.menuItem}
            onSelect={() =>
              // The budget this browser kept goes before the session does.
              void deleteStoredBudgets().finally(
                () => void signOut({ redirectUrl: "/" }),
              )
            }
          >
            <LogOutIcon size={14} aria-hidden />
            Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
  go: () => void;
};

// A section's accounts or loans. Dragging one moves it within its section,
// like the plan's groups, and Alt+Up and Alt+Down move the focused one.
function AccountList({ items, loans }: { items: Item[]; loans: boolean }) {
  const { add } = useAddCategory();
  const byId = new Map(items.map((item) => [item.id, item]));
  const drag = useReorderDrag<HTMLUListElement>({
    ids: items.map((item) => item.id),
    enabled: items.length > 1,
    onDrop: (order, id, done) => {
      const blocked = add(
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
                <NavButton
                  label={item.label}
                  value={item.value}
                  warning={item.warning}
                  toReview={item.toReview}
                  current={item.current}
                  onClick={item.go}
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
  onClick: () => void;
};

function NavItem(props: NavProps) {
  return (
    <li>
      <NavButton {...props} />
    </li>
  );
}

function NavButton({
  icon,
  label,
  current,
  toReview,
  value,
  warning,
  ...rest
}: NavProps & Omit<ComponentProps<"button">, "value">) {
  return (
    <button
      {...rest}
      type="button"
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
    </button>
  );
}

function NavContents({
  icon: Icon,
  label,
  toReview,
  value,
  warning,
}: Omit<NavProps, "current" | "onClick">) {
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
      {toReview && (
        <span
          className={styles.reviewDot}
          data-on
          data-inline
          role="img"
          aria-label="Transactions to review"
        />
      )}
    </>
  );
}
