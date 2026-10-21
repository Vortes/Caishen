import { rowsIn } from "~/domain/change-sets";
import type { RowSet, WireRow } from "~/domain/rows";
import type { Commit } from "./budget-store";

// Where a browser keeps the confirmed rows between visits. Only rows the
// server confirmed are stored, never pending commands.

export type StoredBudget = { revision: number; rows: WireRow[] };

export type Persistence = {
  load(): Promise<StoredBudget | null>;
  /**
   * Stores a commit unless storage already holds its revision or newer, so
   * tabs writing the same storage never move it backward.
   */
  write(commit: Commit): Promise<void>;
  close(): void;
};

/** Keeps rows for this tab only: the fallback when IndexedDB is unavailable. */
export class MemoryPersistence implements Persistence {
  private stored: { revision: number; rows: RowSet } | null = null;

  load(): Promise<StoredBudget | null> {
    const stored = this.stored;
    return Promise.resolve(
      stored && { revision: stored.revision, rows: rowsIn(stored.rows) },
    );
  }

  write(commit: Commit): Promise<void> {
    if (!this.stored || commit.revision > this.stored.revision)
      this.stored = { revision: commit.revision, rows: commit.snapshot };
    return Promise.resolve();
  }

  close() {
    this.stored = null;
  }
}
