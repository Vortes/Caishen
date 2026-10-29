import { db } from "~/server/db";
import { respondToDailyJob } from "~/server/daily-job-endpoint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Scheduled at 00:00 and 06:00 UTC; the second run retries whatever the
// first could not finish.
export function GET(request: Request) {
  return respondToDailyJob(request, { db });
}
