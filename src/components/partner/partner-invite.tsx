"use client";

import Link from "next/link";
import { settingsPages } from "~/components/workspace/routes";

export function PartnerSettingsLink() {
  return (
    <section className="inspector-section">
      <h3>Partner</h3>
      <p className="inspector-note">
        Share costs like rent. Everything else stays private.
      </p>
      <Link href={settingsPages.partner}>Connect your partner in Settings</Link>
    </section>
  );
}
