import { type Metadata } from "next";
import { BankOAuthPrototype } from "~/components/prototype/batch-1/bank-oauth";

export const metadata: Metadata = {
  title: "Bank return prototype · Caishen",
  referrer: "no-referrer",
  robots: { index: false },
};

export default function BankOAuthPrototypePage() {
  return <BankOAuthPrototype />;
}
