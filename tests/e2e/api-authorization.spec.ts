import { expect, test } from "@playwright/test";

test("signed-out API requests cannot read a budget or submit an unconfigured Clerk webhook", async ({
  request,
}) => {
  const response = await request.get(
    `/api/trpc/budget.state?input=${encodeURIComponent(JSON.stringify({ json: { month: "2026-10" } }))}`,
  );
  expect(response.status()).toBe(401);
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()) {
    const webhook = await request.post("/api/webhooks/clerk", {
      data: { type: "user.created", data: { id: "user_unverified" } },
    });
    expect(webhook.status()).toBe(503);
    expect(await webhook.json()).toEqual({
      error: "Clerk webhook signing is not configured.",
    });
  }
});
