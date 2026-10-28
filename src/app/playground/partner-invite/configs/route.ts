import type { Config } from "~/components/playground/partner-invite/config";
import {
  savedConfigFile,
  writeSavedConfig,
} from "~/components/playground/partner-invite/saved-config";

// Saves the lab's config over the last one. Dev server only.
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development")
    return new Response(null, { status: 404 });
  await writeSavedConfig((await request.json()) as Config);
  return Response.json({ path: savedConfigFile });
}
