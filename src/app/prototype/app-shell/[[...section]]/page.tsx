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
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { section } = await params;
  if (section && !settingsPageAt(`${SHELL_PATH}/${section.join("/")}`))
    notFound();
  const { month } = await searchParams;
  const initialMonth =
    typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
      ? month
      : undefined;
  return <LiveAppShell initialMonth={initialMonth} />;
}
