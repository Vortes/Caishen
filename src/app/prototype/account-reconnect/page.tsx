import { type Metadata } from "next";
import { AccountReconnectPrototype } from "~/components/prototype/bank-connect/account-reconnect-prototype";

export const metadata: Metadata = {
  title: "Account reconnect · Caishen",
  robots: { index: false },
};

export default function AccountReconnectPrototypePage() {
  return <AccountReconnectPrototype />;
}
