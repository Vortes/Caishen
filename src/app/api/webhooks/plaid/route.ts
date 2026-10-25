import { after } from "next/server";
import { db } from "~/server/db";
import {
  cachedKeyFetcher,
  respondToPlaidWebhook,
} from "~/server/plaid-webhook";
import { fetchPlaidWebhookKey } from "~/server/services/banks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// An account update scheduled after the response runs in this invocation.
export const maxDuration = 300;

// Plaid's signing keys, fetched once per key id for the life of the instance.
const fetchKey = cachedKeyFetcher(fetchPlaidWebhookKey);

export async function POST(request: Request) {
  try {
    return await respondToPlaidWebhook(request, {
      db,
      fetchKey,
      schedule: (task) => after(task),
    });
  } catch {
    return Response.json(
      { error: "The webhook could not be recorded. Retry the delivery." },
      { status: 500 },
    );
  }
}
