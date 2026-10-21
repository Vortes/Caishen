"use client";

import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  ChevronDownIcon,
  PanelLeftIcon,
  SettingsIcon,
  WalletCardsIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { IconButton } from "~/components/ui/icon-button";
import { AccountEntry } from "./account-entry";
import { money } from "./model";
import { useShellData } from "./shell-data";
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
}: {
  screen: Screen;
  selectedId: string | null;
  onNavigate: (screen: Screen, selectedId?: string) => void;
  toggleLabel: string;
  onToggle: () => void;
}) {
  const { accounts, loans, transactions, budgetName } = useShellData();
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
        <button type="button" className={styles.switcher}>
          <span className={styles.avatar} aria-hidden>
            {budgetName.trim().charAt(0).toUpperCase() || "C"}
          </span>
          <span className={styles.switcherName}>{budgetName}</span>
          <ChevronDownIcon size={12} aria-hidden />
        </button>
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
        <button type="button" className={styles.footerItem}>
          <SettingsIcon size={14} aria-hidden />
          Settings
        </button>
        <AccountEntry />
      </div>
    </nav>
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
