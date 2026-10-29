import assert from "node:assert/strict";
import test, { after, afterEach, mock } from "node:test";

const originalSkipValidation = process.env.SKIP_ENV_VALIDATION;
process.env.SKIP_ENV_VALIDATION = "1";
const { db } = await import("../../src/server/db");
const { GET } = await import("../../src/app/api/jobs/daily/route");
if (originalSkipValidation === undefined)
  delete process.env.SKIP_ENV_VALIDATION;
else process.env.SKIP_ENV_VALIDATION = originalSkipValidation;
const originalFindMany = db.workspaceMember.findMany.bind(db.workspaceMember);
const originalConnections = db.bankConnection.findMany.bind(db.bankConnection);
const originalDeliveries = db.dailyDelivery.findMany.bind(db.dailyDelivery);
const originalPurge = db.bankProviderEvent.deleteMany.bind(
  db.bankProviderEvent,
);
const originalSecret = process.env.CRON_SECRET;
const secret = "scheduler-fixture-secret-32-characters";

after(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

afterEach(() => {
  Object.assign(db.workspaceMember, { findMany: originalFindMany });
  Object.assign(db.bankConnection, { findMany: originalConnections });
  Object.assign(db.dailyDelivery, { findMany: originalDeliveries });
  Object.assign(db.bankProviderEvent, { deleteMany: originalPurge });
});

function request(authorization?: string) {
  return new Request("https://caishen.example/api/jobs/daily", {
    headers: authorization ? { authorization } : {},
  });
}

void test("hosted jobs reject missing configuration and credentials before reading budgets", async () => {
  const members = mock.fn(() => {
    throw new Error("The database must not be queried before authorization.");
  });
  Object.assign(db.workspaceMember, { findMany: members });
  for (const invalidSecret of [undefined, "too-short"]) {
    if (invalidSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = invalidSecret;
    const response = await GET(request());
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  process.env.CRON_SECRET = secret;
  for (const authorization of [undefined, "Bearer wrong"]) {
    const response = await GET(request(authorization));
    assert.equal(response.status, 401);
  }
  assert.equal(members.mock.callCount(), 0);
});

void test("authorized hosted jobs return their result without caching", async () => {
  process.env.CRON_SECRET = secret;
  const members = mock.fn(async () => []);
  Object.assign(db.workspaceMember, { findMany: members });
  Object.assign(db.bankConnection, { findMany: async () => [] });
  Object.assign(db.dailyDelivery, { findMany: async () => [] });
  Object.assign(db.bankProviderEvent, {
    deleteMany: async () => ({ count: 0 }),
  });
  const response = await GET(request(`Bearer ${secret}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = (await response.json()) as Record<string, unknown>;
  assert.equal(result.processed, 0);
  assert.equal(result.failed, 0);
});

void test("daily work that completes with failures reports them in a successful invocation", async () => {
  process.env.CRON_SECRET = secret;
  const now = new Date();
  const members = mock.fn(async () => [
    {
      clerkUserId: "user_fixture",
      workspaceId: "workspace_fixture",
      createdAt: now,
      workspace: {
        id: "workspace_fixture",
        revision: 0,
        book: {},
        createdAt: now,
        updatedAt: now,
      },
    },
  ]);
  Object.assign(db.workspaceMember, { findMany: members });
  Object.assign(db.bankConnection, { findMany: async () => [] });
  Object.assign(db.dailyDelivery, { findMany: async () => [] });
  Object.assign(db.bankProviderEvent, {
    deleteMany: async () => ({ count: 0 }),
  });
  const response = await GET(request(`Bearer ${secret}`));
  assert.equal(response.status, 200);
  const result = (await response.json()) as Record<string, unknown>;
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 1);
});

void test("a run the database keeps from starting returns a non-cacheable 503", async () => {
  process.env.CRON_SECRET = secret;
  Object.assign(db.bankConnection, {
    findMany: async () => {
      throw new Error("database-fixture-error");
    },
  });
  Object.assign(db.dailyDelivery, { findMany: async () => [] });
  Object.assign(db.bankProviderEvent, {
    deleteMany: async () => ({ count: 0 }),
  });
  const response = await GET(request(`Bearer ${secret}`));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(await response.text(), /database-fixture-error/);
});
