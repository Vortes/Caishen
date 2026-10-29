import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Loaded only by the shell test server. Every email Caishen sends lands as a
// file in the run's outbox, for the test to open, instead of reaching Resend.
const outbox = process.env.CAISHEN_E2E_OUTBOX;
if (!outbox)
  throw new Error("The Resend browser fixture requires its test outbox.");
mkdirSync(outbox, { recursive: true });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (url.hostname !== "api.resend.com") return originalFetch(input, init);
  if (
    new Headers(init?.headers).get("Authorization") !== "Bearer e2e-resend-key"
  )
    throw new Error("Refusing real Resend credentials in the browser fixture.");
  if (url.pathname !== "/emails")
    throw new Error(`Unhandled Resend fixture endpoint: ${url.pathname}`);
  const id = randomUUID();
  writeFileSync(
    join(outbox, `${Date.now()}-${id}.json`),
    typeof init?.body === "string" ? init.body : "{}",
  );
  return Response.json({ id });
};
