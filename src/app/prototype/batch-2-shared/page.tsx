import { type Metadata } from "next";
import { Batch2Index } from "~/components/prototype/batch-2-shared/index-page";

export const metadata: Metadata = {
  title: "Batch 2: shared expenses · Caishen",
  robots: { index: false },
};

export default function Batch2IndexPage() {
  return <Batch2Index />;
}
