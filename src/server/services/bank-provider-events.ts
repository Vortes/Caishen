import type { PlaidRequestRecorder } from "~/server/integrations/plaid";
import type { Database } from "./household";

// The provider event audit trail (spec #139): what Caishen asked Plaid, what
// Plaid answered, and when, for any connection. Rows hold ids and outcomes
// only; tokens, account numbers, and request bodies are never stored.

/** Records each Plaid request a client makes on behalf of one member. */
export function plaidRequestRecorder(
  db: Database,
  on: { userId: string; connectionId?: string | null },
): PlaidRequestRecorder {
  return async (event) => {
    await db.bankProviderEvent.create({
      data: {
        kind: "request",
        method: event.path,
        requestId: event.requestId,
        errorCode: event.errorCode,
        durationMs: event.durationMs,
        clerkUserId: on.userId,
        connectionId: on.connectionId ?? null,
      },
    });
  };
}
