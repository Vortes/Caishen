import { execFileSync } from "node:child_process";

// Development data lives on the dev-caishen Neon branch and on per-worktree
// branches created from it (`npm run db:worktree`). Production is never a
// child of dev-caishen, so a verified parent rules it out.
export const neonProjectId = "curly-forest-34798878";
export const developmentBranch = {
  id: "br-withered-hill-b4isbmm6",
  name: "dev-caishen",
  endpointId: "ep-odd-voice-b4sie2v1",
} as const;
export const productionBranchId = "br-ancient-boat-b4ol3iq1";
export const worktreeBranchPrefix = "dev-";

export type EndpointBranch = {
  projectId: string;
  hosts: string[];
  branchId: string;
  branchName: string;
  parentId: string | null;
};
export type EndpointLookup = (endpointId: string) => EndpointBranch;

const endpointPattern = /^ep-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function neonEndpointId(value: string) {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname.endsWith(".neon.tech")
  )
    throw new Error("Development data requires a Neon database URL.");
  const endpointId = url.hostname.split(".")[0]!.replace(/-pooler$/, "");
  if (!endpointPattern.test(endpointId))
    throw new Error("The database URL does not name a Neon endpoint.");
  return { endpointId, hostname: url.hostname };
}

export function isWorktreeBranchName(name: string | undefined) {
  return (
    !!name &&
    name.startsWith(worktreeBranchPrefix) &&
    name.length > worktreeBranchPrefix.length &&
    name !== developmentBranch.name
  );
}

// Accepts dev-caishen itself, or a branch named in NEON_BRANCH that Neon
// confirms is a direct child of dev-caishen and serves these exact hosts.
// Returns the branch name the URLs point at.
export function assertDevelopmentDatabase(
  env: Record<string, string | undefined>,
  lookup: EndpointLookup = neonEndpointBranch,
) {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production")
    throw new Error("Development data cannot be used in production.");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const urls = [env.DATABASE_URL, env.DATABASE_URL_UNPOOLED]
    .filter((value): value is string => !!value)
    .map(neonEndpointId);
  const { endpointId } = urls[0]!;
  if (urls.some((url) => url.endpointId !== endpointId))
    throw new Error("Database URLs must point at the same Neon endpoint.");
  if (endpointId === developmentBranch.endpointId)
    return developmentBranch.name;

  const name = env.NEON_BRANCH;
  if (!isWorktreeBranchName(name))
    throw new Error(
      `Use dev-caishen or a worktree branch from \`npm run db:worktree\`; NEON_BRANCH must name a "${worktreeBranchPrefix}" branch.`,
    );
  const branch = lookup(endpointId);
  if (
    branch.projectId !== neonProjectId ||
    branch.branchId === productionBranchId ||
    branch.parentId !== developmentBranch.id ||
    branch.branchName !== name ||
    urls.some((url) => !branch.hosts.includes(url.hostname))
  )
    throw new Error(
      `Endpoint ${endpointId} is not the dev-caishen child branch ${name}.`,
    );
  return name;
}

export function neonApi<T>(path: string, args: string[] = []): T {
  try {
    return JSON.parse(
      execFileSync("neon", ["api", path, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ) as T;
  } catch (error) {
    const detail =
      error instanceof Error && "stderr" in error
        ? String(error.stderr).trim()
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(
      `Neon CLI request ${path} failed (is \`neon\` installed and logged in?): ${detail}`,
    );
  }
}

export type NeonBranch = {
  id: string;
  name: string;
  project_id: string;
  parent_id?: string;
  default?: boolean;
  current_state?: string;
  expires_at?: string;
};

const verified = new Map<string, EndpointBranch>();

export function neonEndpointBranch(endpointId: string): EndpointBranch {
  const known = verified.get(endpointId);
  if (known) return known;
  const { endpoint } = neonApi<{
    endpoint: {
      project_id: string;
      branch_id: string;
      host: string;
      hosts?: { read_write_host?: string; read_write_pooled_host?: string };
    };
  }>(`/projects/${neonProjectId}/endpoints/${endpointId}`);
  const { branch } = neonApi<{ branch: NeonBranch }>(
    `/projects/${neonProjectId}/branches/${endpoint.branch_id}`,
  );
  const result = {
    projectId: endpoint.project_id,
    hosts: [
      endpoint.host,
      endpoint.host.replace(`${endpointId}.`, `${endpointId}-pooler.`),
      endpoint.hosts?.read_write_host,
      endpoint.hosts?.read_write_pooled_host,
    ].filter((host): host is string => !!host),
    branchId: branch.id,
    branchName: branch.name,
    parentId: branch.parent_id ?? null,
  };
  verified.set(endpointId, result);
  return result;
}

// "feature/Plan Storage" becomes "dev-feature-plan-storage".
export function worktreeBranchName(gitBranch: string) {
  const slug = gitBranch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  const name = `${worktreeBranchPrefix}${slug}`;
  if (!isWorktreeBranchName(name))
    throw new Error(
      `Git branch "${gitBranch}" cannot name a worktree database branch; rename it.`,
    );
  return name;
}

// Replaces each key's assignments in a dotenv file, keeping every other
// line, comment, and blank as written; missing keys are appended.
export function setEnvValues(text: string, values: Record<string, string>) {
  const pending = new Map(Object.entries(values));
  const lines = text.split("\n").flatMap((line) => {
    const key = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(
      line,
    )?.[1];
    if (!key || !(key in values)) return [line];
    if (!pending.has(key)) return [];
    pending.delete(key);
    return [`${key}=${JSON.stringify(values[key])}`];
  });
  if (pending.size) {
    if (lines.at(-1) === "") lines.pop();
    for (const [key, value] of pending)
      lines.push(`${key}=${JSON.stringify(value)}`);
    lines.push("");
  }
  return lines.join("\n");
}
