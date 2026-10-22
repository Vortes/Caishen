"use client";

import { useAuth } from "@clerk/nextjs";
import { useIsMutating } from "@tanstack/react-query";
import { InfoIcon, LogInIcon, WrenchIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { currentMonth, monthName, newId } from "~/components/budget/format";
import type { State } from "~/components/budget/types";
import { Button } from "~/components/ui/button";
import { Toast, ToastRegion } from "~/components/ui/toast";
import {
  useRunBudgetCommand,
  type CommandBlock,
} from "~/components/workspace/use-budget-command";
import {
  MAINTENANCE_DETAIL,
  MAINTENANCE_TITLE,
  useBudgetState,
} from "~/components/workspace/use-budget-state";
import { useWorkspaceHistory } from "~/components/workspace/use-workspace-history";
import { api } from "~/trpc/react";
import { clientId } from "~/components/workspace/client-id";
import { AppShellPrototype, type CategoryAdder } from "./app-shell-prototype";
import {
  AssignMoneyProvider,
  useAssignAttempts,
  type AssignMoney,
} from "./assigned";
import {
  BankConnectionsProvider,
  BankDialog,
  useBankConnections,
} from "./banks";
import { toShellData } from "./model";
import type { MoveMoney } from "./move-money";
import { useSavedSettings } from "./settings";
import { ShellSkeleton } from "./shell-skeleton";
import type { TargetEditing } from "./target-editor";
import type { TransactionSaver } from "./transaction-entry";
import styles from "./shell.module.css";
import {
  approveCommand,
  TransactionReviewProvider,
  type TransactionReview,
} from "./transaction-review";

// Reads the signed-in budget through the production query. Moving money,
// editing Assigned, adding category groups and categories, editing targets,
// marking transactions reviewed, reconciling accounts, adding or editing
// transactions, and connecting banks are real: they send the legacy app's commands through the
// same optimistic path and share its undo history. The other actions stay
// inert.
export function LiveAppShell({ initialMonth }: { initialMonth?: string }) {
  const { isLoaded, userId } = useAuth();
  const [month, setMonth] = useState(() => initialMonth ?? currentMonth());
  const state = useBudgetState(month, Boolean(userId));
  const settings = useSavedSettings();

  if (!isLoaded || (userId && state.isPending))
    return <ShellSkeleton settings={settings} month={monthName(month)} />;
  if (!userId)
    return (
      <Status icon={<LogInIcon size={18} />}>
        <strong>Sign in to see your budget here.</strong>
        <a href="/sign-in?redirect_url=/prototype/app-shell">Sign in</a>
      </Status>
    );
  if (state.error && !state.data)
    return (
      <Status icon={<InfoIcon size={18} />}>
        <strong>Your budget couldn’t load.</strong>
        {state.error.message}
      </Status>
    );
  if (state.data?.status === "maintenance")
    return (
      <Status icon={<WrenchIcon size={18} />}>
        <strong>{MAINTENANCE_TITLE}</strong>
        {MAINTENANCE_DETAIL}
      </Status>
    );
  if (!state.data?.view)
    return (
      <Status icon={<InfoIcon size={18} />}>
        <strong>You don’t have a budget yet.</strong>
        <a href="/">Create one in Caishen</a>, then come back.
      </Status>
    );
  return (
    <LiveWorkspace
      key={userId}
      state={state.data}
      loadingMonth={state.isPlaceholderData}
      refreshError={state.error?.message}
      onRetry={() => void state.refetch()}
      onMonthChange={setMonth}
    />
  );
}

const blockMessage: Record<CommandBlock, string> = {
  saving: "Wait for your last change to save, then try again.",
  loading: "Wait for the month to finish loading, then try again.",
  stale: "Refresh your budget before making more changes.",
};

type Notice = {
  id: string;
  tone: "neutral" | "attention";
  message: string;
  // The revision a change saved as, while its toast offers to undo it.
  revision?: number;
};

function LiveWorkspace({
  state,
  loadingMonth,
  refreshError,
  onRetry,
  onMonthChange,
}: {
  state: State;
  loadingMonth: boolean;
  refreshError?: string;
  onRetry: () => void;
  onMonthChange: (month: string) => void;
}) {
  const data = useMemo(() => toShellData(state), [state]);
  const utils = api.useUtils();
  const resolveImport = api.budget.resolveImport.useMutation({
    retry: false,
    onSuccess: async () => {
      await utils.budget.state.invalidate();
    },
    onError: (error) => notify(error.message, "attention"),
  });
  const [notice, setNotice] = useState<Notice | null>(null);
  const notify = (
    message: string,
    tone: Notice["tone"] = "neutral",
    revision?: number,
  ) => setNotice({ id: crypto.randomUUID(), tone, message, revision });
  // Each change's confirmation, by command id, until the server answers.
  const summaries = useRef(new Map<string, string>());
  // Who's waiting to hear whether a command saved, by command id.
  const settles = useRef(new Map<string, (saved: boolean) => void>());
  const settle = (command: { id: string }, saved: boolean) => {
    const callback = settles.current.get(command.id);
    settles.current.delete(command.id);
    callback?.(saved);
  };
  const { blocked, run, execute } = useRunBudgetCommand({
    state,
    loadingMonth,
    refreshError,
    onSuccess: (command, { revision }) => {
      const summary = summaries.current.get(command.id);
      summaries.current.delete(command.id);
      if (summary) notify(summary, "neutral", revision);
      settle(command, true);
    },
    onError: (error, command) => {
      summaries.current.delete(command.id);
      notify(error.message, "attention");
      settle(command, false);
    },
  });

  const [openPopovers, setOpenPopovers] = useState(0);
  const holdOpen = useCallback(() => {
    setOpenPopovers((count) => count + 1);
    return () => setOpenPopovers((count) => count - 1);
  }, []);
  const banks = useBankConnections({ state, notify, holdOpen });
  const moveMoney: MoveMoney = {
    move: (command, summary) => {
      const reason = blocked();
      if (reason) return blockMessage[reason];
      summaries.current.set(command.id, summary);
      run(command);
      return null;
    },
    holdOpen,
  };

  const categoryAdder: CategoryAdder = {
    add: (command, summary, settled) => {
      const reason = blocked();
      if (reason) return blockMessage[reason];
      summaries.current.set(command.id, summary);
      if (settled) settles.current.set(command.id, settled);
      run(command);
      return null;
    },
    holdOpen,
  };
  const targetEditing: TargetEditing = {
    save: moveMoney.move,
    holdOpen,
  };

  const busy = useIsMutating() > 0 || loadingMonth || Boolean(refreshError);
  const attemptId = useAssignAttempts(state.revision);
  const assignMoney: AssignMoney = {
    revision: state.revision,
    busy,
    assign: (command, summary, settled) => {
      const reason = blocked();
      if (reason) return blockMessage[reason];
      summaries.current.set(command.id, summary);
      settles.current.set(command.id, settled);
      run(command);
      return null;
    },
    attemptId,
    alert: (message) => notify(message, "attention"),
    holdOpen,
  };
  const review: TransactionReview = {
    approve: (transactionIds) => {
      if (blocked() || !transactionIds.length) return;
      const command = approveCommand(transactionIds);
      const count = transactionIds.length;
      summaries.current.set(
        command.id,
        `Marked ${count} ${count === 1 ? "transaction" : "transactions"} reviewed`,
      );
      run(command);
    },
    reject: (transactionIds) => {
      if (blocked() || !transactionIds.length) return;
      const command = {
        type: "transaction.reject" as const,
        id: newId(),
        transactionIds,
      };
      const count = transactionIds.length;
      summaries.current.set(
        command.id,
        `Rejected ${count} ${count === 1 ? "transaction" : "transactions"}`,
      );
      run(command);
    },
    categorize: async (transactionIds, categoryId) => {
      const reason = blocked();
      if (reason) throw new Error(blockMessage[reason]);
      const command = {
        type: "transaction.categorize.batch" as const,
        id: newId(),
        transactionIds,
        categoryId,
      };
      const count = transactionIds.length;
      summaries.current.set(
        command.id,
        `Categorized ${count} ${count === 1 ? "transaction" : "transactions"}`,
      );
      await execute.mutateAsync({
        command,
        baseRevision: state.revision,
        clientId,
      });
    },
    busy,
  };
  const transactionSaver: TransactionSaver = {
    view: state.view!,
    imports: state.imports,
    busy,
    blocked: () => {
      const reason = blocked();
      return reason && blockMessage[reason];
    },
    // Settles with the server's answer, so the editor stays open with its
    // draft when the save fails.
    save: async (command, summary) => {
      summaries.current.set(command.id, summary);
      await execute.mutateAsync({
        command,
        baseRevision: state.revision,
        clientId,
      });
    },
    saveImport: async (item, command, summary) => {
      await resolveImport.mutateAsync({
        connectionId: item.connectionId,
        logicalId: item.logicalId,
        expectedFingerprint: item.fingerprint,
        expectedRevision: state.revision,
        command,
      });
      notify(summary);
    },
    holdOpen,
  };
  const history = useWorkspaceHistory({
    state,
    disabled: busy || openPopovers > 0,
    onSuccess: (message) => notify(message),
    onError: (message) => notify(message, "attention"),
  });

  // A move's toast offers Undo only while the move is still the latest saved
  // change. Until the saved budget arrives the offer waits, disabled; once
  // anything else changes the budget, the offer is gone.
  const saved = notice?.revision;
  const offerUndo =
    saved !== undefined &&
    (state.revision < saved ||
      (state.revision === saved && state.history.undo !== null));
  const canUndo = offerUndo && state.revision === saved && !history.unavailable;

  return (
    <TransactionReviewProvider value={review}>
      <AssignMoneyProvider value={assignMoney}>
        <BankConnectionsProvider value={banks}>
          <AppShellPrototype
            data={data}
            loadingMonth={loadingMonth}
            onMonthChange={onMonthChange}
            moveMoney={moveMoney}
            categoryAdder={categoryAdder}
            transactionSaver={transactionSaver}
            targetEditing={targetEditing}
            reconciling={{ reconcile: moveMoney.move, holdOpen }}
            renameBudget={(name) => {
              const reason = blocked();
              if (reason) return blockMessage[reason];
              const command = {
                type: "settings.update" as const,
                id: newId(),
                name,
              };
              summaries.current.set(
                command.id,
                `Renamed your budget to ${name}`,
              );
              run(command);
              return null;
            }}
            overlays={
              <>
                <BankDialog />
                <ToastRegion>
                  {refreshError && (
                    <Toast
                      tone="attention"
                      action={
                        <Button size="sm" onClick={onRetry}>
                          Try again
                        </Button>
                      }
                    >
                      Your budget couldn’t refresh. Refresh before making more
                      changes.
                    </Toast>
                  )}
                  {notice && (
                    <Toast
                      key={notice.id}
                      tone={notice.tone}
                      duration={saved === undefined ? undefined : 8000}
                      onDismiss={() => setNotice(null)}
                      action={
                        offerUndo && (
                          <Button
                            size="sm"
                            disabled={!canUndo}
                            onClick={() => history.change("undo")}
                          >
                            Undo
                          </Button>
                        )
                      }
                    >
                      {notice.message}
                    </Toast>
                  )}
                </ToastRegion>
              </>
            }
          />
        </BankConnectionsProvider>
      </AssignMoneyProvider>
    </TransactionReviewProvider>
  );
}

function Status({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.root} data-theme="dark" data-tint="neutral">
      <div className={styles.empty} role="status">
        {icon}
        <p>{children}</p>
      </div>
    </div>
  );
}
