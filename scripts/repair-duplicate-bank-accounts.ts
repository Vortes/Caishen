import { parseArgs } from "node:util";
import { PrismaClient } from "../src/generated/prisma";
import {
  assertDevelopmentDatabase,
  neonEndpointBranch,
  neonEndpointId,
  neonProjectId,
  productionBranchId,
} from "../src/server/dev/development-database";
import {
  previewDuplicateBankRepair,
  repairDuplicateBankAccounts,
} from "../src/server/services/banks";

const usage = `Preview unused duplicate bank accounts without changing data:
  node --env-file=.env.local --import tsx scripts/repair-duplicate-bank-accounts.ts \\
    --user USER_ID --retired CONNECTION_ID --replacement CONNECTION_ID

Same-Item mode (two provider accounts on one connection):
  node --env-file=.env.local --import tsx scripts/repair-duplicate-bank-accounts.ts \\
    --user USER_ID --connection CONNECTION_ID \\
    --keep-provider PROVIDER_ACCOUNT_ID --remove-provider PROVIDER_ACCOUNT_ID

Apply exactly the reviewed preview:
  Add --apply --plan-hash HASH --operation-id UUID

Production requires --production and a DATABASE_URL verified against the
configured production Neon branch. No database credentials are printed.
The command keeps original budget accounts, removes only unused duplicates,
and revokes the retired Plaid Item only in the two-connection mode.
Same-Item mode retires the removed provider account without revoking the Item;
it preserves every import and all history on the kept budget account.
Transaction, reconciliation, assignment, and review conflicts on the removed
account require manual resolution. Retry the same operation ID
after a network failure; re-preview if the budget or connections changed.`;

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean" },
      apply: { type: "boolean" },
      production: { type: "boolean" },
      user: { type: "string" },
      retired: { type: "string" },
      replacement: { type: "string" },
      connection: { type: "string" },
      "keep-provider": { type: "string" },
      "remove-provider": { type: "string" },
      "plan-hash": { type: "string" },
      "operation-id": { type: "string" },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const sameItem =
    values.connection ?? values["keep-provider"] ?? values["remove-provider"];
  if (
    !values.user ||
    (sameItem
      ? !values.connection ||
        !values["keep-provider"] ||
        !values["remove-provider"] ||
        values.retired ||
        values.replacement
      : !values.retired || !values.replacement)
  )
    throw new Error(usage);
  if (values.apply && (!values["plan-hash"] || !values["operation-id"]))
    throw new Error(
      "Applying requires the preview's --plan-hash and a stable --operation-id UUID.",
    );
  if (!values.apply && (values["plan-hash"] || values["operation-id"]))
    throw new Error(
      "Use --apply with a plan hash and operation ID, or omit all three to preview.",
    );
  if (values.production) {
    const { endpointId } = neonEndpointId(process.env.DATABASE_URL ?? "");
    const endpoint = neonEndpointBranch(endpointId);
    if (
      endpoint.projectId !== neonProjectId ||
      endpoint.branchId !== productionBranchId
    )
      throw new Error(
        "--production requires this project's production database.",
      );
    if (process.env.PLAID_ENV !== "production")
      throw new Error(
        "Production repair requires production Plaid credentials.",
      );
  } else assertDevelopmentDatabase(process.env);
  const db = new PrismaClient();
  try {
    const selection = sameItem
      ? {
          connectionId: values.connection!,
          keepProviderAccountId: values["keep-provider"]!,
          removeProviderAccountId: values["remove-provider"]!,
        }
      : {
          retiredConnectionId: values.retired!,
          replacementConnectionId: values.replacement!,
        };
    if (!values.apply) {
      console.log(
        JSON.stringify(
          {
            mode: "preview",
            ...(await previewDuplicateBankRepair(db, values.user, selection)),
          },
          null,
          2,
        ),
      );
      return;
    }
    const result = await repairDuplicateBankAccounts(db, values.user, {
      ...selection,
      expectedPlanHash: values["plan-hash"]!,
      operationId: values["operation-id"]!,
    });
    console.log(
      JSON.stringify({
        mode: "applied",
        revision: result.revision,
        operationId: values["operation-id"],
      }),
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Duplicate repair failed.",
  );
  process.exitCode = 1;
});
