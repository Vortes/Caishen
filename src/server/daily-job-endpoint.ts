import { TRPCError } from "@trpc/server";
import type { Database } from "./services/household";
import { requireCronAuthorization } from "./services/safety";
import { runDailyJob } from "./services/daily-job";

export interface DailyJobEndpointDependencies {
  db: Database;
  now?: () => Date;
  overrides?: Parameters<typeof runDailyJob>[2];
  /** The dead-man's switch's ping URL; unset, no ping is sent. */
  pingUrl?: string;
  ping?: (url: string, body: unknown) => Promise<void>;
}

const headers = { "Cache-Control": "no-store" };

// A lost ping is the monitor's to notice; it never changes the run's answer.
async function healthchecksPing(url: string, body: unknown) {
  try {
    await fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("The daily job monitor could not be pinged", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The daily job route's response: 200 once the run reaches its end, whatever
 * each connection and email did, with the outcomes in the body, and 503 when
 * it could not start. Only a
 * completed run pings the monitor, so a run that never starts or dies is
 * noticed by the ping's absence (https://healthchecks.io/docs/).
 */
export async function respondToDailyJob(
  request: Request,
  {
    db,
    now = () => new Date(),
    overrides,
    pingUrl = process.env.HEALTHCHECKS_PING_URL,
    ping = healthchecksPing,
  }: DailyJobEndpointDependencies,
): Promise<Response> {
  let result;
  try {
    requireCronAuthorization(request.headers.get("authorization"));
    result = await runDailyJob(db, now(), overrides);
  } catch (error) {
    if (error instanceof TRPCError)
      return Response.json(
        { error: error.message },
        { status: error.code === "UNAUTHORIZED" ? 401 : 503, headers },
      );
    // The run could not start, so the next scheduled run is the retry.
    console.error("Daily job could not start", error);
    return Response.json(
      { error: "Daily work could not start. Check the hosted job logs." },
      { status: 503, headers },
    );
  }
  // A stale connection signals failure, which alerts at once; the body names
  // the connections.
  if (pingUrl)
    await ping(result.stale.length ? `${pingUrl}/fail` : pingUrl, result);
  return Response.json(result, { headers });
}
