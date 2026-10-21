import { type Metadata } from "next";
import { LiveAppShell } from "~/components/prototype/app-shell/live-app-shell";

export const metadata: Metadata = {
  title: "App shell prototype · Caishen",
  robots: { index: false },
};

export default async function AppShellPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month } = await searchParams;
  const initialMonth =
    typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
      ? month
      : undefined;
  return <LiveAppShell initialMonth={initialMonth} />;
}
