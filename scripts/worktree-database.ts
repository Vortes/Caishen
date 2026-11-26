import { execFileSync } from "node:child_process";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  isWorktreeBranchName,
  neonApi,
  neonDevelopment,
  setEnvValues,
  worktreeBranchName,
  type NeonBranch,
  type NeonDevelopment,
} from "../src/server/dev/development-database";

const ttlDays = 7;
const database = { name: "neondb", role: "neondb_owner" };
const branchesOf = (neon: NeonDevelopment) =>
  `/projects/${neon.projectId}/branches`;

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

Requires the neon CLI, logged in with access to the project that .env.local
names in NEON_PROJECT_ID (see .env.example).
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
  // Like `node --env-file`, the shell's environment wins over the file.
  const neon = neonDevelopment({ ...parseEnv(env), ...process.env });
  const branches = branchesOf(neon);
  assertDevelopmentParent(neon);

  if (command === "create") {
    const name = worktreeBranchName(git("branch", "--show-current"));
    const branch = await ensureBranch(neon, name);
    await writeEnv(neon, envPath, env, branch);
    console.log(
      `${envPath} now uses Neon branch ${name} (${branch.id}), expiring ${branch.expires_at}.`,
    );
    return;
  }

  const current = /^NEON_BRANCH=["']?([^"'\s]+)/m.exec(env)?.[1];
  const name = isWorktreeBranchName(current)
    ? current!
    : worktreeBranchName(git("branch", "--show-current"));
  const branch = findBranch(neon, name);
  if (branch) {
    assertWorktreeBranch(neon, branch);
    neonApi(`${branches}/${branch.id}`, ["-X", "DELETE"]);
    console.log(`Deleted Neon branch ${name} (${branch.id}).`);
  } else console.log(`Neon branch ${name} does not exist.`);
  const parent = neonApi<{ branch: NeonBranch }>(
    `${branches}/${neon.developmentBranch.id}`,
  ).branch;
  await writeEnv(neon, envPath, env, parent);
  console.log(`${envPath} now uses ${neon.developmentBranch.name}.`);
}

function git(...args: string[]) {
  const output = execFileSync("git", args, { encoding: "utf8" }).trim();
  if (!output) throw new Error(`git ${args.join(" ")} returned nothing.`);
  return output;
}

function assertDevelopmentParent(neon: NeonDevelopment) {
  const { branch } = neonApi<{ branch: NeonBranch }>(
    `${branchesOf(neon)}/${neon.developmentBranch.id}`,
  );
  if (
    branch.name !== neon.developmentBranch.name ||
    branch.default ||
    branch.id === neon.productionBranchId
  )
    throw new Error(
      `Branch ${neon.developmentBranch.id} is not the non-default dev-caishen branch; refusing to continue.`,
    );
}

function assertWorktreeBranch(neon: NeonDevelopment, branch: NeonBranch) {
  if (
    !isWorktreeBranchName(branch.name) ||
    branch.default ||
    branch.id === neon.productionBranchId ||
    branch.id === neon.developmentBranch.id ||
    branch.parent_id !== neon.developmentBranch.id ||
    branch.project_id !== neon.projectId
  )
    throw new Error(
      `Neon branch ${branch.name} (${branch.id}) is not a dev-caishen child branch; refusing to change it.`,
    );
}

function findBranch(neon: NeonDevelopment, name: string) {
  const matches = neonApi<{ branches: NeonBranch[] }>(branchesOf(neon), [
    "-Q",
    `search=${name}`,
  ]).branches.filter((branch) => branch.name === name);
  if (matches.length > 1)
    throw new Error(
      `Several Neon branches are named ${name}; resolve by hand.`,
    );
  return matches[0];
}

async function ensureBranch(neon: NeonDevelopment, name: string) {
  const branches = branchesOf(neon);
  const expiresAt = new Date(
    Date.now() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const existing = findBranch(neon, name);
  if (existing) {
    assertWorktreeBranch(neon, existing);
    neonApi(`${branches}/${existing.id}`, [
      "-X",
      "PATCH",
      "-f",
      `branch.expires_at=${expiresAt}`,
    ]);
    console.log(`Reusing Neon branch ${name} (${existing.id}).`);
    return waitUntilReady(neon, existing.id);
  }
  const { branch } = neonApi<{ branch: NeonBranch }>(branches, [
    "-X",
    "POST",
    "-d",
    JSON.stringify({
      branch: {
        name,
        parent_id: neon.developmentBranch.id,
        expires_at: expiresAt,
      },
      endpoints: [{ type: "read_write" }],
    }),
  ]);
  assertWorktreeBranch(neon, branch);
  console.log(`Created Neon branch ${name} (${branch.id}).`);
  return waitUntilReady(neon, branch.id);
}

async function waitUntilReady(neon: NeonDevelopment, id: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { branch } = neonApi<{ branch: NeonBranch }>(
      `${branchesOf(neon)}/${id}`,
    );
    if (branch.current_state === "ready") return branch;
    await new Promise((done) => setTimeout(done, 2000));
  }
  throw new Error(`Neon branch ${id} did not become ready within 2 minutes.`);
}

function connectionUri(
  neon: NeonDevelopment,
  branchId: string,
  pooled: boolean,
) {
  return neonApi<{ uri: string }>(
    `/projects/${neon.projectId}/connection_uri`,
    [
      "-Q",
      `branch_id=${branchId}`,
      "-Q",
      `database_name=${database.name}`,
      "-Q",
      `role_name=${database.role}`,
      "-Q",
      `pooled=${pooled}`,
    ],
  ).uri;
}

async function writeEnv(
  neon: NeonDevelopment,
  path: string,
  original: string,
  branch: NeonBranch,
) {
  const next = setEnvValues(original, {
    DATABASE_URL: connectionUri(neon, branch.id, true),
    DATABASE_URL_UNPOOLED: connectionUri(neon, branch.id, false),
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
