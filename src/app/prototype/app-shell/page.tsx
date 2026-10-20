import { type Metadata } from "next";
import { AppShellPrototype } from "~/components/prototype/app-shell/app-shell-prototype";

export const metadata: Metadata = {
  title: "App shell prototype · Caishen",
  robots: { index: false },
};

export default function AppShellPrototypePage() {
  return <AppShellPrototype />;
}
