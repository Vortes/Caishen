"use client";

import { BankConnections, BankInbox } from "~/components/bank-services";
import { CategorySuggestions } from "~/components/category-suggestions";
import { UserButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { api, type RouterOutputs } from "~/trpc/react";
import { forecastLoan, type Command } from "~/domain/engine";
import {
  Amount,
  Brand,
  Dialog,
  EmptyState,
  FormField,
  Icon,
  SelectField,
  type IconName,
} from "~/components/ui";

const navigation: { id: Tab; label: string; icon: IconName }[] = [
  { id: "budget", label: "Budget", icon: "budget" },
  { id: "transactions", label: "Transactions", icon: "transactions" },
  { id: "shared", label: "Shared", icon: "shared" },
  { id: "loans", label: "Loans", icon: "loans" },
  { id: "settings", label: "Settings", icon: "settings" },
];
type Tab = "budget" | "transactions" | "shared" | "loans" | "settings";
type Panel = {
  type:
    | "account"
    | "category"
    | "assign"
    | "transaction"
    | "import"
    | "card-payment"
    | "statement-credit"
    | "reimbursement"
    | "receive"
    | "shared-category"
    | "opening"
    | "settlement"
    | "loan"
    | "loan-payment"
    | "rate"
    | "reconcile"
    | "target"
    | "join"
    | "rule"
    | "history";
  id?: string;
};
type State = NonNullable<RouterOutputs["budget"]["state"]>;
type View = State["view"];

function currentMonth(timezone = "America/Los_Angeles") {
  return new Date()
    .toLocaleDateString("en-CA", {
      year: "numeric",
      month: "2-digit",
      timeZone: timezone,
    })
    .slice(0, 7);
}
function today(timezone = "America/Los_Angeles") {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: timezone,
  });
}
function monthName(month: string) {
  return new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}
function moveMonth(month: string, delta: number) {
  const date = new Date(`${month}-15T12:00:00`);
  date.setMonth(date.getMonth() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function money(data: FormData, key: string) {
  const value = text(data, key);
  if (!/^-?\d+(\.\d{1,2})?$/.test(value))
    throw new Error(
      "Enter a dollar amount with no more than two decimal places.",
    );
  const sign = value.startsWith("-") ? -1 : 1;
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  const cents = sign * (Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
  if (!Number.isSafeInteger(cents))
    throw new Error("That amount is too large.");
  return cents;
}
function text(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}
function newId() {
  return crypto.randomUUID();
}

export function BudgetApp() {
  const { userId } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  const state = api.budget.state.useQuery(
    { month },
    { enabled: Boolean(userId), refetchOnMount: "always" },
  );
  const refetch = state.refetch;
  useEffect(() => {
    if (userId) void refetch();
  }, [userId, refetch]);
  if (
    state.isPending ||
    (state.data?.view && state.data.view.budget.userId !== userId)
  )
    return (
      <main className="loading-view">
        <Brand />
        <span className="skeleton" />
        <span className="skeleton big" />
        <p>Opening your personal budget…</p>
      </main>
    );
  if (state.error)
    return (
      <main className="onboarding">
        <Brand />
        <h1>Your budget couldn’t load.</h1>
        <div className="notice error" role="alert">
          {state.error.message}
        </div>
        <button className="primary-button" onClick={() => void state.refetch()}>
          Try again
        </button>
      </main>
    );
  if (!state.data?.view)
    return <Onboarding month={month} onComplete={() => void state.refetch()} />;
  return <Dashboard state={state.data} month={month} setMonth={setMonth} />;
}

function Onboarding({
  month,
  onComplete,
}: {
  month: string;
  onComplete: () => void;
}) {
  const onboard = api.budget.onboard.useMutation({ onSuccess: onComplete });
  return (
    <main className="onboarding">
      <Brand />
      <p className="eyebrow" style={{ marginTop: 40 }}>
        A fresh start
      </p>
      <h1>Let’s give your money a home.</h1>
      <p>
        Start with your own personal budget. Add your real account balances,
        create a few categories, then decide where your money should go.
      </p>
      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onboard.mutate({
            name: text(data, "name"),
            month,
            timezone: text(data, "timezone"),
          });
        }}
      >
        <div className="form-grid">
          <FormField
            label="Budget name"
            name="name"
            autoComplete="off"
            placeholder="My personal budget"
            defaultValue="My budget"
            maxLength={80}
            required
            autoFocus
          />
          <SelectField
            label="Your timezone"
            name="timezone"
            defaultValue="America/Los_Angeles"
          >
            <TimezoneOptions />
          </SelectField>
          <p className="field-hint">
            US dollars · Daily review email defaults to 8 a.m. in your timezone.
            Configure or disable it in Settings.
          </p>
        </div>
        {onboard.error && (
          <p className="form-error" role="alert">
            {onboard.error.message}
          </p>
        )}
        <div className="form-actions">
          <button className="primary-button" disabled={onboard.isPending}>
            {onboard.isPending ? "Creating your budget…" : "Create my budget"}
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </form>
      <p className="privacy-note">
        <Icon name="shield" size={17} />
        Your partner has their own budget. Only the shared expenses and
        repayments you need to settle together are shared.
      </p>
    </main>
  );
}

function Dashboard({
  state,
  month,
  setMonth,
}: {
  state: State;
  month: string;
  setMonth: (month: string) => void;
}) {
  const view = state.view!;
  const [tab, setTab] = useState<Tab>("budget");
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState("");
  const [formError, setFormError] = useState("");
  const [search, setSearch] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const utils = api.useUtils();
  const refresh = () => utils.budget.state.invalidate();
  const execute = api.budget.execute.useMutation({
    onSuccess: async () => {
      await refresh();
      setPanel(null);
      setFormError("");
      setNotice("Your budget is up to date.");
    },
    onError: (error) => {
      setFormError(error.message);
      if (error.data?.code === "CONFLICT") void refresh();
    },
  });
  const importCategories = api.budget.importCategories.useMutation({
    onSuccess: async () => {
      await refresh();
      setPanel(null);
      setNotice(
        "Categories imported. Balances and transaction history were not imported.",
      );
    },
    onError: (error) => setFormError(error.message),
  });
  const invite = api.budget.invite.useMutation();
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
      setNotice(
        "Bank update finished. Check the inbox for anything needing review.",
      );
    },
    onError: (error) => setFormError(error.message),
  });
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5500);
    return () => clearTimeout(timer);
  }, [notice]);
  const run = (command: Command) => {
    setFormError("");
    execute.mutate({ command, expectedRevision: state.revision });
  };
  const open = (next: Panel) => {
    setFormError("");
    setPanel(next);
  };
  const busy =
    execute.isPending || importCategories.isPending || join.isPending;
  const pending =
    state.imports.length +
    view.budget.transactions.filter(
      (transaction) => !transaction.removed && !transaction.reviewed,
    ).length;
  const latestUpdate = state.connections
    .map((connection) => connection.lastSyncedAt)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const title = navigation.find((item) => item.id === tab)?.label ?? "Budget";
  const transactions = view.budget.transactions.filter(
    (transaction) =>
      !transaction.removed &&
      (reviewOnly
        ? !transaction.reviewed
        : transaction.date.slice(0, 7) === month) &&
      (!search ||
        transaction.payee.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="budget-switch">
          <span className="budget-avatar">
            {view.budget.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{view.budget.name}</strong>
            <small>Personal budget · USD</small>
          </div>
        </div>
        <nav className="nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => {
                setTab(item.id);
                setFormError("");
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.id === "transactions" && pending > 0 && (
                <span className="nav-count">{pending}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p className="privacy-note">
            <Icon name="shield" size={15} />
            Your personal spending stays yours.
          </p>
          <div className="user-area">
            <UserButton />
            <span>Account & profile</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>My workspace</span>
            <Icon name="chevron" size={12} />
            <strong>{title}</strong>
          </div>
          <span className="freshness">
            <span className="status-dot" />
            {latestUpdate
              ? `Updated ${latestUpdate.toLocaleString("en-US", { timeZone: view.budget.settings.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
              : state.connections.length
                ? "Bank update pending"
                : "No bank accounts connected"}
          </span>
          <div className="mobile-user">
            <UserButton />
          </div>
        </header>
        <main id="main-content" className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {tab === "budget"
                  ? "Make room for what matters"
                  : tab === "transactions"
                    ? "A little attention goes a long way"
                    : tab === "shared"
                      ? "Together, with clarity"
                      : tab === "loans"
                        ? "One payment at a time"
                        : "Make it yours"}
              </p>
              <h1>
                {tab === "transactions" && reviewOnly
                  ? "Review inbox"
                  : tab === "shared"
                    ? "Shared expenses"
                    : tab === "loans"
                      ? "Your loans"
                      : tab === "budget"
                        ? "Your budget"
                        : title}
              </h1>
              <p>
                {tab === "budget"
                  ? "A place for every dollar. The decisions are yours."
                  : tab === "transactions"
                    ? "The full payment, the right category, and a clear record."
                    : tab === "shared"
                      ? "See your share, what was paid, and what’s left to settle."
                      : tab === "loans"
                        ? "Confirmed balances. Clear forecasts. A plan you control."
                        : "Your preferences, connected services, and activity."}
              </p>
            </div>
            <div className="heading-actions">
              {tab !== "settings" && (
                <div className="month-control">
                  <button
                    type="button"
                    aria-label="Previous month"
                    disabled={month <= view.budget.startMonth}
                    onClick={() => setMonth(moveMonth(month, -1))}
                  >
                    <Icon name="chevron" size={13} />
                  </button>
                  <span>{monthName(month)}</span>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => setMonth(moveMonth(month, 1))}
                  >
                    <Icon name="chevron" size={13} />
                  </button>
                </div>
              )}
              {tab === "budget" && (
                <button
                  className="primary-button"
                  onClick={() => open({ type: "transaction" })}
                >
                  <Icon name="plus" size={15} />
                  Add transaction
                </button>
              )}
              {tab === "transactions" && (
                <button
                  className="primary-button"
                  onClick={() => open({ type: "transaction" })}
                >
                  <Icon name="plus" size={15} />
                  Add transaction
                </button>
              )}
              {tab === "shared" && (
                <button
                  className="primary-button"
                  onClick={() => open({ type: "shared-category" })}
                  disabled={view.members.length < 2}
                  title={
                    view.members.length < 2
                      ? "Connect with your partner first"
                      : undefined
                  }
                >
                  <Icon name="plus" size={15} />
                  Shared category
                </button>
              )}
              {tab === "loans" && (
                <button
                  className="primary-button"
                  onClick={() => open({ type: "loan" })}
                >
                  <Icon name="plus" size={15} />
                  Add loan
                </button>
              )}
            </div>
          </div>
          {formError && !panel && (
            <div role="alert" className="notice error">
              <span>!</span>
              <p>{formError}</p>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setFormError("")}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}

          {tab === "budget" && (
            <>
              <div className="budget-overview">
                <div className="overview-stat featured">
                  <span className="stat-label">Ready to Assign</span>
                  <Amount className="stat-value" value={view.readyToAssign} />
                  <span className="stat-note">
                    Real cash, waiting for your direction
                  </span>
                </div>
                <div className="overview-stat">
                  <span className="stat-label">Available in categories</span>
                  <Amount
                    className="stat-value"
                    value={view.categories.reduce(
                      (sum, category) => sum + category.available,
                      0,
                    )}
                  />
                  <span className="stat-note">
                    Carried forward and assigned by you
                  </span>
                </div>
                <div className="overview-stat">
                  <span className="stat-label">Your spending this month</span>
                  <Amount
                    className="stat-value"
                    value={view.personalSpending}
                  />
                  <span className="stat-note">
                    Your personal share of expenses
                  </span>
                </div>
              </div>
              <div className="main-grid">
                <div className="stack">
                  <section className="panel">
                    <div className="panel-header">
                      <div>
                        <h2>Categories</h2>
                        <p>Your envelopes, at a glance</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => open({ type: "category" })}
                      >
                        <Icon name="plus" size={14} />
                        Add category
                      </button>
                    </div>
                    {view.categories.length === 0 ? (
                      <EmptyState
                        icon="budget"
                        title="What would you like to make room for?"
                        action={
                          <button
                            className="primary-button"
                            onClick={() => open({ type: "category" })}
                          >
                            Create your first category
                          </button>
                        }
                      >
                        Create your categories, or bring just your categories
                        over from YNAB. Then assign the cash you actually have.
                      </EmptyState>
                    ) : (
                      <div className="data-table-wrap">
                        <table className="data-table category-table">
                          <thead>
                            <tr>
                              <th>Category</th>
                              <th className="number">Assigned</th>
                              <th className="number">Activity</th>
                              <th className="number">Available</th>
                              <th aria-label="Category actions" />
                            </tr>
                          </thead>
                          <tbody>
                            {view.categories.map((category) => (
                              <tr key={category.id}>
                                <td>
                                  <strong>
                                    <span className="category-dot" />
                                    {category.name}
                                  </strong>
                                  {category.targetProgress && (
                                    <>
                                      <small>
                                        {category.targetProgress.snoozed
                                          ? "Target snoozed this month"
                                          : `${formatMoney(category.targetProgress.needed)} still needed`}
                                      </small>
                                      <span className="target-bar">
                                        <span
                                          style={{
                                            width: `${Math.min(100, category.targetProgress.total ? (category.targetProgress.funded / category.targetProgress.total) * 100 : 0)}%`,
                                          }}
                                        />
                                      </span>
                                    </>
                                  )}
                                </td>
                                <td className="number">
                                  <button
                                    className="amount-button"
                                    title={`Assign money to ${category.name}`}
                                    onClick={() =>
                                      open({ type: "assign", id: category.id })
                                    }
                                  >
                                    <Amount value={category.assigned} />
                                  </button>
                                </td>
                                <td className="number muted">
                                  <Amount value={category.activity} />
                                </td>
                                <td className="number">
                                  <span
                                    className={`available-pill${category.available < 0 ? "negative" : ""}`}
                                  >
                                    <Amount value={category.available} />
                                  </span>
                                  {category.reserved > 0 && (
                                    <small>
                                      {formatMoney(category.reserved)} reserved
                                    </small>
                                  )}
                                </td>
                                <td>
                                  <button
                                    className="icon-button"
                                    title={`Set target for ${category.name}`}
                                    aria-label={`Set target for ${category.name}`}
                                    onClick={() =>
                                      open({ type: "target", id: category.id })
                                    }
                                  >
                                    <Icon name="settings" size={15} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="panel-footer">
                      <Icon name="shield" size={13} />
                      Only you decide how to assign your money.
                      <button
                        className="text-button"
                        style={{
                          marginLeft: "auto",
                          minHeight: 26,
                          paddingBlock: 0,
                        }}
                        onClick={() => open({ type: "import" })}
                      >
                        Import categories
                      </button>
                    </div>
                  </section>
                  {!view.accounts.length && (
                    <section className="panel">
                      <div className="panel-header">
                        <div>
                          <h2>A good place to start</h2>
                          <p>Three small steps to a clearer picture</p>
                        </div>
                      </div>
                      <div className="setup-steps">
                        <div>
                          <strong>
                            <span className="step-number">1</span>Add your
                            accounts
                          </strong>
                          <p>Start with your real cash and card balances.</p>
                          <button
                            className="text-button"
                            onClick={() => open({ type: "account" })}
                          >
                            Add account <Icon name="arrow" size={13} />
                          </button>
                        </div>
                        <div>
                          <strong>
                            <span className="step-number">2</span>Create your
                            categories
                          </strong>
                          <p>Make space for everyday needs and future plans.</p>
                          <button
                            className="text-button"
                            onClick={() => open({ type: "category" })}
                          >
                            Add category <Icon name="arrow" size={13} />
                          </button>
                        </div>
                        <div>
                          <strong>
                            <span className="step-number">3</span>Assign your
                            cash
                          </strong>
                          <p>Give the dollars you have a job, on your terms.</p>
                          <button
                            className="text-button"
                            disabled={!view.categories.length}
                            onClick={() => open({ type: "assign" })}
                          >
                            Assign money <Icon name="arrow" size={13} />
                          </button>
                        </div>
                      </div>
                    </section>
                  )}
                </div>
                <div className="stack">
                  <section className="panel">
                    <div className="panel-header">
                      <h2>Your accounts</h2>
                      <button
                        className="icon-button"
                        aria-label="Add account"
                        onClick={() => open({ type: "account" })}
                      >
                        <Icon name="plus" size={16} />
                      </button>
                    </div>
                    <div className="panel-body">
                      {view.accounts.length ? (
                        view.accounts.map((account) => (
                          <div className="account-row" key={account.id}>
                            <span className="account-symbol">
                              <Icon
                                name={
                                  account.kind === "credit" ? "card" : "bank"
                                }
                                size={17}
                              />
                            </span>
                            <div className="account-label">
                              <strong>{account.name}</strong>
                              <small>
                                {account.kind === "credit"
                                  ? `${formatMoney(account.reserve)} reserved to pay`
                                  : "Cash account"}
                              </small>
                              {account.shortfall > 0 && (
                                <small className="negative">
                                  {formatMoney(account.shortfall)} needs funding
                                </small>
                              )}
                            </div>
                            <Amount value={account.balance} />
                          </div>
                        ))
                      ) : (
                        <p className="muted small">
                          Add an account with its real opening balance to see
                          your cash here.
                        </p>
                      )}
                    </div>
                    {view.accounts.some(
                      (account) => account.kind === "credit",
                    ) && (
                      <div className="panel-footer account-actions">
                        <button
                          className="text-button"
                          onClick={() => open({ type: "card-payment" })}
                        >
                          Record a card payment <Icon name="arrow" size={13} />
                        </button>
                        <button
                          className="text-button"
                          onClick={() => open({ type: "statement-credit" })}
                        >
                          Statement credit
                        </button>
                      </div>
                    )}
                  </section>
                  <section className="panel info-card">
                    <span className="info-card-icon">
                      <Icon name="clock" size={21} />
                    </span>
                    <h2>
                      {pending
                        ? `${pending} ${pending === 1 ? "item needs" : "items need"} a look`
                        : "A little review, a lighter day"}
                    </h2>
                    <p>
                      {pending
                        ? "Review categories and account updates in one persistent inbox. Nothing gets lost between days."
                        : "New activity stays in your review inbox until you’ve had a chance to look it over."}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => {
                        setTab("transactions");
                        setReviewOnly(true);
                      }}
                    >
                      Open review inbox <Icon name="arrow" size={14} />
                    </button>
                  </section>
                  <section className="panel info-card">
                    <h2>Paid and personal</h2>
                    <p>
                      You paid <Amount value={view.amountPaid} /> this month.
                      Your personal expense share is{" "}
                      <Amount value={view.personalSpending} />. Shared
                      obligations stay separate from your cash.
                    </p>
                  </section>
                </div>
              </div>
            </>
          )}

          {tab === "transactions" && (
            <div className="stack">
              <BankInbox state={state} />
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <h2>
                      {reviewOnly ? "Needs your review" : "All transactions"}
                    </h2>
                    <p>Recorded activity and inspectable changes</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setReviewOnly(!reviewOnly)}
                  >
                    {reviewOnly
                      ? "View all"
                      : `Review inbox${pending ? ` (${pending})` : ""}`}
                  </button>
                </div>
                <div className="table-toolbar">
                  <input
                    aria-label="Search transactions by payee"
                    placeholder="Search payees…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <button
                    className="secondary-button"
                    disabled={selected.length === 0 || busy}
                    onClick={() => approveTransactions(selected, run)}
                  >
                    <Icon name="check" size={14} />
                    Approve{" "}
                    {selected.length ? `(${selected.length})` : "selected"}
                  </button>
                  <button
                    className="text-button toolbar-end"
                    onClick={() => open({ type: "reconcile" })}
                  >
                    Reconcile a statement
                  </button>
                </div>
                {transactions.length === 0 ? (
                  <EmptyState
                    icon={reviewOnly ? "check" : "transactions"}
                    title={
                      reviewOnly
                        ? "You’re all caught up."
                        : search
                          ? "No matching transactions."
                          : "Your everyday, in one place."
                    }
                    action={
                      !reviewOnly && !search ? (
                        <button
                          className="primary-button"
                          onClick={() => open({ type: "transaction" })}
                        >
                          Record a transaction
                        </button>
                      ) : undefined
                    }
                  >
                    {reviewOnly
                      ? "Anything that needs your attention will stay here until it’s resolved."
                      : search
                        ? "Try searching for a different payee."
                        : "Record a purchase, income, or payment. Connected bank updates will appear here when that service is configured."}
                  </EmptyState>
                ) : (
                  <div className="data-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>
                            <input
                              className="table-checkbox"
                              type="checkbox"
                              aria-label="Select all visible transactions"
                              checked={
                                transactions.length > 0 &&
                                transactions.every((transaction) =>
                                  selected.includes(transaction.id),
                                )
                              }
                              onChange={(event) =>
                                setSelected(
                                  event.target.checked
                                    ? transactions.map(
                                        (transaction) => transaction.id,
                                      )
                                    : [],
                                )
                              }
                            />
                          </th>
                          <th>Date / Payee</th>
                          <th>Account</th>
                          <th>Category</th>
                          <th className="number">Amount</th>
                          <th>Review</th>
                        </tr>
                      </thead>
                      <tbody>
                        {transactions.map((transaction) => (
                          <tr key={transaction.id}>
                            <td>
                              <input
                                className="table-checkbox"
                                type="checkbox"
                                aria-label={`Select ${transaction.payee}`}
                                checked={selected.includes(transaction.id)}
                                onChange={(event) =>
                                  setSelected((previous) =>
                                    event.target.checked
                                      ? [...previous, transaction.id]
                                      : previous.filter(
                                          (id) => id !== transaction.id,
                                        ),
                                  )
                                }
                              />
                            </td>
                            <td>
                              <button
                                className="amount-button"
                                style={{ padding: 0, fontWeight: 500 }}
                                onClick={() =>
                                  open({ type: "history", id: transaction.id })
                                }
                              >
                                {transaction.payee}
                              </button>
                              <small>
                                {transaction.date} · {transaction.status}
                                {transaction.expenseMonth &&
                                transaction.expenseMonth !==
                                  transaction.date.slice(0, 7)
                                  ? ` · for ${monthName(transaction.expenseMonth)}`
                                  : ""}
                              </small>
                            </td>
                            <td>
                              {
                                view.accounts.find(
                                  (account) =>
                                    account.id === transaction.accountId,
                                )?.name
                              }
                            </td>
                            <td>
                              <button
                                className="amount-button"
                                disabled={
                                  !["purchase", "income", "refund"].includes(
                                    transaction.kind,
                                  )
                                }
                                onClick={() =>
                                  open({
                                    type: "transaction",
                                    id: transaction.id,
                                  })
                                }
                              >
                                {view.categories.find(
                                  (category) =>
                                    category.id === transaction.categoryId,
                                )?.name ??
                                  (transaction.amount > 0
                                    ? "Ready to Assign"
                                    : "Choose category")}
                              </button>
                            </td>
                            <td className="number">
                              <Amount value={transaction.amount} signed />
                            </td>
                            <td>
                              {transaction.reviewed ? (
                                <span className="small muted">Approved</span>
                              ) : (
                                <span className="badge review">
                                  Needs review
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="panel-footer">
                  <Icon name="shield" size={13} />
                  Card, loan, and partner payments are recorded here after you
                  make them outside Caishen.
                </div>
              </section>
              <CategorySuggestions
                state={state}
                selected={selected}
                run={run}
                busy={busy}
              />
            </div>
          )}

          {tab === "shared" && (
            <SharedView
              view={view}
              month={month}
              open={open}
              inviteCode={invite.data?.code}
              inviteBusy={invite.isPending}
              inviteError={invite.error?.message}
              onInvite={() => invite.mutate()}
            />
          )}
          {tab === "loans" && <LoansView view={view} open={open} />}
          {tab === "settings" && (
            <SettingsView
              state={state}
              run={run}
              busy={busy}
              open={open}
              sync={() => sync.mutate()}
              syncBusy={sync.isPending}
            />
          )}
        </main>
      </div>
      {notice && (
        <div className="success-toast" role="status">
          <Icon name="check" size={17} />
          {notice}
        </div>
      )}
      {panel && (
        <CommandDialog
          panel={panel}
          view={view}
          month={month}
          error={formError}
          busy={busy}
          run={run}
          onClose={() => setPanel(null)}
          onError={setFormError}
          onImport={(value) =>
            importCategories.mutate({
              text: value,
              expectedRevision: state.revision,
            })
          }
          onJoin={(code) => join.mutate({ code })}
        />
      )}
    </div>
  );
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
function TimezoneOptions() {
  return (
    <>
      {[
        "America/Los_Angeles",
        "America/Denver",
        "America/Chicago",
        "America/New_York",
        "America/Phoenix",
        "America/Anchorage",
        "Pacific/Honolulu",
      ].map((timezone) => (
        <option key={timezone} value={timezone}>
          {timezone
            .replace("America/", "")
            .replace("Pacific/", "")
            .replaceAll("_", " ")}
        </option>
      ))}
    </>
  );
}

function approveTransactions(
  transactionIds: string[],
  run: (command: Command) => void,
) {
  run({ type: "transaction.approve", id: newId(), transactionIds });
}

function SharedView({
  view,
  month,
  open,
  inviteCode,
  inviteBusy,
  inviteError,
  onInvite,
}: {
  view: View & {};
  month: string;
  open: (panel: Panel) => void;
  inviteCode?: string;
  inviteBusy: boolean;
  inviteError?: string;
  onInvite: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const partner = view.members.find(
    (member) => member.userId !== view.budget.userId,
  );
  return (
    <div className="stack">
      {!partner && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Two budgets. One shared understanding.</h2>
              <p>
                Connect with your partner to share only what you need to settle
                expenses.
              </p>
            </div>
          </div>
          <div className="panel-body">
            <p className="muted" style={{ maxWidth: "65ch", fontSize: 12 }}>
              Your account balances and unrelated transactions stay private.
              Your partner creates their own budget, then joins using your
              invitation code.
            </p>
            <div className="heading-actions" style={{ marginTop: 17 }}>
              <button
                className="primary-button"
                disabled={inviteBusy}
                onClick={onInvite}
              >
                {inviteBusy ? "Creating invitation…" : "Create invitation code"}
              </button>
              <button
                className="secondary-button"
                onClick={() => open({ type: "join" })}
              >
                Enter partner’s code
              </button>
            </div>
            {inviteCode && (
              <div style={{ marginTop: 20 }}>
                <p className="section-label">
                  Share this code with your partner
                </p>
                <p className="inline-code">{inviteCode}</p>
                <button
                  className="text-button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(inviteCode);
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy code"}
                </button>
              </div>
            )}
            {inviteError && (
              <p className="form-error" role="alert" style={{ marginTop: 15 }}>
                {inviteError}
              </p>
            )}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{monthName(month)} settlement</h2>
            <p>
              Unpaid amounts carry forward. Viewing this report changes nothing.
            </p>
          </div>
          {partner && (
            <button
              className="secondary-button"
              disabled={
                view.settlement.net < 0 ||
                !view.obligations.some(
                  (obligation) => obligation.outstanding > 0,
                )
              }
              onClick={() => open({ type: "settlement" })}
            >
              Record net repayment
            </button>
          )}
        </div>
        <div className="report-summary">
          <div>
            <span>You owe</span>
            <strong>
              <Amount value={view.settlement.youOwe} />
            </strong>
          </div>
          <div>
            <span>Owed to you</span>
            <strong>
              <Amount value={view.settlement.owedToYou} />
            </strong>
          </div>
          <div>
            <span>
              {view.settlement.net >= 0
                ? "Your net payment"
                : "Net owed to you"}
            </span>
            <strong>
              <Amount value={Math.abs(view.settlement.net)} />
            </strong>
          </div>
        </div>
        {view.obligations.length ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Shared expense</th>
                  <th>Expense period</th>
                  <th>Direction</th>
                  <th className="number">Still owed</th>
                </tr>
              </thead>
              <tbody>
                {view.obligations.map((obligation) => (
                  <tr key={obligation.id}>
                    <td>
                      <strong>
                        {
                          view.sharedCategories.find(
                            (category) =>
                              category.id === obligation.sharedCategoryId,
                          )?.name
                        }
                      </strong>
                      <small>
                        {obligation.opening
                          ? "Opening amount · already split"
                          : (obligation.payee ?? "Shared expense")}
                      </small>
                    </td>
                    <td>
                      {obligation.expenseMonth
                        ? monthName(obligation.expenseMonth)
                        : "Opening balance"}
                    </td>
                    <td>
                      {obligation.debtorId === view.budget.userId
                        ? "You owe partner"
                        : "Partner owes you"}
                    </td>
                    <td className="number">
                      <Amount value={obligation.outstanding} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="shared" title="A clear start, together.">
            Shared purchases and opening amounts owed will appear here. Only
            actual repayments clear your balance.
          </EmptyState>
        )}
        <div className="panel-footer">
          <Icon name="shield" size={13} />
          Make repayments in your banking app, then record them here.
        </div>
      </section>
      <section className="panel">
        <details className="shared-inspection">
          <summary>Inspect full payments and original splits</summary>
          {view.sharedExpenses.length ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Expense</th>
                    <th>Paid by</th>
                    <th className="number">Full amount paid</th>
                    <th className="number">Your share</th>
                    <th className="number">Partner’s share</th>
                    <th>History</th>
                  </tr>
                </thead>
                <tbody>
                  {view.sharedExpenses
                    .filter((expense) => expense.expenseMonth === month)
                    .map((expense) => (
                      <tr key={`${expense.payerId}:${expense.transactionId}`}>
                        <td>
                          <strong>{expense.payee}</strong>
                          <small>
                            {expense.date} · for{" "}
                            {monthName(expense.expenseMonth)}
                          </small>
                        </td>
                        <td>
                          {expense.payerId === view.budget.userId
                            ? "You"
                            : "Partner"}
                        </td>
                        <td className="number">
                          <Amount value={expense.amountPaid} />
                        </td>
                        <td className="number">
                          <Amount
                            value={expense.shares[view.budget.userId] ?? 0}
                          />
                        </td>
                        <td className="number">
                          <Amount
                            value={
                              partner
                                ? (expense.shares[partner.userId] ?? 0)
                                : 0
                            }
                          />
                        </td>
                        <td>
                          <details>
                            <summary className="small muted">
                              {expense.history.length} records
                            </summary>
                            {expense.history.map((entry, index) => (
                              <p className="field-hint" key={index}>
                                {entry.date} · {entry.reason} · {entry.status} ·{" "}
                                <Amount value={entry.amount} />
                              </p>
                            ))}
                          </details>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small" style={{ padding: 20 }}>
              Shared purchases will retain the payer’s full payment and the
              original allocation for both people to inspect.
            </p>
          )}
        </details>
      </section>
      <div className="two-column">
        <section className="panel">
          <div className="panel-header">
            <h2>Shared categories</h2>
            <button
              className="text-button"
              disabled={!partner}
              onClick={() => open({ type: "opening" })}
            >
              Opening amount owed
            </button>
          </div>
          <div className="panel-body">
            {view.sharedCategories.length ? (
              view.sharedCategories.map((category) => (
                <div className="account-row" key={category.id}>
                  <span className="account-symbol">
                    <Icon name="shared" size={17} />
                  </span>
                  <div className="account-label">
                    <strong>{category.name}</strong>
                    <small>
                      Your split:{" "}
                      {Math.round(
                        ((category.weights[view.budget.userId] ?? 0) /
                          Object.values(category.weights).reduce(
                            (sum, weight) => sum + weight,
                            0,
                          )) *
                          100,
                      )}
                      % · full cash funded separately
                    </small>
                  </div>
                  <button
                    className="text-button"
                    onClick={() =>
                      open({ type: "shared-category", id: category.id })
                    }
                  >
                    Edit split
                  </button>
                </div>
              ))
            ) : (
              <p className="muted small">
                {partner
                  ? "Create a shared category and choose its split. Equal shares are the default."
                  : "Connect with your partner to create shared categories."}
              </p>
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Reimbursements</h2>
            <button
              className="text-button"
              disabled={
                !view.budget.transactions.some(
                  (transaction) => transaction.amount < 0,
                )
              }
              onClick={() => open({ type: "reimbursement" })}
            >
              <Icon name="plus" size={14} />
              Add expected
            </button>
          </div>
          <div className="panel-body">
            {view.reimbursements.length ? (
              view.reimbursements.map((claim) => (
                <div className="account-row" key={claim.id}>
                  <span className="account-symbol">
                    <Icon name="transactions" size={17} />
                  </span>
                  <div className="account-label">
                    <strong>{claim.name}</strong>
                    <small>
                      {formatMoney(claim.outstanding)} expected ·{" "}
                      {claim.kind === "cash" ? "cash" : "statement credit"}
                    </small>
                  </div>
                  {claim.outstanding > 0 && (
                    <button
                      className="text-button"
                      onClick={() =>
                        open({
                          type:
                            claim.kind === "cash"
                              ? "receive"
                              : "statement-credit",
                          id: claim.id,
                        })
                      }
                    >
                      Record received
                    </button>
                  )}
                </div>
              ))
            ) : (
              <p className="muted small">
                Expected reimbursements stay separate from spendable cash.
                Record receipts when the money actually arrives.
              </p>
            )}
          </div>
        </section>
      </div>
      {view.settlements
        .filter(
          (settlement) =>
            settlement.recipientId === view.budget.userId &&
            !settlement.received,
        )
        .map((settlement) => (
          <section className="panel info-card" key={settlement.id}>
            <h2>
              Partner recorded a repayment of{" "}
              <Amount value={settlement.amount} />
            </h2>
            <p>
              Confirm the actual deposit in your account before recording
              receipt.
            </p>
            <button
              className="secondary-button"
              onClick={() =>
                open({ type: "receive", id: `settlement:${settlement.id}` })
              }
            >
              Record receipt
            </button>
          </section>
        ))}
    </div>
  );
}

function LoansView({
  view,
  open,
}: {
  view: View & {};
  open: (panel: Panel) => void;
}) {
  const [extra, setExtra] = useState<Record<string, string>>({});
  if (!view.loans.length)
    return (
      <section className="panel">
        <EmptyState
          icon="loans"
          title="A clear view of the way forward."
          action={
            <button
              className="primary-button"
              onClick={() => open({ type: "loan" })}
            >
              Add your first loan
            </button>
          }
        >
          Add a fixed-rate personal loan or variable-rate student loan. Pair it
          with a payment category to see what you’ve funded and what comes next.
        </EmptyState>
        <div className="panel-footer">
          Forecasts are estimates. Your lender’s confirmed records determine
          actual principal, interest, and balances.
        </div>
      </section>
    );
  return (
    <div className="two-column">
      {view.loans.map((loan) => {
        const extraCents = Math.round(Number(extra[loan.id] ?? 0) * 100);
        const forecast =
          Number.isSafeInteger(extraCents) && extraCents > 0
            ? forecastLoan(
                { ...loan, minimumPayment: loan.forecast.payment },
                view.month,
                extraCents,
              )
            : loan.forecast;
        return (
          <section className="panel loan-card" key={loan.id}>
            <div className="loan-heading">
              <div>
                <h2>{loan.name}</h2>
                <p>
                  {loan.variable
                    ? "Variable-rate student loan"
                    : "Fixed-rate personal loan"}{" "}
                  · {(loan.forecast.rateBps / 100).toFixed(2)}% APR
                </p>
              </div>
              <span className="account-symbol">
                <Icon name="loans" size={20} />
              </span>
            </div>
            <Amount className="loan-balance" value={loan.balance} />
            <dl className="loan-details">
              <div>
                <dt>Required payment</dt>
                <dd>
                  <Amount value={loan.minimumPayment} />
                </dd>
              </div>
              <div>
                <dt>Funded in payment category</dt>
                <dd>
                  <Amount value={loan.funded} />
                </dd>
              </div>
              <div>
                <dt>Estimated payoff</dt>
                <dd>
                  {forecast.payoffMonth
                    ? monthName(forecast.payoffMonth)
                    : "Payment too low"}
                </dd>
              </div>
              <div>
                <dt>Estimated remaining interest</dt>
                <dd>
                  {forecast.interest === null ? (
                    "Unable to estimate"
                  ) : (
                    <Amount value={forecast.interest} />
                  )}
                </dd>
              </div>
            </dl>
            <div style={{ marginTop: 19 }}>
              <FormField
                label="Preview a one-time extra payment"
                name={`extra-${loan.id}`}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={extra[loan.id] ?? ""}
                placeholder="0.00"
                onChange={(event) =>
                  setExtra((previous) => ({
                    ...previous,
                    [loan.id]: event.target.value,
                  }))
                }
                hint="This preview changes no funding and initiates no payment."
              />
              <p className="field-hint" style={{ marginTop: 9 }}>
                {forecast.assumption}
              </p>
            </div>
            <div className="loan-actions">
              <button
                className="primary-button"
                onClick={() => open({ type: "loan-payment", id: loan.id })}
              >
                Record lender payment
              </button>
              {loan.variable && (
                <button
                  className="text-button"
                  onClick={() => open({ type: "rate", id: loan.id })}
                >
                  Update rate
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function SettingsView({
  state,
  run,
  busy,
  open,
  sync,
  syncBusy,
}: {
  state: State;
  run: (command: Command) => void;
  busy: boolean;
  open: (panel: Panel) => void;
  sync: () => void;
  syncBusy: boolean;
}) {
  const view = state.view!;
  return (
    <div className="main-grid">
      <div className="stack">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Personal preferences</h2>
              <p>Your budget and daily review</p>
            </div>
          </div>
          <form
            className="panel-body"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run({
                type: "settings.update",
                id: newId(),
                name: text(data, "name"),
                timezone: text(data, "timezone"),
                emailEnabled: data.has("emailEnabled"),
                emailHour: Number(text(data, "emailHour")),
              });
            }}
          >
            <div className="form-grid">
              <FormField
                label="Budget name"
                name="name"
                defaultValue={view.budget.name}
                maxLength={120}
                required
              />
              <div className="form-row">
                <SelectField
                  label="Timezone"
                  name="timezone"
                  defaultValue={view.budget.settings.timezone}
                >
                  <TimezoneOptions />
                </SelectField>
                <SelectField
                  label="Daily email time"
                  name="emailHour"
                  defaultValue={view.budget.settings.emailHour}
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {new Date(2026, 0, 1, hour).toLocaleTimeString("en-US", {
                        hour: "numeric",
                      })}
                    </option>
                  ))}
                </SelectField>
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  name="emailEnabled"
                  defaultChecked={view.budget.settings.emailEnabled}
                />
                <span>
                  Send my daily review email
                  <p className="field-hint">
                    Email links to your private inbox. Delivery requires the
                    email service and hosted scheduler to be configured.
                  </p>
                </span>
              </label>
            </div>
            <div className="form-actions">
              <button className="primary-button" disabled={busy}>
                {busy ? "Saving…" : "Save preferences"}
              </button>
            </div>
          </form>
        </section>
        <BankConnections state={state} />
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Services & account updates</h2>
              <p>Live availability, without the guesswork</p>
            </div>
            <button
              className="secondary-button"
              onClick={sync}
              disabled={syncBusy || !state.connections.length}
            >
              {syncBusy ? "Updating…" : "Update accounts"}
            </button>
          </div>
          <div className="panel-body">
            {state.services.map((service) => (
              <div className="service-row" key={service.name}>
                <div>
                  <strong>{service.name}</strong>
                  <p>{service.detail}</p>
                </div>
                <span
                  className={`badge${service.status === "configured" ? "" : "warning"}`}
                >
                  {service.status === "configured"
                    ? "Configured"
                    : "Setup needed"}
                </span>
              </div>
            ))}
          </div>
          <div className="panel-footer">
            Daily account updates depend on your institution. A recent cached
            balance alone does not prove reconciliation.
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Standing rules</h2>
              <p>Only rules you explicitly establish can cover overspending.</p>
            </div>
          </div>
          <div className="panel-body">
            {view.budget.rules.length ? (
              view.budget.rules.map((rule) => (
                <p key={rule.id} className="small">
                  Cover{" "}
                  {
                    view.categories.find(
                      (category) => category.id === rule.toCategoryId,
                    )?.name
                  }{" "}
                  from{" "}
                  {
                    view.categories.find(
                      (category) => category.id === rule.fromCategoryId,
                    )?.name
                  }{" "}
                  · {rule.enabled ? "Enabled" : "Disabled"}
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run({
                        type: "rule.set",
                        id: newId(),
                        ruleId: rule.id,
                        fromCategoryId: rule.fromCategoryId,
                        toCategoryId: rule.toCategoryId,
                        enabled: !rule.enabled,
                      })
                    }
                  >
                    {rule.enabled ? "Disable" : "Enable"}
                  </button>
                </p>
              ))
            ) : (
              <p className="small muted">
                No standing rules. Cover overspending by choosing and moving
                money yourself.
              </p>
            )}
            <button
              className="text-button"
              style={{ marginTop: 10 }}
              disabled={view.categories.length < 2}
              onClick={() => open({ type: "rule" })}
            >
              Create a standing rule
            </button>
          </div>
        </section>
      </div>
      <div className="stack">
        <section className="panel info-card">
          <span className="info-card-icon">
            <Icon name="shield" size={21} />
          </span>
          <h2>Private by design</h2>
          <p>
            Your partner sees shared expenses, allocations, and repayments
            needed for settlement. Your unrelated transactions and account
            balances stay private.
          </p>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Recent budget activity</h2>
          </div>
          <div className="panel-body">
            {view.audit.length ? (
              <ul className="audit-list">
                {view.audit
                  .slice(-10)
                  .reverse()
                  .map((entry) => (
                    <li key={entry.id}>
                      <span className="muted">#{entry.sequence}</span>
                      <span>
                        {entry.type.replaceAll(".", " · ")}
                        <small className="muted" style={{ display: "block" }}>
                          {entry.source === "user"
                            ? "Your action"
                            : "Agent bookkeeping"}
                        </small>
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="small muted">
                Your validated budget changes will appear here.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const saveLabels: Partial<Record<Panel["type"], string>> = {
  account: "Add account",
  category: "Create category",
  assign: "Assign money",
  transaction: "Record transaction",
  "card-payment": "Record payment",
  "statement-credit": "Record posted credit",
  reimbursement: "Save expected reimbursement",
  receive: "Record receipt",
  "shared-category": "Save shared category",
  opening: "Save opening amount",
  settlement: "Record repayment",
  loan: "Add loan",
  "loan-payment": "Record lender payment",
  rate: "Save confirmed rate",
  target: "Save target",
  rule: "Create standing rule",
};

const dialogTitles: Record<Panel["type"], string> = {
  account: "Add an account",
  category: "Create a category",
  assign: "Assign your money",
  transaction: "Record a transaction",
  import: "Bring your categories from YNAB",
  "card-payment": "Record a card payment",
  "statement-credit": "Record a statement credit",
  reimbursement: "Expect a reimbursement",
  receive: "Record money received",
  "shared-category": "Set up a shared category",
  opening: "Opening amount owed",
  settlement: "Record a net repayment",
  loan: "Add a loan",
  "loan-payment": "Record a lender payment",
  rate: "Update a confirmed loan rate",
  reconcile: "Reconcile a bank statement",
  target: "Set a category target",
  join: "Connect with your partner",
  rule: "Create a standing rule",
  history: "Transaction history",
};

function CommandDialog({
  panel,
  view,
  month,
  error,
  busy,
  run,
  onClose,
  onError,
  onImport,
  onJoin,
}: {
  panel: Panel;
  view: View & {};
  month: string;
  error: string;
  busy: boolean;
  run: (command: Command) => void;
  onClose: () => void;
  onError: (error: string) => void;
  onImport: (text: string) => void;
  onJoin: (code: string) => void;
}) {
  const [direction, setDirection] = useState(() =>
    (view.budget.transactions.find((item) => item.id === panel.id)?.amount ??
      -1) > 0
      ? "income"
      : "expense",
  );
  const [targetCadence, setTargetCadence] = useState<string>(() => {
    const value = view.categories.find((item) => item.id === panel.id);
    return (
      value?.target?.cadence ??
      (value?.pairedAccountId
        ? "card-monthly"
        : value?.pairedLoanId
          ? "loan"
          : "monthly")
    );
  });
  const [targetBehavior, setTargetBehavior] = useState<string>(
    () =>
      view.categories.find((item) => item.id === panel.id)?.target?.behavior ??
      "refill",
  );
  const [operationId] = useState(newId);
  const [entityId] = useState(newId);
  const [fileText, setFileText] = useState("");
  const [result, setResult] = useState<
    RouterOutputs["budget"]["reconcile"] | null
  >(null);
  const utils = api.useUtils();
  const reconcile = api.budget.reconcile.useMutation({
    onSuccess: async (output) => {
      await utils.budget.state.invalidate();
      setResult(output);
    },
    onError: (failure) => onError(failure.message),
  });
  const transaction = view.budget.transactions.find(
    (item) => item.id === panel.id,
  );
  const category = view.categories.find((item) => item.id === panel.id);
  const shared = view.sharedCategories.find((item) => item.id === panel.id);
  const loan = view.loans.find((item) => item.id === panel.id);
  const claim = view.reimbursements.find((item) => item.id === panel.id);
  const partner = view.members.find(
    (member) => member.userId !== view.budget.userId,
  );
  const cashAccounts = view.accounts.filter(
    (account) => account.kind === "cash",
  );
  const cards = view.accounts.filter((account) => account.kind === "credit");
  const categories = view.categories.filter(
    (item) => !item.pairedAccountId && !item.pairedLoanId,
  );
  const accountOptions = (accounts = view.accounts) => (
    <>
      {accounts.length === 0 && <option value="">Add an account first</option>}
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
    </>
  );
  const categoryOptions = (all = categories) => (
    <>
      {all.length === 0 && <option value="">Create a category first</option>}
      {all.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </>
  );
  const noAccounts =
    [
      "transaction",
      "card-payment",
      "statement-credit",
      "receive",
      "loan-payment",
      "reconcile",
    ].includes(panel.type) && !view.accounts.length;
  const noCategories =
    ["assign", "shared-category"].includes(panel.type) && !categories.length;
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onError("");
    const data = new FormData(event.currentTarget);
    const id = operationId;
    try {
      switch (panel.type) {
        case "account": {
          const kind = text(data, "kind") as "cash" | "credit";
          run({
            type: "account.add",
            id,
            accountId: entityId,
            name: text(data, "name"),
            kind,
            openingBalance:
              kind === "credit"
                ? -Math.abs(money(data, "openingBalance"))
                : money(data, "openingBalance"),
            date: text(data, "date"),
          });
          break;
        }
        case "category":
          run({
            type: "category.add",
            id,
            categoryId: entityId,
            name: text(data, "name"),
            group: text(data, "group") || "Everyday",
          });
          break;
        case "assign": {
          const from = text(data, "fromCategoryId");
          if (from)
            run({
              type: "cover",
              id,
              fromCategoryId: from,
              toCategoryId: text(data, "categoryId"),
              month,
              amount: money(data, "amount"),
            });
          else
            run({
              type: "assign",
              id,
              categoryId: text(data, "categoryId"),
              month,
              amount: money(data, "amount"),
            });
          break;
        }
        case "transaction": {
          const amount = money(data, "amount");
          const selectedShared = text(data, "sharedCategoryId");
          const ownShare = text(data, "ownShare");
          const shares =
            ownShare && selectedShared && partner
              ? {
                  [view.budget.userId]: money(data, "ownShare"),
                  [partner.userId]: Math.abs(amount) - money(data, "ownShare"),
                }
              : undefined;
          run({
            type: "transaction.upsert",
            id,
            transactionId: transaction?.id ?? entityId,
            accountId: text(data, "accountId"),
            date: text(data, "date"),
            amount:
              text(data, "direction") === "income"
                ? Math.abs(amount)
                : -Math.abs(amount),
            payee: text(data, "payee"),
            categoryId:
              text(data, "direction") === "income"
                ? undefined
                : text(data, "categoryId") || undefined,
            status: text(data, "status") as "pending" | "posted",
            expenseMonth: text(data, "expenseMonth") || undefined,
            sharedCategoryId: selectedShared || undefined,
            shares,
            reviewed: false,
            revision: transaction ? transaction.revision + 1 : undefined,
          });
          break;
        }
        case "import":
          onImport(fileText || text(data, "importText"));
          break;
        case "rule":
          run({
            type: "rule.set",
            id,
            ruleId: entityId,
            fromCategoryId: text(data, "fromCategoryId"),
            toCategoryId: text(data, "toCategoryId"),
            enabled: true,
          });
          break;
        case "join":
          onJoin(text(data, "code"));
          break;
        case "card-payment":
          run({
            type: "card.payment",
            id,
            cashAccountId: text(data, "cashAccountId"),
            cardAccountId: text(data, "cardAccountId"),
            date: text(data, "date"),
            amount: money(data, "amount"),
          });
          break;
        case "statement-credit":
          run({
            type: "card.credit",
            id,
            accountId: text(data, "accountId"),
            date: text(data, "date"),
            amount: money(data, "amount"),
            reimbursementId: claim?.id,
            posted: true,
          });
          break;
        case "reimbursement":
          run({
            type: "reimbursement.expect",
            id,
            reimbursementId: entityId,
            transactionId: text(data, "transactionId"),
            name: text(data, "name"),
            amount: money(data, "amount"),
            kind: text(data, "kind") as "cash" | "statement-credit",
          });
          break;
        case "receive": {
          if (panel.id?.startsWith("settlement:"))
            run({
              type: "settlement.receive",
              id,
              settlementId: panel.id.slice(11),
              accountId: text(data, "accountId"),
              date: text(data, "date"),
            });
          else if (claim)
            run({
              type: "reimbursement.receive",
              id,
              reimbursementId: claim.id,
              accountId: text(data, "accountId"),
              date: text(data, "date"),
              amount: money(data, "amount"),
            });
          break;
        }
        case "shared-category": {
          if (!partner)
            throw new Error(
              "Connect with your partner before creating a shared category.",
            );
          const percent = Number(text(data, "percent"));
          const weights = {
            [view.budget.userId]: percent,
            [partner.userId]: 100 - percent,
          };
          if (shared)
            run({
              type: "shared.rule",
              id,
              sharedCategoryId: shared.id,
              weights,
            });
          else
            run({
              type: "shared.create",
              id,
              sharedCategoryId: entityId,
              name: text(data, "name"),
              participants: [view.budget.userId, partner.userId],
              weights,
              categoryIds: {
                [view.budget.userId]: text(data, "categoryId"),
                [partner.userId]: `${entityId}:partner`,
              },
            });
          break;
        }
        case "opening": {
          if (!partner) throw new Error("Connect with your partner first.");
          const youOwe = text(data, "direction") === "you-owe";
          run({
            type: "opening.add",
            id,
            obligationId: entityId,
            sharedCategoryId: text(data, "sharedCategoryId"),
            debtorId: youOwe ? view.budget.userId : partner.userId,
            creditorId: youOwe ? partner.userId : view.budget.userId,
            amount: money(data, "amount"),
          });
          break;
        }
        case "settlement": {
          if (!partner) throw new Error("Connect with your partner first.");
          run({
            type: "settlement.record",
            id,
            settlementId: entityId,
            otherUserId: partner.userId,
            date: text(data, "date"),
            accountId: text(data, "accountId") || undefined,
            amount: money(data, "amount"),
          });
          break;
        }
        case "loan":
          run({
            type: "loan.add",
            id,
            loanId: entityId,
            categoryId: text(data, "categoryId") || `${entityId}:category`,
            name: text(data, "name"),
            principal: money(data, "principal"),
            annualRateBps: Math.round(Number(text(data, "annualRate")) * 100),
            minimumPayment: money(data, "minimumPayment"),
            variable: text(data, "variable") === "variable",
            effectiveDate: text(data, "effectiveDate"),
          });
          break;
        case "loan-payment":
          if (loan)
            run({
              type: "loan.payment",
              id,
              loanId: loan.id,
              accountId: text(data, "accountId"),
              date: text(data, "date"),
              principal: money(data, "principal"),
              interest: money(data, "interest"),
            });
          break;
        case "rate":
          if (loan)
            run({
              type: "loan.rate",
              id,
              loanId: loan.id,
              annualRateBps: Math.round(Number(text(data, "annualRate")) * 100),
              effectiveDate: text(data, "effectiveDate"),
            });
          break;
        case "target": {
          if (!category) throw new Error("Choose a category.");
          run({
            type: "target.set",
            id,
            categoryId: category.id,
            target: {
              cadence: text(data, "cadence") as
                | "weekly"
                | "monthly"
                | "yearly"
                | "custom"
                | "card-monthly"
                | "card-payoff"
                | "loan",
              behavior: text(data, "behavior") as
                "contribution" | "refill" | "balance",
              amount: money(data, "amount"),
              startMonth: text(data, "startMonth"),
              dueDate: text(data, "dueDate") || undefined,
              weekday: text(data, "weekday")
                ? Number(text(data, "weekday"))
                : undefined,
              repeatEvery: text(data, "repeatEvery")
                ? Number(text(data, "repeatEvery"))
                : undefined,
              repeatUnit: text(data, "repeatUnit")
                ? (text(data, "repeatUnit") as "months" | "years")
                : undefined,
              snoozedMonths: category.target?.snoozedMonths ?? [],
            },
          });
          break;
        }
        case "reconcile":
          reconcile.mutate({
            accountId: text(data, "accountId"),
            periodStart: text(data, "periodStart"),
            cutoff: text(data, "cutoff"),
            openingBalanceCents: money(data, "openingBalance"),
            closingBalanceCents: money(data, "closingBalance"),
            csv: fileText || text(data, "csv"),
            verified: data.has("verified"),
          });
          break;
      }
    } catch (failure) {
      onError(
        failure instanceof Error
          ? failure.message
          : "Check your entries and try again.",
      );
    }
  };
  const readFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      onError("Choose a file smaller than 2 MB.");
      return;
    }
    setFileText(await file.text());
  };
  return (
    <Dialog
      title={
        panel.type === "history"
          ? "Transaction history"
          : shared
            ? "Change the split"
            : transaction
              ? "Review transaction"
              : dialogTitles[panel.type]
      }
      description={
        panel.type === "assign"
          ? "A manual decision, using only your real cash."
          : panel.type === "settlement"
            ? "Record a payment you’ve already made. Mutual obligations are offset without a fictional deposit."
            : panel.type === "reconcile"
              ? "Compare cleared activity at the same cutoff. Differences remain visible; no balancing adjustment is created."
              : undefined
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {error && (
          <p className="form-error" role="alert">
            ! {error}
          </p>
        )}
        {noAccounts && (
          <p className="notice warning">
            Add an account before recording this activity.
          </p>
        )}
        {noCategories && (
          <p className="notice warning">
            Create a category first so this money has a place.
          </p>
        )}
        <div className="form-grid">
          {panel.type === "history" && transaction && (
            <>
              <p>
                <strong>{transaction.payee}</strong> ·{" "}
                <Amount value={transaction.amount} />
              </p>
              <p className="small muted">
                {transaction.kind.replaceAll("-", " ")} · {transaction.date} ·{" "}
                {transaction.status}
              </p>
              <TransactionHistory transaction={transaction} />
            </>
          )}
          {panel.type === "account" && (
            <>
              <FormField
                label="Account name"
                name="name"
                placeholder="Everyday checking"
                required
                maxLength={120}
                autoFocus
              />
              <div className="form-row">
                <SelectField label="Account type" name="kind">
                  <option value="cash">Cash / checking / savings</option>
                  <option value="credit">Credit card</option>
                </SelectField>
                <FormField
                  label="Opening balance ($)"
                  name="openingBalance"
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                  hint="For a card, enter the amount owed."
                />
              </div>
              <FormField
                label="Balance as of"
                name="date"
                type="date"
                defaultValue={`${month}-01`}
                min={`${view.budget.startMonth}-01`}
                required
              />
              <p className="field-hint">
                This is a manual account. It does not connect to your bank. Cash
                is Ready to Assign; card debt creates no cash.
              </p>
            </>
          )}
          {panel.type === "category" && (
            <>
              <FormField
                label="Category name"
                name="name"
                placeholder="Groceries"
                maxLength={120}
                required
                autoFocus
              />
              <FormField
                label="Category group"
                name="group"
                defaultValue="Everyday"
                maxLength={120}
              />
              <p className="field-hint">
                Creating a category assigns no money. You decide how to fund it.
              </p>
            </>
          )}
          {panel.type === "assign" && (
            <>
              <SelectField
                label="Category to fund"
                name="categoryId"
                defaultValue={panel.id}
              >
                {categoryOptions(view.categories)}
              </SelectField>
              <SelectField label="Move money from" name="fromCategoryId">
                <option value="">
                  Ready to Assign · {formatMoney(view.readyToAssign)}
                </option>
                {categoryOptions(view.categories)}
              </SelectField>
              <FormField
                label="Amount to add ($)"
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                required
                hint="Enter a negative amount from Ready to Assign to return category funds."
                autoFocus
              />
              <p className="field-hint">
                Current month: {monthName(month)}. Targets guide funding and
                never assign money.
              </p>
            </>
          )}
          {panel.type === "transaction" && (
            <>
              <FormField
                label="Payee"
                name="payee"
                defaultValue={transaction?.payee}
                placeholder="Who was paid?"
                required
                maxLength={240}
                autoFocus
              />
              <div className="form-row">
                <SelectField
                  label="Activity type"
                  name="direction"
                  defaultValue={
                    transaction?.amount && transaction.amount > 0
                      ? "income"
                      : "expense"
                  }
                  onChange={(event) => setDirection(event.target.value)}
                >
                  <option value="expense">Expense</option>
                  <option value="income">New earnings / cash inflow</option>
                </SelectField>
                <FormField
                  label="Amount ($)"
                  name="amount"
                  inputMode="decimal"
                  defaultValue={
                    transaction
                      ? (Math.abs(transaction.amount) / 100).toFixed(2)
                      : undefined
                  }
                  placeholder="0.00"
                  required
                />
              </div>
              <SelectField
                label="Account"
                name="accountId"
                defaultValue={transaction?.accountId}
                required
              >
                {accountOptions()}
              </SelectField>
              {direction !== "income" && (
                <SelectField
                  label="Category"
                  name="categoryId"
                  defaultValue={transaction?.categoryId}
                  required
                >
                  <option value="">Choose a category</option>
                  {categoryOptions()}
                </SelectField>
              )}
              <div className="form-row">
                <FormField
                  label="Payment date"
                  name="date"
                  type="date"
                  defaultValue={
                    transaction?.date ?? today(view.budget.settings.timezone)
                  }
                  min={`${view.budget.startMonth}-01`}
                  required
                />
                <SelectField
                  label="Bank status"
                  name="status"
                  defaultValue={transaction?.status ?? "posted"}
                >
                  <option value="posted">Posted</option>
                  <option value="pending">Pending</option>
                </SelectField>
              </div>
              <FormField
                label="Expense belongs to"
                name="expenseMonth"
                type="month"
                defaultValue={transaction?.expenseMonth ?? month}
                hint="Use the due month for rent. The actual payment date stays in your account ledger."
              />
              {view.sharedCategories.length > 0 && (
                <>
                  <SelectField
                    label="Shared category (optional)"
                    name="sharedCategoryId"
                    defaultValue={transaction?.sharedCategoryId}
                  >
                    <option value="">Personal expense</option>
                    {view.sharedCategories.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </SelectField>
                  <FormField
                    label="Your share override ($, optional)"
                    name="ownShare"
                    inputMode="decimal"
                    placeholder="Use the category split"
                    hint="The rest belongs to your partner. Leave blank to use the category’s split."
                  />
                </>
              )}
              {transaction && <TransactionHistory transaction={transaction} />}
            </>
          )}
          {panel.type === "import" && (
            <>
              <p className="small muted">
                Only category names and groups are imported. Account balances,
                transactions, assignments, and reimbursements are excluded.
              </p>
              <FormField
                label="YNAB categories file"
                name="file"
                type="file"
                accept=".csv,.json,text/csv,application/json"
                onChange={readFile}
                hint="CSV with Category Group,Category columns, or JSON with category_groups and categories."
              />
              <TextArea
                label="Or paste category data"
                name="importText"
                placeholder={
                  "Category Group,Category\nEveryday,Groceries\nEveryday,Dining out"
                }
                required={!fileText}
              />
            </>
          )}
          {panel.type === "rule" && (
            <>
              <SelectField
                label="Cover overspending in"
                name="toCategoryId"
                required
              >
                {categoryOptions()}
              </SelectField>
              <SelectField
                label="Using available money from"
                name="fromCategoryId"
                required
              >
                {categoryOptions()}
              </SelectField>
              <p className="field-hint">
                This explicitly authorizes the agent to use this source category
                when covering overspending. It never assigns Ready to Assign.
              </p>
            </>
          )}
          {panel.type === "join" && (
            <>
              <FormField
                label="Partner’s invitation code"
                name="code"
                required
                autoFocus
                autoComplete="off"
              />
              <p className="field-hint">
                Your own budget and transactions remain private. A household
                supports two people.
              </p>
            </>
          )}
          {panel.type === "card-payment" && (
            <>
              <SelectField
                label="Paid from cash account"
                name="cashAccountId"
                required
              >
                {accountOptions(cashAccounts)}
              </SelectField>
              <SelectField
                label="Paid to credit card"
                name="cardAccountId"
                required
              >
                {accountOptions(cards)}
              </SelectField>
              <div className="form-row">
                <FormField
                  label="Payment amount ($)"
                  name="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                />
                <FormField
                  label="Payment date"
                  name="date"
                  type="date"
                  defaultValue={today(view.budget.settings.timezone)}
                  required
                />
              </div>
              <p className="field-hint">
                The payment reduces bank cash, the card payment reserve, and
                card debt. It is not a new expense.
              </p>
            </>
          )}
          {panel.type === "statement-credit" && (
            <>
              <SelectField label="Credit card" name="accountId" required>
                {accountOptions(cards)}
              </SelectField>
              <div className="form-row">
                <FormField
                  label="Posted credit amount ($)"
                  name="amount"
                  inputMode="decimal"
                  defaultValue={
                    claim ? (claim.outstanding / 100).toFixed(2) : undefined
                  }
                  required
                />
                <FormField
                  label="Posting date"
                  name="date"
                  type="date"
                  defaultValue={today(view.budget.settings.timezone)}
                  required
                />
              </div>
              <p className="field-hint">
                Record only a posted credit. It reduces card debt and releases
                only reserves exceeding remaining debt. It creates no bank
                deposit.
              </p>
            </>
          )}
          {panel.type === "reimbursement" && (
            <>
              <SelectField
                label="Original purchase"
                name="transactionId"
                required
              >
                {view.budget.transactions
                  .filter(
                    (item) =>
                      !item.removed &&
                      item.amount < 0 &&
                      item.kind === "purchase" &&
                      !item.sharedCategoryId,
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.payee} · {formatMoney(-item.amount)}
                    </option>
                  ))}
              </SelectField>
              <FormField
                label="Person or organization"
                name="name"
                placeholder="Who will reimburse you?"
                required
                maxLength={120}
              />
              <div className="form-row">
                <FormField
                  label="Expected amount ($)"
                  name="amount"
                  inputMode="decimal"
                  required
                  placeholder="0.00"
                />
                <SelectField label="How it will arrive" name="kind">
                  <option value="cash">Cash reimbursement</option>
                  <option value="statement-credit">
                    Card statement credit
                  </option>
                </SelectField>
              </div>
              <p className="field-hint">
                An expected reimbursement creates no spendable cash. Shared
                partner expenses already belong to the settlement.
              </p>
            </>
          )}
          {panel.type === "receive" && (
            <>
              <SelectField
                label="Receiving cash account"
                name="accountId"
                required
              >
                {accountOptions(cashAccounts)}
              </SelectField>
              {claim && (
                <FormField
                  label="Cash received ($)"
                  name="amount"
                  defaultValue={(claim.outstanding / 100).toFixed(2)}
                  inputMode="decimal"
                  required
                />
              )}
              <FormField
                label="Date received"
                name="date"
                type="date"
                defaultValue={today(view.budget.settings.timezone)}
                required
              />
              <p className="field-hint">
                Record the actual receipt. Received reimbursements return to
                Ready to Assign without becoming new earnings.
              </p>
            </>
          )}
          {panel.type === "shared-category" && (
            <>
              {!shared && (
                <>
                  <FormField
                    label="Shared category name"
                    name="name"
                    placeholder="Rent"
                    maxLength={120}
                    required
                  />
                  <SelectField
                    label="Your budget category"
                    name="categoryId"
                    required
                  >
                    {categoryOptions()}
                  </SelectField>
                </>
              )}
              <FormField
                label="Your share (%)"
                name="percent"
                type="number"
                min="0"
                max="100"
                step="1"
                defaultValue={
                  shared
                    ? Math.round(
                        ((shared.weights[view.budget.userId] ?? 0) /
                          Object.values(shared.weights).reduce(
                            (sum, weight) => sum + weight,
                            0,
                          )) *
                          100,
                      )
                    : 50
                }
                required
                hint="Your partner’s share is the remainder. Either person may change this rule."
              />
              <p className="field-hint">
                {shared
                  ? "New purchases use the updated split; existing transaction shares remain inspectable."
                  : "A matching shared category is created in your partner’s budget. Each person funds the full cash they pay or owe."}
              </p>
            </>
          )}
          {panel.type === "opening" && (
            <>
              <SelectField
                label="Shared category"
                name="sharedCategoryId"
                required
              >
                {view.sharedCategories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Who owes whom?" name="direction">
                <option value="you-owe">I owe my partner</option>
                <option value="partner-owes">My partner owes me</option>
              </SelectField>
              <FormField
                label="Already-split amount owed ($)"
                name="amount"
                inputMode="decimal"
                required
                placeholder="0.00"
              />
              <p className="field-hint">
                Enter the amount already owed after splitting. It is not split
                again and creates no cash or new-period spending.
              </p>
            </>
          )}
          {panel.type === "settlement" && (
            <>
              <div className="notice">
                <Icon name="shared" size={18} />
                <p>
                  You owe {formatMoney(view.settlement.youOwe)}. Your partner
                  owes {formatMoney(view.settlement.owedToYou)}. Your net
                  payment is{" "}
                  <strong>
                    {formatMoney(Math.max(0, view.settlement.net))}
                  </strong>
                  .
                </p>
              </div>
              <SelectField
                label="Payment from cash account"
                name="accountId"
                required={view.settlement.net > 0}
              >
                {accountOptions(cashAccounts)}
              </SelectField>
              <div className="form-row">
                <FormField
                  label="Actual net payment ($)"
                  name="amount"
                  defaultValue={(
                    Math.max(0, view.settlement.net) / 100
                  ).toFixed(2)}
                  inputMode="decimal"
                  required
                />
                <FormField
                  label="Actual payment date"
                  name="date"
                  type="date"
                  defaultValue={today(view.budget.settings.timezone)}
                  required
                />
              </div>
              <p className="field-hint">
                The net amount must match the outstanding obligations. Offsets
                release unused real reserves. Your partner records receipt after
                the deposit arrives.
              </p>
            </>
          )}
          {panel.type === "loan" && (
            <>
              <FormField
                label="Loan name"
                name="name"
                placeholder="Student loan"
                required
                maxLength={120}
              />
              <SelectField label="Loan type" name="variable">
                <option value="variable">Variable-rate student loan</option>
                <option value="fixed">Fixed-rate personal loan</option>
              </SelectField>
              <div className="form-row">
                <FormField
                  label="Confirmed principal ($)"
                  name="principal"
                  inputMode="decimal"
                  required
                  placeholder="0.00"
                />
                <FormField
                  label="Confirmed annual rate (%)"
                  name="annualRate"
                  type="number"
                  min="0"
                  max="1000"
                  step="0.01"
                  required
                />
              </div>
              <div className="form-row">
                <FormField
                  label="Required monthly payment ($)"
                  name="minimumPayment"
                  inputMode="decimal"
                  required
                />
                <FormField
                  label="Confirmed as of"
                  name="effectiveDate"
                  type="date"
                  defaultValue={today(view.budget.settings.timezone)}
                  required
                />
              </div>
              <SelectField label="Payment category" name="categoryId">
                <option value="">Create a paired payment category</option>
                {categoryOptions()}
              </SelectField>
              <p className="field-hint">
                Loan debt is not available cash. Forecasts estimate the future;
                actual lender records determine principal and interest.
              </p>
            </>
          )}
          {panel.type === "loan-payment" && (
            <>
              <SelectField
                label="Paid from cash account"
                name="accountId"
                required
              >
                {accountOptions(cashAccounts)}
              </SelectField>
              <div className="form-row">
                <FormField
                  label="Lender-confirmed principal ($)"
                  name="principal"
                  inputMode="decimal"
                  required
                />
                <FormField
                  label="Lender-confirmed interest ($)"
                  name="interest"
                  inputMode="decimal"
                  required
                />
              </div>
              <FormField
                label="Payment date"
                name="date"
                type="date"
                defaultValue={today(view.budget.settings.timezone)}
                required
              />
              <p className="field-hint">
                The bank payment equals principal plus interest. Only the
                confirmed principal reduces your loan balance.
              </p>
            </>
          )}
          {panel.type === "rate" && (
            <>
              <FormField
                label="Confirmed annual rate (%)"
                name="annualRate"
                type="number"
                min="0"
                max="1000"
                step="0.01"
                defaultValue={loan ? loan.forecast.rateBps / 100 : undefined}
                required
              />
              <FormField
                label="Rate effective date"
                name="effectiveDate"
                type="date"
                defaultValue={today(view.budget.settings.timezone)}
                required
              />
              <p className="field-hint">
                The effective rate is retained in history. Forecasts assume the
                latest confirmed rate continues.
              </p>
            </>
          )}
          {panel.type === "target" && (
            <>
              <div className="form-row">
                <SelectField
                  label="Schedule"
                  name="cadence"
                  defaultValue={
                    category?.target?.cadence ??
                    (category?.pairedAccountId
                      ? "card-monthly"
                      : category?.pairedLoanId
                        ? "loan"
                        : "monthly")
                  }
                  onChange={(event) => setTargetCadence(event.target.value)}
                >
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                  <option value="custom">Custom</option>
                  {category?.pairedAccountId && (
                    <>
                      <option value="card-monthly">Monthly card payment</option>
                      <option value="card-payoff">Pay off card by date</option>
                    </>
                  )}
                  {category?.pairedLoanId && (
                    <option value="loan">Loan payment</option>
                  )}
                </SelectField>
                <SelectField
                  label="Target behavior"
                  name="behavior"
                  defaultValue={category?.target?.behavior ?? "refill"}
                  onChange={(event) => setTargetBehavior(event.target.value)}
                >
                  <option value="refill">Refill up to</option>
                  <option value="contribution">Set aside another</option>
                  <option value="balance">Have a balance of</option>
                </SelectField>
              </div>
              <div className="form-row">
                <FormField
                  label="Target amount ($)"
                  name="amount"
                  inputMode="decimal"
                  required
                  defaultValue={
                    category?.target
                      ? (category.target.amount / 100).toFixed(2)
                      : undefined
                  }
                />
                <FormField
                  label="Start month"
                  name="startMonth"
                  type="month"
                  defaultValue={category?.target?.startMonth ?? month}
                  required
                />
              </div>
              <FormField
                label="Due date (yearly, custom, or card payoff)"
                name="dueDate"
                type="date"
                defaultValue={category?.target?.dueDate}
                required={
                  targetCadence === "yearly" || targetCadence === "card-payoff"
                }
              />
              <SelectField
                label="Weekly due day"
                name="weekday"
                defaultValue={category?.target?.weekday ?? 5}
              >
                <option value="">Not a weekly target</option>
                {[
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ].map((day, index) => (
                  <option value={index} key={day}>
                    {day}
                  </option>
                ))}
              </SelectField>
              {targetCadence === "custom" && targetBehavior !== "balance" && (
                <div className="form-row">
                  <FormField
                    label="Repeat every (optional)"
                    name="repeatEvery"
                    type="number"
                    min="1"
                    max="120"
                    defaultValue={category?.target?.repeatEvery}
                  />
                  <SelectField
                    label="Repeat unit"
                    name="repeatUnit"
                    defaultValue={category?.target?.repeatUnit ?? "months"}
                  >
                    <option value="months">Months</option>
                    <option value="years">Years</option>
                  </SelectField>
                </div>
              )}
              <p className="field-hint">
                Targets guide your manual funding. Balance goals use a custom
                schedule and do not repeat. Refill targets count available
                rollover; contribution targets ask for new money.
              </p>
              {category?.target && (
                <div className="heading-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      run({
                        type: "target.snooze",
                        id: newId(),
                        categoryId: category.id,
                        month,
                        currentMonth: currentMonth(
                          view.budget.settings.timezone,
                        ),
                        snoozed:
                          !category.target?.snoozedMonths.includes(month),
                      })
                    }
                  >
                    {category.target.snoozedMonths.includes(month)
                      ? "Restore this month’s target"
                      : "Snooze this month"}
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      run({
                        type: "target.set",
                        id: newId(),
                        categoryId: category.id,
                        target: null,
                      })
                    }
                  >
                    Remove target
                  </button>
                </div>
              )}
            </>
          )}
          {panel.type === "reconcile" && (
            <>
              <SelectField label="Account" name="accountId" required>
                {accountOptions()}
              </SelectField>
              <div className="form-row">
                <FormField
                  label="Statement period begins"
                  name="periodStart"
                  type="date"
                  defaultValue={`${month}-01`}
                  required
                />
                <FormField
                  label="Statement cutoff"
                  name="cutoff"
                  type="date"
                  defaultValue={today(view.budget.settings.timezone)}
                  required
                />
              </div>
              <div className="form-row">
                <FormField
                  label="Statement opening balance ($)"
                  name="openingBalance"
                  inputMode="decimal"
                  required
                />
                <FormField
                  label="Statement closing balance ($)"
                  name="closingBalance"
                  inputMode="decimal"
                  required
                />
              </div>
              <FormField
                label="Statement activity CSV"
                name="file"
                type="file"
                accept=".csv,text/csv"
                onChange={readFile}
                hint="Columns: date, description, amount. Signed amounts, posted activity only."
              />
              <TextArea
                label="Or paste statement CSV"
                name="csv"
                required={!fileText}
                placeholder={
                  "date,description,amount\n2026-10-01,Groceries,-24.50"
                }
              />
              <label className="checkbox-field">
                <input type="checkbox" name="verified" />
                <span>
                  I confirmed this is the complete cleared activity from my bank
                  statement.
                  <p className="field-hint">
                    This is your attestation. Caishen cannot authenticate the
                    uploaded document.
                  </p>
                </span>
              </label>
              {result && (
                <div
                  className={`notice${result.status === "reconciled" ? "" : "warning"}`}
                  role="status"
                >
                  <div>
                    <strong>
                      {result.status === "reconciled"
                        ? "Statement matches your cleared ledger"
                        : result.status === "discrepancy"
                          ? "There is a difference to investigate"
                          : "More evidence is needed"}
                    </strong>
                    {result.differenceCents !== null && (
                      <p>
                        Balance difference:{" "}
                        <Amount value={result.differenceCents} />
                      </p>
                    )}
                    {result.reasons.map((reason) => (
                      <p key={reason}>{reason}</p>
                    ))}
                    {result.missingFromLedger.length > 0 && (
                      <p>
                        {result.missingFromLedger.length} statement items are
                        missing from your ledger.
                      </p>
                    )}
                    {result.missingFromStatement.length > 0 && (
                      <p>
                        {result.missingFromStatement.length} ledger items are
                        missing from the statement.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            {panel.type === "history" ? "Close" : "Cancel"}
          </button>
          <button
            className="primary-button"
            hidden={panel.type === "history"}
            disabled={busy || reconcile.isPending || noAccounts || noCategories}
          >
            {busy || reconcile.isPending
              ? "Saving…"
              : panel.type === "reconcile"
                ? "Compare statement"
                : panel.type === "import"
                  ? "Import categories only"
                  : panel.type === "join"
                    ? "Connect budgets"
                    : panel.type === "transaction" && transaction
                      ? "Save correction"
                      : (saveLabels[panel.type] ?? "Save changes")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function TextArea({
  label,
  name,
  ...props
}: {
  label: string;
  name: string;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = `textarea-${name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} name={name} {...props} />
    </div>
  );
}
function TransactionHistory({
  transaction,
}: {
  transaction: NonNullable<View>["budget"]["transactions"][number];
}) {
  return (
    <details>
      <summary className="small muted" style={{ cursor: "pointer" }}>
        Transaction history · {transaction.history.length}{" "}
        {transaction.history.length === 1 ? "record" : "records"}
      </summary>
      <ul className="audit-list" style={{ marginTop: 10 }}>
        {transaction.history.map((entry, index) => (
          <li key={`${entry.operationId}-${index}`}>
            <span className="muted">Revision {entry.revision}</span>
            <span>
              {entry.reason} · <Amount value={entry.amount} /> · {entry.status}
              <small className="muted" style={{ display: "block" }}>
                {entry.date} · {entry.payee}
              </small>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
