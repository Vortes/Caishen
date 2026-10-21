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
    include: ["tests/components/**/*.test.tsx"],
    setupFiles: ["tests/components/setup.ts"],
    environmentOptions: {
      jsdom: { url: "http://localhost/prototype/app-shell" },
    },
  },
});
