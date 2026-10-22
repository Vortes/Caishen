import {
  applyChangeSet,
  executeRevert,
  getRow,
  revertConflicts,
  rowsIn,
  toRowSet,
} from "~/domain/change-sets";
import {
  AccountingError,
  executeWithChanges,
  projectBook,
  type BudgetProjection,
  type Command,
  type LedgerCommand,
  type RevertCommand,
} from "~/domain/engine";
import {
  rowKey,
  rowsToPersonalLedger,
  sameJson,
  type ChangeSet,
  type RowSet,
  type WireRow,
} from "~/domain/rows";
import type { PersonalLedger } from "~/domain/shared-ledger";
import { budgetDay, prepareUserCommand } from "~/domain/user-command";
import type { ExecuteResult, PullResult, SyncErrorKind } from "./transport";

// One tab's copy of the signed-in partner's budget (ADR 0006). The confirmed
// rows come only from the server; commands the server has not confirmed yet
// wait in an ordered queue and are replayed through the same engine on top
// of them, so the browser shows every change at once and the server stays
// the authority. The Outbox sends the queue and the SyncController brings
// in rows; this class only holds state and publishes it.

export type Settled =
  | { ok: true; revision: number }
  | { ok: false; kind: SyncErrorKind | "local"; message: string };

export type RunOptions = {
  /** What the change did, for toasts and the undo history. */
  summary: string;
  /** Called once, when the server confirms or refuses the command. */
  onSettled?: (result: Settled) => void;
};

export type RunResult =
  { ok: true; operationId: string } | { ok: false; message: string };

/** A command not confirmed yet, as the interface shows it. */
export type PendingView = {
  operationId: string;
  summary: string;
  /** The change shows on screen; false while only the server can apply it. */
  previewed: boolean;
};

export type HistoryView = { operationId: string; label: string };

export type SyncState = {
  /** A pull is bringing in rows. */
  updating: boolean;
  /** Pulls keep failing; the numbers may be out of date. */
  refreshFailed: boolean;
  /** Sending keeps failing; commands wait and are retried. */
  savingPaused: boolean;
  /** The server needs a newer version of the app. */
  staleClient: boolean;
  /** The user is signed out or may no longer use Caishen. */
  signedOut: boolean;
};

export type BudgetSnapshot = SyncState & {
  /** loading until rows arrive; empty when the user has no budget. */
  status: "loading" | "ready" | "empty";
  /** The confirmed revision. */
  revision: number | null;
  /** The budget as shown: confirmed rows plus the pending commands. */
  ledger: PersonalLedger | null;
  pending: readonly PendingView[];
  undo: HistoryView | null;
  redo: HistoryView | null;
};

export type Notice =
  | {
      kind: "refused";
      operationId: string;
      summary: string;
      reason: SyncErrorKind | "local";
      message: string;
    }
  /** An undo or redo entry can no longer apply and was removed. */
  | { kind: "historyExpired"; operationId: string };

/** Confirmed rows the store took in, for storage and other tabs. */
export type Commit = {
  /** The revision the change applies on top of; null replaces everything. */
  since: number | null;
  revision: number;
  /** The rows that changed, or every row when `since` is null. */
  rows: WireRow[];
  /** Every confirmed row after the change. */
  snapshot: RowSet;
  /** The server's change set, when the commit is exactly one operation. */
  changeSet?: ChangeSet;
  source: "server" | "tab" | "storage";
};

type Step = { ledger: PersonalLedger; rows: RowSet; changeSet: ChangeSet };

export type PendingOperation = {
  readonly operationId: string;
  readonly summary: string;
  /** The command, or null for an operation only the server can apply. */
  readonly command: LedgerCommand | null;
  readonly send: ((baseRevision: number) => Promise<ExecuteResult>) | null;
  /** For a revert: the change set it restores in this browser. */
  readonly revertTarget?: ChangeSet;
  readonly onSettled?: (result: Settled) => void;
  settled: boolean;
  /** The server applied it at this revision; its rows have not arrived. */
  confirmedAt: number | null;
  /** Failed sends since the last answer from the server. */
  failures: number;
};

type HistoryEntry = {
  operationId: string;
  label: string;
  changeSet: ChangeSet;
};

export type BudgetStoreOptions = {
  userId: string;
  now?: () => Date;
  newId?: () => string;
};

const noRows: RowSet = new Map();

export class BudgetStore {
  readonly userId: string;
  private readonly now: () => Date;
  private readonly newId: () => string;

  private revision: number | null = null;
  private confirmedRows: RowSet = noRows;
  private confirmedLedger: PersonalLedger | null = null;
  private pending: PendingOperation[] = [];
  private optimisticLedger: PersonalLedger | null = null;
  private optimisticRows: RowSet = noRows;
  private steps = new Map<string, Step>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private sync: SyncState = {
    updating: false,
    refreshFailed: false,
    savingPaused: false,
    staleClient: false,
    signedOut: false,
  };
  // The server said the user has no budget.
  private noBudget = false;

  private snapshot: BudgetSnapshot;
  private dirty = false;
  private readonly listeners = new Set<() => void>();
  private readonly noticeListeners = new Set<(notice: Notice) => void>();
  private readonly commitListeners = new Set<(commit: Commit) => void>();
  private readonly projections = new WeakMap<
    PersonalLedger,
    Map<string, BudgetProjection>
  >();

  constructor(options: BudgetStoreOptions) {
    this.userId = options.userId;
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.snapshot = this.buildSnapshot();
  }

  // Reading -----------------------------------------------------------------

  /** For useSyncExternalStore: listeners run once per microtask at most. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): BudgetSnapshot => this.snapshot;

  onNotice(listener: (notice: Notice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  onCommit(listener: (commit: Commit) => void): () => void {
    this.commitListeners.add(listener);
    return () => this.commitListeners.delete(listener);
  }

  get confirmedRevision(): number | null {
    return this.revision;
  }

  /** Syncing has stopped until the page reloads or the user signs in. */
  get halted(): boolean {
    return this.sync.staleClient || this.sync.signedOut;
  }

  /** The month as shown, computed once per ledger, month, and current month. */
  month(month: string): BudgetProjection | null {
    const ledger = this.snapshot.ledger;
    if (!ledger) return null;
    const current = budgetDay(
      ledger.budget.settings.timezone,
      this.now(),
    ).slice(0, 7);
    let months = this.projections.get(ledger);
    if (!months)
      this.projections.set(
        ledger,
        (months = new Map<string, BudgetProjection>()),
      );
    const key = `${month} ${current}`;
    let projection = months.get(key);
    if (!projection) {
      projection = projectBook(ledger, this.userId, month, current);
      months.set(key, projection);
    }
    return projection;
  }

  // Commands ----------------------------------------------------------------

  /**
   * Shows a command at once and queues it for the server. A command the
   * engine refuses here is refused inline and never sent.
   */
  run(input: Command, options: RunOptions): RunResult {
    const ledger = this.optimisticLedger;
    if (!ledger) return { ok: false, message: "The budget is still loading" };
    let command: Command;
    let step: Step;
    try {
      command = prepareUserCommand(ledger.budget, input, this.now());
      step = this.apply(ledger, this.optimisticRows, command);
    } catch (error) {
      if (error instanceof AccountingError)
        return { ok: false, message: error.message };
      throw error;
    }
    if (this.pending.some((op) => op.operationId === command.id))
      return { ok: false, message: "This change was already sent" };
    this.push(
      { command, summary: options.summary, onSettled: options.onSettled },
      step,
    );
    this.undoStack.push({
      operationId: command.id,
      label: options.summary,
      changeSet: step.changeSet,
    });
    this.redoStack = [];
    this.changed();
    return { ok: true, operationId: command.id };
  }

  /**
   * Queues an operation only the server can apply (bank imports, joining,
   * onboarding). Nothing changes on screen until its rows arrive.
   */
  runOnServer(
    operationId: string,
    send: (baseRevision: number) => Promise<ExecuteResult>,
    options: RunOptions,
  ): RunResult {
    if (this.revision === null)
      return { ok: false, message: "The budget is still loading" };
    this.push({
      command: null,
      send,
      operationId,
      summary: options.summary,
      onSettled: options.onSettled,
    });
    this.changed();
    return { ok: true, operationId };
  }

  /** Null when there is nothing to undo. */
  undo(onSettled?: RunOptions["onSettled"]): RunResult | null {
    return this.travel(this.undoStack, this.redoStack, onSettled);
  }

  /** Null when there is nothing to redo. */
  redo(onSettled?: RunOptions["onSettled"]): RunResult | null {
    return this.travel(this.redoStack, this.undoStack, onSettled);
  }

  // Undo is a revert of the latest entry and redo the revert of that revert.
  // Either queues behind a target the server has not confirmed yet.
  private travel(
    from: HistoryEntry[],
    to: HistoryEntry[],
    onSettled: RunOptions["onSettled"],
  ): RunResult | null {
    const entry = from.at(-1);
    if (!entry || !this.optimisticLedger) return null;
    const target =
      this.steps.get(entry.operationId)?.changeSet ?? entry.changeSet;
    const command: RevertCommand = {
      type: "revert",
      id: this.newId(),
      targetOperationId: entry.operationId,
    };
    let step: Step;
    try {
      step = this.revertStep(this.optimisticRows, command, target);
    } catch (error) {
      if (!(error instanceof AccountingError)) throw error;
      from.pop();
      this.changed();
      return { ok: false, message: error.message };
    }
    from.pop();
    this.push(
      { command, summary: entry.label, revertTarget: target, onSettled },
      step,
    );
    to.push({
      operationId: command.id,
      label: entry.label,
      changeSet: step.changeSet,
    });
    this.changed();
    return { ok: true, operationId: command.id };
  }

  private push(
    op: Pick<PendingOperation, "summary" | "onSettled" | "revertTarget"> &
      (
        | { command: LedgerCommand & { id: string }; send?: undefined }
        | {
            command: null;
            operationId: string;
            send: PendingOperation["send"];
          }
      ),
    step?: Step,
  ) {
    const operationId = op.command ? op.command.id : op.operationId;
    this.pending.push({
      operationId,
      summary: op.summary,
      command: op.command,
      send: op.send ?? null,
      revertTarget: op.revertTarget,
      onSettled: op.onSettled,
      settled: false,
      confirmedAt: null,
      failures: 0,
    });
    if (step) {
      this.steps.set(operationId, step);
      this.optimisticLedger = step.ledger;
      this.optimisticRows = step.rows;
    }
  }

  // Engine ------------------------------------------------------------------

  private apply(
    ledger: PersonalLedger,
    rows: RowSet,
    command: LedgerCommand,
    revertTarget?: ChangeSet,
  ): Step {
    if (command.type === "revert") {
      if (!revertTarget) throw new AccountingError("Undo access denied");
      return this.revertStep(rows, command, revertTarget);
    }
    const result = executeWithChanges(ledger, this.userId, command);
    // Operations are recorded on the server; a ledger built from rows has
    // no audit, so neither does one the browser computed.
    result.book.audit = [];
    return {
      ledger: result.book,
      rows: applyChangeSet(rows, result.changeSet),
      changeSet: result.changeSet,
    };
  }

  private revertStep(
    rows: RowSet,
    command: RevertCommand,
    target: ChangeSet,
  ): Step {
    const result = executeRevert(rows, command, target, this.userId);
    return {
      ledger: result.book as PersonalLedger,
      rows: result.rows,
      changeSet: result.changeSet,
    };
  }

  /**
   * Rebuilds what is shown: the confirmed ledger with every pending command
   * applied in order. A command that no longer applies here is still sent;
   * only its preview is skipped.
   */
  private replay() {
    let ledger = this.confirmedLedger;
    let rows = this.confirmedRows;
    this.steps = new Map();
    if (ledger)
      for (const op of this.pending) {
        if (!op.command) continue;
        try {
          const step = this.apply(ledger, rows, op.command, op.revertTarget);
          this.steps.set(op.operationId, step);
          ledger = step.ledger;
          rows = step.rows;
        } catch {
          // The server decides; its answer settles the command.
        }
      }
    this.optimisticLedger = ledger;
    this.optimisticRows = rows;
  }

  /**
   * After the server confirmed the first pending command exactly as
   * previewed, the rest of the queue was already computed on top of the
   * confirmed ledger. Only the revisions on their rows change.
   */
  private keepSteps() {
    let ledger = this.confirmedLedger;
    let rows = this.confirmedRows;
    const steps = new Map<string, Step>();
    for (const op of this.pending) {
      const step = this.steps.get(op.operationId);
      if (!step) continue;
      rows = applyChangeSet(rows, step.changeSet);
      ledger = step.ledger;
      steps.set(op.operationId, { ...step, rows });
    }
    this.steps = steps;
    this.optimisticLedger = ledger;
    this.optimisticRows = rows;
  }

  // From the server ---------------------------------------------------------

  /** Rows read from this browser's storage, shown until a pull confirms them. */
  hydrate(revision: number, rows: Iterable<WireRow>) {
    if (this.revision !== null) return;
    const set = toRowSet(rows);
    this.advance(set, revision, {
      commit: {
        since: null,
        revision,
        rows: [],
        snapshot: set,
        source: "storage",
      },
    });
  }

  /** The next operation to send, oldest first. */
  nextToSend(): PendingOperation | undefined {
    return this.pending.find((op) => op.confirmedAt === null);
  }

  /**
   * Takes in the server's answer to an operation. Returns "pull" when the
   * server is ahead of the revision the change set applies to.
   */
  confirm(operationId: string, result: ExecuteResult): "done" | "pull" {
    const op = this.pending.find((item) => item.operationId === operationId);
    if (!op || this.revision === null) return "done";
    this.recordAnswer(op);
    if (result.changeSet) this.replaceHistory(operationId, result.changeSet);
    this.settle(op, { ok: true, revision: result.revision });
    const base = this.revision;
    if (result.revision <= base) {
      this.remove(op);
      this.replay();
      this.changed();
      return "done";
    }
    if (!result.changeSet || result.revision !== base + 1) {
      op.confirmedAt = result.revision;
      this.changed();
      return "pull";
    }
    // Usually the server wrote exactly what this browser previewed, and the
    // ledger it computed is the confirmed one.
    const step = this.steps.get(operationId);
    const reuse =
      this.pending[0] === op &&
      step &&
      sameChanges(step.changeSet, result.changeSet);
    this.remove(op);
    this.advance(
      applyChangeSet(this.confirmedRows, result.changeSet),
      base + 1,
      {
        ledger: reuse ? step.ledger : undefined,
        commit: {
          since: base,
          revision: base + 1,
          rows: result.changeSet.after,
          snapshot: noRows,
          changeSet: result.changeSet,
          source: "server",
        },
      },
    );
    return "done";
  }

  /** The server refused the operation: its preview and history go. */
  refuse(operationId: string, kind: SyncErrorKind, message: string) {
    const op = this.pending.find((item) => item.operationId === operationId);
    if (!op) return;
    const refused = new Set([operationId]);
    // Undoing or redoing a refused operation can't succeed either.
    for (const other of this.pending)
      if (
        other.command?.type === "revert" &&
        refused.has(other.command.targetOperationId)
      )
        refused.add(other.operationId);
    for (const item of this.pending.filter((p) => refused.has(p.operationId))) {
      this.remove(item);
      this.settle(item, { ok: false, kind, message });
      this.notify({
        kind: "refused",
        operationId: item.operationId,
        summary: item.summary,
        reason: kind,
        message,
      });
    }
    this.undoStack = this.undoStack.filter((e) => !refused.has(e.operationId));
    this.redoStack = this.redoStack.filter((e) => !refused.has(e.operationId));
    this.replay();
    this.changed();
  }

  /** A failed send; returns how many have failed in a row. */
  recordFailure(operationId: string): number {
    const op = this.pending.find((item) => item.operationId === operationId);
    if (!op) return 0;
    op.failures++;
    return op.failures;
  }

  private recordAnswer(op: PendingOperation) {
    op.failures = 0;
  }

  /** Rows from a pull, taken in whole: one change, one publish. */
  applyPull(result: Omit<PullResult, "nextCursor" | "cursor">) {
    const base = this.revision;
    const confirmed = new Set(result.confirmedOperationIds);
    for (const op of this.pending)
      if (confirmed.has(op.operationId)) {
        op.confirmedAt = Math.min(op.confirmedAt ?? Infinity, result.revision);
        this.settle(op, { ok: true, revision: result.revision });
      }
    if (base !== null && !result.reset && result.revision <= base) {
      // Nothing newer than what this tab holds; only confirmations.
      this.dropConfirmed();
      this.replay();
      this.changed();
      return;
    }
    const replace = result.reset || base === null;
    const rows = replace
      ? toRowSet(result.rows)
      : applyChangeSet(this.confirmedRows, {
          operationId: "",
          revision: result.revision,
          after: result.rows,
          before: [],
        });
    this.advance(rows, result.revision, {
      commit: {
        since: replace ? null : base,
        revision: result.revision,
        rows: result.rows,
        snapshot: noRows,
        source: "server",
      },
    });
  }

  /**
   * The server holds no budget for this user. Nothing is shown or sent
   * until a pull brings one.
   */
  markNoBudget() {
    this.noBudget = true;
    if (this.revision !== null) {
      this.revision = null;
      this.confirmedRows = noRows;
      this.confirmedLedger = null;
      this.replay();
    }
    this.changed();
  }

  /**
   * A change set another tab confirmed. Returns false when it does not
   * follow the revision held here, so the caller pulls instead.
   */
  applyFromTab(changeSet: ChangeSet): boolean {
    if (this.revision === null) return false;
    if (changeSet.revision <= this.revision) return true;
    if (changeSet.revision !== this.revision + 1) return false;
    this.advance(
      applyChangeSet(this.confirmedRows, changeSet),
      changeSet.revision,
      {
        commit: {
          since: this.revision,
          revision: changeSet.revision,
          rows: changeSet.after,
          snapshot: noRows,
          changeSet,
          source: "tab",
        },
      },
    );
    return true;
  }

  setSync(state: Partial<SyncState>) {
    const next = { ...this.sync, ...state };
    if (
      Object.keys(next).every(
        (key) =>
          next[key as keyof SyncState] === this.sync[key as keyof SyncState],
      )
    )
      return;
    this.sync = next;
    this.changed();
  }

  private advance(
    rows: RowSet,
    revision: number,
    { ledger, commit }: { ledger?: PersonalLedger; commit: Commit },
  ) {
    this.confirmedRows = rows;
    this.revision = revision;
    this.noBudget = false;
    this.confirmedLedger = ledger ?? this.buildLedger(rows);
    const dropped = this.dropConfirmed();
    this.expireHistory();
    if (ledger && !dropped) this.keepSteps();
    else this.replay();
    const event = { ...commit, snapshot: rows };
    for (const listener of this.commitListeners) listener(event);
    this.changed();
  }

  private buildLedger(rows: RowSet): PersonalLedger | null {
    const settings = getRow(rows, "budgetSettings", rowKey(this.userId));
    return settings && !settings.deleted
      ? rowsToPersonalLedger(rowsIn(rows), this.userId)
      : null;
  }

  /** Removes operations whose rows have arrived; returns whether any did. */
  private dropConfirmed(): boolean {
    const revision = this.revision ?? -1;
    const arrived = this.pending.filter(
      (item) => item.confirmedAt !== null && item.confirmedAt <= revision,
    );
    for (const op of arrived) this.remove(op);
    return arrived.length > 0;
  }

  // History -----------------------------------------------------------------

  private replaceHistory(operationId: string, changeSet: ChangeSet) {
    for (const entry of [...this.undoStack, ...this.redoStack])
      if (entry.operationId === operationId) entry.changeSet = changeSet;
  }

  /**
   * Removes entries whose rows changed again after confirmation, by a
   * partner, another tab, or a later command: the server would refuse them.
   */
  private expireHistory() {
    const pending = new Set(this.pending.map((op) => op.operationId));
    const live = (entry: HistoryEntry) => {
      if (pending.has(entry.operationId)) return true;
      if (!revertConflicts(this.confirmedRows, entry.changeSet).length)
        return true;
      this.notify({ kind: "historyExpired", operationId: entry.operationId });
      return false;
    };
    this.undoStack = this.undoStack.filter(live);
    this.redoStack = this.redoStack.filter(live);
  }

  // Bookkeeping -------------------------------------------------------------

  private remove(op: PendingOperation) {
    this.pending = this.pending.filter((item) => item !== op);
  }

  private settle(op: PendingOperation, result: Settled) {
    if (op.settled) return;
    op.settled = true;
    op.onSettled?.(result);
  }

  private notify(notice: Notice) {
    for (const listener of this.noticeListeners) listener(notice);
  }

  // Every change marks the snapshot dirty; subscribers hear about it once,
  // after the current task's synchronous work.
  private changed() {
    if (this.dirty) return;
    this.dirty = true;
    queueMicrotask(() => {
      this.dirty = false;
      this.snapshot = this.buildSnapshot();
      for (const listener of this.listeners) listener();
    });
  }

  private buildSnapshot(): BudgetSnapshot {
    const view = (entry: HistoryEntry | undefined) =>
      entry ? { operationId: entry.operationId, label: entry.label } : null;
    return {
      ...this.sync,
      status:
        this.revision === null
          ? this.noBudget
            ? "empty"
            : "loading"
          : this.confirmedLedger
            ? "ready"
            : "empty",
      revision: this.revision,
      ledger: this.optimisticLedger,
      pending: this.pending.map((op) => ({
        operationId: op.operationId,
        summary: op.summary,
        previewed: this.steps.has(op.operationId),
      })),
      undo: view(this.undoStack.at(-1)),
      redo: view(this.redoStack.at(-1)),
    };
  }
}

// Whether two change sets write the same rows with the same content.
function sameChanges(local: ChangeSet, server: ChangeSet): boolean {
  if (local.after.length !== server.after.length) return false;
  const written = new Map(
    server.after.map((row) => [`${row.table} ${row.id}`, row]),
  );
  return local.after.every((row) => {
    const other = written.get(`${row.table} ${row.id}`);
    return other?.deleted === row.deleted && sameJson(other.data, row.data);
  });
}
