"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { State } from "~/components/budget/types";
import { FormField, SelectField } from "~/components/shared";
import { Button } from "~/components/ui-legacy/button";
import { Checkbox } from "~/components/ui-legacy/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui-legacy/dialog";
import { api } from "~/trpc/react";

type Connection = State["connections"][number];
type BankAccount = Connection["accounts"][number];
type AccountMapping = { accountId: string; startDate: string };
type AccountDraft = {
  selected: boolean;
  name: string;
  existingAccountId: string;
  startDate: string;
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
  | { kind: "cash" | "credit"; reason?: never }
  | { kind?: never; reason: string } {
  if (account.currency !== "USD")
    return { reason: "Only US dollar accounts can be added to this budget." };
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
    if (account.currentBalance < 0)
      return {
        reason:
          "This card has a credit balance. Support for overpaid cards isn’t available yet.",
      };
    return { kind: "credit" };
  }
  return {
    reason: "This account type isn’t supported in Cash or Credit yet.",
  };
}

export function hasUnmappedBankAccounts(connection: Connection) {
  const mappings = bankAccountMappings(connection.accountMappings);
  return connection.accounts.some(
    (account) => !mappings.has(account.accountId),
  );
}

export function useBankAccountSetup(
  state: State | undefined,
  preferredConnectionId?: string,
  enabled = true,
) {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  const userId = state?.view?.budget.userId;

  useEffect(() => {
    if (!enabled || !userId || !state || connectionId) return;
    const candidates = [...state.connections].sort(
      (first, second) =>
        Number(second.id === preferredConnectionId) -
        Number(first.id === preferredConnectionId),
    );
    for (const connection of candidates) {
      if (seen.current.has(connection.id)) continue;
      const mappings = bankAccountMappings(connection.accountMappings);
      if (
        !connection.accounts.some(
          (account) =>
            !mappings.has(account.accountId) && accountSetupType(account).kind,
        )
      )
        continue;
      const key = `caishen:bank-account-setup:${userId}:${connection.id}`;
      let prompted = false;
      try {
        prompted = window.sessionStorage.getItem(key) === "seen";
      } catch {
        // The in-memory guard also covers browsers that disable storage.
      }
      seen.current.add(connection.id);
      if (prompted && connection.id !== preferredConnectionId) continue;
      try {
        window.sessionStorage.setItem(key, "seen");
      } catch {
        // Account setup remains available through its explicit button.
      }
      setConnectionId(connection.id);
      break;
    }
  }, [connectionId, enabled, preferredConnectionId, state, userId]);

  return {
    connection: state?.connections.find((item) => item.id === connectionId),
    open: (id: string) => {
      seen.current.add(id);
      setConnectionId(id);
    },
    close: () => setConnectionId(null),
  };
}

function startingBalance(account: BankAccount) {
  if (account.currentBalance === null) return "Unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(account.currentBalance);
}

// The setup form's drafts, validation, and save, shared by the legacy dialog
// and the app shell's. It updates the bank once on mount so the balances it
// saves are current, and keeps one operation id per set of choices so a
// retried save can't add the same accounts twice.
export function useBankAccountSetupForm({
  state,
  connection,
  onSaved,
}: {
  state: State;
  connection: Connection;
  onSaved: (added: number) => void;
}) {
  const utils = api.useUtils();
  const save = api.budget.setupBankAccounts.useMutation();
  const sync = api.budget.sync.useMutation();
  const initialMappings = bankAccountMappings(connection.accountMappings);
  const [drafts, setDrafts] = useState<Record<string, AccountDraft>>(() =>
    Object.fromEntries(
      connection.accounts.map((account) => [
        account.accountId,
        {
          selected:
            !initialMappings.has(account.accountId) &&
            Boolean(accountSetupType(account).kind),
          name: account.name.trim().slice(0, 120),
          existingAccountId: "",
          startDate: "",
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
      await current.current.utils.budget.state.invalidate();
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
    state.connections.flatMap((item) =>
      [...bankAccountMappings(item.accountMappings).values()].map(
        (mapping) => mapping.accountId,
      ),
    ),
  );
  const selected = connection.accounts.filter(
    (account) =>
      !mappings.has(account.accountId) &&
      synchronizedAccountIds.has(account.accountId) &&
      accountSetupType(account).kind &&
      drafts[account.accountId]?.selected,
  );
  const preparingAccounts = connection.accounts.some(
    (account) =>
      !mappings.has(account.accountId) &&
      accountSetupType(account).kind &&
      !synchronizedAccountIds.has(account.accountId),
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
      synchronized: synchronizedAccountIds.has(account.accountId),
      draft: drafts[account.accountId],
      fieldError: fieldErrors[account.accountId],
      // The budget account a bank account was already added as.
      addedAs: mapping
        ? (state.view?.accounts.find((item) => item.id === mapping.accountId)
            ?.name ?? "a budget account")
        : undefined,
      existingAccounts:
        state.view?.budget.accounts.filter(
          (existing) =>
            existing.kind === type.kind &&
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
      if (!draft.name.trim() || draft.name.trim().length > 120)
        errors[account.accountId] =
          "Enter an account name with 1 to 120 characters.";
      if (draft.existingAccountId) {
        const existing = state.view?.budget.accounts.find(
          (item) => item.id === draft.existingAccountId,
        );
        if (!draft.startDate || !existing || draft.startDate <= existing.date)
          errors[account.accountId] =
            "Choose an import date after this account’s opening balance date.";
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
          expectedBalance: account.currentBalance!,
          ...(draft.existingAccountId
            ? {
                existingAccountId: draft.existingAccountId,
                startDate: draft.startDate,
              }
            : {}),
        };
      });
      await save.mutateAsync({
        connectionId: connection.id,
        operationId,
        expectedRevision: state.revision,
        accounts: submittedAccounts.current,
      });
      await utils.budget.state.invalidate();
      onSaved(submittedAccounts.current.length);
    } catch (failure) {
      if (
        failure &&
        typeof failure === "object" &&
        "data" in failure &&
        failure.data &&
        typeof failure.data === "object" &&
        "code" in failure.data &&
        (failure.data.code === "CONFLICT" ||
          failure.data.code === "BAD_REQUEST" ||
          failure.data.code === "PRECONDITION_FAILED")
      ) {
        submittedAccounts.current = null;
        setOperationId(crypto.randomUUID());
        if (failure.data.code === "PRECONDITION_FAILED") setRefreshed(false);
      }
      setError(
        failure instanceof Error
          ? failure.message
          : "Your accounts couldn’t be added. Try again.",
      );
      await utils.budget.state.invalidate();
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

export function BankAccountSetup({
  state,
  connection,
  onClose,
  onComplete,
}: {
  state: State;
  connection: Connection;
  onClose: () => void;
  onComplete?: () => void;
}) {
  const form = useBankAccountSetupForm({
    state,
    connection,
    onSaved: () => {
      onComplete?.();
      onClose();
    },
  });
  const { busy, submitting, updating } = form;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !form.locked()) onClose();
      }}
    >
      <DialogContent
        className="dialog max-w-xl"
        showCloseButton={!submitting}
        onOpenAutoFocus={(event) => {
          if ("ontouchstart" in window) event.preventDefault();
        }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>Name your bank accounts</DialogTitle>
          <DialogDescription>
            Choose the accounts to add
            {connection.institutionName
              ? ` from ${connection.institutionName}`
              : ""}
            . Checking and savings go in Cash. Credit cards go in Credit.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <div className="grid gap-4">
            {form.rows.map(
              ({
                account,
                type,
                synchronized,
                draft,
                fieldError,
                addedAs,
                existingAccounts,
              }) => {
                const errorId = `bank-setup-${account.accountId}-error`;
                return (
                  <fieldset
                    className="border-border min-w-0 rounded-md border px-4 pb-4"
                    key={account.accountId}
                  >
                    <legend className="max-w-full px-1 text-sm font-medium break-words">
                      {account.name}
                    </legend>
                    <div className="grid gap-3 pt-1">
                      <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
                        <span className="muted">
                          {account.mask ? `••${account.mask} · ` : ""}
                          {type.kind === "cash"
                            ? "Cash"
                            : type.kind === "credit"
                              ? "Credit"
                              : (account.subtype?.replaceAll("_", " ") ??
                                account.type)}
                        </span>
                        {type.kind && synchronized && (
                          <span className="text-right tabular-nums">
                            {startingBalance(account)}
                            <span className="muted block text-xs">
                              {type.kind === "credit"
                                ? "Starting balance owed"
                                : "Starting balance"}
                            </span>
                          </span>
                        )}
                      </div>
                      {addedAs ? (
                        <p className="small muted">Added as {addedAs}.</p>
                      ) : type.reason ? (
                        <p className="small muted">{type.reason}</p>
                      ) : !synchronized ? (
                        <>
                          <label className="flex min-h-11 items-center gap-2 text-sm">
                            <Checkbox checked={false} disabled />
                            Add {account.name}
                          </label>
                          <p className="small muted">
                            The bank is still preparing this account’s balance
                            and activity. Update again shortly.
                          </p>
                        </>
                      ) : (
                        <>
                          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                            <Checkbox
                              checked={draft?.selected ?? false}
                              disabled={busy}
                              onCheckedChange={(checked) =>
                                form.change(account.accountId, {
                                  selected: checked === true,
                                })
                              }
                            />
                            Add {account.name}
                          </label>
                          {draft?.selected && (
                            <>
                              <FormField
                                label="Account name"
                                name={`name-${account.accountId}`}
                                value={draft.name}
                                maxLength={120}
                                autoComplete="off"
                                spellCheck={false}
                                disabled={
                                  busy || Boolean(draft.existingAccountId)
                                }
                                aria-invalid={Boolean(fieldError) || undefined}
                                aria-describedby={
                                  fieldError ? errorId : undefined
                                }
                                onChange={(event) =>
                                  form.change(account.accountId, {
                                    name: event.target.value,
                                  })
                                }
                              />
                              {existingAccounts.length > 0 && (
                                <details className="small">
                                  <summary className="muted cursor-pointer">
                                    Use an existing budget account
                                  </summary>
                                  <div className="mt-3 grid gap-3">
                                    <SelectField
                                      label="Budget account"
                                      name={`existing-${account.accountId}`}
                                      value={draft.existingAccountId}
                                      disabled={busy}
                                      onChange={(event) =>
                                        form.change(account.accountId, {
                                          existingAccountId: event.target.value,
                                        })
                                      }
                                    >
                                      <option value="">
                                        Create a new account
                                      </option>
                                      {existingAccounts.map((existing) => (
                                        <option
                                          key={existing.id}
                                          value={existing.id}
                                        >
                                          {existing.name}
                                        </option>
                                      ))}
                                    </SelectField>
                                    {draft.existingAccountId && (
                                      <>
                                        <p className="field-hint">
                                          Your existing account name and
                                          balances will stay the same. Choose
                                          when to begin importing new activity.
                                        </p>
                                        <FormField
                                          label="Import activity beginning"
                                          name={`start-${account.accountId}`}
                                          type="date"
                                          value={draft.startDate}
                                          disabled={busy}
                                          aria-invalid={
                                            Boolean(fieldError) || undefined
                                          }
                                          aria-describedby={
                                            fieldError ? errorId : undefined
                                          }
                                          onChange={(event) =>
                                            form.change(account.accountId, {
                                              startDate: event.target.value,
                                            })
                                          }
                                        />
                                      </>
                                    )}
                                  </div>
                                </details>
                              )}
                              {fieldError && (
                                <p
                                  className="form-error"
                                  id={errorId}
                                  role="alert"
                                >
                                  ! {fieldError}
                                </p>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </fieldset>
                );
              },
            )}
          </div>
          <p className="field-hint">
            Posted activity already included in this balance won’t be imported
            again. Pending and new activity will appear for review.
          </p>
          {form.waiting && (
            <div className="grid gap-3" role="status">
              <p className="small muted">{form.waiting}</p>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void form.updateBank()}
              >
                {updating ? "Updating…" : "Retry bank update"}
              </Button>
            </div>
          )}
          {form.error && (
            <p className="form-error" role="alert">
              ! {form.error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={submitting}
              onClick={onClose}
            >
              Later
            </Button>
            <Button type="submit" disabled={!form.canSubmit}>
              {submitting ? "Adding accounts…" : "Add accounts"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
