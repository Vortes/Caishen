import { type Metadata } from "next";
import { Batch4Index } from "~/components/prototype/batch-4-plan/index-page";

export const metadata: Metadata = {
  title: "Batch 4 · Plan prototype · Caishen",
  robots: { index: false },
};

export default function Batch4IndexPage() {
  return <Batch4Index />;
}
