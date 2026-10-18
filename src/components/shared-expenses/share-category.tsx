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
        <span>
          <Icon name="shared" size={15} />
          Share with your partner
        </span>
      </h3>
      <p className="inspector-note">
        Split purchases in {category.name} with your partner. Equal shares by
        default.
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="inspector-wide-action"
        onClick={() =>
          open({ type: "shared-category", categoryId: category.id })
        }
      >
        Share this category
      </Button>
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
      <h3>
        <span>
          <Icon name="shared" size={15} />
          Share with your partner
        </span>
      </h3>
      <p className="inspector-note">
        Split categories like rent or groceries. You each keep your own budget,
        and your accounts and other spending stay private.
      </p>
      {code && (
        <div className="partner-code">
          <p className="inspector-note">
            Your partner enters this code from their own budget.
          </p>
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
