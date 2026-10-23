"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { api } from "~/trpc/react";
import { useShellData } from "./shell-data";
import styles from "./shell.module.css";

// Creates a real invitation through the same API as the legacy app. Joining
// with a partner's code still happens there.
export function PartnerSettings() {
  const { partner } = useShellData();
  const invite = api.budget.invite.useMutation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const code = invite.data?.code;

  return (
    <div className={styles.settingsPage}>
      <section className={styles.settingsSection} aria-label="Partner">
        <p className={styles.settingsIntro}>
          Share costs like rent with one partner. They see the purchases you
          share with them and the payments between you; your categories, other
          transactions, and balances stay private.
        </p>
        <Card>
          {partner ? (
            <div className={styles.settingRow}>
              <div className={styles.settingText}>
                <span className={styles.settingLabel}>
                  Connected with {partner.name}
                </span>
                <span className={styles.settingHint}>
                  A budget has room for one partner.
                </span>
              </div>
            </div>
          ) : (
            <div className={styles.settingRow}>
              <div className={styles.settingText}>
                <span className={styles.settingLabel}>Invite your partner</span>
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
              {!code && (
                <Button
                  variant="primary"
                  disabled={invite.isPending}
                  onClick={() => invite.mutate()}
                >
                  {invite.isPending ? "Creating code…" : "Create code"}
                </Button>
              )}
            </div>
          )}
          {code && !partner && (
            <div className={styles.inviteCode}>
              <code>{code}</code>
              <Button
                size="sm"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(code)
                    .then(() => setCopied(true))
                }
              >
                {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
