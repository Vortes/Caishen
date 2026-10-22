import { type Metadata } from "next";
import { Batch5Index } from "~/components/prototype/batch-5-register/scenes";

export const metadata: Metadata = {
  title: "Batch 5 prototype · Caishen",
  robots: { index: false },
};

export default function Batch5IndexPage() {
  return <Batch5Index />;
}
