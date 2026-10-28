import type { Viewport } from "next";
import { PartnerInviteLab } from "~/components/playground/partner-invite/lab";
import { readSavedConfig } from "~/components/playground/partner-invite/saved-config";

// The sky runs edge to edge under the notch and home indicator; the
// signing buttons pad themselves back out with the safe-area insets.
export const viewport: Viewport = { viewportFit: "cover" };

export default async function PartnerInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ sky?: string }>;
}) {
  const { sky } = await searchParams;
  return (
    <PartnerInviteLab
      sky={sky === "night" ? "night" : "day"}
      config={await readSavedConfig()}
    />
  );
}
