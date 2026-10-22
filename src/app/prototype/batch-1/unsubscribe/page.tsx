import { type Metadata } from "next";
import { UnsubscribePrototype } from "~/components/prototype/batch-1/unsubscribe";

export const metadata: Metadata = {
  title: "Unsubscribe prototype · Caishen",
  robots: { index: false },
};

export default function UnsubscribePrototypePage() {
  return <UnsubscribePrototype />;
}
