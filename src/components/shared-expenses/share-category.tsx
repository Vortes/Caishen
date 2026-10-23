"use client";

import Link from "next/link";
import { settingsPages } from "~/components/workspace/routes";
import type { Panel } from "~/components/budget/types";
import type { Category } from "~/components/budget/category-table";
import { Button } from "~/components/ui-legacy/button";

export function ShareCategory({
  category,
  open,
}: {
  category: Category;
  open: (panel: Panel) => void;
}) {
  return (
    <section className="inspector-section">
      <h3>
        Partner
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            open({ type: "shared-category", categoryId: category.id })
          }
        >
          Share category
        </Button>
      </h3>
    </section>
  );
}

export function PartnerSettingsLink() {
  return (
    <section className="inspector-section">
      <h3>Partner</h3>
      <p className="inspector-note">
        Split categories like rent. Everything else stays private.
      </p>
      <Link href={settingsPages.partner}>Connect your partner in Settings</Link>
    </section>
  );
}
