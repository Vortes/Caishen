import nextEnv from "@next/env";
import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { e2eEnvironment, outboxPath, shellPath } from "./tests/e2e/environment";
import { clerkWebhookSecret } from "./tests/e2e/clerk-webhook-fixture";

nextEnv.loadEnvConfig(process.cwd(), true);
const environment = e2eEnvironment(process.env);

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./.next/cache/playwright/test-results",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  projects: [
    { name: "critical-shell", testMatch: "shell-*.spec.ts" },
    { name: "api-smoke", testMatch: "api-authorization.spec.ts" },
  ],
  webServer: {
    env: {
      CLERK_WEBHOOK_SIGNING_SECRET: clerkWebhookSecret,
      // Email goes to files the specs can open, never to Resend.
      NODE_OPTIONS: `--import=${pathToFileURL(resolve("tests/e2e/resend-fetch-fixture.mjs")).href}`,
      CAISHEN_E2E_OUTBOX: resolve(outboxPath),
      RESEND_API_KEY: "e2e-resend-key",
      EMAIL_FROM: "Caishen <invites@caishen.example>",
      APP_BASE_URL: environment.baseURL,
    },
    command: `npm run dev -- --hostname ${environment.hostname} --port ${environment.port}`,
    url: `${environment.baseURL}${shellPath}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: environment.baseURL,
    channel: "chrome",
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
    actionTimeout: 15_000,
    screenshot: "only-on-failure",
  },
});
