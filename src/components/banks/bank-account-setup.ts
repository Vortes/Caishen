"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readAmount } from "~/components/budget/amount";
import type { State } from "~/components/budget/types";
import type { ExecuteResult } from "~/components/sync/transport";
import { api } from "~/trpc/react";
import {
  bankRecoveryCandidates,
  bankAccountNeedsRecovery,
  isBankAccountLive,
} from "~/lib/bank-account-identity";

type Connection = State["connections"][number];

/** What the setup form reads of the budget. */
export type BankSetupState = Pick<State, "connections" | "view">;

/**
 * Sends an operation only the server can apply behind the budget's pending
 * changes (the app shell's budget client). `send` gets the revision to
 * check against. Resolves once saved; rejects with the reason the server
 * refused it.
 */
export type ServerRunner = (
  operationId: string,
  send: (expectedRevision: number) => Promise<ExecuteResult>,
  summary: string,
) => Promise<void>;
type BankAccount = Connection["accounts"][number];
type AccountMapping = { accountId: string; startDate: string };
type AccountDraft = {
  selected: boolean;
  name: string;
  existingAccountId: string;
  startDate: string;
  loanBalance: string;
  annualRate: string;
  minimumPayment: string;
  variable: boolean;
};

type LoanTerms = {
  principal: number;
  annualRateBps: number;
  minimumPayment: number;
};

// A new loan's terms in cents and basis points, or why they can't be read.
// The principal and payment are typed amounts; a balance from the bank is
// taken as given.
function loanTerms(
  currentBalance: number | null,
  draft: AccountDraft,
): LoanTerms | { error: string } {
  let principal = NaN;
  if (currentBalance === null) {
    const typed = readAmount(draft.loanBalance);
    if (typed.ok) principal = typed.cents;
  } else if (twoPlaces.test(String(currentBalance)))
    principal = Math.round(currentBalance * 100);
  if (!Number.isSafeInteger(principal) || principal < 0)
    return {
      error:
        "Enter the current principal owed from your lender’s latest statement.",
    };
  if (!twoPlaces.test(draft.annualRate) || Number(draft.annualRate) > 1000)
    return {
      error:
        "Enter the loan’s confirmed APR, including 0 for an interest-free loan.",
    };
  const payment = readAmount(draft.minimumPayment);
  if (!payment.ok || payment.cents <= 0)
    return { error: "Enter the required monthly payment from your lender." };
  return {
    principal,
    annualRateBps: Math.round(Number(draft.annualRate) * 100),
    minimumPayment: payment.cents,
  };
}
// A bank balance or an APR: digits with up to two decimal places.
const twoPlaces = /^\d+(?:\.\d{1,2})?$/;

export function bankAccountMappings(value: unknown) {
  const mappings = new Map<string, AccountMapping>();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return mappings;
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, mapping] of entries) {
    if (
      mapping &&
      typeof mapping === "object" &&
      "accountId" in mapping &&
      typeof mapping.accountId === "string" &&
      "startDate" in mapping &&
      typeof mapping.startDate === "string"
    )
      mappings.set(key, {
        accountId: mapping.accountId,
        startDate: mapping.startDate,
      });
  }
  return mappings;
}

export function accountSetupType(
  account: BankAccount,
):
  | { kind: "cash" | "credit" | "loan"; reason?: never }
  | { kind?: never; reason: string } {
  if (account.currency !== "USD")
    return { reason: "Only US dollar accounts can be added to this budget." };
  if (account.type === "loan") return { kind: "loan" };
  if (
    account.currentBalance === null ||
    !Number.isFinite(account.currentBalance)
  )
    return {
      reason: "The bank hasn’t provided a current balance yet.",
    };
  if (account.type === "depository") return { kind: "cash" };
  if (account.type === "credit" && account.subtype === "credit card") {
    return { kind: "credit" };
  }
  return {
    reason: "This account type isn’t supported in Cash or Credit yet.",
  };
}

// Updating the bank. `refreshed` remembers that an earlier update finished,
// so checking again in the background keeps the form usable.
type Refresh =
  | { status: "idle" }
  | { status: "done" }
  | { status: "running"; refreshed: boolean }
  | { status: "failed"; refreshed: boolean; error: string };

// Adding the chosen accounts. A failure keeps why, for the whole form and per
// account, until the user changes something or tries again.
type Submit =
  | { status: "idle" }
  | { status: "saving" }
  | {
      status: "failed";
      error: string;
      fields: Partial<Record<string, string>>;
    };

const hasRefreshed = (refresh: Refresh) =>
  refresh.status === "done" || (refresh.status !== "idle" && refresh.refreshed);

// Reuses the update from Link, or updates on mount when opening setup later.
// One operation id per set of choices keeps retries from adding accounts twice.
export function useBankAccountSetupForm({
  state,
  connection,
  updated,
  onSaved,
  runOnServer,
}: {
  state: BankSetupState;
  connection: Connection;
  updated: boolean;
  onSaved: (added: number) => void;
  runOnServer: ServerRunner;
}) {
  const utils = api.useUtils();
  const save = api.budget.setupBankAccounts.useMutation();
  const sync = api.budget.sync.useMutation();
  const initialMappings = bankAccountMappings(connection.accountMappings);
  const identities = state.connections.map((item) => ({
    ...item,
    accountMappings: Object.fromEntries(
      bankAccountMappings(item.accountMappings),
    ),
  }));
  const budgetAccountKinds = new Map([
    ...(state.view?.budget.accounts ?? []).map(
      (account) => [account.id, account.kind] as const,
    ),
    ...(state.view?.budget.loans ?? []).map(
      (loan) => [loan.id, "loan"] as const,
    ),
  ]);
  const recoveryAccounts = (account: BankAccount, exact = false) => [
    ...new Set(
      bankRecoveryCandidates(
        account,
        connection.institutionId,
        identities,
        budgetAccountKinds,
      )
        .filter((candidate) => !exact || candidate.exact)
        .map((candidate) => candidate.accountId),
    ),
  ];
  const recoveryAccountIds = new Set(
    identities.flatMap((item) =>
      Object.entries(item.accountMappings)
        .filter(([providerId]) => bankAccountNeedsRecovery(item, providerId))
        .map(([, mapping]) => mapping.accountId),
    ),
  );
  const [drafts, setDrafts] = useState<Record<string, AccountDraft>>(() =>
    Object.fromEntries(
      connection.accounts.map((account) => [
        account.accountId,
        {
          selected:
            !initialMappings.has(account.accountId) &&
            Boolean(accountSetupType(account).kind),
          name: account.name.trim().slice(0, 120),
          existingAccountId:
            recoveryAccounts(account, true).length === 1 &&
            recoveryAccounts(account).length === 1
              ? recoveryAccounts(account, true)[0]!
              : "",
          startDate: "",
          loanBalance: account.currentBalance?.toString() ?? "",
          annualRate: "",
          minimumPayment: "",
          variable: false,
        },
      ]),
    ),
  );
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [refresh, setRefresh] = useState<Refresh>({
    status: updated ? "done" : "idle",
  });
  const [submission, setSubmission] = useState<Submit>({ status: "idle" });
  // Updating and saving take turns; set before either starts, so a second
  // click or a timer firing in the same tick can't start another.
  const activity = useRef<"refreshing" | "saving" | null>(null);
  const attemptedUpdate = useRef(false);
  const submittedAccounts = useRef<
    Parameters<typeof save.mutateAsync>[0]["accounts"] | null
  >(null);
  const mappings = bankAccountMappings(connection.accountMappings);
  const synchronizedAccountIds = new Set(connection.synchronizedAccountIds);
  const ready = [
    "INITIAL_UPDATE_COMPLETE",
    "HISTORICAL_UPDATE_COMPLETE",
  ].includes(connection.transactionStatus ?? "");
  const refreshed = hasRefreshed(refresh);
  const updating = refresh.status === "running";
  const submitting = submission.status === "saving";
  // Checking the bank again after it has updated leaves the fields alone.
  const busy = submitting || (updating && !refreshed);
  const fieldErrors = submission.status === "failed" ? submission.fields : {};
  const current = useRef({ sync, utils });
  current.current = { sync, utils };

  const updateBank = useCallback(async () => {
    if (activity.current) return;
    activity.current = "refreshing";
    setRefresh((previous) => ({
      status: "running",
      refreshed: hasRefreshed(previous),
    }));
    try {
      await current.current.sync.mutateAsync();
      await current.current.utils.budget.invalidate();
      setRefresh({ status: "done" });
    } catch (failure) {
      setRefresh((previous) => ({
        status: "failed",
        refreshed: hasRefreshed(previous),
        error:
          failure instanceof Error
            ? failure.message
            : "Your bank couldn’t update. Try again.",
      }));
    } finally {
      activity.current = null;
    }
  }, []);

  useEffect(() => {
    if (updated || attemptedUpdate.current) return;
    attemptedUpdate.current = true;
    void updateBank();
  }, [updated, updateBank]);

  function change(accountId: string, next: Partial<AccountDraft>) {
    setDrafts((previous) => ({
      ...previous,
      [accountId]: {
        selected: false,
        name: "",
        existingAccountId: "",
        startDate: "",
        loanBalance: "",
        annualRate: "",
        minimumPayment: "",
        variable: false,
        ...previous[accountId],
        ...next,
      },
    }));
    setSubmission((previous) => {
      if (previous.status !== "failed") return previous;
      const fields = { ...previous.fields };
      delete fields[accountId];
      return { status: "failed", error: "", fields };
    });
    submittedAccounts.current = null;
    setOperationId(crypto.randomUUID());
  }

  const mappedAccountIds = new Set(
    identities.flatMap((item) =>
      Object.entries(item.accountMappings)
        .filter(([providerId]) => !bankAccountNeedsRecovery(item, providerId))
        .map(([, mapping]) => mapping.accountId),
    ),
  );
  const synchronized = (account: BankAccount) =>
    isBankAccountLive(connection, account.accountId) &&
    (account.type === "loan"
      ? ready
      : synchronizedAccountIds.has(account.accountId));
  const selected = connection.accounts.filter(
    (account) =>
      !mappings.has(account.accountId) &&
      synchronized(account) &&
      accountSetupType(account).kind &&
      drafts[account.accountId]?.selected,
  );
  const preparingAccounts = connection.accounts.some((account) => {
    if (mappings.has(account.accountId)) return false;
    const awaitingBalance =
      account.currency === "USD" &&
      account.currentBalance === null &&
      (account.type === "depository" ||
        (account.type === "credit" && account.subtype === "credit card"));
    return (
      awaitingBalance ||
      (Boolean(accountSetupType(account).kind) && !synchronized(account))
    );
  });

  useEffect(() => {
    if (submitting || updating || (ready && refreshed && !preparingAccounts))
      return;
    const timer = window.setTimeout(() => void updateBank(), 30_000);
    return () => window.clearTimeout(timer);
  }, [preparingAccounts, ready, refreshed, submitting, updating, updateBank]);

  const rows = connection.accounts.map((account) => {
    const type = accountSetupType(account);
    const mapping = mappings.get(account.accountId);
    const selectedElsewhere = new Set(
      Object.entries(drafts)
        .filter(([id, value]) => id !== account.accountId && value.selected)
        .map(([, value]) => value.existingAccountId),
    );
    return {
      account,
      type,
      synchronized: synchronized(account),
      draft: drafts[account.accountId],
      fieldError: fieldErrors[account.accountId],
      recovery: recoveryAccountIds.has(
        drafts[account.accountId]?.existingAccountId ?? "",
      ),
      requiresExisting: recoveryAccounts(account).length > 0,
      // The budget account a bank account was already added as.
      addedAs: mapping
        ? ((account.type === "loan"
            ? state.view?.loans
            : state.view?.accounts
          )?.find((item) => item.id === mapping.accountId)?.name ??
          "a budget account")
        : undefined,
      existingAccounts:
        (type.kind === "loan"
          ? state.view?.budget.loans.map((loan) => ({
              id: loan.id,
              name: loan.name,
              kind: "loan" as const,
            }))
          : state.view?.budget.accounts
        )?.filter(
          (existing) =>
            existing.kind === type.kind &&
            (!recoveryAccounts(account).length ||
              recoveryAccounts(account).includes(existing.id)) &&
            !mappedAccountIds.has(existing.id) &&
            !selectedElsewhere.has(existing.id),
        ) ?? [],
    };
  });

  const submit = async () => {
    if (activity.current || busy || !ready || !refreshed) return;
    const errors: Record<string, string> = {};
    // A new loan's terms as checked here are the ones sent.
    const loans = new Map<string, LoanTerms>();
    for (const account of selected) {
      const draft = drafts[account.accountId]!;
      if (recoveryAccounts(account).length && !draft.existingAccountId)
        errors[account.accountId] =
          "Choose the existing budget account for this bank account.";
      if (!draft.name.trim() || draft.name.trim().length > 120)
        errors[account.accountId] =
          "Enter an account name with 1 to 120 characters.";
      if (draft.existingAccountId) {
        const existing =
          account.type === "loan"
            ? state.view?.budget.loans.find(
                (item) => item.id === draft.existingAccountId,
              )
            : state.view?.budget.accounts.find(
                (item) => item.id === draft.existingAccountId,
              );
        const openingDate =
          existing &&
          ("rates" in existing
            ? existing.rates.map((rate) => rate.effectiveDate).sort()[0]!
            : existing.date);
        if (
          !recoveryAccountIds.has(draft.existingAccountId) &&
          (!draft.startDate || !openingDate || draft.startDate <= openingDate)
        )
          errors[account.accountId] =
            "Choose an import date after this account’s opening balance date.";
      } else if (account.type === "loan") {
        const terms = loanTerms(account.currentBalance, draft);
        if ("error" in terms) errors[account.accountId] = terms.error;
        else loans.set(account.accountId, terms);
      }
    }
    if (Object.keys(errors).length) {
      setSubmission({ status: "failed", error: "", fields: errors });
      return;
    }
    if (!selected.length) {
      setSubmission({
        status: "failed",
        error: "Choose at least one account to add.",
        fields: {},
      });
      return;
    }
    activity.current = "saving";
    setSubmission({ status: "saving" });
    let outcome: Submit = { status: "idle" };
    try {
      submittedAccounts.current ??= selected.map((account) => {
        const draft = drafts[account.accountId]!;
        return {
          providerAccountId: account.accountId,
          name: draft.name.trim(),
          expectedBalance: account.currentBalance,
          ...(draft.existingAccountId
            ? {
                existingAccountId: draft.existingAccountId,
                ...(recoveryAccountIds.has(draft.existingAccountId)
                  ? {}
                  : { startDate: draft.startDate }),
              }
            : account.type === "loan"
              ? {
                  loan: {
                    ...loans.get(account.accountId)!,
                    variable: draft.variable,
                  },
                }
              : {}),
        };
      });
      const accounts = submittedAccounts.current;
      const send = (expectedRevision: number) =>
        save.mutateAsync({
          connectionId: connection.id,
          operationId,
          expectedRevision,
          accounts,
        });
      await runOnServer(
        operationId,
        send,
        `Added ${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`,
      );
      await utils.budget.invalidate();
      onSaved(accounts.length);
    } catch (failure) {
      // The budget client only gives up on a save the server refused.
      submittedAccounts.current = null;
      setOperationId(crypto.randomUUID());
      outcome = {
        status: "failed",
        error:
          failure instanceof Error
            ? failure.message
            : "Your accounts couldn’t be added. Try again.",
        fields: {},
      };
      await utils.budget.invalidate();
    } finally {
      activity.current = null;
      setSubmission(outcome);
    }
  };

  // Why the form can't save yet, when the bank's data isn't ready for it.
  let waiting: string | null = null;
  if (updating && !refreshed)
    waiting = "Preparing your accounts and recent activity…";
  else if (!refreshed)
    waiting =
      "Your bank is taking longer than usual. We’ll keep trying automatically. Your account names are saved here.";
  else if (preparingAccounts && ready && selected.length > 0)
    waiting =
      "Some accounts are still preparing. You can add the ready accounts now. The others will appear automatically when they’re ready.";
  else if (preparingAccounts || !ready)
    waiting =
      "Your bank is still preparing activity. We’ll keep checking automatically.";

  // Why the last save failed, then why the bank couldn't update.
  const error = [
    submission.status === "failed" ? submission.error : "",
    refresh.status === "failed" ? refresh.error : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    rows,
    change,
    submit,
    error,
    waiting,
    busy,
    submitting,
    // Closing mid-save would lose track of whether the accounts were added.
    locked: () => activity.current === "saving",
    // Saving waits for a bank check to finish, so it sends what the check
    // found.
    canSubmit: !busy && !updating && ready && refreshed && selected.length > 0,
  };
}
