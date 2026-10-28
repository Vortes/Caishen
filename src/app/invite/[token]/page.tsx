import { auth } from "@clerk/nextjs/server";
import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { InvitationLink } from "~/components/partner-invite/invitation";
import { SHELL_PATH } from "~/components/workspace/routes";
import { db } from "~/server/db";
import { openPartnerInvitation } from "~/server/services/partner-invites";

export const metadata: Metadata = {
  title: "Invitation · Caishen",
  robots: { index: false, follow: false },
};

// The sky runs edge to edge under the notch and home indicator.
export const viewport: Viewport = { viewportFit: "cover" };

// The link in an invitation email. Whoever holds it can open the card;
// the person who already accepted it goes on to their budget.
export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const { userId } = await auth();
  const invitation = await openPartnerInvitation(db, userId, token);
  if (invitation.status === "joined") redirect(SHELL_PATH);
  return (
    <InvitationLink
      path={`/invite/${encodeURIComponent(token)}`}
      invitation={invitation}
      signedIn={Boolean(userId)}
    />
  );
}
