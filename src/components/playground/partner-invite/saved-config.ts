import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultConfig, type Config } from "./config";

// The lab's one saved config, written into the project so the keeper can be
// imported by the real invite. Saving again replaces it.
export const savedConfigFile =
  "src/components/playground/partner-invite/saved-config.json";
const absolute = path.join(process.cwd(), savedConfigFile);

// Laid over the defaults, so knobs added since it was saved still get a value.
export async function readSavedConfig(): Promise<Config> {
  const saved = await readFile(absolute, "utf8").then(
    (text) => JSON.parse(text) as Partial<Config>,
    () => ({}),
  );
  return { ...defaultConfig, ...saved };
}

export async function writeSavedConfig(config: Config) {
  await writeFile(absolute, `${JSON.stringify(config, null, 2)}\n`);
}
