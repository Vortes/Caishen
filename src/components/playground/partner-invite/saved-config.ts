import { readFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfig, type Config } from "./config";

// The lab's one saved config, kept in the project so the real invite can
// import it.
const absolute = path.join(
  process.cwd(),
  "src/components/playground/partner-invite/saved-config.json",
);

// Laid over the defaults, group by group, so knobs added since it was saved
// still get a value.
export async function readSavedConfig(): Promise<Config> {
  const saved = await readFile(absolute, "utf8").then(
    (text) => JSON.parse(text) as Record<string, unknown>,
    () => ({}),
  );
  const merged: Record<string, unknown> = { ...defaultConfig };
  for (const [key, value] of Object.entries(saved)) {
    const fallback = merged[key];
    merged[key] =
      isGroup(fallback) && isGroup(value) ? { ...fallback, ...value } : value;
  }
  return merged as Config;
}

const isGroup = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
