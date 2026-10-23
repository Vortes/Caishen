import { EmailUnsubscribe } from "~/components/entry/email-unsubscribe";

export const metadata = {
  title: "Daily email · Caishen",
  robots: { index: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <EmailUnsubscribe token={typeof token === "string" ? token : ""} />;
}
