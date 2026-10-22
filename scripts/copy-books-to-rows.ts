import { parseArgs } from "node:util";
import { PrismaClient } from "../src/generated/prisma";
import {
  copyHousehold,
  verifyHousehold,
  type CopyProblem,
} from "../src/server/storage/book-copy";

const usage = `Usage: npm run db:rows:copy -- [--verify-only] [--workspace <id>...]

Copies every household's stored book (Workspace.book), its members' bank
import state (BankConnection.imports), and its recorded operations into the
row tables (ADR 0006), then verifies the copy: every month view of every
budget from its start month to its latest month, built from the rows (whole
and as each partner's browser holds them), must equal the view built from the
stored book to the cent, and every loan, reimbursement, obligation, settlement,
shared category, bank import, and operation must match record by record.

Rows are written at the household's current revision. Running it again
changes nothing unless a stored book changed since; then that household's
rows are replaced. Do not run it once the app writes rows instead of books.

--verify-only     Compare without copying.
--workspace <id>  Only these households (repeatable).

Exits with status 1 when any household can't be read or any check fails.`;

const { values } = parseArgs({
  options: {
    "verify-only": { type: "boolean" },
    workspace: { type: "string", multiple: true },
    help: { type: "boolean", short: "h" },
  },
});

async function main() {
  if (values.help) {
    console.log(usage);
    return;
  }
  const db = new PrismaClient();
  try {
    const workspaceIds = values.workspace?.length
      ? values.workspace
      : (
          await db.workspace.findMany({
            select: { id: true },
            orderBy: { createdAt: "asc" },
          })
        ).map((workspace) => workspace.id);
    const currentMonth = new Date().toISOString().slice(0, 7);
    const problems: CopyProblem[] = [];
    const totals = {
      households: workspaceIds.length,
      copied: 0,
      unchanged: 0,
      rows: 0,
      operations: 0,
      budgets: 0,
      monthViews: 0,
      records: 0,
      mismatches: 0,
      rowsByTable: {} as Record<string, number>,
    };
    for (const workspaceId of workspaceIds) {
      if (!values["verify-only"]) {
        const copied = await copyHousehold(db, workspaceId);
        if ("problem" in copied) {
          problems.push(copied);
          continue;
        }
        totals[copied.status]++;
        totals.operations += copied.operations;
      }
      const verified = await verifyHousehold(db, workspaceId, currentMonth);
      if ("problem" in verified) {
        problems.push(verified);
        continue;
      }
      totals.rows += verified.rows;
      for (const [table, count] of Object.entries(verified.rowsByTable))
        totals.rowsByTable[table] = (totals.rowsByTable[table] ?? 0) + count;
      totals.budgets += verified.budgets;
      totals.monthViews += verified.monthViews;
      totals.records += verified.records;
      totals.mismatches += verified.mismatches.length;
      for (const problem of verified.mismatches)
        problems.push({ workspaceId, problem });
    }
    console.log(JSON.stringify(totals, null, 2));
    for (const { workspaceId, problem } of problems)
      console.error(`${workspaceId}: ${problem}`);
    if (problems.length) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

await main();
