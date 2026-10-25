import path from "node:path";
import { Config } from "@remotion/cli/config";

// Remotion renders the Open Graph video in src/video. Its bundler needs the
// same `~/` alias as the app so the video can import the real brand and tokens.
Config.setVideoImageFormat("png");
Config.setOverwriteOutput(true);
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...config.resolve?.alias,
      "~": path.resolve(process.cwd(), "src"),
    },
  },
}));
