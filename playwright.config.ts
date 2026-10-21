import nextEnv from "@next/env";
import { defineConfig } from "@playwright/test";
import { e2eEnvironment, shellPath } from "./tests/e2e/environment";

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
