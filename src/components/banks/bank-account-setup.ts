"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { State } from "~/components/budget/types";
import type { ExecuteResult } from "~/components/sync/transport";
import { api } from "~/trpc/react";
import {
  possibleBankAccount,
  sameBankAccount,
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
      reason:
        "The bank hasn’t provided a current balance. Update and try again.",
    };
  if (account.type === "depository") return { kind: "cash" };
  if (account.type === "credit" && account.subtype === "credit card") {
    return { kind: "credit" };
  }
  return {
    reason: "This account type isn’t supported in Cash or Credit yet.",
  };
}

// Updates the bank once on mount so setup uses current balances, and keeps
// one operation id per set of choices so retries cannot add accounts twice.
export function useBankAccountSetupForm({
  state,
  connection,
  onSaved,
  runOnServer,
}: {
  state: BankSetupState;
  connection: Connection;
  onSaved: (added: number) => void;
  runOnServer: ServerRunner;
}) {
  const utils = api.useUtils();
  const save = api.budget.setupBankAccounts.useMutation();
  const sync = api.budget.sync.useMutation();
  const initialMappings = bankAccountMappings(connection.accountMappings);
  const recoveryAccounts = (account: BankAccount, exact = false) => [
    ...new Set(
      state.connections
        .filter((item) => item.disconnectedAt)
        .flatMap((item) => {
          const mappings = bankAccountMappings(item.accountMappings);
          return item.accounts.flatMap((saved) => {
            const mapping = mappings.get(saved.accountId);
            return mapping &&
              (exact ? sameBankAccount : possibleBankAccount)(
                account,
                saved,
                connection.institutionId,
                item.institutionId,
              )
              ? [mapping.accountId]
              : [];
          });
        }),
    ),
  ];
  const disconnectedAccountIds = new Set(
    state.connections
      .filter((item) => item.disconnectedAt)
      .flatMap((item) =>
        [...bankAccountMappings(item.accountMappings).values()].map(
          (mapping) => mapping.accountId,
        ),
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
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<string, string>>
  >({});
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [updating, setUpdating] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const updateInFlight = useRef(false);
  const attemptedUpdate = useRef(false);
  const saving = useRef(false);
  const submittedAccounts = useRef<
    Parameters<typeof save.mutateAsync>[0]["accounts"] | null
  >(null);
  const mappings = bankAccountMappings(connection.accountMappings);
  const synchronizedAccountIds = new Set(connection.synchronizedAccountIds);
  const ready = [
    "INITIAL_UPDATE_COMPLETE",
    "HISTORICAL_UPDATE_COMPLETE",
  ].includes(connection.transactionStatus ?? "");
  const busy = submitting || updating;
  const current = useRef({ sync, utils });
  current.current = { sync, utils };

  const updateBank = useCallback(async () => {
    if (updateInFlight.current || saving.current) return;
    updateInFlight.current = true;
    setUpdating(true);
    setRefreshed(false);
    setError("");
    try {
      await current.current.sync.mutateAsync();
      await current.current.utils.budget.invalidate();
      setRefreshed(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Your bank couldn’t update. Try again.",
      );
    } finally {
      updateInFlight.current = false;
      setUpdating(false);
    }
  }, []);

  useEffect(() => {
    if (attemptedUpdate.current) return;
    attemptedUpdate.current = true;
    void updateBank();
  }, [updateBank]);

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
    setFieldErrors((previous) => {
      const next = { ...previous };
      delete next[accountId];
      return next;
    });
    submittedAccounts.current = null;
    setOperationId(crypto.randomUUID());
    setError("");
  }

  const mappedAccountIds = new Set(
    state.connections
      .filter((item) => !item.disconnectedAt)
      .flatMap((item) =>
        [...bankAccountMappings(item.accountMappings).values()].map(
          (mapping) => mapping.accountId,
        ),
      ),
  );
  const synchronized = (account: BankAccount) =>
    account.type === "loan"
      ? ready
      : synchronizedAccountIds.has(account.accountId);
  const selected = connection.accounts.filter(
    (account) =>
      !mappings.has(account.accountId) &&
      synchronized(account) &&
      accountSetupType(account).kind &&
      drafts[account.accountId]?.selected,
  );
  const preparingAccounts = connection.accounts.some(
    (account) =>
      !mappings.has(account.accountId) &&
      accountSetupType(account).kind &&
      !synchronized(account),
  );

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
      recovery: disconnectedAccountIds.has(
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
    if (saving.current || busy || !ready || !refreshed) return;
    const errors: Record<string, string> = {};
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
          !disconnectedAccountIds.has(draft.existingAccountId) &&
          (!draft.startDate || !openingDate || draft.startDate <= openingDate)
        )
          errors[account.accountId] =
            "Choose an import date after this account’s opening balance date.";
      } else if (account.type === "loan") {
        const money = /^\d+(?:\.\d{1,2})?$/;
        const principal =
          account.currentBalance?.toString() ?? draft.loanBalance;
        if (
          !money.test(principal) ||
          !Number.isSafeInteger(Math.round(Number(principal) * 100))
        )
          errors[account.accountId] =
            "Enter the current principal owed from your lender’s latest statement.";
        else if (
          !money.test(draft.annualRate) ||
          Number(draft.annualRate) > 1000
        )
          errors[account.accountId] =
            "Enter the loan’s confirmed APR, including 0 for an interest-free loan.";
        else if (
          !money.test(draft.minimumPayment) ||
          Number(draft.minimumPayment) <= 0 ||
          !Number.isSafeInteger(Math.round(Number(draft.minimumPayment) * 100))
        )
          errors[account.accountId] =
            "Enter the required monthly payment from your lender.";
      }
    }
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    if (!selected.length) {
      setError("Choose at least one account to add.");
      return;
    }
    saving.current = true;
    setSubmitting(true);
    setError("");
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
                ...(disconnectedAccountIds.has(draft.existingAccountId)
                  ? {}
                  : { startDate: draft.startDate }),
              }
            : account.type === "loan"
              ? {
                  loan: {
                    principal: Math.round(
                      Number(account.currentBalance ?? draft.loanBalance) * 100,
                    ),
                    annualRateBps: Math.round(Number(draft.annualRate) * 100),
                    minimumPayment: Math.round(
                      Number(draft.minimumPayment) * 100,
                    ),
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
      setError(
        failure instanceof Error
          ? failure.message
          : "Your accounts couldn’t be added. Try again.",
      );
      await utils.budget.invalidate();
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  };

  // Why the form can't save yet, when the bank's data isn't ready for it.
  const waiting =
    !ready || !refreshed || updating || preparingAccounts
      ? updating
        ? "Updating your bank accounts and activity…"
        : !refreshed
          ? "Update your bank accounts to use their latest balances. Your account names are saved here while you try again."
          : preparingAccounts && ready
            ? "Some accounts are still preparing. You can add the ready accounts now, or update again shortly."
            : "Your bank is still preparing activity. Update again in a moment to finish adding these accounts."
      : null;

  return {
    rows,
    change,
    submit,
    updateBank,
    error,
    waiting,
    busy,
    submitting,
    updating,
    // Closing mid-save would lose track of whether the accounts were added.
    locked: () => saving.current,
    canSubmit: !busy && ready && refreshed && selected.length > 0,
  };
}
