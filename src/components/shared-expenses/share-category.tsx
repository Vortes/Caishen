"use client";

import { useEffect, useState } from "react";
import { api } from "~/trpc/react";
import type { Panel } from "~/components/budget/types";
import type { Category } from "~/components/budget/category-table";
import { Icon } from "~/components/shared";
import { Button } from "~/components/ui/button";

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

export function PartnerInvite({ open }: { open: (panel: Panel) => void }) {
  const invite = api.budget.invite.useMutation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const code = invite.data?.code;
  return (
    <section className="inspector-section">
      <h3>Partner</h3>
      <p className="inspector-note">
        Split categories like rent. Everything else stays private.
      </p>
      {code && (
        <div className="partner-code">
          <p className="inline-code">{code}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void navigator.clipboard.writeText(code).then(
                () => setCopied(true),
                () => undefined,
              )
            }
          >
            <Icon name={copied ? "check" : "copy"} size={14} />
            {copied ? "Copied" : "Copy code"}
          </Button>
        </div>
      )}
      <div className="partner-actions">
        {!code && (
          <Button
            variant="secondary"
            size="sm"
            disabled={invite.isPending}
            onClick={() => invite.mutate()}
          >
            {invite.isPending
              ? "Creating invitation…"
              : "Create invitation code"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => open({ type: "join" })}
        >
          Enter partner’s code
        </Button>
      </div>
      {invite.error && (
        <p className="form-error" role="alert">
          {invite.error.message}
        </p>
      )}
    </section>
  );
}
