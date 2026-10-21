import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import { rowsIn } from "~/domain/change-sets";
import type { WireRow } from "~/domain/rows";
import type { Commit } from "./budget-store";
import {
  MemoryPersistence,
  type Persistence,
  type StoredBudget,
} from "./persistence";

// The confirmed rows kept in IndexedDB, one database per signed-in user
// (`caishen:{userId}`), shared by that user's tabs. Each commit is one
// transaction and is skipped when storage already holds its revision or a
// newer one, so tabs never move it backward and need no leader.

/** Raised when stored rows can no longer be read as they are: they are dropped. */
export const STORE_SCHEMA_VERSION = 1;
const DATABASE_PREFIX = "caishen:";

type Meta = { revision: number; storeSchemaVersion: number; build: string };

interface BudgetDatabase extends DBSchema {
  rows: { key: [string, string]; value: WireRow };
  meta: { key: "meta"; value: Meta };
}

export const budgetDatabaseName = (userId: string) =>
  `${DATABASE_PREFIX}${userId}`;

export class IndexedDbPersistence implements Persistence {
  private closed = false;

  private constructor(
    private readonly db: IDBPDatabase<BudgetDatabase>,
    private readonly build: string,
  ) {
    // Another tab is deleting this database (sign-out): let it.
    db.addEventListener("versionchange", () => this.close());
  }

  static async open(
    userId: string,
    build: string,
  ): Promise<IndexedDbPersistence> {
    const db = await openDB<BudgetDatabase>(budgetDatabaseName(userId), 1, {
      upgrade(database) {
        database.createObjectStore("rows", { keyPath: ["table", "id"] });
        database.createObjectStore("meta");
      },
    });
    return new IndexedDbPersistence(db, build);
  }

  async load(): Promise<StoredBudget | null> {
    if (this.closed) return null;
    const tx = this.db.transaction(["rows", "meta"], "readwrite");
    const meta = await tx.objectStore("meta").get("meta");
    if (meta?.storeSchemaVersion !== STORE_SCHEMA_VERSION) {
      await Promise.all([
        tx.objectStore("rows").clear(),
        tx.objectStore("meta").clear(),
        tx.done,
      ]);
      return null;
    }
    const rows = await tx.objectStore("rows").getAll();
    await tx.done;
    return { revision: meta.revision, rows };
  }

  async write(commit: Commit): Promise<void> {
    if (this.closed) return;
    const tx = this.db.transaction(["rows", "meta"], "readwrite");
    const rows = tx.objectStore("rows");
    const meta = tx.objectStore("meta");
    const held = await meta.get("meta");
    const writes: Promise<unknown>[] = [];
    if (
      held?.storeSchemaVersion !== STORE_SCHEMA_VERSION ||
      commit.revision > held.revision
    ) {
      // Rows changed since the stored revision may be missing from a commit
      // that applies on top of a newer one, so storage behind it takes all.
      const whole =
        commit.since === null ||
        held?.storeSchemaVersion !== STORE_SCHEMA_VERSION ||
        held.revision < commit.since;
      if (whole) writes.push(rows.clear());
      for (const row of whole ? rowsIn(commit.snapshot) : commit.rows)
        writes.push(rows.put(row));
      writes.push(
        meta.put(
          {
            revision: commit.revision,
            storeSchemaVersion: STORE_SCHEMA_VERSION,
            build: this.build,
          },
          "meta",
        ),
      );
    }
    await Promise.all([...writes, tx.done]);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

/**
 * The signed-in user's storage, after removing any other user's: a browser
 * keeps one person's budget at a time. Falls back to memory where
 * IndexedDB is missing or refuses to open (some private windows).
 */
export async function openPersistence(
  userId: string,
  build: string,
): Promise<Persistence> {
  if (typeof indexedDB === "undefined") return new MemoryPersistence();
  try {
    await deleteStoredBudgets({ except: userId });
    return await IndexedDbPersistence.open(userId, build);
  } catch (error) {
    console.error(
      "Budget storage is unavailable; keeping rows in memory",
      error,
    );
    return new MemoryPersistence();
  }
}

/**
 * Deletes stored budgets on sign-out (every one) or a change of user (all
 * but the new user's). Browsers that can't list databases delete the named
 * user's only.
 */
export async function deleteStoredBudgets({
  except,
  userId,
}: { except?: string; userId?: string } = {}): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const names = new Set<string>();
  if (userId) names.add(budgetDatabaseName(userId));
  if ("databases" in indexedDB)
    for (const database of await indexedDB.databases())
      if (database.name?.startsWith(DATABASE_PREFIX)) names.add(database.name);
  if (except) names.delete(budgetDatabaseName(except));
  await Promise.all([...names].map((name) => deleteDB(name)));
}
