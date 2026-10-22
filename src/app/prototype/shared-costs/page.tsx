import { type Metadata } from "next";
import { SharedCostsIndex } from "~/components/prototype/shared-costs/index-page";

export const metadata: Metadata = {
  title: "Shared costs prototype · Caishen",
  robots: { index: false },
};

export default function SharedCostsIndexPage() {
  return <SharedCostsIndex />;
}
