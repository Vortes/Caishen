import {
  assertDevelopmentDatabase,
  type EndpointLookup,
} from "../../src/server/dev/development-database";

export const shellPath = "/prototype/app-shell";

// Match the database suite's isolated branch check: dev-caishen or a verified
// worktree branch under it. The managed web server inherits these same URLs;
// an unrelated running app must never be reused for a test that creates or
// deletes financial data.
export function e2eEnvironment(
  env: Record<string, string | undefined>,
  lookup?: EndpointLookup,
) {
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const)
    if (!env[key]) throw new Error(`${key} is required for isolated E2E data.`);
  assertDevelopmentDatabase(env, lookup);
  if (
    new URL(env.DATABASE_URL!).pathname !==
    new URL(env.DATABASE_URL_UNPOOLED!).pathname
  )
    throw new Error("E2E database URLs must name the same database.");
  if (
    !env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
    !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")
  )
    throw new Error("E2E tests require Clerk development keys.");

  const baseURL = env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
  const url = new URL(baseURL);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "localhost" ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "E2E requires a managed localhost origin with an explicit port.",
    );
  return { baseURL: url.origin, port: url.port, hostname: url.hostname };
}
