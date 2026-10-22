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

// The refusals the server sends as data.caishen.
const kinds = new Set<SyncErrorKind>([
  "rejected",
  "conflict",
  "revertRefused",
  "staleClient",
  "noBudget",
]);

/** Said when the server couldn't read a request at all. */
const UNREADABLE_MESSAGE =
  "Caishen couldn’t read this change, so it wasn’t saved.";
const SIGNED_OUT_MESSAGE = "Sign in to keep saving your changes.";

// Client errors that sending again can still get through: a timeout, too
// many requests, or a request the browser itself abandoned.
const retryable = new Set([
  "TIMEOUT",
  "TOO_MANY_REQUESTS",
  "CLIENT_CLOSED_REQUEST",
]);

/**
 * The answer that settles a request, as a SyncError, or null for an unknown
 * outcome (no connection, a timeout, a server error), which is retried.
 */
function settled(error: unknown): SyncError | null {
  if (!(error instanceof TRPCClientError)) return null;
  const data = error.data as
    | {
        caishen?: unknown;
        code?: unknown;
        httpStatus?: unknown;
        zodError?: unknown;
      }
    | undefined;
  const refusal = data?.caishen as
    { kind?: unknown; message?: unknown; revision?: unknown } | undefined;
  if (refusal && kinds.has(refusal.kind as SyncErrorKind))
    return new SyncError(
      refusal.kind as SyncErrorKind,
      typeof refusal.message === "string" ? refusal.message : error.message,
      typeof refusal.revision === "number" ? refusal.revision : undefined,
    );
  const code = data?.code;
  const status = data?.httpStatus;
  if (code === "UNAUTHORIZED")
    return new SyncError("signedOut", SIGNED_OUT_MESSAGE);
  if (code === "FORBIDDEN")
    return new SyncError("signedOut", error.message || SIGNED_OUT_MESSAGE);
  // The server read the request and said no: sending it again gets the
  // same answer. Input it couldn't parse or validate has no message worth
  // showing.
  if (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    !retryable.has(code as string)
  )
    return new SyncError(
      "rejected",
      code === "PARSE_ERROR" || data?.zodError
        ? UNREADABLE_MESSAGE
        : error.message,
    );
  return null;
}

// An unknown outcome is rethrown as is; the outbox retries it with the same
// operation id, and the server applies it at most once.
async function mapped<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    throw settled(error) ?? error;
  }
}

export function trpcTransport(client: TRPCClient<AppRouter>): SyncTransport {
  return {
    execute: (input) => mapped(() => client.budget.execute.mutate(input)),
    pull: (input) => mapped(() => client.sync.pull.query(input)),
  };
}

/**
 * Sends an operation only the server can apply (bank imports, adding a
 * bank's accounts), for BudgetClient.runOnServer. Those procedures refuse
 * with plain client errors as well as the sync refusals; both settle it.
 */
export function serverOperation(
  send: () => Promise<ExecuteResult>,
): Promise<ExecuteResult> {
  return mapped(send);
}
