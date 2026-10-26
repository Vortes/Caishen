"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { LogInIcon, RotateCwIcon, WrenchIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { currentMonth, monthName, newId } from "~/components/budget/format";
import { Button } from "~/components/ui/button";
import { Toast, ToastRegion } from "~/components/ui/toast";
import {
  openBudgetClient,
  type BudgetClient,
} from "~/components/sync/budget-client";
import type {
  BudgetSnapshot,
  RunResult,
  Settled,
} from "~/components/sync/budget-store";
import {
  importRowId,
  importReviewCommand,
  type BankImport,
} from "~/components/transactions/import-draft";
import { transactionActions } from "~/components/transactions/transaction-actions";
import {
  BudgetClientProvider,
  useBudgetMonth,
  useBudgetSelector,
} from "~/components/sync/hooks";
import {
  clientBuild,
  serverOperation,
  trpcTransport,
  type RenewSession,
} from "~/components/sync/trpc-transport";
import {
  MAINTENANCE_DETAIL,
  MAINTENANCE_TITLE,
} from "~/components/workspace/maintenance";
import type { Command } from "~/domain/engine";
import { api, type RouterOutputs } from "~/trpc/react";
import { serverRevisions } from "~/trpc/links";
import { AppShell, type CategoryAdder } from "./app-shell";
import { settingsReturnHref } from "~/components/workspace/routes";
import { AssignMoneyProvider, type AssignMoney } from "./assigned";
import type { ServerRunner } from "~/components/banks/bank-account-setup";
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
import { useHistoryShortcuts } from "./use-history-shortcuts";
import { SHELL_PATH } from "~/components/workspace/routes";
import { BudgetLoadError } from "~/components/entry/load-error";

type Overview = RouterOutputs["budget"]["overview"];

// The signed-in budget, kept in this browser by the budget client (ADR 0006):
// stored rows show at once, every change applies on screen as it's made and
// saves in the background, and undo covers this browser load. Moving money,
// editing Assigned, adding category groups and categories, editing targets,
// reviewing and editing transactions, reconciling accounts, and connecting
// banks use the same command path.
export function LiveAppShell() {
  const searchParams = useSearchParams();
  const search = new URLSearchParams(searchParams?.toString());
  const returnSearch = new URLSearchParams(
    settingsReturnHref(search).split("?")[1],
  );
  const requestedMonth = search.get("month") ?? returnSearch.get("month");
  const month =
    requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
      ? requestedMonth
      : currentMonth();
  const setMonth = useCallback((next: string) => {
    const address = new URL(window.location.href);
    address.searchParams.set("month", next);
    window.history.replaceState(
      null,
      "",
      `${address.pathname}${address.search}`,
    );
  }, []);
  return <BudgetSession month={month} onMonthChange={setMonth} />;
}

// Route and filter updates reach AppShell without rerendering the budget session.
const BudgetSession = memo(function BudgetSession({
  month,
  onMonthChange,
}: {
  month: string;
  onMonthChange: (month: string) => void;
}) {
  const { isLoaded, userId } = useAuth();
  const settings = useSavedSettings();
  const renewSession = useRenewSession();
  const client = useBudgetClientFor(userId, renewSession);
  const overview = api.budget.overview.useQuery(undefined, {
    enabled: Boolean(userId),
    // A budget under maintenance checks back every minute, so the plan
    // returns on its own.
    refetchInterval: (query) =>
      query.state.data?.status === "maintenance" ? 60_000 : false,
  });

  if (isLoaded && !userId) return <SignIn />;
  const skeleton = (
    <ShellSkeleton settings={settings} month={monthName(month)} />
  );
  if (!client) return skeleton;
  return (
    <BudgetClientProvider client={client}>
      <LiveBudget
        client={client}
        month={month}
        onMonthChange={onMonthChange}
        overview={overview.data}
        overviewError={overview.error?.message}
        skeleton={skeleton}
      />
    </BudgetClientProvider>
  );
});

// Asks Clerk for a fresh session token, which also renews the session
// cookie the API reads. Stays the same function, so the budget client
// isn't reopened.
function useRenewSession(): RenewSession {
  const clerk = useClerk();
  const current = useRef(clerk);
  useEffect(() => {
    current.current = clerk;
  }, [clerk]);
  return useCallback(
    async () =>
      Boolean(await current.current.session?.getToken({ skipCache: true })),
    [],
  );
}

// One budget client per signed-in user, for as long as the shell is open.
// Revisions on any API response tell it when to catch up.
function useBudgetClientFor(
  userId: string | null | undefined,
  renewSession: RenewSession,
) {
  const trpc = api.useUtils().client;
  const [client, setClient] = useState<BudgetClient | null>(null);
  useEffect(() => {
    if (!userId) return;
    const opened = openBudgetClient({
      userId,
      transport: trpcTransport(trpc, renewSession),
      clientBuild,
    });
    const stop = serverRevisions.subscribe((hint) => opened.signal.emit(hint));
    setClient(opened);
    return () => {
      stop();
      opened.dispose();
      setClient(null);
    };
  }, [userId, trpc, renewSession]);
  return client;
}

const whole = (snapshot: BudgetSnapshot) => snapshot;

function LiveBudget({
  client,
  month,
  onMonthChange,
  overview,
  overviewError,
  skeleton,
}: {
  client: BudgetClient;
  month: string;
  onMonthChange: (month: string) => void;
  overview?: Overview;
  overviewError?: string;
  skeleton: ReactNode;
}) {
  const snapshot = useBudgetSelector(whole);
  const [retrying, setRetrying] = useState(false);
  // Bank connections, their inbox, and Reflect's spending are read beside
  // the rows; they follow the budget's revision.
  const utils = api.useUtils();
  const shown = useRef(snapshot.revision);
  useEffect(() => {
    const previous = shown.current;
    shown.current = snapshot.revision;
    // The first revision is what they were read at.
    if (previous !== null && previous !== snapshot.revision)
      void utils.budget.invalidate();
  }, [snapshot.revision, utils]);

  if (overview?.status === "maintenance")
    return (
      <Status icon={<WrenchIcon size={18} />}>
        <strong>{MAINTENANCE_TITLE}</strong>
        {MAINTENANCE_DETAIL}
      </Status>
    );
  if (snapshot.signedOut && snapshot.status !== "ready") return <SignIn />;
  if (snapshot.staleClient && snapshot.status !== "ready")
    return (
      <Status icon={<RotateCwIcon size={18} />}>
        <strong>Caishen has been updated.</strong>
        <a href={window.location.href}>Reload</a> to keep using your budget.
      </Status>
    );
  if (
    overview?.status === "new" ||
    (snapshot.status === "empty" && overview?.status !== "ready")
  )
    return <StartOnboarding>{skeleton}</StartOnboarding>;
  if (snapshot.status !== "ready") {
    if (retrying) return skeleton;
    if (snapshot.refreshFailed || (overviewError && !overview))
      return (
        <BudgetLoadError
          error={overviewError}
          onRetry={() => {
            setRetrying(true);
            void Promise.all([
              client.refresh(),
              utils.budget.overview.invalidate(),
            ]).finally(() => setRetrying(false));
          }}
        />
      );
    return skeleton;
  }
  return (
    <LiveWorkspace
      client={client}
      snapshot={snapshot}
      month={month}
      onMonthChange={onMonthChange}
      overview={overview}
    />
  );
}

function StartOnboarding({ children }: { children: ReactNode }) {
  const router = useRouter();
  // Setup stays on its own page so the first saved budget cannot replace it.
  useEffect(() => router.replace("/welcome"), [router]);
  return children;
}

type Notice = {
  id: string;
  tone: "neutral" | "attention";
  message: string;
  // The change this toast confirms, while it offers to undo it.
  operationId?: string;
};

const noImports: Overview["imports"] = [];
const noConnections: Overview["connections"] = [];
const noServices: Overview["services"] = [];

function LiveWorkspace({
  client,
  snapshot,
  month,
  onMonthChange,
  overview,
}: {
  client: BudgetClient;
  snapshot: BudgetSnapshot;
  month: string;
  onMonthChange: (month: string) => void;
  overview?: Overview;
}) {
  const view = useBudgetMonth(month)!;
  const utils = api.useUtils();
  const trpc = utils.client;
  const renewSession = useRenewSession();
  const services = overview?.services ?? noServices;
  const connections = overview?.connections ?? noConnections;
  // Imports a save just resolved stay hidden until the inbox catches up.
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());
  const [importPreviews, setImportPreviews] = useState<
    ReadonlyMap<string, { fingerprint: string; transactionId: string }>
  >(new Map());
  const allImports = overview?.imports ?? noImports;
  const imports = useMemo(
    () =>
      allImports.filter((item) => {
        if (resolved.has(importRowId(item))) return false;
        const preview = importPreviews.get(importRowId(item));
        return (
          preview?.fingerprint !== item.fingerprint ||
          !view.budget.transactions.some(
            (transaction) =>
              transaction.id === preview.transactionId && !transaction.removed,
          )
        );
      }),
    [allImports, resolved, importPreviews, view.budget.transactions],
  );
  useEffect(() => {
    setImportPreviews((current) => {
      const next = new Map(
        [...current].filter(([id, preview]) =>
          allImports.some(
            (item) =>
              importRowId(item) === id &&
              item.fingerprint === preview.fingerprint &&
              !item.transactionId,
          ),
        ),
      );
      return next.size === current.size ? current : next;
    });
  }, [allImports]);
  const partnerFirstName = overview?.partnerFirstName ?? undefined;
  const data = useMemo(
    () => toShellData({ view, connections, imports, partnerFirstName }),
    [view, connections, imports, partnerFirstName],
  );

  const [notice, setNotice] = useState<Notice | null>(null);
  const notify = useCallback(
    (message: string, tone: Notice["tone"] = "neutral", operationId?: string) =>
      setNotice({ id: crypto.randomUUID(), tone, message, operationId }),
    [],
  );
  // Refusals a form shows next to its fields, by operation id.
  const shownInPlace = useRef(new Set<string>());
  // The server refused a change: it's gone from the screen, so say why.
  useEffect(
    () =>
      client.store.onNotice((event) => {
        if (event.kind !== "refused") return;
        if (!shownInPlace.current.delete(event.operationId))
          notify(event.message, "attention");
      }),
    [client, notify],
  );

  // Unsaved changes live only in this tab until the server has them.
  const unsaved = snapshot.pending.length > 0;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  // Shows the change at once and confirms it once saved. Returns why the
  // change can't apply here, or null once it's on its way.
  const run = (
    command: Command,
    summary: string,
    settled?: (saved: boolean) => void,
  ) =>
    message(
      client.run(command, {
        summary,
        onSettled: (result) => {
          if (result.ok) notify(summary, "neutral", command.id);
          settled?.(result.ok);
        },
      }),
    );
  // Sends an operation only the server can apply, behind any pending
  // changes. Nothing changes on screen until the server has it. A form that
  // waits for it shows a refusal itself.
  const runOnServer = (
    operationId: string,
    send: Parameters<ServerRunner>[1],
    summary: string,
    inPlace = false,
  ) =>
    new Promise<void>((resolve, reject) => {
      const result = client.runOnServer(
        operationId,
        (baseRevision) =>
          serverOperation(() => send(baseRevision), renewSession),
        {
          summary,
          onSettled: (settled) =>
            settled.ok ? resolve() : reject(new Error(settled.message)),
        },
      );
      if (!result.ok) reject(new Error(result.message));
      else if (inPlace) shownInPlace.current.add(operationId);
    });
  const runInForm: ServerRunner = (operationId, send, summary) =>
    runOnServer(operationId, send, summary, true);

  const [openPopovers, setOpenPopovers] = useState(0);
  const holdOpen = useCallback(() => {
    setOpenPopovers((count) => count + 1);
    return () => setOpenPopovers((count) => count - 1);
  }, []);
  const banks = useBankConnections({
    state: { services, connections, view },
    notify,
    holdOpen,
    runOnServer: runInForm,
  });

  const moveMoney: MoveMoney = {
    move: (command, summary) => run(command, summary),
    holdOpen,
  };
  const categoryAdder: CategoryAdder = { add: run, holdOpen };
  const targetEditing: TargetEditing = { save: moveMoney.move, holdOpen };
  const assignMoney: AssignMoney = {
    assign: run,
    alert: (text) => notify(text, "attention"),
    holdOpen,
  };
  const count = (ids: string[]) =>
    `${ids.length} ${ids.length === 1 ? "transaction" : "transactions"}`;
  const reviewSelection = (
    transactionIds: string[],
    action: "approve" | "enter" | "reject",
  ) => {
    if (!transactionIds.length) return;
    const selectedImports = imports.filter((item) =>
      transactionIds.includes(importRowId(item)),
    );
    const recorded = view.budget.transactions.filter((item) =>
      transactionIds.includes(item.id),
    );
    if (
      selectedImports.length + recorded.length !== transactionIds.length ||
      [...selectedImports, ...recorded].some(
        (item) => !transactionActions(view, item)[action],
      )
    ) {
      notify(
        "This selection changed. Select the transactions again.",
        "attention",
      );
      return;
    }
    const recordedIds = recorded.map((item) => item.id);
    if (recordedIds.length) {
      if (action === "approve")
        run(
          approveCommand(recordedIds),
          `Marked ${count(recordedIds)} reviewed`,
        );
      else
        run(
          {
            type: "transaction.reject",
            id: newId(),
            transactionIds: recordedIds,
          },
          `Rejected ${count(recordedIds)}`,
        );
    }
    for (const item of selectedImports) {
      if (action === "reject") {
        const operationId = newId();
        const summary = `Rejected ${item.payee}`;
        void runOnServer(
          operationId,
          (expectedRevision) =>
            trpc.budget.resolveImport.mutate({
              connectionId: item.connectionId,
              logicalId: item.logicalId,
              expectedFingerprint: item.fingerprint,
              expectedRevision,
              operationId,
              ignore: true,
            }),
          summary,
          true,
        ).then(
          async () => {
            notify(summary, "neutral", operationId);
            await refreshResolvedImport(item);
          },
          (error: Error) =>
            notify(
              `Couldn’t reject ${item.payee}. ${error.message}`,
              "attention",
            ),
        );
        continue;
      }
      const command = importReviewCommand(view, item);
      const summary = `${action === "enter" ? "Entered" : "Approved"} ${item.payee}`;
      const result = previewImport(
        item,
        command,
        summary,
        (settled) => {
          if (settled.ok) notify(summary, "neutral", command.id);
        },
        action,
      );
      if (!result.ok) notify(result.message, "attention");
    }
  };
  const review: TransactionReview = {
    approve: (ids) => reviewSelection(ids, "approve"),
    enter: (ids) => reviewSelection(ids, "enter"),
    reject: (ids) => reviewSelection(ids, "reject"),
  };
  const refreshResolvedImport = async (item: BankImport) => {
    const rowId = importRowId(item);
    setResolved((ids) => new Set(ids).add(rowId));
    try {
      await utils.budget.overview.invalidate();
    } finally {
      setResolved((ids) => {
        const next = new Set(ids);
        next.delete(rowId);
        return next;
      });
    }
  };
  const saveImportedTransaction = async (
    item: (typeof imports)[number],
    command: Command,
    summary: string,
    inPlace = false,
  ) => {
    await runOnServer(
      command.id,
      (expectedRevision) =>
        trpc.budget.resolveImport.mutate({
          connectionId: item.connectionId,
          logicalId: item.logicalId,
          expectedFingerprint: item.fingerprint,
          expectedRevision,
          command,
        }),
      summary,
      inPlace,
    );
    await refreshResolvedImport(item);
  };
  const previewImport = (
    item: BankImport,
    command: Command,
    summary: string,
    onSettled: (result: Settled) => void,
    review?: "approve" | "enter",
  ): RunResult => {
    if (command.type !== "transaction.upsert")
      return { ok: false, message: "This bank operation cannot be previewed." };
    const result = client.run(command, {
      summary,
      send: (expectedRevision) =>
        serverOperation(
          () =>
            trpc.budget.resolveImport.mutate({
              connectionId: item.connectionId,
              logicalId: item.logicalId,
              expectedFingerprint: item.fingerprint,
              expectedRevision,
              command,
              review,
            }),
          renewSession,
        ),
      onSettled: (settled) => {
        onSettled(settled);
        if (settled.ok) void utils.budget.overview.invalidate();
      },
    });
    if (result.ok)
      setImportPreviews((current) =>
        new Map(current).set(importRowId(item), {
          fingerprint: item.fingerprint,
          transactionId: command.transactionId,
        }),
      );
    return result;
  };
  const transactionSaver: TransactionSaver = {
    view,
    imports,
    save: (command, summary, refused) =>
      run(command, summary, (saved) => {
        if (!saved) refused?.();
      }),
    saveImport: (item, command, summary, refused) => {
      if (command.type === "transaction.upsert")
        return message(
          previewImport(item, command, summary, (settled) => {
            if (settled.ok) notify(summary, "neutral", command.id);
            else refused?.();
          }),
        );
      saveImportedTransaction(item, command, summary).then(
        () => notify(summary),
        () => refused?.(),
      );
      return null;
    },
    saveSelection: (changes, action, refused) => {
      const queuedIds: string[] = [];
      const failures: { payee: string; message: string }[] = [];
      let remaining = changes.length;
      for (const { rowIds, imported, command, summary } of changes) {
        shownInPlace.current.add(command.id);
        const settled = (result: Settled) => {
          remaining--;
          if (!result.ok) {
            failures.push({
              payee:
                ("payee" in command ? command.payee : undefined) ??
                count(rowIds),
              message: result.message,
            });
            rowIds.forEach(refused);
            notify(
              `Couldn’t ${action} ${failures.map((item) => item.payee).join(", ")}. ${[...new Set(failures.map((item) => item.message))].join(" ")}`,
              "attention",
            );
          } else {
            shownInPlace.current.delete(command.id);
            if (remaining === 0 && !failures.length)
              notify(
                `${action === "share" ? "Shared" : "Categorized"} ${count(queuedIds)}`,
                "neutral",
                command.id,
              );
          }
        };
        const result = imported
          ? previewImport(imported, command, summary, settled)
          : client.run(command, { summary, onSettled: settled });
        if (!result.ok) {
          shownInPlace.current.delete(command.id);
          return { queuedIds, error: result.message };
        }
        queuedIds.push(...rowIds);
      }
      return { queuedIds };
    },
    holdOpen,
    alert: (message) => notify(message, "attention"),
  };

  // Undo and redo cover this browser load. Each is a change of its own,
  // confirmed like any other.
  const travel = (direction: "undo" | "redo") => {
    const result = client[direction]((settled) => {
      if (settled.ok)
        notify(direction === "undo" ? "Action undone." : "Action redone.");
    });
    if (result && !result.ok) notify(result.message, "attention");
  };
  useHistoryShortcuts({
    disabled: openPopovers > 0,
    available: { undo: snapshot.undo !== null, redo: snapshot.redo !== null },
    change: travel,
  });
  // A confirmation offers Undo while its change is still the latest one
  // this browser can undo.
  const offerUndo =
    notice?.operationId !== undefined &&
    snapshot.undo?.operationId === notice.operationId;

  return (
    <TransactionReviewProvider value={review}>
      <AssignMoneyProvider value={assignMoney}>
        <BankConnectionsProvider value={banks}>
          <AppShell
            data={data}
            onMonthChange={onMonthChange}
            moveMoney={moveMoney}
            categoryAdder={categoryAdder}
            transactionSaver={transactionSaver}
            targetEditing={targetEditing}
            reconciling={{ reconcile: moveMoney.move, holdOpen }}
            renameBudget={(name) =>
              run(
                { type: "settings.update", id: newId(), name },
                `Renamed your budget to ${name}`,
              )
            }
            joinBlocked={
              snapshot.pending.length
                ? "Wait for your changes to finish saving before connecting budgets."
                : undefined
            }
            updatePreferences={(change) =>
              run(
                { type: "settings.update", id: newId(), ...change },
                "Preferences saved",
              )
            }
            overlays={
              <>
                <BankDialog />
                <ToastRegion>
                  <SyncToasts client={client} snapshot={snapshot} />
                  {notice && (
                    <Toast
                      key={notice.id}
                      tone={notice.tone}
                      duration={offerUndo ? 8000 : undefined}
                      onDismiss={() => setNotice(null)}
                      action={
                        offerUndo && (
                          <Button size="sm" onClick={() => travel("undo")}>
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

// Problems that last as long as their cause, each with what the user can do.
function SyncToasts({
  client,
  snapshot,
}: {
  client: BudgetClient;
  snapshot: BudgetSnapshot;
}) {
  if (snapshot.signedOut)
    return (
      <Toast
        tone="attention"
        action={
          <Button size="sm" asChild>
            <a href={SIGN_IN_URL}>Sign in</a>
          </Button>
        }
      >
        You’ve been signed out. Sign in to keep saving your changes.
      </Toast>
    );
  if (snapshot.staleClient)
    return (
      <Toast
        tone="attention"
        action={
          <Button size="sm" onClick={() => window.location.reload()}>
            Reload
          </Button>
        }
      >
        Caishen has been updated. Reload to keep saving your changes.
      </Toast>
    );
  return (
    <>
      {snapshot.savingPaused && (
        <Toast
          tone="attention"
          action={
            <Button size="sm" onClick={client.retrySaving}>
              Try again
            </Button>
          }
        >
          Saving paused. Your changes are kept here and will save when Caishen
          reconnects.
        </Toast>
      )}
      {snapshot.refreshFailed && (
        <Toast
          tone="attention"
          action={
            <Button size="sm" onClick={() => void client.refresh()}>
              Try again
            </Button>
          }
        >
          Your budget couldn’t refresh. What you see may be out of date.
        </Toast>
      )}
    </>
  );
}

function message(result: RunResult): string | null {
  return result.ok ? null : result.message;
}

const SIGN_IN_URL = `/sign-in?redirect_url=${SHELL_PATH}`;

function SignIn() {
  return (
    <Status icon={<LogInIcon size={18} />}>
      <strong>Sign in to see your budget here.</strong>
      <a href={SIGN_IN_URL}>Sign in</a>
    </Status>
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
