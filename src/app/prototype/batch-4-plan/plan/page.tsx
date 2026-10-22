import { type Metadata } from "next";
import { Batch4PlanPrototype } from "~/components/prototype/batch-4-plan/prototype";
import { scenarioIds } from "~/components/prototype/batch-4-plan/scenarios";

export const metadata: Metadata = {
  title: "Batch 4 · Plan · Caishen",
  robots: { index: false },
};

export default async function Batch4PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const scenario = scenarioIds.find((id) => id === state);
  return <Batch4PlanPrototype key={scenario} scenario={scenario} />;
}
