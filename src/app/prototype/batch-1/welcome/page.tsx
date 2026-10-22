import { type Metadata } from "next";
import { WelcomePrototype } from "~/components/prototype/batch-1/welcome";

export const metadata: Metadata = {
  title: "Welcome prototype · Caishen",
  robots: { index: false },
};

export default function WelcomePrototypePage() {
  return <WelcomePrototype />;
}
