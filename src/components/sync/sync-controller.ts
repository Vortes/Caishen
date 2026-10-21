import type { WireRow } from "~/domain/rows";
import type { BudgetStore } from "./budget-store";
import { ATTENTION_AFTER_FAILURES, retryDelay } from "./outbox";
import type { RevisionHint } from "./revision-signal";
import { SyncError, type PullResult, type SyncTransport } from "./transport";

// Brings the store up to the server's revision with sync.pull. Only one
// pull runs at a time; requests made meanwhile share one follow-up pull.
// A failed pull is retried with backoff until one succeeds.

export type SyncControllerOptions = {
  clientBuild: string;
  /** Resolves once the command in flight has been answered. */
  commandSettled?: () => Promise<void>;
};

export class SyncController {
  private running: Promise<void> | null = null;
  private again = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private hints: RevisionHint[] = [];
  private hintsScheduled = false;
  private stopped = false;

  constructor(
    private readonly store: BudgetStore,
    private readonly transport: SyncTransport,
    private readonly options: SyncControllerOptions,
  ) {}

  /**
   * Pulls unless the store already holds `revision`. Resolves when the store
   * holds at least what the server had when the request was made, or the
   * pull failed (and a retry is scheduled).
   */
  request(revision?: number): Promise<void> {
    const held = this.store.confirmedRevision;
    if (revision !== undefined && held !== null && revision <= held)
      return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.pullOnce();
        } while (this.again && !this.stopped);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /**
   * Takes a hint from any source. Hints are read after the command in
   * flight is answered, so a revision the command itself produced (seen
   * first on its response header) does not cause a pull.
   */
  hint(hint: RevisionHint) {
    this.hints.push(hint);
    if (this.hintsScheduled) return;
    this.hintsScheduled = true;
    setTimeout(() => {
      void (this.options.commandSettled?.() ?? Promise.resolve()).then(() => {
        this.hintsScheduled = false;
        const hints = this.hints.splice(0);
        let pull = false;
        let target = -1;
        for (const item of hints) {
          if (item.changeSet && this.store.applyFromTab(item.changeSet))
            continue;
          const revision = item.changeSet?.revision ?? item.revision;
          if (revision === undefined) pull = true;
          else target = Math.max(target, revision);
        }
        const held = this.store.confirmedRevision ?? -1;
        if (pull || target > held) void this.request();
      });
    }, 0);
  }

  /** Resolves when no hint is waiting and no pull is running. */
  async settled(): Promise<void> {
    while (this.hintsScheduled || this.running) {
      await this.running;
      if (this.hintsScheduled)
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  /** Try again: pulls now instead of waiting for the next retry. */
  retryNow() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    return this.request();
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  private async pullOnce() {
    if (this.stopped) return;
    this.store.setSync({ updating: true });
    try {
      this.store.applyPull(await this.download());
      this.failures = 0;
      this.store.setSync({ updating: false, refreshFailed: false });
    } catch (error) {
      this.store.setSync({ updating: false });
      if (error instanceof SyncError && error.kind === "staleClient") {
        this.store.setSync({ staleClient: true });
        this.stop();
        return;
      }
      this.failures++;
      if (this.failures >= ATTENTION_AFTER_FAILURES)
        this.store.setSync({ refreshFailed: true });
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.request();
      }, retryDelay(this.failures));
    }
  }

  // Every page of one pull, which the server reads at one revision.
  private async download(): Promise<Omit<PullResult, "nextCursor">> {
    const since = this.store.confirmedRevision;
    const rows: WireRow[] = [];
    const confirmed: string[] = [];
    let cursor: string | undefined;
    let first: PullResult | undefined;
    do {
      const page = await this.transport.pull({
        since,
        cursor,
        clientBuild: this.options.clientBuild,
      });
      if (first && page.revision !== first.revision)
        throw new Error("Pull pages came from different revisions");
      first ??= page;
      rows.push(...page.rows);
      confirmed.push(...page.confirmedOperationIds);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return {
      revision: first.revision,
      rows,
      reset: first.reset,
      confirmedOperationIds: confirmed,
    };
  }
}
