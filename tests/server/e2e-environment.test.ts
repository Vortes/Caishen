import assert from "node:assert/strict";
import test from "node:test";
import {
  developmentBranch,
  neonProjectId,
  productionBranchId,
} from "../../src/server/dev/development-database";
import { e2eEnvironment } from "../e2e/environment";

const isolated = {
  DATABASE_URL:
    "postgresql://user:pass@ep-odd-voice-b4sie2v1-pooler.c-6.us-east-2.aws.neon.tech/neondb",
  DATABASE_URL_UNPOOLED:
    "postgresql://user:pass@ep-odd-voice-b4sie2v1.c-6.us-east-2.aws.neon.tech/neondb",
  CLERK_SECRET_KEY: "sk_test_fixture",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_fixture",
};

void test("E2E setup accepts only the isolated database and a managed local app", () => {
  assert.deepEqual(e2eEnvironment(isolated), {
    baseURL: "http://localhost:3100",
    hostname: "localhost",
    port: "3100",
  });
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
    for (const url of [
      undefined,
      "postgresql://user:pass@ep-production.neon.tech/neondb",
      "postgresql://user:pass@ep-odd-voice-b4sie2v1-impostor.neon.tech/neondb",
      "postgresql://user:pass@ep-odd-voice-b4sie2v1.example.com/neondb",
      "postgresql://user:pass@localhost/neondb",
    ])
      assert.throws(() => e2eEnvironment({ ...isolated, [key]: url }));
  }
  assert.throws(() =>
    e2eEnvironment({
      ...isolated,
      DATABASE_URL_UNPOOLED: isolated.DATABASE_URL_UNPOOLED.replace(
        "neondb",
        "other",
      ),
    }),
  );
  for (const baseURL of [
    "https://caishen.app",
    "http://localhost",
    "http://localhost:3100/path",
    "http://localhost:3100?other=1",
    "http://user:pass@localhost:3100",
  ])
    assert.throws(() =>
      e2eEnvironment({ ...isolated, PLAYWRIGHT_BASE_URL: baseURL }),
    );
});

void test("E2E setup refuses live or missing Clerk keys and production environments", () => {
  for (const patch of [
    { CLERK_SECRET_KEY: "sk_live_fixture" },
    { CLERK_SECRET_KEY: undefined },
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_fixture" },
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: undefined },
    { NODE_ENV: "production" },
    { VERCEL_ENV: "production" },
  ])
    assert.throws(() => e2eEnvironment({ ...isolated, ...patch }));
});

void test("E2E setup accepts a worktree branch only when Neon confirms its dev-caishen parent", () => {
  const host = "ep-quiet-lake-a1b2c3d4.c-6.us-east-2.aws.neon.tech";
  const pooledHost = host.replace(".c-6", "-pooler.c-6");
  const worktree = {
    ...isolated,
    DATABASE_URL: `postgresql://user:pass@${pooledHost}/neondb`,
    DATABASE_URL_UNPOOLED: `postgresql://user:pass@${host}/neondb`,
    NEON_BRANCH: "dev-worktree-db",
  };
  const branch = {
    projectId: neonProjectId,
    hosts: [host, pooledHost],
    branchId: "br-child-a1b2c3d4",
    branchName: "dev-worktree-db",
    parentId: developmentBranch.id,
  };
  assert.equal(e2eEnvironment(worktree, () => branch).port, "3100");
  assert.throws(() =>
    e2eEnvironment(worktree, () => ({
      ...branch,
      parentId: productionBranchId,
    })),
  );
  assert.throws(() =>
    e2eEnvironment({ ...worktree, NEON_BRANCH: "production" }, () => branch),
  );
  assert.throws(() =>
    e2eEnvironment(
      { ...worktree, DATABASE_URL_UNPOOLED: undefined },
      () => branch,
    ),
  );
});
