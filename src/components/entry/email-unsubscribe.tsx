"use client";

import { useState } from "react";
import { CircleAlertIcon, CircleCheckIcon, MailIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { EntryPage } from "./entry-page";
import { Brand } from "./brand";
import styles from "./unsubscribe.module.css";
import batch from "./entry.module.css";

export function EmailUnsubscribe({ token }: { token: string }) {
  const subscription = api.budget.emailSubscription.useQuery(
    { token },
    { retry: false },
  );
  const [changed, setChanged] = useState(false);
  const change = api.budget.setEmailSubscription.useMutation({
    onSuccess: async () => {
      setChanged(true);
      await subscription.refetch();
    },
  });
  const enabled = subscription.data?.enabled;
  const broken = Boolean(subscription.error);
  const Icon = broken
    ? CircleAlertIcon
    : enabled && !changed
      ? MailIcon
      : CircleCheckIcon;
  return (
    <EntryPage>
      <div className={styles.page}>
        <Brand />
        <main className={styles.card}>
          <div className={styles.message}>
            <span className={styles.icon}>
              <Icon size={20} aria-hidden />
            </span>
            <div className={styles.text}>
              <h1 className={styles.title}>
                {broken
                  ? "This link doesn’t work anymore"
                  : subscription.isPending
                    ? "Opening your email preferences…"
                    : enabled
                      ? changed
                        ? "Daily emails are back on"
                        : "Turn off the daily email?"
                      : changed
                        ? "You’re unsubscribed"
                        : "Daily emails are already off"}
              </h1>
              <p className={styles.body}>
                {broken
                  ? "It may be from an old email, or it was cut short when copied. Sign in to turn the daily email off in Settings."
                  : subscription.data
                    ? `${enabled ? "Daily review emails go to" : "No more daily review emails will be sent to"} ${subscription.data.email}. Your budget and bank updates keep working.`
                    : ""}
              </p>
              {change.error && (
                <p className={batch.error} role="alert">
                  {change.error.message}
                </p>
              )}
              <div className={batch.actions}>
                {subscription.data && (
                  <Button
                    variant="primary"
                    disabled={change.isPending || subscription.isFetching}
                    onClick={() => change.mutate({ token, enabled: !enabled })}
                  >
                    {change.isPending
                      ? "Saving…"
                      : enabled
                        ? "Turn off daily emails"
                        : "Turn daily emails back on"}
                  </Button>
                )}
                <Button asChild>
                  <Link href="/sign-in">Sign in to Caishen</Link>
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </EntryPage>
  );
}
