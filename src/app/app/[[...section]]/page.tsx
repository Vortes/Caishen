import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { LiveAppShell } from "~/components/app-shell/live-app-shell";
import {
  screenAt,
  settingsPageAt,
  SHELL_PATH,
} from "~/components/workspace/routes";

export const metadata: Metadata = {
  title: "Caishen",
  robots: { index: false },
};

// All shell addresses share the same budget client and saved layout.
export default async function AppPage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  // The client reads the request's URL, including its month and filters.
  await connection();
  const { section } = await params;
  const pathname = [
    SHELL_PATH,
    ...(section ?? []).map(encodeURIComponent),
  ].join("/");
  if (!screenAt(pathname) && !settingsPageAt(pathname)) notFound();
  return <LiveAppShell />;
}
