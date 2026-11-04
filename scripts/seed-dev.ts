import { parseArgs } from "node:util";
import { PrismaClient } from "../src/generated/prisma";
import { projectBook } from "../src/domain/engine";
import {
  assertDevelopmentSeedEnvironment,
  developmentSeedIdentity,
  restoreDevelopmentWorkspace,
  seedDevelopmentDatabase,
} from "../src/server/dev/seed-database";
import {
  buildDevelopmentSeed,
  developmentSeedScenarios,
  developmentToday,
  soloSeedScenario,
} from "../src/server/dev/seed-scenarios";
import { buildDevelopmentSeedBanks } from "../src/server/dev/seed-banks";

const { values } = parseArgs({
  options: {
    user: { type: "string" },
    partner: { type: "string" },
    date: { type: "string" },
    scenario: { type: "string" },
    activate: { type: "boolean" },
    reset: { type: "boolean" },
    "dry-run": { type: "boolean" },
    restore: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

async function main() {
  if (values.help) {
    console.log(`Usage: npm run db:seed -- --user <development Clerk user ID> [options]

--partner <ID>   Use a second development login; defaults to a database-only mock partner
--date YYYY-MM-DD  End the three-month sample on this date (defaults to today in Los Angeles)
--scenario <name>  household (default), simple, invitation, or former-partner
--dry-run        Validate the scenarios and print a summary without database writes
--activate       Switch the selected login to the demo workspace; retain its original workspace
--reset          Rebuild only this seed's demo workspace after trying features
--restore <ID>   Switch your login back to the original workspace ID printed during activation

The simple preset is one month with five categories and five of Jordan's purchases, no banks or loans.
The invitation preset shows a pending invitation after a previous partnership.
Bank connections contain offline sample data. No external bank requests or emails are sent.
Solo presets use a mock former partner; --partner is for the household and simple presets.
Existing seed data is left intact unless --reset is supplied.`);
    return;
  }
  assertDevelopmentSeedEnvironment(process.env);
  const userId = values.user ?? process.env.DEV_SEED_USER_ID;
  if (!userId)
    throw new Error(
      "Provide --user <your development Clerk user ID> or set DEV_SEED_USER_ID.",
    );
  const scenario = developmentSeedScenarios.find(
    (scenario) => scenario === values.scenario,
  );
  if (values.scenario !== undefined && !scenario)
    throw new Error(
      `Choose --scenario ${developmentSeedScenarios.join(", ")}.`,
    );
  if (
    values.restore &&
    (values.reset ||
      values.activate ||
      values["dry-run"] ||
      values.date ||
      values.scenario)
  )
    throw new Error(
      "Use --restore on its own with --user and, if needed, --partner.",
    );
  const identity = developmentSeedIdentity(
    userId,
    values.partner ??
      (process.env.DEV_SEED_PARTNER_ID === ""
        ? undefined
        : process.env.DEV_SEED_PARTNER_ID),
  );
  if (
    scenario &&
    soloSeedScenario(scenario) &&
    identity.partnerId !== developmentSeedIdentity(userId).partnerId
  )
    throw new Error(
      "Solo scenarios use a mock former partner. Omit --partner.",
    );
  const asOf = values.date ?? developmentToday();
  if (asOf > developmentToday())
    throw new Error("Seed activity cannot be dated in the future.");
  if (values["dry-run"]) {
    const seed = buildDevelopmentSeed({ ...identity, asOf, scenario });
    const banks =
      seed.scenario === "simple"
        ? []
        : buildDevelopmentSeedBanks(seed, identity.workspaceId);
    console.log(
      JSON.stringify(
        {
          ...summary(seed),
          bankConnections: banks.map(({ data, imports }) => ({
            institution: data.imports.institutionName,
            status: data.status,
            linkedAccounts: data.bankAccounts.create.filter(
              (account) => account.link,
            ).length,
            unresolvedMatches: imports.records.filter(
              (record) => record.matchStatus === "needs_review",
            ).length,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }
  const db = new PrismaClient();
  try {
    if (values.restore) {
      console.log(
        JSON.stringify(
          await restoreDevelopmentWorkspace(
            db,
            userId,
            values.restore,
            identity.partnerId,
          ),
          null,
          2,
        ),
      );
      return;
    }
    const result = await seedDevelopmentDatabase(db, {
      ...identity,
      asOf,
      activate: values.activate,
      reset: values.reset,
      scenario,
    });
    console.log(
      JSON.stringify(
        {
          workspaceId: result.workspaceId,
          revision: result.revision,
          status: result.skipped
            ? "Already seeded; existing demo activity retained"
            : "Seeded",
          previousWorkspaces: result.previousWorkspaces,
          invitationPath: result.invitationPath,
          ...summary(result.seed, !result.skipped),
        },
        null,
        2,
      ),
    );
    for (const original of result.previousWorkspaces)
      console.log(
        `Restore ${original.userId}: npm run db:seed -- --user ${original.userId} --restore ${original.workspaceId}${original.userId !== userId || values.partner || process.env.DEV_SEED_PARTNER_ID ? ` --partner ${original.userId === userId ? identity.partnerId : userId}` : ""}`,
      );
  } finally {
    await db.$disconnect();
  }
}

function summary(
  seed: ReturnType<typeof buildDevelopmentSeed>,
  includeOperations = true,
) {
  return {
    scenario: seed.scenario,
    from: seed.firstMonth,
    through: seed.asOf,
    ...(includeOperations ? { operations: seed.operations.length } : {}),
    budgets: Object.keys(seed.book.budgets).map((userId) => {
      const view = projectBook(seed.book, userId, seed.month);
      return {
        userId,
        name: view.budget.name,
        accounts: view.accounts.length,
        categories: view.categories.length,
        transactions: view.budget.transactions.length,
        loans: view.loans.length,
        expectedIncomeCents: view.expectedIncome,
        formerPartners: view.accounts.filter(
          (account) => account.kind === "person" && account.closed,
        ).length,
        needsReview: view.budget.transactions.filter(
          (transaction) => !transaction.removed && !transaction.reviewed,
        ).length,
        // Positive: the partner owes this budget.
        partnerBalanceCents: view.accounts.find(
          (account) => account.linkedUserId && !account.closed,
        )?.balance,
        overspentCategoriesCents: Object.fromEntries(
          view.categories
            .filter((category) => category.available < 0)
            .map((category) => [category.name, category.available]),
        ),
      };
    }),
  };
}

main().catch((failure: unknown) => {
  console.error(
    failure instanceof Error ? failure.message : "Development seed failed.",
  );
  process.exitCode = 1;
});
