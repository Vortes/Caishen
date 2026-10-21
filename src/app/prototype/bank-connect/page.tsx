import { type Metadata } from "next";
import { BankConnectPrototype } from "~/components/prototype/bank-connect/bank-connect-prototype";

export const metadata: Metadata = {
  title: "Banks popover states · Caishen",
  robots: { index: false },
};

export default function BankConnectPrototypePage() {
  return <BankConnectPrototype />;
}
