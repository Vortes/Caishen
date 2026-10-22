import { z } from "zod";
import { Prisma } from "~/generated/prisma";
import { rowIssues } from "~/domain/row-schemas";
import { tableNames, type WireRow } from "~/domain/rows";
import { MINIMUM_CLIENT_FORMAT } from "~/domain/client-format";
import {
  confirmedOperationIds,
  pullRows,
  readHouseholdRevision,
  type PullPosition,
} from "~/server/storage/rows";
import { refusal, type Database, type RevisionObserver } from "./household";
import { addCounterpartyAccounts } from "./household-operations";
import { budgetMaintenance, reportUnreadable } from "./stored-data";

// sync.pull (ADR 0006): the rows a partner's browser holds, changed since
// the revision it has, paged at one revision.

/**
 * The oldest browser format the server still serves. A browser sends
 * `${format}:${build}` as its client build; one whose format is older is
 * told to reload (staleClient). Raise it when browsers that hold rows in
 * the old format could no longer read what the server sends.
 */
export { MINIMUM_CLIENT_FORMAT } from "~/domain/client-format";

export const PULL_PAGE_ROWS = 4_000;

export const pullInputSchema = z.object({
  since: z.number().int().nonnegative().nullable(),
  cursor: z.string().max(4_000).optional(),
  clientBuild: z.string().max(200),
});

const cursorSchema = z.object({
  workspaceId: z.string(),
  revision: z.number().int().nonnegative(),
  since: z.number().int().nonnegative().nullable(),
  after: z.object({ table: z.enum(tableNames), id: z.string() }),
});

const encode = (cursor: z.infer<typeof cursorSchema>) =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url");

function decode(cursor: string) {
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
}

function clientFormat(build: string) {
  const format = Number(/^(\d+):/.exec(build)?.[1]);
  return Number.isSafeInteger(format) ? format : 0;
}

export type PullResult = {
  revision: number;
  rows: WireRow[];
  nextCursor?: string;
  reset: boolean;
  confirmedOperationIds: string[];
};

/**
 * One page of a partner's pull. A page is one snapshot of the database, so
 * a pull of one page holds every row as it stood at its revision. Every
 * later page is read at the revision of the first, leaving out rows changed
 * after it; those come with the next pull. The browser starts over (reset)
 * when its revision is older than the household's last reset, or isn't one
 * of this household's.
 */
export async function pull(
  db: Database,
  viewerId: string,
  input: z.infer<typeof pullInputSchema>,
  observe?: RevisionObserver,
): Promise<PullResult> {
  if (clientFormat(input.clientBuild) < MINIMUM_CLIENT_FORMAT)
    throw refusal("staleClient", "Reload Caishen to get the latest version.");
  // Budgets made before counterparty accounts get them as they load.
  if (!input.cursor) await addCounterpartyAccounts(db, viewerId, observe);
  return db.$transaction(
    (snapshot) => readPage(snapshot as Database, viewerId, input, observe),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

async function readPage(
  db: Database,
  viewerId: string,
  input: z.infer<typeof pullInputSchema>,
  observe?: RevisionObserver,
): Promise<PullResult> {
  const household = await readHouseholdRevision(db, viewerId);
  if (!household)
    throw refusal("noBudget", "Create your personal budget first.");
  observe?.(household.revision);
  let page: {
    revision: number;
    since: number | null;
    reset: boolean;
    after?: PullPosition;
  };
  if (input.cursor) {
    const cursor = decode(input.cursor);
    // Another household's pages, or a broken cursor: the browser's pull
    // fails and starts over.
    if (cursor?.workspaceId !== household.workspaceId)
      throw new Error("The pull can't continue; start it again.");
    page = { ...cursor, reset: false };
  } else {
    const reset =
      input.since !== null &&
      (input.since > household.revision ||
        input.since < household.resetRevision);
    page = {
      revision: household.revision,
      since: reset ? null : input.since,
      reset,
    };
  }
  const read = await pullRows(db, {
    workspaceId: household.workspaceId,
    viewerId,
    since: page.since,
    revision: page.revision,
    after: page.after,
    limit: PULL_PAGE_ROWS,
  });
  const rows: WireRow[] = [];
  const unreadable = [];
  for (const row of read.rows) {
    const issues = "issues" in row ? row.issues : rowIssues(row);
    if (issues) unreadable.push({ table: row.table, id: row.id, issues });
    else rows.push(row as WireRow);
  }
  // Rows this code can't read never reach a browser.
  if (unreadable.length) {
    reportUnreadable(
      {
        record: "rows",
        workspaceId: household.workspaceId,
        userId: viewerId,
      },
      [
        {
          part: "pull",
          issues: unreadable.flatMap((row) =>
            row.issues.map((issue) => ({
              ...issue,
              path: [row.table, row.id, ...issue.path],
            })),
          ),
        },
      ],
    );
    throw budgetMaintenance();
  }
  return {
    revision: page.revision,
    rows,
    ...(read.next
      ? {
          nextCursor: encode({
            workspaceId: household.workspaceId,
            revision: page.revision,
            since: page.since,
            after: read.next,
          }),
        }
      : {}),
    reset: page.reset,
    confirmedOperationIds:
      input.cursor || page.since === null
        ? []
        : await confirmedOperationIds(db, {
            workspaceId: household.workspaceId,
            actorId: viewerId,
            after: page.since,
            through: page.revision,
          }),
  };
}
