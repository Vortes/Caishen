import nextEnv from "@next/env";
import { defineConfig } from "prisma/config";

nextEnv.loadEnvConfig(
  import.meta.dirname,
  process.env.NODE_ENV !== "production",
);

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
});
