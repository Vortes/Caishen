import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDevelopmentDatabase,
  neonDevelopment,
  setEnvValues,
  worktreeBranchName,
  type EndpointBranch,
} from "../../src/server/dev/development-database";

const neon = {
  NEON_PROJECT_ID: "calm-meadow-12345678",
  NEON_DEVELOPMENT_BRANCH_ID: "br-still-pond-a1b2c3d4",
  NEON_DEVELOPMENT_ENDPOINT_ID: "ep-still-pond-a1b2c3d4",
  NEON_PRODUCTION_BRANCH_ID: "br-tall-pine-a1b2c3d4",
};
const developmentHost = "ep-still-pond-a1b2c3d4.c-6.us-east-2.aws.neon.tech";
const host = "ep-quiet-lake-a1b2c3d4.c-6.us-east-2.aws.neon.tech";
const pooledHost = "ep-quiet-lake-a1b2c3d4-pooler.c-6.us-east-2.aws.neon.tech";
const worktree = {
  ...neon,
  DATABASE_URL: `postgresql://user:pass@${pooledHost}/neondb`,
  DATABASE_URL_UNPOOLED: `postgresql://user:pass@${host}/neondb`,
  NEON_BRANCH: "dev-plan-storage",
};
const child: EndpointBranch = {
  projectId: neon.NEON_PROJECT_ID,
  hosts: [host, pooledHost],
  branchId: "br-child-a1b2c3d4",
  branchName: "dev-plan-storage",
  parentId: neon.NEON_DEVELOPMENT_BRANCH_ID,
};
const lookupOf =
  (branch: EndpointBranch) => (endpointId: string, projectId: string) => {
    assert.equal(endpointId, "ep-quiet-lake-a1b2c3d4");
    assert.equal(projectId, neon.NEON_PROJECT_ID);
    return branch;
  };
const unreachable = () => {
  throw new Error("Neon must not be consulted.");
};

void test("dev-caishen is accepted by endpoint without consulting Neon", () => {
  assert.equal(
    assertDevelopmentDatabase(
      {
        ...neon,
        DATABASE_URL: `postgresql://user:pass@${developmentHost.replace(".c-6", "-pooler.c-6")}/neondb`,
      },
      unreachable,
    ),
    "dev-caishen",
  );
});

void test("the Neon project is the one the environment names, and every id must be present and well formed", () => {
  assert.deepEqual(neonDevelopment(neon), {
    projectId: "calm-meadow-12345678",
    developmentBranch: {
      id: "br-still-pond-a1b2c3d4",
      name: "dev-caishen",
      endpointId: "ep-still-pond-a1b2c3d4",
    },
    productionBranchId: "br-tall-pine-a1b2c3d4",
  });
  for (const key of Object.keys(neon))
    for (const value of [undefined, "", "../branches", "BR-UPPER"])
      assert.throws(
        () => neonDevelopment({ ...neon, [key]: value }),
        (error: Error) =>
          error.message.includes(key) && error.message.includes(".env.example"),
      );
  assert.throws(
    () =>
      neonDevelopment({
        ...neon,
        NEON_DEVELOPMENT_BRANCH_ID: neon.NEON_PRODUCTION_BRANCH_ID,
      }),
    /production branch/,
  );
});

void test("a Neon database is refused until its project is named, and a local one never needs it", () => {
  assert.throws(
    () =>
      assertDevelopmentDatabase(
        { ...worktree, NEON_PROJECT_ID: undefined },
        unreachable,
      ),
    /NEON_PROJECT_ID/,
  );
  assert.equal(
    assertDevelopmentDatabase(
      { DATABASE_URL: "postgresql://user:pass@localhost/caishen" },
      unreachable,
    ),
    "local",
  );
});

void test("a worktree branch is accepted only when Neon confirms it is a named child of dev-caishen", () => {
  assert.equal(
    assertDevelopmentDatabase(worktree, lookupOf(child)),
    "dev-plan-storage",
  );
  for (const branch of [
    { ...child, parentId: neon.NEON_PRODUCTION_BRANCH_ID },
    { ...child, parentId: null },
    { ...child, parentId: "br-other-a1b2c3d4" },
    { ...child, branchId: neon.NEON_PRODUCTION_BRANCH_ID },
    { ...child, branchName: "dev-renamed" },
    { ...child, projectId: "other-project-123" },
    { ...child, hosts: [host] },
  ])
    assert.throws(() => assertDevelopmentDatabase(worktree, lookupOf(branch)));
});

void test("production, lookalikes, and unnamed branches are refused before any lookup", () => {
  for (const patch of [
    { NEON_BRANCH: undefined },
    { NEON_BRANCH: "production" },
    { NEON_BRANCH: "dev-caishen" },
    { NEON_BRANCH: "dev-" },
    { NEON_BRANCH: "review-plan-storage" },
    { NODE_ENV: "production" },
    { VERCEL_ENV: "production" },
    { DATABASE_URL: undefined },
    { DATABASE_URL: "postgresql://user:pass@localhost/neondb" },
    { DATABASE_URL: `postgresql://user:pass@${host}.example.com/neondb` },
    { DATABASE_URL: `mysql://user:pass@${host}/neondb` },
    {
      DATABASE_URL_UNPOOLED: `postgresql://user:pass@${developmentHost}/neondb`,
    },
  ])
    assert.throws(
      () => assertDevelopmentDatabase({ ...worktree, ...patch }, unreachable),
      (error: Error) => !error.message.includes("must not be consulted"),
    );
});

void test("worktree branch names are slugs of the git branch and never dev-caishen", () => {
  assert.equal(worktreeBranchName("worktree-db"), "dev-worktree-db");
  assert.equal(
    worktreeBranchName("Feature/Plan Storage__v2"),
    "dev-feature-plan-storage-v2",
  );
  assert.equal(worktreeBranchName("x".repeat(80)).length, 64);
  for (const name of ["caishen", "Caishen", "///", ""])
    assert.throws(() => worktreeBranchName(name));
});

void test("env updates replace only the named keys and keep everything else", () => {
  const original = [
    'DATABASE_URL="old-pooled"',
    "DATABASE_URL_UNPOOLED=old-direct",
    'NEON_BRANCH="dev-caishen"',
    "",
    "# Clerk",
    "CLERK_SECRET_KEY=sk_test_x # keep",
    "DATABASE_URL=duplicate",
    "",
  ].join("\n");
  assert.equal(
    setEnvValues(original, {
      DATABASE_URL: "postgresql://a",
      DATABASE_URL_UNPOOLED: "postgresql://b",
      NEON_BRANCH: "dev-worktree-db",
    }),
    [
      'DATABASE_URL="postgresql://a"',
      'DATABASE_URL_UNPOOLED="postgresql://b"',
      'NEON_BRANCH="dev-worktree-db"',
      "",
      "# Clerk",
      "CLERK_SECRET_KEY=sk_test_x # keep",
      "",
    ].join("\n"),
  );
  assert.equal(
    setEnvValues("CLERK_SECRET_KEY=x", { NEON_BRANCH: "dev-a" }),
    'CLERK_SECRET_KEY=x\nNEON_BRANCH="dev-a"\n',
  );
});
