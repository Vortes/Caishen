import { type Metadata } from "next";
import { LoansPrototypeClient } from "~/components/prototype/batch-3-loans/client";

export const metadata: Metadata = {
  title: "Loans prototype · Caishen",
  robots: { index: false },
};

export default function LoansPrototypePage() {
  return <LoansPrototypeClient />;
}
