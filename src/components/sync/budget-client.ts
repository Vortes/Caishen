import type { Command } from "~/domain/engine";
import { BudgetStore, type RunOptions, type RunResult } from "./budget-store";
import { Outbox } from "./outbox";
import { MemoryPersistence, type Persistence } from "./persistence";
import { RevisionSignal } from "./revision-signal";
import { SyncController } from "./sync-controller";
import type { ExecuteResult, SyncTransport } from "./transport";

// One tab's budget sync: the store, the outbox that sends its commands, the
// controller that pulls rows, and the storage that keeps confirmed rows.

export type BudgetClientOptions = {
  userId: string;
  transport: SyncTransport;
  /** The running app's build, which the server checks on every pull. */
  clientBuild: string;
  persistence?: Persistence;
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
  const persistence = options.persistence ?? new MemoryPersistence();
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

  let writes = Promise.resolve();
  const unsubscribeCommits = store.onCommit((commit) => {
    if (commit.source === "storage") return;
    writes = writes
      .then(() => persistence.write(commit))
      .catch((error: unknown) => {
        // Storage only saves a download; the rows stay correct in memory.
        console.error("Couldn't store budget rows", error);
      });
  });
  const unsubscribeHints = signal.subscribe((hint) => {
    controller.hint(hint);
    // The server answered something, so a waiting send can go now.
    if (store.getSnapshot().savingPaused) sender.retryNow();
  });

  const ready = (async () => {
    const stored = await persistence.load().catch(() => null);
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
      unsubscribeHints();
      sender.stop();
      controller.stop();
      persistence.close();
    },
  };
}
