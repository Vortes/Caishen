import { type Metadata } from "next";
import { BatchIndex } from "~/components/prototype/batch-1/batch-index";

export const metadata: Metadata = {
  title: "Batch 1 prototypes · Caishen",
  robots: { index: false },
};

export default function BatchIndexPage() {
  return <BatchIndex />;
}
