import { PeopleLab } from "./people-lab";

export default async function PeoplePlayground({
  searchParams,
}: {
  searchParams: Promise<{ data?: string }>;
}) {
  const { data } = await searchParams;
  return <PeopleLab initialData={data} />;
}
