import type { Command } from "~/domain/engine";
import { BudgetStore, type RunOptions, type RunResult } from "./budget-store";
import { Outbox } from "./outbox";
import { openPersistence } from "./indexed-db";
import { MemoryPersistence, type Persistence } from "./persistence";
import { RevisionSignal, watchFocusAndOnline } from "./revision-signal";
import { SyncController } from "./sync-controller";
import { connectTabs, tabChannelName } from "./tabs";
import type { ExecuteResult, SyncTransport } from "./transport";

// One tab's budget sync: the store, the outbox that sends its commands, the
// controller that pulls rows, and the storage that keeps confirmed rows.

export type BudgetClientOptions = {
  userId: string;
  transport: SyncTransport;
  /** The running app's build, which the server checks on every pull. */
  clientBuild: string;
  persistence?: Persistence | Promise<Persistence>;
  signal?: RevisionSignal;
  clientId?: string;
  now?: () => Date;
  newId?: () => string;
};

export type BudgetClient = {
  readonly store: BudgetStore;
  readonly signal: RevisionSignal;
  /** Resolves once stored rows are shown and the first pull has finished. */
  readonly ready: Promise<void>;
  run: (command: Command, options: RunOptions) => RunResult;
  runChange: BudgetStore["runChange"];
  runOnServer: (
    operationId: string,
    send: (baseRevision: number) => Promise<ExecuteResult>,
    options: RunOptions,
  ) => RunResult;
  undo: (onSettled?: RunOptions["onSettled"]) => RunResult | null;
  redo: (onSettled?: RunOptions["onSettled"]) => RunResult | null;
  /** Try again after a failed refresh. */
  refresh: () => Promise<void>;
  /** Try again after failed saves. */
  retrySaving: () => void;
  /** Resolves when nothing is being sent, pulled, or stored. */
  idle: () => Promise<void>;
  dispose: () => void;
};

export function createBudgetClient(options: BudgetClientOptions): BudgetClient {
  const store = new BudgetStore(options);
  const signal = options.signal ?? new RevisionSignal();
  const persistence = Promise.resolve(
    options.persistence ?? new MemoryPersistence(),
  );
  const clientId = options.clientId ?? crypto.randomUUID();
  const controller: SyncController = new SyncController(
    store,
    options.transport,
    {
      clientBuild: options.clientBuild,
      commandSettled: () => sender.settled(),
    },
  );
  const sender = new Outbox(store, options.transport, {
    clientId,
    pull: (revision) => controller.request(revision),
  });

  // Storage changes one at a time, in the order the store made them.
  let writes = Promise.resolve();
  const queueStorage = (change: (storage: Persistence) => Promise<void>) => {
    writes = writes
      .then(async () => change(await persistence))
      .catch((error: unknown) => {
        // Storage only saves a download; the rows stay correct in memory.
        console.error("Couldn't store budget rows", error);
      });
  };
  const unsubscribeCommits = store.onCommit((commit) => {
    if (commit.source !== "storage")
      queueStorage((storage) => storage.write(commit));
  });
  // A budget the server no longer has must not show again from storage.
  const unsubscribeNoBudget = store.onNoBudget(() =>
    queueStorage((storage) => storage.clear()),
  );
  const unsubscribeHints = signal.subscribe((hint) => {
    controller.hint(hint);
    // The server answered something, so a waiting send can go now.
    if (store.getSnapshot().savingPaused) sender.retryNow();
  });

  const ready = (async () => {
    const stored = await persistence
      .then((storage) => storage.load())
      .catch(() => null);
    if (stored) store.hydrate(stored.revision, stored.rows);
    await controller.request();
    void sender.flush();
  })();

  const started = (result: RunResult) => {
    if (result.ok) void sender.flush();
    return result;
  };

  return {
    store,
    signal,
    ready,
    run: (command, runOptions) => started(store.run(command, runOptions)),
    runChange: (change, runOptions) =>
      started(store.runChange(change, runOptions)),
    runOnServer: (operationId, send, runOptions) =>
      started(store.runOnServer(operationId, send, runOptions)),
    undo: (onSettled) => {
      const result = store.undo(onSettled);
      return result && started(result);
    },
    redo: (onSettled) => {
      const result = store.redo(onSettled);
      return result && started(result);
    },
    refresh: () => controller.retryNow(),
    retrySaving: () => sender.retryNow(),
    idle: async () => {
      await ready;
      let before: unknown;
      do {
        before = writes;
        await sender.flush();
        await controller.settled();
        await writes;
      } while (before !== writes);
    },
    dispose: () => {
      unsubscribeCommits();
      unsubscribeNoBudget();
      unsubscribeHints();
      sender.stop();
      controller.stop();
      void persistence.then((storage) => storage.close());
    },
  };
}

/**
 * The client the app uses: rows kept in IndexedDB between visits, other
 * tabs of the same user told what the server confirmed, and a pull
 * whenever the page regains focus or the network.
 */
export function openBudgetClient(
  options: Omit<BudgetClientOptions, "persistence" | "signal">,
): BudgetClient {
  const signal = new RevisionSignal();
  const client = createBudgetClient({
    ...options,
    signal,
    persistence: openPersistence(options.userId, options.clientBuild),
  });
  const disconnect = [
    watchFocusAndOnline(signal),
    typeof BroadcastChannel === "undefined"
      ? () => undefined
      : connectTabs(
          client.store,
          signal,
          new BroadcastChannel(tabChannelName(options.userId)),
        ),
  ];
  return {
    ...client,
    dispose: () => {
      for (const stop of disconnect) stop();
      client.dispose();
    },
  };
}
