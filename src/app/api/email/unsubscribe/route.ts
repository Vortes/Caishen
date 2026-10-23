import { TRPCError } from "@trpc/server";
import { db } from "~/server/db";
import { setEmailSubscription } from "~/server/services/email-preferences";

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length > 2048)
    return new Response("Invalid link", { status: 400 });
  try {
    await setEmailSubscription(db, token, false);
    return new Response(null, { status: 204 });
  } catch (error) {
    return new Response("Couldn’t update email preferences", {
      status:
        error instanceof TRPCError && error.code === "NOT_FOUND" ? 404 : 503,
    });
  }
}
