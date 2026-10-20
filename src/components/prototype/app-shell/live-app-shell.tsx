"use client";

import { useAuth } from "@clerk/nextjs";
import { useIsMutating } from "@tanstack/react-query";
import { InfoIcon, LoaderCircleIcon, LogInIcon } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { currentMonth } from "~/components/budget/format";
import type { State } from "~/components/budget/types";
import { Button } from "~/components/ui/button";
import { Toast, ToastRegion } from "~/components/ui/toast";
import {
  useRunBudgetCommand,
  type CommandBlock,
} from "~/components/workspace/use-budget-command";
import { useBudgetState } from "~/components/workspace/use-budget-state";
import { useWorkspaceHistory } from "~/components/workspace/use-workspace-history";
import { AppShellPrototype } from "./app-shell-prototype";
import { toShellData } from "./model";
import type { MoveMoney } from "./move-money";
import styles from "./shell.module.css";
import {
  approveCommand,
  TransactionReviewProvider,
  type TransactionReview,
} from "./transaction-review";

// Reads the signed-in budget through the production query. Moving money and
// marking transactions reviewed are real: they send the legacy app's
// commands through the same optimistic path and share its undo history. The
// other actions stay inert.
export function LiveAppShell() {
  const { isLoaded, userId } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  const state = useBudgetState(month, Boolean(userId));

  if (!isLoaded || (userId && state.isPending))
    return (
      <Status icon={<LoaderCircleIcon size={18} className={styles.spin} />}>
        <strong>Opening your budget…</strong>
      </Status>
    );
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
  // The revision a move saved as, while its toast offers to undo it.
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const notify = (
    message: string,
    tone: Notice["tone"] = "neutral",
    revision?: number,
  ) => setNotice({ id: crypto.randomUUID(), tone, message, revision });
  // Each move's confirmation, by command id, until the server answers.
  const summaries = useRef(new Map<string, string>());
  const { blocked, run } = useRunBudgetCommand({
    state,
    loadingMonth,
    refreshError,
    onSuccess: (command, { revision }) => {
      const summary = summaries.current.get(command.id);
      summaries.current.delete(command.id);
      if (summary) notify(summary, "neutral", revision);
    },
    onError: (error, command) => {
      summaries.current.delete(command.id);
      notify(error.message, "attention");
    },
  });

  const [openPopovers, setOpenPopovers] = useState(0);
  const holdOpen = useCallback(() => {
    setOpenPopovers((count) => count + 1);
    return () => setOpenPopovers((count) => count - 1);
  }, []);
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

  const busy = useIsMutating() > 0 || loadingMonth || Boolean(refreshError);
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
    busy,
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
      <AppShellPrototype
        data={data}
        loadingMonth={loadingMonth}
        onMonthChange={onMonthChange}
        moveMoney={moveMoney}
        notifications={
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
        }
      />
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
