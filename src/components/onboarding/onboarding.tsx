"use client";

import { groupAmountInput } from "~/components/budget/amount-input";
import { useAuth, useUser, useClerk } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import { LandmarkIcon, PlusIcon } from "lucide-react";
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
import { firstName } from "~/components/partner-invite/print";
import batch from "~/components/entry/entry.module.css";
import styles from "~/components/entry/onboarding.module.css";

const holdOpen = () => () => undefined;

const stageKeyFor = (userId: string | null | undefined) =>
  `caishen:onboarding:${userId ?? ""}`;

/**
 * The invitation link this tab's unfinished setup came from, kept beside
 * the setup draft so reopening the link carries on with the setup. A closed
 * tab loses it, and the link opens the invitation again.
 */
export function savedInvitation(userId: string) {
  return window.sessionStorage.getItem(`${stageKeyFor(userId)}:invitation`);
}

// The invitation a newcomer signed, accepted in the step that creates their
// budget.
export type OnboardingInvitation = { token: string; id: string; from: string };

export function Onboarding({
  invitation,
}: { invitation?: OnboardingInvitation } = {}) {
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
  const stageKey = stageKeyFor(userId);
  const draftKey = `${stageKey}:categories`;
  const invitationKey = `${stageKey}:invitation`;
  useEffect(() => {
    if (invitation && userId)
      window.sessionStorage.setItem(invitationKey, invitation.token);
  }, [invitation, userId, invitationKey]);
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
  const cashAccounts = (view?.accounts ?? []).filter((account) =>
    ["cash", "credit", "tracking"].includes(account.kind),
  );
  const createBudget = async (input: BudgetBasics) => {
    const [firstName = "", ...rest] = input.yourName.split(/\s+/);
    if (user && input.yourName !== (user.fullName ?? ""))
      await user.update({ firstName, lastName: rest.join(" ") });
    const start = currentMonth(input.timezone);
    const current = await utils.client.budget.state.query({ month: start });
    // Accepting joins the sender's household, so it needs the budget made
    // with it; the server makes it unless an earlier try already did.
    if (invitation) {
      await create.mutateAsync({
        name: input.name,
        timezone: input.timezone,
        emailEnabled: input.emailEnabled,
        month: start,
        invitation: invitation.id,
      });
      window.sessionStorage.removeItem(invitationKey);
      // The link is spent; a reload carries on with the setup.
      window.history.replaceState(null, "", "/welcome");
    } else if (!current.view)
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
        initialName={user?.fullName ?? ""}
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
        invitedBy={invitation && firstName(invitation.from)}
        onCheckInvite={
          invitation ? undefined : (code) => check.mutateAsync({ code })
        }
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
          window.sessionStorage.removeItem(invitationKey);
          window.sessionStorage.removeItem(draftKey);
          window.location.assign(`${SHELL_PATH}?assign=1`);
        }}
        accounts={
          <>
            <AccountsCard
              banks={banks}
              accounts={cashAccounts}
              notice={notice}
              timezone={view?.budget.settings.timezone ?? "America/Los_Angeles"}
              onAdd={run}
            />
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

export function AccountsCard({
  banks,
  accounts,
  notice,
  timezone,
  onAdd,
}: {
  banks: ReturnType<typeof useBankConnections>;
  accounts: { id: string; name: string; balance: number }[];
  notice: string | null;
  timezone: string;
  onAdd: (command: Command) => Promise<void>;
}) {
  const [manual, setManual] = useState(false);
  return (
    <Card>
      <div className={styles.connect}>
        <LandmarkIcon size={15} className={styles.connectIcon} aria-hidden />
        <div className={styles.bankHead}>
          <h2 className={styles.cardHeading}>Connect your bank</h2>
          <p className={batch.fieldHint}>
            {banks.available
              ? "Caishen never sees your bank password."
              : "Bank connections aren’t set up yet. Add an account by hand."}
          </p>
        </div>
        <Button
          variant="primary"
          disabled={!banks.available || banks.busy}
          onClick={() => banks.start()}
        >
          {banks.opening ? "Opening Plaid…" : "Connect a bank"}
        </Button>
      </div>
      {(banks.connections.length > 0 || accounts.length > 0) && (
        <ul className={styles.accountList} data-spaced>
          {banks.connections.map((connection) => (
            <li key={connection.id} className={styles.accountRow}>
              <span className={styles.accountName}>
                {connection.institutionName ?? "Connected bank"}
              </span>
              <Button size="sm" onClick={() => banks.setUp(connection.id)}>
                Set up accounts
              </Button>
            </li>
          ))}
          {accounts.map((account) => (
            <li key={account.id} className={styles.accountRow}>
              <span className={styles.accountName}>{account.name}</span>
              <span className={styles.amount}>
                {formatMoney(account.balance)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.divider} />
      {manual ? (
        <ManualAccount
          onCancel={() => setManual(false)}
          onSave={async (command) => {
            await onAdd(command);
            setManual(false);
          }}
          timezone={timezone}
        />
      ) : (
        <div>
          <Button variant="quiet" onClick={() => setManual(true)}>
            <PlusIcon aria-hidden />
            Add an account by hand
          </Button>
        </div>
      )}
      {notice && (
        <p className={styles.bankNote} role="status">
          {notice}
        </p>
      )}
    </Card>
  );
}

function ManualAccount({
  onSave,
  onCancel,
  timezone,
}: {
  onSave: (command: Command) => Promise<void>;
  onCancel: () => void;
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
      className={styles.manual}
      onSubmit={(event) => {
        event.preventDefault();
        void save(event.currentTarget);
      }}
    >
      <div className={styles.manualFields}>
        <label className={batch.field}>
          <span className={batch.fieldLabel}>Account name</span>
          <input
            className={batch.input}
            name="name"
            autoComplete="off"
            required
            maxLength={80}
          />
        </label>
        <label className={batch.field}>
          <span className={batch.fieldLabel}>Type</span>
          <select className={batch.select} name="kind">
            <option value="cash">Checking or savings</option>
            <option value="credit">Credit card</option>
          </select>
        </label>
        <label className={batch.field}>
          <span className={batch.fieldLabel}>Balance today</span>
          <input
            className={`${batch.input} ${styles.amountInput}`}
            name="balance"
            inputMode="decimal"
            onChange={(event) => {
              event.target.value = groupAmountInput(event.target);
            }}
            placeholder="0.00"
            required
          />
        </label>
      </div>
      <p className={batch.fieldHint}>
        For a credit card, enter the amount you owe.
      </p>
      {error && (
        <p className={batch.error} role="alert">
          {error}
        </p>
      )}
      <div className={batch.actions} data-end>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Adding…" : "Add account"}
        </Button>
      </div>
    </form>
  );
}
