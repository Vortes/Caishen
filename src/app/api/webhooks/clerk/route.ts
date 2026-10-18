import { verifyClerkRequest, ClerkWebhookError } from "~/server/clerk-webhook";
import { db } from "~/server/db";
import { cancelScheduledDailyReviews } from "~/server/services/daily-delivery";
import {
  syncClerkUserEvent,
  ClerkUserEventValidationError,
  ClerkUserEventConflictError,
} from "~/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { messageId, event } = await verifyClerkRequest(
      request,
      process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    );
    if (!["user.created", "user.updated", "user.deleted"].includes(event.type))
      return Response.json({ received: true, ignored: true });
    const synced = await syncClerkUserEvent(db, messageId, event);
    if (event.type === "user.deleted")
      await cancelScheduledDailyReviews(db, synced.clerkUserId);
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof ClerkWebhookError)
      return Response.json({ error: error.message }, { status: error.status });
    if (
      error instanceof ClerkUserEventValidationError ||
      error instanceof ClerkUserEventConflictError
    )
      return Response.json({ error: error.message }, { status: 400 });
    return Response.json(
      { error: "User synchronization could not finish. Retry the delivery." },
      { status: 500 },
    );
  }
}
