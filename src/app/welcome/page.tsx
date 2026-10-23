import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Onboarding } from "~/components/onboarding/onboarding";

export default async function WelcomePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/welcome");
  return <Onboarding />;
}
