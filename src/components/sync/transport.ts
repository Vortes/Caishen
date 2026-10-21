import type { LedgerCommand } from "~/domain/engine";
import type { ChangeSet, WireRow } from "~/domain/rows";

// What the browser's sync layer needs from the server (the sync contract in
// ADR 0006). The live app implements it over tRPC; tests implement it over
// the domain engine.

export type ExecuteInput = {
  command: LedgerCommand;
  /** The confirmed revision the command was previewed against. */
  baseRevision: number;
  /** This tab, so the server can tell a retry from another tab's command. */
  clientId: string;
};

export type ExecuteResult = {
  revision: number;
  /**
   * The rows the operation changed, as the viewer holds them, stamped with
   * `revision`. Null when the server no longer has it (an old retry); the
   * browser then pulls.
   */
  changeSet: ChangeSet | null;
  /** The server re-ran the command against a newer revision. */
  rebased: boolean;
};

export type PullInput = {
  /** The revision the browser holds, or null for everything. */
  since: number | null;
  cursor?: string;
  clientBuild: string;
};

export type PullResult = {
  revision: number;
  /** Rows changed after `since`, tombstones included. */
  rows: WireRow[];
  /** Another page at the same revision follows. */
  nextCursor?: string;
  /** The rows replace everything the browser holds. */
  reset: boolean;
  /** This actor's operations written after `since`. */
  confirmedOperationIds: string[];
};

export type SyncTransport = {
  execute(input: ExecuteInput): Promise<ExecuteResult>;
  pull(input: PullInput): Promise<PullResult>;
};

/**
 * A refusal the server decided. Anything else a transport throws is treated
 * as an unknown outcome and retried with the same operation id.
 */
export type SyncErrorKind =
  "rejected" | "conflict" | "revertRefused" | "staleClient";

export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
    readonly revision?: number,
  ) {
    super(message);
    this.name = "SyncError";
  }
}
