import { expect, test } from "@playwright/test";

test("signed-out API requests cannot read a budget", async ({ request }) => {
  const response = await request.get(
    `/api/trpc/budget.state?input=${encodeURIComponent(JSON.stringify({ json: { month: "2026-10" } }))}`,
  );
  expect(response.status()).toBe(401);
});

test("a Clerk webhook is rejected when signing is not configured", async ({
  request,
}) => {
  // playwright.config.ts starts this server with an empty signing secret.
  const response = await request.post("/api/webhooks/clerk", {
    data: { type: "user.created", data: { id: "user_unverified" } },
  });
  expect(response.status()).toBe(503);
  expect(await response.json()).toEqual({
    error: "Clerk webhook signing is not configured.",
  });
});
