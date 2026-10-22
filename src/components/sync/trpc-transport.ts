import { TRPCClientError, type TRPCClient } from "@trpc/client";
import type { AppRouter } from "~/server/api/root";
import {
  SyncError,
  type ExecuteResult,
  type SyncErrorKind,
  type SyncTransport,
} from "./transport";

// The sync contract over the app's tRPC API: budget.execute and sync.pull.

/**
 * The format of the rows this browser holds and reads. The server refuses
 * pulls from a format older than its minimum (staleClient), so raise it
 * together with the server's MINIMUM_CLIENT_FORMAT when old browsers could
 * no longer read what it sends.
 */
export const CLIENT_FORMAT = 1;

/** Sent on every pull as `${format}:${build}`. */
export const clientBuild = `${CLIENT_FORMAT}:${process.env.CAISHEN_BUILD ?? "development"}`;

const kinds = new Set<SyncErrorKind>([
  "rejected",
  "conflict",
  "revertRefused",
  "staleClient",
]);

/** The server's refusal on a tRPC error (data.caishen), if it is one. */
function refusal(error: unknown): SyncError | null {
  if (!(error instanceof TRPCClientError)) return null;
  const data = (error.data as { caishen?: unknown } | undefined)?.caishen as
    { kind?: unknown; message?: unknown; revision?: unknown } | undefined;
  if (!data || !kinds.has(data.kind as SyncErrorKind)) return null;
  return new SyncError(
    data.kind as SyncErrorKind,
    typeof data.message === "string" ? data.message : error.message,
    typeof data.revision === "number" ? data.revision : undefined,
  );
}

// Anything but a refusal may or may not have been applied: it is rethrown
// as is, and the outbox retries it with the same operation id.
async function mapped<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    throw refusal(error) ?? error;
  }
}

export function trpcTransport(client: TRPCClient<AppRouter>): SyncTransport {
  return {
    execute: (input) => mapped(() => client.budget.execute.mutate(input)),
    pull: (input) => mapped(() => client.sync.pull.query(input)),
  };
}

// Answers a server that decided can't change by retrying: the request was
// wrong or the budget isn't in a state to take it. Signing in again, a
// timeout, or too many requests can still go through later.
const retryable = new Set([401, 408, 429]);

/**
 * Sends an operation only the server can apply (bank imports, adding a
 * bank's accounts), for BudgetClient.runOnServer. Those procedures refuse
 * with plain client errors as well as the sync refusals; both settle it.
 */
export async function serverOperation(
  send: () => Promise<ExecuteResult>,
): Promise<ExecuteResult> {
  try {
    return await send();
  } catch (error) {
    const refused = refusal(error);
    if (refused) throw refused;
    const status =
      error instanceof TRPCClientError
        ? (error.data as { httpStatus?: unknown } | undefined)?.httpStatus
        : undefined;
    if (
      typeof status === "number" &&
      status >= 400 &&
      status < 500 &&
      !retryable.has(status)
    )
      throw new SyncError("rejected", (error as Error).message);
    throw error;
  }
}
