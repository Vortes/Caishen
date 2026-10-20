import { type Metadata } from "next";
import { LiveAppShell } from "~/components/prototype/app-shell/live-app-shell";

export const metadata: Metadata = {
  title: "App shell prototype · Caishen",
  robots: { index: false },
};

export default function AppShellPrototypePage() {
  return <LiveAppShell />;
}
