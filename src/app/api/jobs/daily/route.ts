import { TRPCError } from "@trpc/server";
import { db } from "~/server/db";
import { requireCronAuthorization } from "~/server/services/safety";
import { runDailyJob } from "~/server/services/daily-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    requireCronAuthorization(request.headers.get("authorization"));
    const result = await runDailyJob(db);
    return Response.json(result, {
      status: result.failed ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof TRPCError)
      return Response.json(
        { error: error.message },
        {
          status: error.code === "UNAUTHORIZED" ? 401 : 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    return Response.json(
      { error: "Daily work could not finish. Check the hosted job logs." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
