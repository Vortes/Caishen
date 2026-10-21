import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { LiveAppShell } from "~/components/prototype/app-shell/live-app-shell";
import {
  settingsPageAt,
  SHELL_PATH,
} from "~/components/prototype/app-shell/settings-pages";

export const metadata: Metadata = {
  title: "App shell prototype · Caishen",
  robots: { index: false },
};

// The shell and its settings are one page: opening settings swaps the
// shell's panels in place, so the budget and layout stay loaded.
export default async function AppShellPrototypePage({
  params,
}: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section } = await params;
  if (section && !settingsPageAt(`${SHELL_PATH}/${section.join("/")}`))
    notFound();
  return <LiveAppShell />;
}
