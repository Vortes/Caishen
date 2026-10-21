"use client";

import { cn } from "~/lib/utils";
import { bankImportNeedsReview } from "~/lib/bank-import-review";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { api } from "~/trpc/react";
import type { Command } from "~/domain/engine";
import { currentMonth, newId } from "~/components/budget/format";
import type { Panel, State, Tab } from "~/components/budget/types";
import { BudgetPlan } from "~/components/budget/budget-plan";
import { CommandDialog } from "~/components/budget/command-dialog";
import { LoansView } from "~/components/loans/loans-view";
import { Onboarding } from "~/components/onboarding/onboarding";
import { SettingsView } from "~/components/settings/settings-view";
import { Amount, Brand, Icon } from "~/components/shared";
import { TransactionRegister } from "~/components/transactions/transaction-register";
import { Button } from "~/components/ui-legacy/button";
import { MonthPicker } from "~/components/workspace/month-picker";
import { WorkspaceSidebar } from "~/components/workspace/workspace-sidebar";
import { useWorkspaceHistory } from "~/components/workspace/use-workspace-history";
import { useRunBudgetCommand } from "~/components/workspace/use-budget-command";
import {
  MAINTENANCE_DETAIL,
  MAINTENANCE_TITLE,
  useBudgetState,
} from "~/components/workspace/use-budget-state";

export function BudgetApp() {
  const { userId } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  const state = useBudgetState(month, Boolean(userId));
  if (
    state.isPending ||
    (state.data?.view && state.data.view.budget.userId !== userId)
  )
    return (
      <main className="loading-view">
        <Brand />
        <div className="loading-workspace" aria-hidden="true">
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
        <p role="status">Opening your personal budget…</p>
      </main>
    );
  if (state.error && !state.data)
    return (
      <main className="onboarding">
        <Brand />
        <h1>Your budget couldn’t load.</h1>
        <p className="notice error" role="alert">
          {state.error.message}
        </p>
        <Button onClick={() => void state.refetch()}>Try again</Button>
      </main>
    );
  if (state.data?.status === "maintenance")
    return (
      <main className="onboarding">
        <Brand />
        <h1>{MAINTENANCE_TITLE}</h1>
        <p role="status">{MAINTENANCE_DETAIL}</p>
      </main>
    );
  if (!state.data?.view)
    return <Onboarding month={month} onComplete={() => void state.refetch()} />;
  return (
    <BudgetWorkspace
      key={userId}
      state={state.data}
      month={month}
      loadingMonth={state.isPlaceholderData}
      refreshError={state.error?.message}
      onRetry={() => void state.refetch()}
      onMonthChange={setMonth}
    />
  );
}

function BudgetWorkspace({
  state,
  month,
  onMonthChange,
  loadingMonth,
  refreshError,
  onRetry,
}: {
  state: State;
  month: string;
  onMonthChange: (month: string) => void;
  loadingMonth: boolean;
  refreshError?: string;
  onRetry: () => void;
}) {
  const view = state.view!;
  const [tab, setTab] = useState<Tab>("budget");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [transactionEditor, setTransactionEditor] = useState<{
    key: string;
    transactionId?: string;
  } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const activeMutations = useIsMutating();
  const refresh = () => utils.budget.state.invalidate();
  const { execute, run: send } = useRunBudgetCommand({
    state,
    loadingMonth,
    refreshError,
    onSuccess: (command) => {
      setPanel(null);
      setFormError("");
      if (command.type === "settings.update") setNotice("Preferences saved.");
    },
    onError: (error, command) => {
      if (command.type !== "transaction.upsert") setFormError(error.message);
    },
  });
  const importCategories = api.budget.importCategories.useMutation({
    onSuccess: async () => {
      await refresh();
      setPanel(null);
      setNotice("Categories imported.");
    },
    onError: (error) => setFormError(error.message),
  });
  const join = api.budget.join.useMutation({
    onSuccess: async () => {
      await refresh();
      setPanel(null);
      setNotice("Your budgets are connected for shared expenses.");
    },
    onError: (error) => setFormError(error.message),
  });
  const sync = api.budget.sync.useMutation({
    onSuccess: async () => {
      await refresh();
      setNotice("Accounts updated. Check your review inbox.");
    },
    onError: (error) => setFormError(error.message),
  });
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const run = (command: Command) => {
    if (send(command)) setFormError("");
  };
  const open = (next: Panel) => {
    if (loadingMonth) return;
    setFormError("");
    setPanel(next);
    setMobileOpen(false);
  };
  const startTransaction = (transactionId?: string) => {
    if (queryClient.isMutating() > 0 || loadingMonth || !view.accounts.length)
      return;
    setFormError("");
    setPanel(null);
    setTab("transactions");
    setMobileOpen(false);
    setTransactionEditor({ key: newId(), transactionId });
  };
  const saveTransaction = async (command: Command) => {
    if (refreshError)
      throw new Error("Refresh your budget before saving again.");
    if (queryClient.isMutating() > 0 || loadingMonth)
      throw new Error(
        "Wait for the current update to finish, then save again.",
      );
    await execute.mutateAsync({ command, expectedRevision: state.revision });
  };
  const navigate = (next: Tab) => {
    setTab(next);
    setAccountId(null);
    setReviewOnly(false);
    setPanel(null);
    setTransactionEditor(null);
    setMobileOpen(false);
    setFormError("");
  };
  const busy = activeMutations > 0 || loadingMonth || Boolean(refreshError);
  useWorkspaceHistory({
    state,
    disabled: busy || Boolean(panel) || Boolean(transactionEditor),
    onSuccess: (message) => {
      setFormError("");
      setNotice(message);
    },
    onError: setFormError,
  });
  const pending =
    state.imports.filter(bankImportNeedsReview).length +
    view.budget.transactions.filter(
      (transaction) => !transaction.removed && !transaction.reviewed,
    ).length;
  const commandDialog = panel && (
    <CommandDialog
      key={`${panel.type}:${panel.id ?? "new"}:${month}`}
      panel={panel}
      view={view}
      month={month}
      busy={busy}
      error={formError}
      run={run}
      onClose={() => {
        setPanel(null);
        setFormError("");
      }}
      onError={setFormError}
      onImport={(text) =>
        importCategories.mutate({ text, expectedRevision: state.revision })
      }
      onJoin={(code) => join.mutate({ code })}
    />
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <WorkspaceSidebar
        view={view}
        tab={tab}
        accountId={accountId}
        pending={pending}
        open={open}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        onNavigate={navigate}
        onAccount={(id) => {
          navigate("transactions");
          setAccountId(id);
        }}
      />
      <main
        id="main-content"
        className={`workspace workspace-${tab}`}
        aria-busy={loadingMonth}
      >
        {loadingMonth && (
          <div className="month-loading-progress" role="status">
            <span className="sr-only">Updating budget month…</span>
          </div>
        )}
        <div className="mobile-topbar">
          <Button
            variant="ghost"
            size="icon"
            id="open-navigation"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Icon name="menu" />
          </Button>
          <strong>{view.budget.name}</strong>
          <Brand />
        </div>
        {tab === "budget" ? (
          <>
            <header className="plan-header">
              <h1 className="sr-only">Your budget</h1>
              <MonthPicker
                month={month}
                startMonth={view.budget.startMonth}
                timezone={view.budget.settings.timezone}
                onChange={(value) => {
                  setPanel(null);
                  onMonthChange(value);
                }}
              />
              <div
                className={cn(
                  "ready-to-assign",
                  view.readyToAssign < 0 && "is-negative",
                  view.readyToAssign === 0 && "is-zero",
                )}
              >
                <span>
                  <Amount value={view.readyToAssign} />
                  <small>
                    {view.readyToAssign < 0
                      ? "Overassigned"
                      : "Ready to Assign"}
                  </small>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => open({ type: "assign" })}
                  disabled={!view.categories.length || loadingMonth}
                >
                  Assign
                  <Icon name="chevron-down" size={13} />
                </Button>
              </div>
            </header>
          </>
        ) : (
          tab !== "transactions" && (
            <header className="feature-header">
              <div>
                <h1>{tab === "loans" ? "Your loans" : "Settings"}</h1>
                <p>
                  {tab === "loans"
                    ? "Confirmed balances and payoff forecasts."
                    : "Your preferences and connected services."}
                </p>
              </div>
              <div className="feature-header-actions">
                {tab !== "settings" && (
                  <MonthPicker
                    month={month}
                    startMonth={view.budget.startMonth}
                    timezone={view.budget.settings.timezone}
                    onChange={onMonthChange}
                  />
                )}
                {tab === "loans" && (
                  <Button onClick={() => open({ type: "loan" })}>
                    <Icon name="plus" size={15} />
                    Add loan
                  </Button>
                )}
              </div>
            </header>
          )
        )}
        {refreshError && (
          <div className="notice error workspace-notice" role="alert">
            <Icon name="info" size={16} />
            <p>
              Your budget couldn’t refresh. Refresh before making more changes.
            </p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
        {formError && !panel && (
          <div className="notice error workspace-notice" role="alert">
            <Icon name="info" size={16} />
            <p>{formError}</p>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss error"
              onClick={() => setFormError("")}
            >
              <Icon name="close" size={16} />
            </Button>
          </div>
        )}
        {tab === "budget" && (
          <BudgetPlan
            state={state}
            busy={busy}
            run={run}
            open={open}
            onError={setFormError}
          />
        )}
        {tab === "transactions" && (
          <TransactionRegister
            state={state}
            month={month}
            accountId={accountId}
            reviewOnly={reviewOnly}
            onReviewOnlyChange={setReviewOnly}
            busy={busy}
            run={run}
            open={open}
            editor={transactionEditor}
            onStartTransaction={startTransaction}
            onCloseTransaction={() => setTransactionEditor(null)}
            onSaveTransaction={saveTransaction}
          />
        )}
        {tab === "loans" && (
          <div className="feature-content">
            <LoansView view={view} open={open} />
          </div>
        )}
        {tab === "settings" && (
          <div className="feature-content">
            <SettingsView
              state={state}
              run={run}
              busy={busy}
              open={open}
              sync={() => sync.mutate()}
              syncBusy={sync.isPending}
            />
          </div>
        )}
      </main>
      {notice && (
        <div className="success-toast" role="status">
          <Icon name="check" size={16} />
          {notice}
        </div>
      )}
      {commandDialog}
    </div>
  );
}
