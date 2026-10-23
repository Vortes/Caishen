import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) } },
  oxc: {
    jsx: { runtime: "automatic" },
    typescript: { onlyRemoveTypeImports: false },
  },
  test: {
    environment: "jsdom",
    include: ["tests/components/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/components/setup.ts"],
    // Whole-shell renders take seconds; a busy machine (parallel suites,
    // other worktrees) can more than double that.
    testTimeout: 20_000,
    environmentOptions: {
      jsdom: { url: "http://localhost/app" },
    },
  },
});
