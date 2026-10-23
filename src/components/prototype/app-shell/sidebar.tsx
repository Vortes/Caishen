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
import { DropdownMenu } from "radix-ui";
import { useRef, useState } from "react";
import { deleteStoredBudgets } from "~/components/sync/indexed-db";
import { IconButton } from "~/components/ui/icon-button";
import { usePortalContainer } from "~/components/ui/tooltip";
import { AccountEntry } from "./account-entry";
import { BanksPopover } from "./banks";
import { money } from "./model";
import { SHELL_PATH, type SettingsPage } from "./settings-pages";
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
          warning: false,
          current:
            screen.type === "register" && screen.accountId === account.id,
          go: () => onNavigate({ type: "register", accountId: account.id }),
        })),
    },
    {
      // The counterparty accounts: the partner first, then Reimbursements.
      id: "people",
      label: "People",
      empty: undefined,
      items: accounts
        .filter(
          (account) =>
            account.kind === "partner" || account.kind === "reimbursements",
        )
        .sort((a, b) =>
          a.kind === "partner" ? -1 : b.kind === "partner" ? 1 : 0,
        )
        .map((account) => ({
          id: account.id,
          label: account.name,
          value: account.balance,
          warning: false,
          toReview: account.toReview,
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
                <span className={styles.sectionTotal}>{money(total)}</span>
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
                    <ul className={`${styles.navList} ${styles.nested}`}>
                      {section.items.map((item) => (
                        <NavItem
                          key={item.id}
                          label={item.label}
                          value={money(item.value)}
                          warning={item.warning}
                          toReview={
                            "toReview" in item && item.toReview === true
                          }
                          current={item.current}
                          onClick={item.go}
                        />
                      ))}
                    </ul>
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
                () => void signOut({ redirectUrl: SHELL_PATH }),
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

function NavItem({
  icon: Icon,
  label,
  current,
  toReview,
  value,
  warning,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  current: boolean;
  // Transactions are waiting for review.
  toReview?: boolean;
  value?: string;
  warning?: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={styles.navItem}
        aria-current={current ? "page" : undefined}
        onClick={onClick}
      >
        {Icon && <Icon size={14} className={styles.navIcon} aria-hidden />}
        <span className={styles.navLabel}>{label}</span>
        {warning && (
          <span
            className={styles.warningDot}
            role="img"
            aria-label="Connection needs attention"
          />
        )}
        {value && <span className={styles.navValue}>{value}</span>}
        {toReview && (
          <span
            className={styles.reviewDot}
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
