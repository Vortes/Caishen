import { type Metadata } from "next";
import { Batch2Prototype } from "~/components/prototype/batch-2-shared/prototype";

export const metadata: Metadata = {
  title: "Shared expenses prototype · Caishen",
  robots: { index: false },
};

export default function Batch2PlayPage() {
  return <Batch2Prototype />;
}
