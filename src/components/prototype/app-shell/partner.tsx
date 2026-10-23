"use client";

import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { api } from "~/trpc/react";
import {
  CodeDisplay,
  CodeField,
  isComplete,
  useLock,
} from "~/components/entry/invite-code";
import { useShellData } from "./shell-data";
import styles from "./shell.module.css";
import additions from "~/components/entry/settings.module.css";

export function PartnerSettings({ blocked }: { blocked?: string } = {}) {
  const { partner } = useShellData();
  const id = useId();
  const invite = api.budget.invite.useMutation();
  const utils = api.useUtils();
  const join = api.budget.join.useMutation({
    onSuccess: async () => {
      await utils.budget.invalidate();
      window.location.reload();
    },
  });
  const [code, setCode] = useState("");
  const locked = useLock(join.error?.data?.code === "TOO_MANY_REQUESTS");
  return (
    <div className={styles.settingsPage}>
      <section className={styles.settingsSection} aria-label="Partner">
        <p className={styles.settingsIntro}>
          Split categories like rent with one partner. They see shared expenses,
          allocations, and repayments; your other transactions and balances stay
          private.
        </p>
        <Card>
          {partner ? (
            <div className={styles.settingRow}>
              <div className={styles.settingText}>
                <span className={styles.settingLabel}>
                  Connected with {partner.name}
                </span>
                <span className={styles.settingHint}>
                  {partner.name === "Deleted partner"
                    ? "Existing shared balances are frozen. New spending stays in your personal budget."
                    : "A budget has room for one partner."}
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.settingRow}>
                <div className={styles.settingText}>
                  <span className={styles.settingLabel}>
                    Invite your partner
                  </span>
                  <span className={styles.settingHint}>
                    They enter the code in their own Caishen account. It works
                    once and expires in 24 hours.
                  </span>
                  {invite.error && (
                    <span className={styles.settingError} role="alert">
                      {invite.error.message}
                    </span>
                  )}
                </div>
                {!invite.data && (
                  <Button
                    variant="primary"
                    disabled={invite.isPending}
                    onClick={() => invite.mutate()}
                  >
                    {invite.isPending ? "Creating code…" : "Create code"}
                  </Button>
                )}
              </div>
              {invite.data && (
                <CodeDisplay
                  code={invite.data.code}
                  expires={new Intl.DateTimeFormat("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(invite.data.expiresAt)}
                  onNew={invite.isPending ? undefined : () => invite.mutate()}
                />
              )}
              <div className={styles.settingDivider} />
              <div className={styles.settingRow}>
                <div className={styles.settingText}>
                  <span className={styles.settingLabel}>
                    Have your partner’s code?
                  </span>
                  <span className={styles.settingHint}>
                    Connect your budgets while keeping personal spending
                    private.
                  </span>
                  {blocked && (
                    <span className={styles.settingHint}>{blocked}</span>
                  )}
                  <div className={additions.inlineForm}>
                    <CodeField
                      id={`${id}-join`}
                      label="Invitation code"
                      value={code}
                      onChange={(next) => {
                        setCode(next);
                        join.reset();
                      }}
                      locked={locked}
                      error={join.error?.message ?? null}
                      action={
                        <Button
                          variant="primary"
                          disabled={
                            !isComplete(code) ||
                            join.isPending ||
                            Boolean(locked) ||
                            Boolean(blocked)
                          }
                          onClick={() => join.mutate({ code })}
                        >
                          {join.isPending ? "Connecting…" : "Connect budgets"}
                        </Button>
                      }
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </Card>
      </section>
    </div>
  );
}
