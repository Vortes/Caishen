import { defineConfig } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import base from "./playwright.config";
import { e2eEnvironment, outboxPath, shellPath } from "./tests/e2e/environment";
import { clerkWebhookSecret } from "./tests/e2e/clerk-webhook-fixture";

const environment = e2eEnvironment({
  ...process.env,
  PLAYWRIGHT_BASE_URL:
    process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3212",
});
process.env.PLAYWRIGHT_BASE_URL = environment.baseURL;

export default defineConfig({
  ...base,
  projects: [
    {
      name: "bank-link",
      testMatch: ["bank-link.spec.ts", "bank-settlement.spec.ts"],
    },
  ],
  webServer: {
    command: `npm run dev -- --hostname ${environment.hostname} --port ${environment.port}`,
    url: `${environment.baseURL}${shellPath}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      CLERK_WEBHOOK_SIGNING_SECRET: clerkWebhookSecret,
      NEXT_DIST_DIR: ".next/cache/bank-e2e",
      NODE_OPTIONS: `--import=${pathToFileURL(resolve("tests/e2e/bank-fetch-fixture.mjs")).href}`,
      CAISHEN_E2E_OUTBOX: resolve(outboxPath),
      RESEND_API_KEY: "e2e-resend-key",
      EMAIL_FROM: "Caishen <invites@caishen.example>",
      APP_BASE_URL: environment.baseURL,
      CAISHEN_E2E_PLAID_FIXTURE: "1",
      PLAID_CLIENT_ID: "e2e-plaid-client",
      PLAID_SECRET: "e2e-plaid-secret",
      PLAID_ENV: "sandbox",
      PLAID_REDIRECT_URI: "",
    },
  },
  use: { ...base.use, baseURL: environment.baseURL },
});
