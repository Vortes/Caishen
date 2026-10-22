import { type Metadata } from "next";
import { SharedCostsPrototype } from "~/components/prototype/shared-costs-v2/prototype";

export const metadata: Metadata = {
  title: "Shared costs prototype · Caishen",
  robots: { index: false },
};

export default function SharedCostsPrototypePage() {
  return <SharedCostsPrototype />;
}
