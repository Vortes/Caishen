export const shellPath = "/prototype/app-shell";

// Match the database suite's isolated branch, with an exact endpoint check.
// The managed web server inherits these same URLs; an unrelated running app
// must never be reused for a test that creates or deletes financial data.
export function e2eEnvironment(env: Record<string, string | undefined>) {
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
    const value = env[key];
    if (!value) throw new Error(`${key} is required for isolated E2E data.`);
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname.endsWith(".neon.tech") ||
      url.hostname.split(".")[0]?.replace(/-pooler$/, "") !==
        "ep-odd-voice-b4sie2v1"
    )
      throw new Error("E2E tests require the isolated dev-caishen database.");
  }
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
  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production")
    throw new Error("E2E setup cannot run in production.");

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
