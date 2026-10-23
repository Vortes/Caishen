import { notFound, redirect } from "next/navigation";
import {
  appHref,
  settingsPageAt,
  SHELL_PATH,
  type AppSearchParams,
} from "~/components/workspace/routes";

export default async function PreviousAppShellPage({
  params,
  searchParams,
}: {
  params: Promise<{ section?: string[] }>;
  searchParams: Promise<AppSearchParams>;
}) {
  const { section } = await params;
  if (section && !settingsPageAt(`${SHELL_PATH}/${section.join("/")}`))
    notFound();
  redirect(appHref(await searchParams, section));
}
