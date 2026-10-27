import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Saved lab configs, written into the project so a keeper can be imported
// by the real invite. Dev server only.
const file = "src/components/playground/partner-invite/saved-configs.json";
const absolute = path.join(process.cwd(), file);

const notFound = () => new Response(null, { status: 404 });

async function read() {
  return JSON.parse(await readFile(absolute, "utf8")) as unknown[];
}

export async function GET() {
  if (process.env.NODE_ENV !== "development") return notFound();
  return Response.json(await read());
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return notFound();
  const config = (await request.json()) as unknown;
  const saved = [
    ...(await read()),
    { savedAt: new Date().toISOString(), config },
  ];
  await writeFile(absolute, `${JSON.stringify(saved, null, 2)}\n`);
  return Response.json({ path: file, saved });
}
