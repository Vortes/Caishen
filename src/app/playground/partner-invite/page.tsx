import type { Viewport } from "next";
import { PartnerInviteLab } from "~/components/playground/partner-invite/lab";
import { readSavedConfig } from "~/components/playground/partner-invite/saved-config";
// proto:cloud-font
import { CloudFontProto } from "~/components/playground/partner-invite/proto-cloud-font/harness";

// The sky runs edge to edge under the notch and home indicator; the
// signing buttons pad themselves back out with the safe-area insets.
export const viewport: Viewport = { viewportFit: "cover" };

export default async function PartnerInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ sky?: string }>;
}) {
  const { sky } = await searchParams;
  const lab = (
    <PartnerInviteLab
      sky={sky === "night" ? "night" : "day"}
      config={await readSavedConfig()}
    />
  );
  // proto:cloud-font start — dev-only face picker; revert this block when done.
  if (process.env.NODE_ENV === "development")
    return <CloudFontProto>{lab}</CloudFontProto>;
  // proto:cloud-font end
  return lab;
}
