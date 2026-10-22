/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The build the browser names on every pull (src/components/sync).
  env: { CAISHEN_BUILD: process.env.VERCEL_GIT_COMMIT_SHA ?? "development" },
};

export default config;
