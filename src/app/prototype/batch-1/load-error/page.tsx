import { type Metadata } from "next";
import { LoadErrorPrototype } from "~/components/prototype/batch-1/load-error";

export const metadata: Metadata = {
  title: "Couldn’t load prototype · Caishen",
  robots: { index: false },
};

export default function LoadErrorPrototypePage() {
  return <LoadErrorPrototype />;
}
