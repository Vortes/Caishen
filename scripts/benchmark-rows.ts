// Times reading a heavy household's rows from Postgres through the
// data-access layer, and running a command through the server's command
// path with the household held in memory (warm) and read whole (cold): 150
// transactions per partner per month, 2 partners, 30 assignments per month.
// Writes a temporary household to the development database and removes it
// afterwards, with its members' user records if it created them.
// Usage: npm run benchmark:rows -- [years...]
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { bookToRows, rowsToBook } from "../src/domain/rows";
import { PrismaClient } from "../src/generated/prisma";
import { assertDevelopmentDatabase } from "../src/server/dev/development-database";
import { executeCommand } from "../src/server/services/household";
import { households } from "../src/server/storage/households";
import {
  loadRows,
  pullRows,
  readHouseholdRevision,
  replaceRows,
} from "../src/server/storage/rows";
import {
  MEMBERS,
  syntheticBook,
} from "../tests/domain/fixtures/synthetic-book";

nextEnv.loadEnvConfig(process.cwd(), true);
assertDevelopmentDatabase(process.env);
const years = process.argv.slice(2).map(Number);
const db = new PrismaClient();

async function time(run: () => Promise<unknown>) {
  const samples: number[] = [];
  for (let index = 0; index < 5; index++) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  return samples.sort((a, b) => a - b)[2]!;
}

// The synthetic household's members need user records.
const created = (
  await Promise.all(
    MEMBERS.map(async (clerkUserId) =>
      (await db.user.findUnique({ where: { clerkUserId } }))
        ? null
        : db.user.create({ data: { clerkUserId } }),
    ),
  )
).flatMap((user) => (user ? [user.clerkUserId] : []));

// One command through the server's command path for Alex.
async function command() {
  const household = (await readHouseholdRevision(db, "alex"))!;
  await executeCommand(db, "alex", {
    command: {
      type: "income.expect",
      id: randomUUID(),
      month: "2020-02",
      amount: Math.floor(Math.random() * 100_000),
    },
    submitted: {},
    baseRevision: household.revision,
  });
}

try {
  // Connecting is not part of a read.
  await db.$queryRaw`SELECT 1`;
  for (const year of years.length ? years : [1, 5]) {
    const book = syntheticBook({
      seed: 7,
      startMonth: "2020-01",
      months: year * 12,
      transactionsPerMonth: 150,
      assignmentsPerMonth: 30,
    });
    const rows = bookToRows(book);
    const workspaceId = `benchmark-rows-${randomUUID()}`;
    await db.workspace.create({
      data: {
        id: workspaceId,
        revision: 1,
        members: {
          create: MEMBERS.map((clerkUserId) => ({ clerkUserId })),
        },
      },
    });
    try {
      const started = performance.now();
      await replaceRows(db, workspaceId, rows, 1);
      const written = performance.now() - started;
      const ping = await time(() => db.$queryRaw`SELECT 1`);
      console.log(
        `\n${year} year${year === 1 ? "" : "s"}: ${rows.length} rows (round trip ${ping.toFixed(0)} ms)`,
      );
      const report = (name: string, ms: number) =>
        console.log(`  ${name.padEnd(40)} ${ms.toFixed(0).padStart(8)} ms`);
      report("write every row (one copy)", written);
      report(
        "load household rows",
        await time(() => loadRows(db, workspaceId)),
      );
      report(
        "load one partner's rows",
        await time(() => loadRows(db, workspaceId, { viewerId: "alex" })),
      );
      report(
        "load rows changed since a revision",
        await time(() => loadRows(db, workspaceId, { since: 1 })),
      );
      const loaded = await loadRows(db, workspaceId);
      report(
        "rows to household (in memory)",
        await time(async () => rowsToBook(loaded)),
      );
      report(
        "pull: first page of a partner's rows",
        await time(() =>
          pullRows(db, {
            workspaceId,
            viewerId: "alex",
            since: null,
            revision: 1,
            limit: 4_000,
          }),
        ),
      );
      report(
        "command, household read whole (cold)",
        await time(async () => {
          households.clear();
          await command();
        }),
      );
      await command();
      report("command, household held (warm)", await time(command));
    } finally {
      await db.workspace.delete({ where: { id: workspaceId } });
    }
  }
} finally {
  await db.user.deleteMany({ where: { clerkUserId: { in: created } } });
  await db.$disconnect();
}
