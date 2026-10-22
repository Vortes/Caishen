import { type Metadata } from "next";
import { OnboardingPrototype } from "~/components/prototype/batch-1/onboarding";

export const metadata: Metadata = {
  title: "Onboarding prototype · Caishen",
  robots: { index: false },
};

export default function OnboardingPrototypePage() {
  return <OnboardingPrototype />;
}
