import nextEnv from "@next/env";
import { defineConfig } from "@playwright/test";

nextEnv.loadEnvConfig(process.cwd(), true);

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./.next/cache/playwright/test-results",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
  },
});
