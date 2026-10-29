import { createClerkClient } from "@clerk/backend";
import nextEnv from "@next/env";
import { readdir } from "node:fs/promises";
import { PrismaClient } from "../src/generated/prisma/index.js";
import {
  cleanupRun,
  recoveryDirectory,
  RunJournal,
} from "../tests/e2e/cleanup";
import { cleanupServices } from "../tests/e2e/cleanup-clients";
import { e2eEnvironment } from "../tests/e2e/environment";

// Recovery is explicit and scoped to one journal; it never sweeps accounts.
const [runId, ...extra] = process.argv.slice(2);
if (!runId || extra.length)
  throw new Error("Usage: npm run test:e2e:cleanup -- <run-id | --list>");
if (runId === "--list") {
  const files = await readdir(recoveryDirectory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  for (const file of files.filter((file) => file.endsWith(".json")))
    console.log(file.slice(0, -5));
} else {
  const journal = await RunJournal.open(recoveryDirectory, runId);
  let running = true;
  try {
    process.kill(journal.pid, 0);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ESRCH"
    )
      throw error;
    running = false;
  }
  if (running)
    throw new Error(
      `Run ${runId} still has a live process; refusing concurrent cleanup.`,
    );
  nextEnv.loadEnvConfig(process.cwd());
  e2eEnvironment(process.env);
  const auth = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  const db = new PrismaClient();
  try {
    await cleanupRun(
      journal,
      cleanupServices(auth, db, () => journal.userIds),
    );
    console.log(`Cleaned E2E run ${runId}.`);
  } finally {
    await db.$disconnect();
  }
}
