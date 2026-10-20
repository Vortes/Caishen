"use client";

import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChevronDownIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  WalletCardsIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { accounts, balance, loans, money, transactions } from "./data";
import styles from "./shell.module.css";
import { Tip } from "./tooltip";

export type Screen =
  | { type: "plan" }
  | { type: "register"; accountId: string | null }
  | { type: "loans" };

const reviewCount = transactions.filter((item) => item.needsReview).length;

export function Sidebar({
  screen,
  selectedId,
  onNavigate,
}: {
  screen: Screen;
  selectedId: string | null;
  onNavigate: (screen: Screen, selectedId?: string) => void;
}) {
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
      items: accounts
        .filter((account) => account.kind === "cash")
        .map((account) => ({
          id: account.id,
          label: account.name,
          value: balance(account),
          warning: false,
          current:
            screen.type === "register" && screen.accountId === account.id,
          go: () => onNavigate({ type: "register", accountId: account.id }),
        })),
    },
    {
      id: "credit",
      label: "Credit",
      items: accounts
        .filter((account) => account.kind === "credit")
        .map((account) => ({
          id: account.id,
          label: account.name,
          value: balance(account),
          warning: account.syncedAgo === "Needs reconnect",
          current:
            screen.type === "register" && screen.accountId === account.id,
          go: () => onNavigate({ type: "register", accountId: account.id }),
        })),
    },
    {
      id: "loans",
      label: "Loans",
      items: loans.map((loan) => ({
        id: loan.id,
        label: loan.name,
        value: -loan.balance,
        warning: false,
        current: screen.type === "loans" && selectedId === loan.id,
        go: () => onNavigate({ type: "loans" }, loan.id),
      })),
    },
  ];

  return (
    <nav className={styles.sidebarNav} aria-label="Budget navigation">
      <div className={styles.sidebarHeader}>
        <button type="button" className={styles.switcher}>
          <span className={styles.avatar} aria-hidden>
            W
          </span>
          <span className={styles.switcherName}>Weng household</span>
          <ChevronDownIcon size={12} aria-hidden />
        </button>
        <IconButton label="Search" shortcut="⌘K" icon={SearchIcon} />
        <IconButton label="New transaction" shortcut="N" icon={SquarePenIcon} />
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
            icon={ArrowLeftRightIcon}
            label="All accounts"
            count={reviewCount}
            countLabel={`${reviewCount} to review`}
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
                <ChevronDownIcon
                  size={10}
                  strokeWidth={2.5}
                  className={styles.sectionCaret}
                  aria-hidden
                />
                <span className={styles.sectionTotal}>{money(total)}</span>
              </button>
              {open && (
                <ul className={styles.navList}>
                  {section.items.map((item) => (
                    <NavItem
                      key={item.id}
                      label={item.label}
                      value={money(item.value)}
                      warning={item.warning}
                      current={item.current}
                      onClick={item.go}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <div className={styles.sidebarFooter}>
        <button type="button" className={styles.footerItem}>
          <SettingsIcon size={14} aria-hidden />
          Settings
        </button>
        <IconButton label="Add account" icon={PlusIcon} />
      </div>
    </nav>
  );
}

function NavItem({
  icon: Icon,
  label,
  current,
  count,
  countLabel,
  value,
  warning,
  onClick,
}: {
  icon?: LucideIcon;
  label: string;
  current: boolean;
  count?: number;
  countLabel?: string;
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
            aria-label="Needs reconnect"
          />
        )}
        {value && <span className={styles.navValue}>{value}</span>}
        {count ? (
          <span className={styles.navCount} aria-label={countLabel}>
            {count}
          </span>
        ) : null}
      </button>
    </li>
  );
}

export function IconButton({
  label,
  shortcut,
  icon: Icon,
  pressed,
  onClick,
  className,
}: {
  label: string;
  shortcut?: string;
  icon: LucideIcon;
  pressed?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button
        type="button"
        className={`${styles.iconButton} ${className ?? ""}`}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut?.replace("⌘", "Meta+")}
        onClick={onClick}
      >
        <Icon size={15} aria-hidden />
      </button>
    </Tip>
  );
}
