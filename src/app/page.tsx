import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Welcome } from "~/components/auth/welcome";
import { appHref, type AppSearchParams } from "~/components/workspace/routes";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<AppSearchParams>;
}) {
  const { userId } = await auth();
  if (userId) redirect(appHref(await searchParams));
  return <Welcome />;
}
