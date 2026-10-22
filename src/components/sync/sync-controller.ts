import type { WireRow } from "~/domain/rows";
import type { BudgetStore } from "./budget-store";
import { ATTENTION_AFTER_FAILURES, retryDelay } from "./outbox";
import type { RevisionHint } from "./revision-signal";
import { SyncError, type PullResult, type SyncTransport } from "./transport";

// Brings the store up to the server's revision with sync.pull. Only one
// pull runs at a time; requests made meanwhile share one follow-up pull.
// A failed pull is retried with backoff until one succeeds. A user without
// a budget isn't pulled for again until a hint (focus, another tab, an
// answer from the server) suggests one may exist.

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
    if (
      this.store.halted ||
      (revision !== undefined && held !== null && revision <= held)
    )
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
        } while (this.again && !this.stopped && !this.store.halted);
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
    if (this.stopped || this.store.halted) return;
    try {
      this.store.applyPull(await this.download());
      this.failures = 0;
      this.store.setSync({ refreshFailed: false });
    } catch (error) {
      if (error instanceof SyncError) {
        if (error.kind === "staleClient" || error.kind === "signedOut") {
          this.store.setSync({ [error.kind]: true, refreshFailed: false });
          return;
        }
        if (error.kind === "noBudget") {
          this.failures = 0;
          this.store.setSync({ refreshFailed: false });
          this.store.markNoBudget();
          return;
        }
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

  /**
   * What changed since the revision the store holds, taken in whole. A pull
   * of one page is one consistent read. Later pages leave out rows changed
   * after the first page's revision, so what several pages bring can hold
   * a row without its parent; the changes since that revision are pulled
   * too, until they come in one page, before any of it is shown.
   */
  private async download(): Promise<Omit<PullResult, "nextCursor">> {
    let { pages, ...result } = await this.pages(this.store.confirmedRevision);
    while (pages > 1) {
      const next = await this.pages(result.revision);
      pages = next.pages;
      result = {
        revision: next.revision,
        rows: next.reset ? next.rows : [...result.rows, ...next.rows],
        reset: result.reset || next.reset,
        confirmedOperationIds: [
          ...result.confirmedOperationIds,
          ...next.confirmedOperationIds,
        ],
      };
    }
    return result;
  }

  // Every page of one pull, which the server reads at one revision.
  private async pages(
    since: number | null,
  ): Promise<Omit<PullResult, "nextCursor"> & { pages: number }> {
    const rows: WireRow[] = [];
    const confirmed: string[] = [];
    let cursor: string | undefined;
    let first: PullResult | undefined;
    let pages = 0;
    do {
      const page = await this.transport.pull({
        since,
        cursor,
        clientBuild: this.options.clientBuild,
      });
      if (first && page.revision !== first.revision)
        throw new Error("Pull pages came from different revisions");
      first ??= page;
      pages++;
      rows.push(...page.rows);
      confirmed.push(...page.confirmedOperationIds);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return {
      revision: first.revision,
      rows,
      reset: first.reset,
      confirmedOperationIds: confirmed,
      pages,
    };
  }
}
