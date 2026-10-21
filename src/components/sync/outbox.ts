import type { BudgetStore, PendingOperation } from "./budget-store";
import { SyncError, type ExecuteResult, type SyncTransport } from "./transport";

// Sends the store's pending operations to the server one at a time, in
// order. An answer the browser never received is retried with the same
// operation id, which the server recognizes, so nothing applies twice.

/** Failed sends in a row before the interface says saving is paused. */
export const ATTENTION_AFTER_FAILURES = 3;

/** Wait before retry number `failures`: 1s, 2s, 4s, ... up to 30s. */
export function retryDelay(failures: number): number {
  return Math.min(30_000, 1000 * 2 ** (failures - 1));
}

export type OutboxOptions = {
  clientId: string;
  /** Brings in rows up to at least `revision`. */
  pull: (revision: number) => Promise<void>;
};

export class Outbox {
  private running: Promise<void> | null = null;
  private current: Promise<unknown> | null = null;
  private wake: (() => void) | null = null;
  private stopped = false;

  constructor(
    private readonly store: BudgetStore,
    private readonly transport: SyncTransport,
    private readonly options: OutboxOptions,
  ) {}

  /** Starts sending, if it is not already. Resolves when the queue is empty or sending stops. */
  flush(): Promise<void> {
    return (this.running ??= this.loop().finally(() => {
      this.running = null;
    }));
  }

  /** Retries a waiting send now (Try again, coming back online). */
  retryNow() {
    this.wake?.();
    void this.flush();
  }

  /** Resolves once the request in flight, if any, has been answered. */
  async settled(): Promise<void> {
    await this.current?.catch(() => undefined);
  }

  stop() {
    this.stopped = true;
    this.wake?.();
  }

  private async loop() {
    while (!this.stopped) {
      const op = this.store.nextToSend();
      const base = this.store.confirmedRevision;
      if (!op || base === null) return;
      const request = this.send(op, base);
      this.current = request;
      let result: ExecuteResult;
      try {
        result = await request;
      } catch (error) {
        this.current = null;
        await this.failed(op.operationId, error);
        continue;
      }
      this.current = null;
      this.store.setSync({ savingPaused: false });
      // Sending the next command waits for the rows, so it is checked
      // against the latest revision.
      if (this.store.confirm(op.operationId, result) === "pull")
        await this.options.pull(result.revision);
    }
  }

  private async send(
    op: PendingOperation,
    baseRevision: number,
  ): Promise<ExecuteResult> {
    return op.command
      ? this.transport.execute({
          command: op.command,
          baseRevision,
          clientId: this.options.clientId,
        })
      : op.send!(baseRevision);
  }

  private async failed(operationId: string, error: unknown) {
    if (!(error instanceof SyncError)) {
      // The command may or may not have been applied; the retry carries
      // the same operation id, so the server applies it at most once.
      const failures = this.store.recordFailure(operationId);
      if (failures >= ATTENTION_AFTER_FAILURES)
        this.store.setSync({ savingPaused: true });
      await this.sleep(retryDelay(failures));
      return;
    }
    this.store.setSync({ savingPaused: false });
    if (error.kind === "staleClient") {
      this.store.setSync({ staleClient: true });
      this.stop();
      return;
    }
    this.store.refuse(operationId, error.kind, error.message);
    // The refusal may come from changes this browser hasn't seen.
    if (error.revision !== undefined) await this.options.pull(error.revision);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wake = done;
    });
  }
}
