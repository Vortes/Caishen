"use client";

import { useEffect, useState } from "react";
import { api } from "~/trpc/react";
import type { Panel } from "~/components/budget/types";
import { Icon } from "~/components/shared";
import { Button } from "~/components/ui-legacy/button";

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
        Share costs like rent. Everything else stays private.
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
