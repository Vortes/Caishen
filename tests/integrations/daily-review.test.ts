import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDailyReviewMessage,
  createResendClient,
  dailyReviewSchedule,
} from "../../src/server/integrations/daily-review";
import { integrationStatus } from "../../src/server/integrations/status";
import { IntegrationError } from "../../src/server/integrations/validation";

void test("daily UTC batches schedule 08:00 in each user's timezone", () => {
  for (const [timeZone, hour] of [
    ["America/New_York", "12"],
    ["America/Chicago", "13"],
    ["America/Denver", "14"],
    ["America/Los_Angeles", "15"],
    ["America/Phoenix", "15"],
    ["America/Anchorage", "16"],
    ["Pacific/Honolulu", "18"],
  ] as const) {
    assert.deepEqual(
      dailyReviewSchedule("owner", { enabled: true, timeZone }, "2026-10-17"),
      [
        {
          localDate: "2026-10-17",
          scheduledAt: `2026-10-17T${hour}:00:00.000Z`,
          dedupeKey: "daily-review:owner:2026-10-17",
        },
      ],
    );
  }
});

void test("batch boundaries select local dates by actual delivery instant", () => {
  assert.deepEqual(
    dailyReviewSchedule(
      "owner",
      {
        enabled: true,
        timeZone: "America/Los_Angeles",
        localTime: "20:00",
      },
      "2026-10-17",
    ),
    [
      {
        localDate: "2026-10-16",
        scheduledAt: "2026-10-17T03:00:00.000Z",
        dedupeKey: "daily-review:owner:2026-10-16",
      },
    ],
  );
  assert.deepEqual(
    dailyReviewSchedule(
      "owner",
      {
        enabled: true,
        timeZone: "Pacific/Kiritimati",
      },
      "2026-10-17",
    ),
    [
      {
        localDate: "2026-10-18",
        scheduledAt: "2026-10-17T18:00:00.000Z",
        dedupeKey: "daily-review:owner:2026-10-18",
      },
    ],
  );
  assert.equal(
    dailyReviewSchedule(
      "owner",
      { enabled: true, timeZone: "UTC", localTime: "00:00" },
      "2026-10-17",
    )[0]!.scheduledAt,
    "2026-10-17T00:00:00.000Z",
  );
});

void test("morning delivery follows DST and ambiguous times choose the first valid occurrence", () => {
  const preferences = { enabled: true, timeZone: "America/Los_Angeles" };
  assert.equal(
    dailyReviewSchedule("owner", preferences, "2026-03-07")[0]!.scheduledAt,
    "2026-03-07T16:00:00.000Z",
  );
  assert.equal(
    dailyReviewSchedule("owner", preferences, "2026-03-08")[0]!.scheduledAt,
    "2026-03-08T15:00:00.000Z",
  );
  assert.equal(
    dailyReviewSchedule(
      "owner",
      { ...preferences, localTime: "02:30" },
      "2026-03-08",
    )[0]!.scheduledAt,
    "2026-03-08T10:00:00.000Z",
  );
  assert.equal(
    dailyReviewSchedule(
      "owner",
      { ...preferences, localTime: "01:30" },
      "2026-11-01",
    )[0]!.scheduledAt,
    "2026-11-01T08:30:00.000Z",
  );
});

void test("consecutive UTC batches preserve every local date when DST yields zero or two delivery targets", () => {
  const preferences = {
    enabled: true,
    timeZone: "America/Los_Angeles",
    localTime: "16:30",
  };
  const spring = ["2026-03-07", "2026-03-08", "2026-03-09"].flatMap((date) =>
    dailyReviewSchedule("owner", preferences, date),
  );
  assert.deepEqual(
    spring.map((target) => target.localDate),
    ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"],
  );
  assert.equal(
    dailyReviewSchedule("owner", preferences, "2026-03-08").length,
    2,
  );
  const fall = ["2026-10-31", "2026-11-01", "2026-11-02"].flatMap((date) =>
    dailyReviewSchedule("owner", preferences, date),
  );
  assert.deepEqual(
    fall.map((target) => target.localDate),
    ["2026-10-31", "2026-11-01"],
  );
  assert.equal(
    dailyReviewSchedule("owner", preferences, "2026-11-01").length,
    0,
  );
  assert.equal(
    new Set(spring.map((target) => target.dedupeKey)).size,
    spring.length,
  );
});

void test("disabled email has no targets; invalid timezone, time and batch date fail", () => {
  assert.deepEqual(
    dailyReviewSchedule(
      "owner",
      { enabled: false, timeZone: "UTC" },
      "2026-10-17",
    ),
    [],
  );
  for (const preferences of [
    { enabled: true, timeZone: "Invalid/Zone" },
    { enabled: true, timeZone: "UTC", localTime: "25:00" },
  ])
    assert.throws(() =>
      dailyReviewSchedule("owner", preferences, "2026-10-17"),
    );
  for (const date of ["2026-02-30", "2026-10-17T00:00:00Z", "invalid"])
    assert.throws(() =>
      dailyReviewSchedule("owner", { enabled: true, timeZone: "UTC" }, date),
    );
});

void test("daily email links to private persistent inbox and states actual freshness without merchant details", () => {
  const message = buildDailyReviewMessage({
    appBaseUrl: "https://caishen.example",
    inboxCount: 4,
    latestSuccessfulSync: null,
    timeZone: "America/Los_Angeles",
  });
  assert.match(message.subject, /4 items/);
  assert.match(message.text, /No successful bank update yet/);
  assert.match(message.text, /https:\/\/caishen.example\/\?view=review/);
  assert.throws(() =>
    buildDailyReviewMessage({
      appBaseUrl: "http://caishen.example",
      inboxCount: 1,
      latestSuccessfulSync: null,
      timeZone: "UTC",
    }),
  );
});

void test("Resend adapter sends only to the specified address with the daily idempotency key", async () => {
  let called = 0;
  const fakeFetch: typeof fetch = async (url, init) => {
    called += 1;
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(
      new Headers(init?.headers).get("Idempotency-Key"),
      "daily-review:owner:2026-10-17",
    );
    assert.equal(typeof init?.body, "string");
    assert.deepEqual(
      (JSON.parse(init?.body as string) as { to: string[] }).to,
      ["owner@example.com"],
    );
    assert.equal(
      "scheduled_at" in (JSON.parse(init?.body as string) as object),
      false,
    );
    return Response.json({ id: "email-1" });
  };
  const client = createResendClient(
    { apiKey: "test-key", from: "Caishen <review@example.com>" },
    fakeFetch,
  );
  const result = await client.sendDailyReview({
    to: "owner@example.com",
    dedupeKey: "daily-review:owner:2026-10-17",
    message: { subject: "Daily review", text: "Private inbox" },
  });
  assert.equal(result.id, "email-1");
  assert.equal(called, 1);
  assert.throws(() =>
    createResendClient({ apiKey: "", from: "review@example.com" }),
  );
});

void test("Resend schedules the requested ISO instant and preserves identical retry bodies", async () => {
  const bodies: string[] = [];
  const client = createResendClient(
    { apiKey: "test-key", from: "Caishen <review@example.com>" },
    async (_url, init) => {
      bodies.push(init!.body as string);
      assert.equal(
        new Headers(init?.headers).get("Idempotency-Key"),
        "daily-review:owner:2026-10-17",
      );
      return Response.json({ id: "scheduled-email" });
    },
  );
  const input = {
    to: "owner@example.com",
    dedupeKey: "daily-review:owner:2026-10-17",
    message: { subject: "Daily review", text: "Private inbox" },
    scheduledAt: "2026-10-17T15:00:00.000Z",
  };
  assert.deepEqual(await client.sendDailyReview(input), {
    id: "scheduled-email",
  });
  await client.sendDailyReview(input);
  assert.equal(bodies[0], bodies[1]);
  assert.deepEqual(JSON.parse(bodies[0]!) as unknown, {
    from: "Caishen <review@example.com>",
    to: ["owner@example.com"],
    subject: "Daily review",
    text: "Private inbox",
    scheduled_at: "2026-10-17T15:00:00.000Z",
  });
  for (const scheduledAt of ["tomorrow", "2026-10-17T08:00:00", "invalid"])
    await assert.rejects(client.sendDailyReview({ ...input, scheduledAt }));
  assert.equal(bodies.length, 2);
});

void test("Resend cancellation uses a fixed endpoint and validates email IDs and acknowledgement", async () => {
  let called = 0;
  const client = createResendClient(
    { apiKey: "fixture-key", from: "review@example.com" },
    async (url, init) => {
      called++;
      assert.equal(
        url,
        "https://api.resend.com/emails/email_fixture-id/cancel",
      );
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, undefined);
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer fixture-key",
      );
      return Response.json({ object: "email", id: "email_fixture-id" });
    },
  );
  assert.deepEqual(await client.cancelEmail("email_fixture-id"), {
    id: "email_fixture-id",
  });
  for (const id of [
    "",
    "with space",
    "with\nnewline",
    "../other",
    "..",
    "email?query",
    "x".repeat(257),
  ])
    await assert.rejects(client.cancelEmail(id));
  assert.equal(called, 1);
  const rejected = createResendClient(
    { apiKey: "fixture-key", from: "review@example.com" },
    async () =>
      Response.json({ message: "private provider detail" }, { status: 403 }),
  );
  await assert.rejects(
    rejected.cancelEmail("email-1"),
    (error: unknown) =>
      error instanceof IntegrationError &&
      error.message === "Queued email cancellation failed (HTTP 403).",
  );
  const wrongAcknowledgement = createResendClient(
    { apiKey: "fixture-key", from: "review@example.com" },
    async () => Response.json({ id: "other-email" }),
  );
  await assert.rejects(wrongAcknowledgement.cancelEmail("email-1"));
});

void test("cancellation retries recover a lost acknowledgement only from a matching canceled email", async () => {
  const calls: string[] = [];
  const client = createResendClient(
    { apiKey: "fixture-key", from: "review@example.com" },
    async (url, init) => {
      if (typeof url !== "string")
        throw new Error("Expected a fixed URL string.");
      calls.push(`${init?.method} ${url}`);
      return init?.method === "POST"
        ? Response.json({ message: "already canceled" }, { status: 400 })
        : Response.json({ id: "email-1", last_event: "canceled" });
    },
  );
  assert.deepEqual(await client.cancelEmail("email-1"), { id: "email-1" });
  assert.deepEqual(calls, [
    "POST https://api.resend.com/emails/email-1/cancel",
    "GET https://api.resend.com/emails/email-1",
  ]);
  for (const confirmation of [
    { id: "other-email", last_event: "canceled" },
    { id: "email-1", last_event: "scheduled" },
  ]) {
    const unconfirmed = createResendClient(
      { apiKey: "fixture-key", from: "review@example.com" },
      async (_url, init) =>
        init?.method === "POST"
          ? Response.json({ message: "provider detail" }, { status: 400 })
          : Response.json(confirmation),
    );
    await assert.rejects(unconfirmed.cancelEmail("email-1"), {
      message: "Queued email cancellation failed (HTTP 400).",
    });
  }
});

void test("production Plaid status requires a registered HTTPS OAuth redirect", () => {
  const credentials = {
    PLAID_CLIENT_ID: "present",
    PLAID_SECRET: "present",
    PLAID_ENV: "production",
    BANK_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  };
  const plaidStatus = (redirectUri?: string) =>
    integrationStatus({ ...credentials, PLAID_REDIRECT_URI: redirectUri }).find(
      (service) => service.name === "Plaid",
    )!;
  assert.equal(plaidStatus().status, "not configured");
  assert.match(plaidStatus().detail, /PLAID_REDIRECT_URI/);
  for (const redirect of [
    "http://localhost:3000/plaid/oauth",
    "https://caishen.example/plaid/oauth?next=1",
    "https://caishen.example/plaid/oauth#return",
  ])
    assert.equal(plaidStatus(redirect).status, "not configured");
  assert.equal(
    plaidStatus("https://caishen.example/plaid/oauth").status,
    "configured",
  );
});

void test("service status reports missing credentials and labels sandbox as test data", () => {
  const missing = integrationStatus({});
  assert.ok(missing.every((service) => service.status === "not configured"));
  assert.match(
    missing.find((service) => service.name === "Plaid")!.detail,
    /PLAID_CLIENT_ID/,
  );
  const sandbox = integrationStatus({
    PLAID_CLIENT_ID: "present",
    PLAID_SECRET: "present",
    PLAID_ENV: "sandbox",
    BANK_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  });
  assert.equal(
    sandbox.find((service) => service.name === "Plaid")!.status,
    "configured",
  );
  assert.match(
    sandbox.find((service) => service.name === "Plaid")!.detail,
    /test bank data/,
  );
  assert.ok(!JSON.stringify(sandbox).includes('"present"'));
});
