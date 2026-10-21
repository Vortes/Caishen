import {
  applyChangeSet,
  changeSetVisibleTo,
  executeRevert,
  rowsIn,
  stampChangeSet,
  toRowSet,
} from "~/domain/change-sets";
import { canonicalJson } from "~/domain/canonical-json";
import {
  AccountingError,
  addMember,
  createBook,
  execute,
  executeWithChanges,
  ledgerCommandSchema,
  type Book,
  type Command,
  type LedgerCommand,
} from "~/domain/engine";
import {
  bookToRows,
  rowKeyParts,
  rowsToBook,
  rowVisibleTo,
  type ChangeSet,
  type RowSet,
} from "~/domain/rows";
import {
  SyncError,
  type ExecuteInput,
  type ExecuteResult,
  type PullInput,
  type PullResult,
  type SyncTransport,
} from "~/components/sync/transport";

// The sync contract (ADR 0006) served by the real engine over rows, as the
// server does: each command runs against the household, its change set is
// stamped with the next revision and written, and every answer is filtered
// to what the viewer's browser holds.

type Operation = {
  actorId: string;
  hash: string;
  revision: number;
  changeSet: ChangeSet;
};

// Budget tables owned by one partner. Anything else is shared, and a command
// that writes it can't be rebased onto a newer revision.
const sharedTables = new Set([
  "member",
  "sharedCategory",
  "obligation",
  "settlement",
  "settlementAllocation",
  "partnerFact",
]);

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

export class FakeServer {
  revision = 0;
  rows: RowSet;
  readonly operations = new Map<string, Operation>();
  private readonly history = new Map<number, RowSet>();
  /** Rows per pull page. */
  pageSize = Number.POSITIVE_INFINITY;
  /** Pulls since an older revision than this reset the browser. */
  oldestDelta = 0;
  /** Whether a retried operation's change set is still kept. */
  keepsChangeSets = true;
  readonly executed: { actorId: string; input: ExecuteInput }[] = [];
  /** Runs as each command arrives, before the server applies it. */
  onExecute?: (input: ExecuteInput) => void;
  /** Answers staleClient to any other build. */
  requiredBuild?: string;
  readonly pulls: { viewerId: string; input: PullInput }[] = [];

  constructor(book: Book) {
    this.rows = toRowSet(bookToRows(book));
    this.history.set(0, this.rows);
  }

  book(): Book {
    return rowsToBook(rowsIn(this.rows));
  }

  /** A change made elsewhere: the partner, or another tab or device. */
  act(actorId: string, command: LedgerCommand): ChangeSet {
    return this.write(actorId, command, this.revision).changeSet;
  }

  execute(actorId: string, input: ExecuteInput): ExecuteResult {
    this.executed.push({ actorId, input });
    this.onExecute?.(input);
    const command = input.command;
    const previous = this.operations.get(command.id);
    if (previous) {
      if (previous.hash !== canonicalJson(command))
        throw new SyncError(
          "rejected",
          "Operation ID was already used with different data",
        );
      return {
        revision: previous.revision,
        changeSet: this.keepsChangeSets
          ? changeSetVisibleTo(previous.changeSet, actorId)
          : null,
        rebased: false,
      };
    }
    const written = this.write(actorId, command, input.baseRevision);
    return {
      revision: written.revision,
      changeSet: changeSetVisibleTo(written.changeSet, actorId),
      rebased: input.baseRevision !== written.revision - 1,
    };
  }

  pull(viewerId: string, input: PullInput): PullResult {
    this.pulls.push({ viewerId, input });
    if (this.requiredBuild && input.clientBuild !== this.requiredBuild)
      throw new SyncError("staleClient", "Reload to get the latest version");
    const [revisionText, offsetText] = (input.cursor ?? "").split(":");
    const revision = input.cursor ? Number(revisionText) : this.revision;
    const rows = this.history.get(revision)!;
    const reset = input.since !== null && input.since < this.oldestDelta;
    const since = reset ? null : input.since;
    const changed = rowsIn(rows)
      .filter((row) => rowVisibleTo(row, viewerId))
      .filter((row) => (since === null ? !row.deleted : row.revision > since));
    const offset = input.cursor ? Number(offsetText) : 0;
    const end = offset + this.pageSize;
    return {
      revision,
      rows: changed.slice(offset, end),
      nextCursor: end < changed.length ? `${revision}:${end}` : undefined,
      reset,
      confirmedOperationIds: input.cursor
        ? []
        : [...this.operations]
            .filter(
              ([, op]) =>
                op.actorId === viewerId &&
                op.revision <= revision &&
                op.revision > (since ?? -1),
            )
            .map(([id]) => id),
    };
  }

  private write(actorId: string, input: LedgerCommand, baseRevision: number) {
    const command = ledgerCommandSchema.parse(input);
    let changeSet: ChangeSet;
    try {
      if (command.type === "revert") {
        const target = this.operations.get(command.targetOperationId);
        if (target?.actorId !== actorId)
          throw new AccountingError("Undo access denied");
        changeSet = executeRevert(
          this.rows,
          command,
          target.changeSet,
        ).changeSet;
      } else
        changeSet = executeWithChanges(this.book(), actorId, command).changeSet;
    } catch (error) {
      if (!(error instanceof AccountingError)) throw error;
      throw new SyncError(
        command.type === "revert" ? "revertRefused" : "rejected",
        error.message,
        this.revision,
      );
    }
    if (
      baseRevision < this.revision &&
      changeSet.after.some(
        (row) =>
          sharedTables.has(row.table) || rowKeyParts(row.id)[0] !== actorId,
      )
    )
      throw new SyncError(
        "conflict",
        "Your partner changed this budget at the same time",
        this.revision,
      );
    const stamped = stampChangeSet(changeSet, this.revision + 1, this.rows);
    this.revision++;
    this.rows = applyChangeSet(this.rows, stamped);
    this.history.set(this.revision, this.rows);
    this.operations.set(command.id, {
      actorId,
      hash: canonicalJson(input),
      revision: this.revision,
      changeSet: stamped,
    });
    return { revision: this.revision, changeSet: stamped };
  }
}

type Delivery = { release: () => void; fail: () => void };

/**
 * One browser's connection to the fake server. Answers can be held back
 * and released in any order, and a request can fail before or after the
 * server applied it.
 */
export class FakeConnection implements SyncTransport {
  holding = false;
  readonly held: Delivery[] = [];
  private failures: { kind: "execute" | "pull"; applied: boolean }[] = [];

  constructor(
    readonly server: FakeServer,
    readonly viewerId: string,
  ) {}

  /** The next request of this kind fails; `applied` means the server ran it. */
  failNext(kind: "execute" | "pull", applied = false) {
    this.failures.push({ kind, applied });
  }

  releaseAll() {
    for (const delivery of this.held.splice(0)) delivery.release();
  }

  execute = (input: ExecuteInput) =>
    this.deliver("execute", () =>
      this.server.execute(this.viewerId, structuredClone(input)),
    );

  pull = (input: PullInput) =>
    this.deliver("pull", () => this.server.pull(this.viewerId, input));

  private deliver<T>(kind: "execute" | "pull", answer: () => T): Promise<T> {
    const index = this.failures.findIndex((failure) => failure.kind === kind);
    const failure = index >= 0 ? this.failures.splice(index, 1)[0] : undefined;
    if (failure && !failure.applied)
      return Promise.reject(new TypeError("Failed to fetch"));
    // The server answers when the request arrives, whenever the browser
    // hears back.
    let result: { value: T } | { error: unknown };
    try {
      result = { value: answer() };
    } catch (error) {
      result = { error };
    }
    if (failure) return Promise.reject(new TypeError("Failed to fetch"));
    const settle = (
      resolve: (value: T) => void,
      reject: (e: unknown) => void,
    ) => ("value" in result ? resolve(result.value) : reject(result.error));
    if (!this.holding) return new Promise(settle);
    return new Promise((resolve, reject) =>
      this.held.push({
        release: () => settle(resolve, reject),
        fail: () => reject(new TypeError("Failed to fetch")),
      }),
    );
  }
}

/** Alex and Jordan's household, with a few accounts, categories, and spending. */
export function household(): Book {
  let book = addMember(
    createBook("alex", "Alex", "2026-09"),
    "jordan",
    "Jordan",
    "2026-09",
  );
  let sequence = 0;
  const run = (actorId: string, command: WithoutId<Command>) => {
    book = execute(book, actorId, {
      ...command,
      id: `setup-${++sequence}`,
    });
  };
  for (const actorId of ["alex", "jordan"]) {
    run(actorId, {
      type: "account.add",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      openingBalance: 500_000,
    });
    for (const name of ["Rent", "Food", "Dining"])
      run(actorId, {
        type: "category.add",
        categoryId: name.toLowerCase(),
        name,
      });
  }
  run("alex", {
    type: "transaction.upsert",
    transactionId: "cafe",
    accountId: "checking",
    date: "2026-10-03",
    amount: -2_500,
    payee: "Cafe",
    categoryId: "food",
  });
  return book;
}
