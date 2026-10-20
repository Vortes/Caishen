import { type Metadata } from "next";
import { PlaidOAuthReturn } from "~/components/banks/plaid-oauth-return";

export const metadata: Metadata = {
  title: "Connect your bank · Caishen",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function BankOAuthPage() {
  return <PlaidOAuthReturn />;
}
