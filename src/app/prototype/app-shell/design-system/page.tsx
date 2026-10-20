import { type Metadata } from "next";
import { DesignSystem } from "~/components/prototype/app-shell/design-system/design-system";

export const metadata: Metadata = {
  title: "Design system · Caishen",
  robots: { index: false },
};

export default function DesignSystemPage() {
  return <DesignSystem />;
}
