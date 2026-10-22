import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { AppearancePlaceholder } from "~/components/prototype/batch-1/appearance-placeholder";
import { NotificationSettingsPrototype } from "~/components/prototype/batch-1/notification-settings";
import { PartnerSettingsPrototype } from "~/components/prototype/batch-1/partner-settings";
import { ProfileSettingsPrototype } from "~/components/prototype/batch-1/profile-settings";

export const metadata: Metadata = {
  title: "Settings prototype · Caishen",
  robots: { index: false },
};

const pages = {
  profile: ProfileSettingsPrototype,
  appearance: AppearancePlaceholder,
  partner: PartnerSettingsPrototype,
  notifications: NotificationSettingsPrototype,
};

export default async function SettingsPrototypePage({
  params,
}: {
  params: Promise<{ page?: string[] }>;
}) {
  const { page } = await params;
  const name = page?.join("/") ?? "profile";
  if (!(name in pages)) notFound();
  const Page = pages[name as keyof typeof pages];
  return <Page />;
}
