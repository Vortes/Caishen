"use client";

import { useAuth, useUser, useClerk } from "@clerk/nextjs";
import { useCallback, useState } from "react";
import { LandmarkIcon } from "lucide-react";
import {
  currentMonth,
  newId,
  parseMoney,
  text,
  today,
  formatMoney,
} from "~/components/budget/format";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { api } from "~/trpc/react";
import type { Command } from "~/domain/engine";
import {
  BankConnectionsProvider,
  BankDialog,
  useBankConnections,
} from "~/components/app-shell/banks";
import { deleteStoredBudgets } from "~/components/sync/indexed-db";
import { SHELL_PATH } from "~/components/workspace/routes";
import { PartnerSettings } from "~/components/settings/partner";
import { ShellDataProvider } from "~/components/app-shell/shell-data";
import { toShellData } from "~/components/app-shell/model";
import {
  GuidedOnboarding,
  type BudgetBasics,
  type SetupStage,
} from "~/components/entry/guided-onboarding";
import { EntryPage } from "~/components/entry/entry-page";
import {
  categoryDraftSchema,
  initialCategories,
} from "~/components/entry/onboarding-categories";
import batch from "~/components/entry/entry.module.css";
import styles from "~/components/entry/onboarding.module.css";

const holdOpen = () => () => undefined;

export function Onboarding() {
  const { userId } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const [month, setMonth] = useState(currentMonth);
  const utils = api.useUtils();
  const state = api.budget.state.useQuery(
    { month },
    { enabled: Boolean(userId) },
  );
  const create = api.budget.onboard.useMutation();
  const join = api.budget.join.useMutation();
  const check = api.budget.checkInvite.useMutation();
  const [notice, setNotice] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const refresh = () => utils.budget.state.invalidate();
  const run = async (command: Command) => {
    const current = await utils.client.budget.state.query({ month });
    await utils.client.budget.execute.mutate({
      command,
      baseRevision: current.revision,
      clientId: "onboarding",
    });
    await refresh();
  };
  const banks = useBankConnections({
    state: state.data ?? {
      connections: [],
      view: null,
      revision: 0,
      services: [],
    },
    notify: (message) => setNotice(message),
    holdOpen,
    runOnServer: async (_id, send) => {
      const current = await utils.client.budget.state.query({ month });
      await send(current.revision);
      await refresh();
    },
  });
  const stageKey = `caishen:onboarding:${userId ?? ""}`;
  const draftKey = `${stageKey}:categories`;
  const savedDraft = () => {
    // This is an unfinished setup draft; the saved budget remains on the server.
    try {
      return (
        categoryDraftSchema.safeParse(
          JSON.parse(window.sessionStorage.getItem(draftKey) ?? "null"),
        ).data ?? initialCategories
      );
    } catch {
      return initialCategories;
    }
  };
  const savedStage = () => {
    const value = window.sessionStorage.getItem(stageKey);
    return ["categories", "accounts", "ready"].includes(value ?? "")
      ? (value as SetupStage)
      : undefined;
  };
  if (state.isPending)
    return (
      <EntryPage>
        <main className={styles.main}>
          <p role="status">Opening your budget setup…</p>
        </main>
      </EntryPage>
    );
  if (state.error)
    return (
      <EntryPage>
        <main className={styles.main}>
          <p role="alert">{state.error.message}</p>
          <Button onClick={() => void state.refetch()}>Try again</Button>
        </main>
      </EntryPage>
    );
  if (state.data.status === "maintenance")
    return (
      <EntryPage>
        <main className={styles.main}>
          <p role="alert">
            Your budget is under maintenance. Try again in a few minutes.
          </p>
        </main>
      </EntryPage>
    );
  const view = state.data.view;
  const createBudget = async (input: BudgetBasics) => {
    const start = currentMonth(input.timezone);
    const current = await utils.client.budget.state.query({ month: start });
    if (!current.view)
      await create.mutateAsync({
        name: input.name,
        timezone: input.timezone,
        emailEnabled: input.emailEnabled,
        month: start,
      });
    if (input.inviteCode) await join.mutateAsync({ code: input.inviteCode });
    window.sessionStorage.setItem(stageKey, "categories");
    setMonth(start);
    await refresh();
  };
  return (
    <BankConnectionsProvider value={banks}>
      <GuidedOnboarding
        email={user?.primaryEmailAddress?.emailAddress}
        onSignOut={() =>
          void deleteStoredBudgets().finally(() =>
            clerk.signOut({ redirectUrl: "/" }),
          )
        }
        initialDraft={savedDraft()}
        onDraftChange={(draft) =>
          window.sessionStorage.setItem(draftKey, JSON.stringify(draft))
        }
        initialStage={view ? (savedStage() ?? "categories") : "basics"}
        onStageChange={(stage) =>
          window.sessionStorage.setItem(stageKey, stage)
        }
        onCreate={createBudget}
        onCheckInvite={(code) => check.mutateAsync({ code })}
        onCategories={async (groups) => {
          const current = await utils.client.budget.state.query({ month });
          await utils.client.budget.setupCategories.mutate({
            operationId: newId(),
            expectedRevision: current.revision,
            categories: groups.flatMap((group) =>
              group.categories.map((name) => ({
                name,
                group: group.name,
                categoryId: `setup:${group.name}:${name}`,
              })),
            ),
          });
          await refresh();
        }}
        readyToAssign={view?.readyToAssign ?? 0}
        onComplete={() => {
          window.sessionStorage.removeItem(stageKey);
          window.sessionStorage.removeItem(draftKey);
          window.location.assign(`${SHELL_PATH}?assign=1`);
        }}
        accounts={
          <>
            <Card>
              <div className={styles.fields}>
                <LandmarkIcon size={20} aria-hidden />
                <h2 className={styles.groupName}>Connect your bank</h2>
                <p className={batch.fieldHint}>
                  Choose your bank in Plaid’s secure window. Caishen never sees
                  your bank password.
                </p>
                <div>
                  <Button
                    variant="primary"
                    disabled={!banks.available || banks.busy}
                    onClick={() => banks.start()}
                  >
                    {banks.opening ? "Opening Plaid…" : "Connect a bank"}
                  </Button>
                </div>
                {!banks.available && (
                  <p className={batch.fieldHint}>
                    Bank connections aren’t configured yet. You can add an
                    account by hand.
                  </p>
                )}
                {banks.connections.map((connection) => (
                  <div key={connection.id}>
                    <span>
                      {connection.institutionName ?? "Connected bank"}
                    </span>{" "}
                    <Button
                      size="sm"
                      onClick={() => banks.setUp(connection.id)}
                    >
                      Set up accounts
                    </Button>
                  </div>
                ))}
                {view && (
                  <ul className={styles.checkList}>
                    {view.accounts
                      .filter((account) =>
                        ["cash", "credit", "tracking"].includes(account.kind),
                      )
                      .map((account) => (
                        <li key={account.id}>
                          {account.name} · {formatMoney(account.balance)}
                        </li>
                      ))}
                  </ul>
                )}
                <div>
                  <Button variant="quiet" onClick={() => setManual(!manual)}>
                    {manual ? "Cancel" : "Add an account by hand"}
                  </Button>
                </div>
                {manual && (
                  <ManualAccount
                    onSave={async (command) => {
                      await run(command);
                      setManual(false);
                    }}
                    timezone={
                      view?.budget.settings.timezone ?? "America/Los_Angeles"
                    }
                  />
                )}
                {notice && <p role="status">{notice}</p>}
              </div>
            </Card>
            <BankDialog />
          </>
        }
        partner={
          view && (
            <ShellDataProvider value={toShellData(state.data)}>
              <PartnerSettings />
            </ShellDataProvider>
          )
        }
      />
    </BankConnectionsProvider>
  );
}

function ManualAccount({
  onSave,
  timezone,
}: {
  onSave: (command: Command) => Promise<void>;
  timezone: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [operationId] = useState(newId);
  const save = useCallback(
    async (form: HTMLFormElement) => {
      const fields = new FormData(form);
      setBusy(true);
      setError(null);
      try {
        const kind = fields.get("kind") === "credit" ? "credit" : "cash";
        const balance = parseMoney(text(fields, "balance"));
        await onSave({
          type: "account.add",
          id: operationId,
          accountId: operationId,
          name: text(fields, "name"),
          kind,
          openingBalance: kind === "credit" ? -Math.abs(balance) : balance,
          date: today(timezone),
        });
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Couldn’t add this account. Try again.",
        );
      } finally {
        setBusy(false);
      }
    },
    [onSave, operationId, timezone],
  );
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void save(event.currentTarget);
      }}
    >
      <label className={batch.field}>
        Account name
        <input
          className={batch.input}
          name="name"
          autoComplete="off"
          required
          maxLength={80}
        />
      </label>
      <label className={batch.field}>
        Account type
        <select className={batch.select} name="kind">
          <option value="cash">Checking or savings</option>
          <option value="credit">Credit card</option>
        </select>
      </label>
      <label className={batch.field}>
        Current balance
        <input
          className={batch.input}
          name="balance"
          inputMode="decimal"
          placeholder="0.00"
          required
        />
      </label>
      <p className={batch.fieldHint}>
        For a credit card, enter the amount you owe.
      </p>
      {error && (
        <p className={batch.error} role="alert">
          {error}
        </p>
      )}
      <div className={batch.actions} data-end>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add account"}
        </Button>
      </div>
    </form>
  );
}
