import { type Metadata } from "next";
import { SharedCostsPrototype } from "~/components/prototype/shared-costs/prototype";
import { scenarioIds } from "~/components/prototype/shared-costs/scenarios";

export const metadata: Metadata = {
  title: "Shared costs · Caishen",
  robots: { index: false },
};

export default async function SharedCostsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const scenario = scenarioIds.find((id) => id === state);
  return <SharedCostsPrototype key={scenario} scenario={scenario} />;
}
