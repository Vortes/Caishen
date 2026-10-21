import { execFileSync } from "node:child_process";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  developmentBranch,
  isWorktreeBranchName,
  neonApi,
  neonProjectId,
  productionBranchId,
  setEnvValues,
  worktreeBranchName,
  type NeonBranch,
} from "../src/server/dev/development-database";

const ttlDays = 7;
const database = { name: "neondb", role: "neondb_owner" };
const branches = `/projects/${neonProjectId}/branches`;

const usage = `Usage: npm run db:worktree [-- --help]
       npm run db:worktree:delete

Gives this git worktree its own Neon database branch, so data written by
unmerged code never reaches other worktrees.

db:worktree         Create (or reuse) the Neon branch "dev-<git branch>" as a
                    child of dev-caishen, then point this worktree's .env.local
                    at it: DATABASE_URL (pooled), DATABASE_URL_UNPOOLED
                    (direct), and NEON_BRANCH. Other keys are left untouched.
                    The branch copies dev-caishen's current data and expires
                    ${ttlDays} days after the latest run; rerun to extend it,
                    or to recreate it after it expires. Run
                    \`npm run db:migrate\` afterwards if this worktree adds
                    migrations.
db:worktree:delete  Delete this worktree's branch (the one named in
                    NEON_BRANCH, or "dev-<git branch>") and point .env.local
                    back at dev-caishen.

Requires the neon CLI, logged in with access to project ${neonProjectId}.
Only branches named "dev-..." whose parent is dev-caishen are ever created,
changed, or deleted; production and dev-caishen are refused.`;

async function main() {
  const [command, ...extra] = process.argv.slice(2);
  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    extra.includes("--help") ||
    extra.includes("-h")
  ) {
    console.log(usage);
    return;
  }
  if (extra.length || !["create", "delete"].includes(command))
    throw new Error(usage);

  const root = git("rev-parse", "--show-toplevel");
  const envPath = resolve(root, ".env.local");
  const env = await readFile(envPath, "utf8").catch(() => {
    throw new Error(
      `${envPath} is missing; copy .env.local from the main checkout first.`,
    );
  });
  assertDevelopmentParent();

  if (command === "create") {
    const name = worktreeBranchName(git("branch", "--show-current"));
    const branch = await ensureBranch(name);
    await writeEnv(envPath, env, branch);
    console.log(
      `${envPath} now uses Neon branch ${name} (${branch.id}), expiring ${branch.expires_at}.`,
    );
    return;
  }

  const current = /^NEON_BRANCH=["']?([^"'\s]+)/m.exec(env)?.[1];
  const name = isWorktreeBranchName(current)
    ? current!
    : worktreeBranchName(git("branch", "--show-current"));
  const branch = findBranch(name);
  if (branch) {
    assertWorktreeBranch(branch);
    neonApi(`${branches}/${branch.id}`, ["-X", "DELETE"]);
    console.log(`Deleted Neon branch ${name} (${branch.id}).`);
  } else console.log(`Neon branch ${name} does not exist.`);
  const parent = neonApi<{ branch: NeonBranch }>(
    `${branches}/${developmentBranch.id}`,
  ).branch;
  await writeEnv(envPath, env, parent);
  console.log(`${envPath} now uses ${developmentBranch.name}.`);
}

function git(...args: string[]) {
  const output = execFileSync("git", args, { encoding: "utf8" }).trim();
  if (!output) throw new Error(`git ${args.join(" ")} returned nothing.`);
  return output;
}

function assertDevelopmentParent() {
  const { branch } = neonApi<{ branch: NeonBranch }>(
    `${branches}/${developmentBranch.id}`,
  );
  if (
    branch.name !== developmentBranch.name ||
    branch.default ||
    branch.id === productionBranchId
  )
    throw new Error(
      `Branch ${developmentBranch.id} is no longer the non-default dev-caishen branch; refusing to continue.`,
    );
}

function assertWorktreeBranch(branch: NeonBranch) {
  if (
    !isWorktreeBranchName(branch.name) ||
    branch.default ||
    branch.id === productionBranchId ||
    branch.id === developmentBranch.id ||
    branch.parent_id !== developmentBranch.id ||
    branch.project_id !== neonProjectId
  )
    throw new Error(
      `Neon branch ${branch.name} (${branch.id}) is not a dev-caishen child branch; refusing to change it.`,
    );
}

function findBranch(name: string) {
  const matches = neonApi<{ branches: NeonBranch[] }>(branches, [
    "-Q",
    `search=${name}`,
  ]).branches.filter((branch) => branch.name === name);
  if (matches.length > 1)
    throw new Error(
      `Several Neon branches are named ${name}; resolve by hand.`,
    );
  return matches[0];
}

async function ensureBranch(name: string) {
  const expiresAt = new Date(
    Date.now() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const existing = findBranch(name);
  if (existing) {
    assertWorktreeBranch(existing);
    neonApi(`${branches}/${existing.id}`, [
      "-X",
      "PATCH",
      "-f",
      `branch.expires_at=${expiresAt}`,
    ]);
    console.log(`Reusing Neon branch ${name} (${existing.id}).`);
    return waitUntilReady(existing.id);
  }
  const { branch } = neonApi<{ branch: NeonBranch }>(branches, [
    "-X",
    "POST",
    "-d",
    JSON.stringify({
      branch: {
        name,
        parent_id: developmentBranch.id,
        expires_at: expiresAt,
      },
      endpoints: [{ type: "read_write" }],
    }),
  ]);
  assertWorktreeBranch(branch);
  console.log(`Created Neon branch ${name} (${branch.id}).`);
  return waitUntilReady(branch.id);
}

async function waitUntilReady(id: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { branch } = neonApi<{ branch: NeonBranch }>(`${branches}/${id}`);
    if (branch.current_state === "ready") return branch;
    await new Promise((done) => setTimeout(done, 2000));
  }
  throw new Error(`Neon branch ${id} did not become ready within 2 minutes.`);
}

function connectionUri(branchId: string, pooled: boolean) {
  return neonApi<{ uri: string }>(`/projects/${neonProjectId}/connection_uri`, [
    "-Q",
    `branch_id=${branchId}`,
    "-Q",
    `database_name=${database.name}`,
    "-Q",
    `role_name=${database.role}`,
    "-Q",
    `pooled=${pooled}`,
  ]).uri;
}

async function writeEnv(path: string, original: string, branch: NeonBranch) {
  const next = setEnvValues(original, {
    DATABASE_URL: connectionUri(branch.id, true),
    DATABASE_URL_UNPOOLED: connectionUri(branch.id, false),
    NEON_BRANCH: branch.name,
  });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, next, { mode: (await stat(path)).mode });
  await rename(temporary, path);
}

main().catch((failure: unknown) => {
  console.error(failure instanceof Error ? failure.message : failure);
  process.exitCode = 1;
});
