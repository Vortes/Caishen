import { type Metadata } from "next";
import { LoansIndex } from "~/components/prototype/batch-3-loans/index-page";

export const metadata: Metadata = {
  title: "Loans prototype states · Caishen",
  robots: { index: false },
};

export default function LoansIndexPage() {
  return <LoansIndex />;
}
