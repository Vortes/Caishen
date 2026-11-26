import assert from "node:assert/strict";
import test from "node:test";
import { bookSchema, projectBook } from "../../src/domain/engine";
import {
  assertDevelopmentSeedEnvironment,
  developmentSeedIdentity,
} from "../../src/server/dev/seed-database";
import {
  buildDevelopmentSeed,
  developmentToday,
} from "../../src/server/dev/seed-scenarios";

const options = { userId: "alex", partnerId: "jordan", asOf: "2026-10-17" };
function seedFixture() {
  const seed = buildDevelopmentSeed(options);
  return {
    seed,
    primary: projectBook(seed.book, "alex", seed.month),
    partner: projectBook(seed.book, "jordan", seed.month),
  };
}

void test("development seeds repeat exactly and load as a valid budget", () => {
  const { seed } = seedFixture();
  assert.deepEqual(seed, buildDevelopmentSeed(options));
  assert.deepEqual(bookSchema.parse(seed.book), seed.book);
  assert.equal(seed.firstMonth, "2026-08");
});

void test("the development budget provides cash and credit accounts with email disabled", () => {
  const { primary, partner } = seedFixture();
  assert.ok(primary.accounts.some((account) => account.kind === "cash"));
  assert.ok(primary.accounts.some((account) => account.kind === "credit"));
  assert.equal(primary.budget.settings.emailEnabled, false);
  assert.equal(partner.budget.settings.emailEnabled, false);
});

void test("the development budget has expected income for this month and the next", () => {
  const { seed, primary, partner } = seedFixture();
  assert.equal(primary.expectedIncome, 650000);
  assert.equal(partner.expectedIncome, 570000);
  assert.equal(
    projectBook(seed.book, "alex", "2026-11").expectedIncome,
    650000,
  );
  assert.equal(
    projectBook(seed.book, "jordan", "2026-11").expectedIncome,
    570000,
  );
});

void test("the former-partner seed keeps the closed ledger and frees the partner slot", () => {
  const original = seedFixture().primary;
  const seed = buildDevelopmentSeed({ ...options, scenario: "former-partner" });
  const view = projectBook(seed.book, "alex", seed.month);
  assert.equal(view.members.length, 1);
  assert.equal(
    view.accounts.some((account) => account.linkedUserId),
    false,
  );
  const former = view.accounts.find(
    (account) => account.kind === "person" && account.closed,
  )!;
  assert.equal(former.name, "Jordan");
  assert.equal(former.closed?.by, "alex");
  assert.equal(
    former.balance,
    original.accounts.find((account) => account.linkedUserId)!.balance,
  );
  assert.ok(view.formerPartnerLedgers[former.id]!.length > 0);
  assert.equal(view.cash, original.cash);
  assert.equal(view.readyToAssign, original.readyToAssign);
});

void test("the development budget includes overspent categories", () => {
  const { primary } = seedFixture();
  assert.ok(
    primary.categories.find((category) => category.id === "health")!.available <
      0,
  );
  assert.ok(
    primary.categories.find((category) => category.id === "shopping")!
      .available < 0,
  );
});

void test("the development budget includes a snoozed target", () => {
  const { seed, primary } = seedFixture();
  assert.ok(
    primary.categories
      .find((category) => category.id === "travel")!
      .target?.snoozedMonths.includes(seed.month),
  );
});

void test("the development budget includes fixed and variable-rate loans", () => {
  const { primary } = seedFixture();
  assert.equal(
    primary.budget.loans.find((loan) => loan.id === "student")?.rates.length,
    2,
  );
  assert.equal(
    primary.budget.loans.find((loan) => loan.id === "personal")?.rates.length,
    1,
  );
});

void test("the development budget retains correction, merge and removal history", () => {
  const { primary } = seedFixture();
  assert.ok(
    primary.audit.some(
      (entry) => entry.type === "cover" && entry.source === "user",
    ),
  );
  assert.equal(
    primary.budget.transactions.find(
      (transaction) => transaction.id === "restaurant-updated",
    )?.history.length,
    2,
  );
  assert.equal(
    primary.budget.transactions
      .find((transaction) => transaction.id === "duplicate-original")
      ?.history.at(-1)?.reason,
    "merged",
  );
  assert.equal(
    primary.budget.transactions.find(
      (transaction) => transaction.id === "voided-charge",
    )?.removed,
    true,
  );
});

void test("the development budget has no purchases waiting for category approval", () => {
  const { primary, partner } = seedFixture();
  for (const view of [primary, partner])
    assert.equal(
      view.budget.transactions.filter(
        (transaction) => !transaction.removed && !transaction.reviewed,
      ).length,
      0,
    );
});

void test("the development budget includes pending income and agent categorization", () => {
  const { primary } = seedFixture();
  assert.ok(
    primary.budget.transactions.some(
      (transaction) =>
        transaction.amount > 0 && transaction.status === "pending",
    ),
  );
  assert.ok(
    primary.audit.some(
      (entry) =>
        entry.type === "transaction.upsert" && entry.source === "agent",
    ),
  );
});

void test("the development budget keeps unrelated partner purchases private", () => {
  const { partner } = seedFixture();
  assert.ok(!JSON.stringify(partner).includes("Cedar Labs · conference hotel"));
});

void test("the development budget carries savings forward without carrying cash overspending", () => {
  const { seed } = seedFixture();
  const nextMonth = projectBook(seed.book, "alex", "2026-11");
  assert.ok(
    nextMonth.categories.find((category) => category.id === "emergency")!
      .available > 0,
  );
  assert.equal(
    nextMonth.categories.find((category) => category.id === "health")!
      .available,
    0,
  );
});

void test("seed dates work at month/year boundaries and never create future activity", () => {
  for (const asOf of ["2026-01-01", "2026-02-28", "2028-02-29", "2026-10-17"]) {
    const seed = buildDevelopmentSeed({
      userId: "alex",
      partnerId: "jordan",
      asOf,
    });
    for (const budget of Object.values(seed.book.budgets))
      assert.ok(
        budget.transactions.every((transaction) => transaction.date <= asOf),
      );
    assert.doesNotThrow(() => projectBook(seed.book, "alex", seed.month));
  }
  assert.equal(
    developmentToday(new Date("2026-10-18T01:00:00Z")),
    "2026-10-17",
  );
  assert.throws(
    () => buildDevelopmentSeed({ userId: "same", partnerId: "same" }),
    /different participants/,
  );
  assert.throws(
    () =>
      buildDevelopmentSeed({
        userId: "alex",
        partnerId: "jordan",
        asOf: "2026-02-30",
      }),
    /valid/,
  );
});

void test("seeding rejects production, lookalike endpoints, and live auth keys", () => {
  const neon = {
    NEON_PROJECT_ID: "calm-meadow-12345678",
    NEON_DEVELOPMENT_BRANCH_ID: "br-still-pond-a1b2c3d4",
    NEON_DEVELOPMENT_ENDPOINT_ID: "ep-still-pond-a1b2c3d4",
    NEON_PRODUCTION_BRANCH_ID: "br-tall-pine-a1b2c3d4",
  };
  const development = {
    ...neon,
    DATABASE_URL:
      "postgresql://user:pass@ep-still-pond-a1b2c3d4-pooler.us-east-1.aws.neon.tech/db",
  };
  assert.doesNotThrow(() => assertDevelopmentSeedEnvironment(development));
  assert.doesNotThrow(() =>
    assertDevelopmentSeedEnvironment({
      DATABASE_URL: "postgresql://user:pass@localhost/db",
    }),
  );
  const worktree = {
    ...neon,
    DATABASE_URL:
      "postgresql://user:pass@ep-quiet-lake-a1b2c3d4-pooler.us-east-1.aws.neon.tech/db",
    NEON_BRANCH: "dev-worktree-db",
  };
  const child = {
    projectId: neon.NEON_PROJECT_ID,
    hosts: ["ep-quiet-lake-a1b2c3d4-pooler.us-east-1.aws.neon.tech"],
    branchId: "br-child-a1b2c3d4",
    branchName: "dev-worktree-db",
    parentId: neon.NEON_DEVELOPMENT_BRANCH_ID,
  };
  assert.doesNotThrow(() =>
    assertDevelopmentSeedEnvironment(worktree, () => child),
  );
  assert.throws(() =>
    assertDevelopmentSeedEnvironment(worktree, () => ({
      ...child,
      parentId: null,
    })),
  );
  for (const env of [
    { ...development, NODE_ENV: "production" },
    { ...development, VERCEL_ENV: "production" },
    { ...development, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_example" },
    { ...development, CLERK_SECRET_KEY: "sk_live_example" },
    {
      ...neon,
      DATABASE_URL:
        "postgresql://user:pass@ep-production.us-east-1.aws.neon.tech/db",
    },
    {
      ...neon,
      DATABASE_URL:
        "postgresql://user:pass@ep-still-pond-a1b2c3d4.evil.example/db",
    },
    {
      ...neon,
      DATABASE_URL:
        "postgresql://user:pass@ep-still-pond-a1b2c3d4-extra.us-east-1.aws.neon.tech/db",
    },
  ])
    assert.throws(() => assertDevelopmentSeedEnvironment(env));
  assert.equal(
    developmentSeedIdentity("alex", "jordan").workspaceId,
    developmentSeedIdentity("jordan", "alex").workspaceId,
  );
  assert.equal(
    developmentSeedIdentity("alex").partnerId,
    developmentSeedIdentity("alex").partnerId,
  );
});
