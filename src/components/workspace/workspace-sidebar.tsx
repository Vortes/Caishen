"use client";

import { UserButton } from "@clerk/nextjs";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "~/components/ui-legacy/dialog";
import type { Panel, Tab, View } from "~/components/budget/types";
import { Amount, Brand, Icon, type IconName } from "~/components/shared";
import { Button } from "~/components/ui-legacy/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui-legacy/dropdown-menu";

const navigation: { id: Tab; label: string; icon: IconName }[] = [
  { id: "budget", label: "Plan", icon: "budget" },
  { id: "transactions", label: "All accounts", icon: "bank" },
  { id: "loans", label: "Loans", icon: "loans" },
];

export function WorkspaceSidebar({
  view,
  tab,
  accountId,
  pending,
  mobileOpen,
  onMobileClose,
  onNavigate,
  onAccount,
  open,
}: {
  view: View;
  tab: Tab;
  accountId: string | null;
  pending: number;
  mobileOpen: boolean;
  onMobileClose: () => void;
  onNavigate: (tab: Tab) => void;
  onAccount: (id: string) => void;
  open: (panel: Panel) => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const toggle = (id: string) =>
    setCollapsed((values) =>
      values.includes(id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    );
  const sidebar = (
    <aside className="workspace-sidebar" aria-label="Budget navigation">
      <div className="sidebar-budget">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="budget-menu">
              <Brand />
              <span className="budget-menu-name">
                <strong title={view.budget.name}>{view.budget.name}</strong>
                <small>Personal budget · USD</small>
              </span>
              <Icon name="chevron-down" size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => onNavigate("settings")}>
              <Icon name="settings" size={16} />
              Budget settings
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => open({ type: "import" })}>
              <Icon name="budget" size={16} />
              Import categories
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          className="mobile-sidebar-close"
          variant="ghost"
          size="icon"
          aria-label="Close navigation"
          onClick={onMobileClose}
        >
          <Icon name="close" />
        </Button>
      </div>
      <nav className="workspace-nav" aria-label="Main navigation">
        {navigation.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-label={item.label}
            aria-current={
              tab === item.id && (item.id !== "transactions" || !accountId)
                ? "page"
                : undefined
            }
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
            {item.id === "transactions" && pending > 0 && (
              <span className="nav-count">{pending}</span>
            )}
          </button>
        ))}
      </nav>
      <div className="sidebar-accounts">
        {(["cash", "credit"] as const).map((kind) => {
          const accounts = view.accounts.filter(
            (account) => account.kind === kind,
          );
          const balance = accounts.reduce(
            (sum, account) => sum + account.balance,
            0,
          );
          return (
            <section className="sidebar-account-group" key={kind}>
              <button
                className="account-group-heading"
                aria-expanded={!collapsed.includes(kind)}
                onClick={() => toggle(kind)}
              >
                <Icon
                  name={
                    collapsed.includes(kind) ? "chevron-right" : "chevron-down"
                  }
                  size={12}
                />
                <span>{kind === "cash" ? "Cash" : "Credit"}</span>
                <Amount
                  value={balance}
                  className={balance < 0 ? "negative" : ""}
                />
              </button>
              {!collapsed.includes(kind) &&
                (accounts.length ? (
                  accounts.map((account) => (
                    <button
                      className="sidebar-account"
                      key={account.id}
                      aria-current={
                        tab === "transactions" && accountId === account.id
                          ? "page"
                          : undefined
                      }
                      onClick={() => onAccount(account.id)}
                    >
                      <span title={account.name}>{account.name}</span>
                      <Amount
                        value={account.balance}
                        className={account.balance < 0 ? "negative" : ""}
                      />
                    </button>
                  ))
                ) : (
                  <p className="sidebar-empty">
                    No {kind === "cash" ? "cash accounts" : "credit cards"} yet
                  </p>
                ))}
            </section>
          );
        })}
        {view.loans.length > 0 && (
          <section className="sidebar-account-group">
            <button
              className="account-group-heading"
              aria-expanded={!collapsed.includes("loans")}
              onClick={() => toggle("loans")}
            >
              <Icon
                name={
                  collapsed.includes("loans") ? "chevron-right" : "chevron-down"
                }
                size={12}
              />
              <span>Loans</span>
              <Amount
                value={-view.loans.reduce((sum, loan) => sum + loan.balance, 0)}
              />
            </button>
            {!collapsed.includes("loans") &&
              view.loans.map((loan) => (
                <button
                  className="sidebar-account"
                  key={loan.id}
                  onClick={() => onNavigate("loans")}
                >
                  <span title={loan.name}>{loan.name}</span>
                  <Amount value={-loan.balance} />
                </button>
              ))}
          </section>
        )}
        <div className="sidebar-account-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => open({ type: "account" })}
          >
            <Icon name="plus" size={14} />
            Add account
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate("settings")}
          >
            <Icon name="bank" size={14} />
            Bank connections
          </Button>
        </div>
      </div>
      <div className="sidebar-footer">
        <Button
          variant="ghost"
          size="sm"
          aria-current={tab === "settings" ? "page" : undefined}
          onClick={() => onNavigate("settings")}
        >
          <Icon name="settings" size={17} />
          Settings
        </Button>
        <div className="sidebar-user">
          <UserButton />
          <span>Account & profile</span>
        </div>
      </div>
    </aside>
  );
  return (
    <>
      <div className="desktop-sidebar">{sidebar}</div>
      <Dialog
        open={mobileOpen}
        onOpenChange={(value) => {
          if (!value) onMobileClose();
        }}
      >
        <DialogContent
          className="mobile-navigation translate-x-0 translate-y-0"
          showCloseButton={false}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("open-navigation")?.focus();
          }}
        >
          <DialogTitle className="sr-only">Budget navigation</DialogTitle>
          {sidebar}
        </DialogContent>
      </Dialog>
    </>
  );
}
