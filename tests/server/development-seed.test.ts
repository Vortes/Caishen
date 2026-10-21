import assert from "node:assert/strict";
import test from "node:test";
import { bookSchema, projectBook } from "../../src/domain/engine";
import {
  assertDevelopmentSeedEnvironment,
  developmentSeedIdentity,
} from "../../src/server/dev/seed-database";
import {
  developmentBranch,
  neonProjectId,
} from "../../src/server/dev/development-database";
import {
  buildDevelopmentSeed,
  buildSeedStatements,
  developmentToday,
} from "../../src/server/dev/seed-scenarios";
import {
  parseStatementCsv,
  savedReconciliationResult,
} from "../../src/server/integrations/reconciliation";

void test("development seeds are deterministic and preserve accounting and privacy rules", () => {
  const options = { userId: "alex", partnerId: "jordan", asOf: "2026-10-17" };
  const seed = buildDevelopmentSeed(options);
  assert.deepEqual(seed, buildDevelopmentSeed(options));
  assert.deepEqual(bookSchema.parse(seed.book), seed.book);
  assert.equal(seed.firstMonth, "2026-08");
  const primary = projectBook(seed.book, "alex", seed.month);
  const partner = projectBook(seed.book, "jordan", seed.month);
  assert.ok(primary.accounts.some((account) => account.kind === "cash"));
  assert.ok(primary.accounts.some((account) => account.kind === "credit"));
  assert.equal(primary.budget.settings.emailEnabled, false);
  assert.equal(partner.budget.settings.emailEnabled, false);
  assert.equal(primary.settlement.net, -partner.settlement.net);
  assert.ok(primary.settlement.net > 25000);
  assert.equal(primary.sharedStatement.balance, primary.settlement.net);
  assert.equal(partner.sharedStatement.balance, partner.settlement.net);
  assert.equal(primary.sharedStatement.repayments.length, 2);
  assert.equal(partner.sharedStatement.awaitingYourConfirmation.length, 1);
  assert.equal(primary.sharedStatement.awaitingYourConfirmation.length, 1);
  assert.equal(
    primary.reimbursements.find((claim) => claim.id === "work-hotel")
      ?.outstanding,
    28000,
  );
  assert.equal(
    primary.reimbursements.find((claim) => claim.id === "work-train")
      ?.outstanding,
    0,
  );
  assert.equal(
    primary.reimbursements.find((claim) => claim.id === "amex-offer")
      ?.outstanding,
    1500,
  );
  assert.ok(
    primary.categories.find((category) => category.id === "health")!.available <
      0,
  );
  assert.ok(
    primary.categories.find((category) => category.id === "shopping")!
      .available < 0,
  );
  assert.ok(
    primary.categories
      .find((category) => category.id === "travel")!
      .target?.snoozedMonths.includes(seed.month),
  );
  assert.equal(
    primary.budget.loans.find((loan) => loan.id === "student")?.rates.length,
    2,
  );
  assert.equal(
    primary.budget.loans.find((loan) => loan.id === "personal")?.rates.length,
    1,
  );
  assert.ok(
    primary.audit.some(
      (entry) => entry.type === "cover" && entry.source === "agent",
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
  for (const view of [primary, partner])
    assert.equal(
      view.budget.transactions.filter(
        (transaction) => !transaction.removed && !transaction.reviewed,
      ).length,
      0,
    );
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
  assert.deepEqual(
    primary.sharedStatement.categories.find(
      (category) => category.sharedCategoryId === "weekend",
    )?.purchases,
    [],
  );
  assert.ok(!JSON.stringify(partner).includes("Cedar Labs · conference hotel"));
  const nextMonth = projectBook(seed.book, "alex", "2026-11");
  assert.equal(nextMonth.settlement.net, primary.settlement.net);
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

void test("statement fixtures include valid matching evidence and unexplained charges without adjustments", () => {
  const seed = buildDevelopmentSeed({
    userId: "alex",
    partnerId: "jordan",
    asOf: "2026-10-17",
  });
  const before = structuredClone(seed.book);
  const statements = buildSeedStatements(seed);
  assert.equal(statements.length, 6);
  for (const statement of statements) {
    assert.deepEqual(
      parseStatementCsv(statement.csv),
      statement.evidence.activity,
    );
    assert.equal(
      statement.result.status,
      statement.accountId === "checking" ? "discrepancy" : "reconciled",
    );
    assert.equal(
      statement.result.differenceCents,
      statement.accountId === "checking" ? -3499 : 0,
    );
    assert.equal(
      savedReconciliationResult(statement.result, { revision: 1 }, 2).status,
      "insufficient_evidence",
    );
  }
  assert.deepEqual(seed.book, before);
});

void test("seeding rejects production, lookalike endpoints, and live auth keys", () => {
  const development = {
    DATABASE_URL:
      "postgresql://user:pass@ep-odd-voice-b4sie2v1-pooler.us-east-1.aws.neon.tech/db",
  };
  assert.doesNotThrow(() => assertDevelopmentSeedEnvironment(development));
  assert.doesNotThrow(() =>
    assertDevelopmentSeedEnvironment({
      DATABASE_URL: "postgresql://user:pass@localhost/db",
    }),
  );
  const worktree = {
    DATABASE_URL:
      "postgresql://user:pass@ep-quiet-lake-a1b2c3d4-pooler.us-east-1.aws.neon.tech/db",
    NEON_BRANCH: "dev-worktree-db",
  };
  const child = {
    projectId: neonProjectId,
    hosts: ["ep-quiet-lake-a1b2c3d4-pooler.us-east-1.aws.neon.tech"],
    branchId: "br-child-a1b2c3d4",
    branchName: "dev-worktree-db",
    parentId: developmentBranch.id,
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
      DATABASE_URL:
        "postgresql://user:pass@ep-production.us-east-1.aws.neon.tech/db",
    },
    {
      DATABASE_URL:
        "postgresql://user:pass@ep-odd-voice-b4sie2v1.evil.example/db",
    },
    {
      DATABASE_URL:
        "postgresql://user:pass@ep-odd-voice-b4sie2v1-extra.us-east-1.aws.neon.tech/db",
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
