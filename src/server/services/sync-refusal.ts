import { TRPCError } from "@trpc/server";
import type { TRPC_ERROR_CODE_KEY } from "@trpc/server/rpc";

export type SyncErrorKind =
  "rejected" | "conflict" | "revertRefused" | "staleClient";

/**
 * A refusal the browser can act on, sent as `data.caishen` on the error
 * (src/server/api/error-formatter.ts). Any other error is an unknown
 * outcome, which the browser retries with the same operation id.
 */
export class SyncRefusal extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
    readonly revision?: number,
  ) {
    super(message);
    this.name = "SyncRefusal";
  }
}

const refusalCodes: Record<SyncErrorKind, TRPC_ERROR_CODE_KEY> = {
  rejected: "BAD_REQUEST",
  conflict: "CONFLICT",
  revertRefused: "CONFLICT",
  staleClient: "PRECONDITION_FAILED",
};

export function refusal(
  kind: SyncErrorKind,
  message: string,
  revision?: number,
): TRPCError {
  return new TRPCError({
    code: refusalCodes[kind],
    message,
    cause: new SyncRefusal(kind, message, revision),
  });
}
