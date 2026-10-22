import { type Metadata } from "next";
import { BankConnectPrototype } from "~/components/prototype/bank-connect/bank-connect-prototype";

export const metadata: Metadata = {
  title: "Banks popover states · Caishen",
  robots: { index: false },
};

export default async function BankConnectPrototypePage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; theme?: string }>;
}) {
  const { scenario, theme } = await searchParams;
  return (
    <BankConnectPrototype
      initialScenario={scenario}
      theme={theme === "light" ? "light" : "dark"}
    />
  );
}
