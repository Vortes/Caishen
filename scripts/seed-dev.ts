import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  buildSeedStatements,
  developmentToday,
} from "../src/server/dev/seed-scenarios";

const { values } = parseArgs({
  options: {
    user: { type: "string" },
    partner: { type: "string" },
    date: { type: "string" },
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
--dry-run        Validate the scenarios and print a summary without database writes
--activate       Switch the selected login to the demo workspace; retain its original workspace
--reset          Rebuild only this seed's demo workspace after trying features
--restore <ID>   Switch your login back to the original workspace ID printed during activation

Seed accounts contain mock activity. No external bank requests or emails are sent.
Existing seed data is left intact unless --reset is supplied.`);
    return;
  }
  assertDevelopmentSeedEnvironment(process.env);
  const userId = values.user ?? process.env.DEV_SEED_USER_ID;
  if (!userId)
    throw new Error(
      "Provide --user <your development Clerk user ID> or set DEV_SEED_USER_ID.",
    );
  if (
    values.restore &&
    (values.reset || values.activate || values["dry-run"] || values.date)
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
  const asOf = values.date ?? developmentToday();
  if (asOf > developmentToday())
    throw new Error("Seed activity cannot be dated in the future.");
  if (values["dry-run"]) {
    const seed = buildDevelopmentSeed({ ...identity, asOf });
    console.log(JSON.stringify(summary(seed), null, 2));
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
          ...summary(result.seed),
        },
        null,
        2,
      ),
    );
    if (result.skipped) return;
    const directory = resolve(".next/cache/dev-seed", result.workspaceId);
    await mkdir(directory, { recursive: true });
    const statements = buildSeedStatements(result.seed);
    for (const statement of statements) {
      const role = statement.userId === userId ? "you" : "partner";
      await writeFile(
        resolve(
          directory,
          `${role}-${statement.accountId}-${statement.result.status}.csv`,
        ),
        statement.csv,
      );
      await writeFile(
        resolve(directory, `${role}-${statement.accountId}-matched.csv`),
        [
          "Date,Description,Amount",
          ...statement.ledger.activity.map(
            (activity) =>
              `${activity.date},"${activity.description.replaceAll('"', '""')}",${(activity.amountCents / 100).toFixed(2)}`,
          ),
        ].join("\n") + "\n",
      );
    }
    await writeFile(
      resolve(directory, "statement-balances.json"),
      JSON.stringify(
        statements.map(
          ({
            userId: ownerId,
            accountId,
            ledger,
            evidence,
            result: comparison,
          }) => ({
            userId: ownerId,
            accountId,
            periodStart: ledger.periodStart,
            cutoff: ledger.cutoff,
            openingBalanceCents: ledger.openingBalanceCents,
            matchedClosingBalanceCents: ledger.closingBalanceCents,
            statementClosingBalanceCents: evidence.closingBalanceCents,
            status: comparison.status,
          }),
        ),
        null,
        2,
      ) + "\n",
    );
    await writeFile(
      resolve(directory, "ynab-categories.csv"),
      "Category Group,Category\nHome,Water & sewer\nTrue expenses,Pet care\nGoals,New bicycle\n",
    );
    console.log(`Statement and category-import fixtures: ${directory}`);
    for (const original of result.previousWorkspaces)
      console.log(
        `Restore ${original.userId}: npm run db:seed -- --user ${original.userId} --restore ${original.workspaceId}${original.userId !== userId || values.partner || process.env.DEV_SEED_PARTNER_ID ? ` --partner ${original.userId === userId ? identity.partnerId : userId}` : ""}`,
      );
  } finally {
    await db.$disconnect();
  }
}

function summary(seed: ReturnType<typeof buildDevelopmentSeed>) {
  return {
    from: seed.firstMonth,
    through: seed.asOf,
    operations: seed.book.audit.length,
    budgets: [seed.userId, seed.partnerId].map((userId) => {
      const view = projectBook(seed.book, userId, seed.month);
      return {
        userId,
        name: view.budget.name,
        accounts: view.accounts.length,
        categories: view.categories.length,
        transactions: view.budget.transactions.length,
        loans: view.loans.length,
        needsReview: view.budget.transactions.filter(
          (transaction) => !transaction.removed && !transaction.reviewed,
        ).length,
        outstandingSharedCents: view.settlement.net,
        overspentCategories: view.categories
          .filter((category) => category.available < 0)
          .map((category) => category.name),
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
