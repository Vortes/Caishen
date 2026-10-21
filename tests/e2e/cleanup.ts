import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const recoveryDirectory = ".e2e-recovery";
const recordSchema = z.object({
  runId: z.string().uuid(),
  pid: z.number().int().positive(),
  identities: z.array(
    z.object({ email: z.string().email(), userId: z.string().optional() }),
  ),
});
type RunRecord = z.infer<typeof recordSchema>;

// A recovery record, not a credential file. Keep it outside .next so a build
// cannot erase the evidence needed to clean up an interrupted run.
export class RunJournal {
  private constructor(
    private directory: string,
    private record: RunRecord,
  ) {}

  static async create(directory = recoveryDirectory) {
    const journal = new RunJournal(directory, {
      runId: randomUUID(),
      pid: process.pid,
      identities: [],
    });
    await journal.save();
    return journal;
  }

  static async open(directory: string, runId: string) {
    z.string().uuid().parse(runId);
    const record = recordSchema.parse(
      JSON.parse(await readFile(join(directory, `${runId}.json`), "utf8")),
    );
    if (
      record.runId !== runId ||
      record.identities.some(
        ({ email }) =>
          !email.startsWith(`caishen-e2e-${runId}-`) ||
          !email.endsWith("+clerk_test@example.com"),
      )
    )
      throw new Error("Invalid E2E recovery ownership record.");
    return new RunJournal(directory, record);
  }

  get runId() {
    return this.record.runId;
  }
  get pid() {
    return this.record.pid;
  }
  get identities() {
    return this.record.identities;
  }
  private get path() {
    return join(this.directory, `${this.runId}.json`);
  }

  private async save() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(this.record), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async reserveIdentity() {
    const email = `caishen-e2e-${this.runId}-${this.record.identities.length.toString(36)}+clerk_test@example.com`;
    this.record.identities.push({ email });
    await this.save();
    return email;
  }

  async recordIdentity(email: string, userId: string) {
    const entry = this.record.identities.find(
      (identity) => identity.email === email,
    );
    if (!entry || (entry.userId && entry.userId !== userId))
      throw new Error("E2E identity does not match its reservation.");
    entry.userId = userId;
    await this.save();
  }

  async complete() {
    await rm(this.path);
  }
}

export type CleanupServices = {
  findIdentity: (
    email: string,
  ) => Promise<{ id: string; email: string; runId: unknown }[]>;
  assertOwnedData: (userId: string) => Promise<void>;
  deleteIdentity: (userId: string) => Promise<void>;
  clearData: (userId: string) => Promise<void>;
};

export async function cleanupRun(
  journal: RunJournal,
  services: CleanupServices,
) {
  const failures: unknown[] = [];
  for (const entry of journal.identities) {
    try {
      const found = await services.findIdentity(entry.email);
      if (found.length > 1)
        throw new Error("Ambiguous E2E identity ownership.");
      const identity = found[0];
      if (!identity && !entry.userId)
        throw new Error(
          "Identity creation is unresolved; retain its reservation for recovery.",
        );
      if (identity) {
        if (
          identity.email !== entry.email ||
          identity.runId !== journal.runId ||
          (entry.userId && entry.userId !== identity.id)
        )
          throw new Error("Refusing to delete an unowned E2E identity.");
        // Persist ownership before deleting Clerk; a later retry must still be
        // able to remove database records after that identity has disappeared.
        await journal.recordIdentity(entry.email, identity.id);
        await services.assertOwnedData(identity.id);
        await services.deleteIdentity(identity.id);
      }
      if (entry.userId) {
        await services.assertOwnedData(entry.userId);
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await services.clearData(entry.userId);
            break;
          } catch (error) {
            // Concurrent Clerk webhooks can invalidate a serializable cleanup.
            // P2034 guarantees rollback; retry the whole transaction only.
            if (
              attempt < 2 &&
              error instanceof Error &&
              "code" in error &&
              error.code === "P2034"
            )
              continue;
            throw error;
          }
        }
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      `E2E cleanup incomplete. Recover run ${journal.runId}; its journal was retained.`,
    );
  await journal.complete();
}
