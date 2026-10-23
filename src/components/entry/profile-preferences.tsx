"use client";

import { useId, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { TimezoneOptions } from "~/components/settings/timezone-options";
import type { Budget } from "~/domain/engine";
import shell from "~/components/prototype/app-shell/shell.module.css";
import batch from "./entry.module.css";
import styles from "./settings.module.css";

export type Preferences = Budget["settings"];
export type UpdatePreferences = (change: Partial<Preferences>) => string | null;

const hourLabel = (hour: number) =>
  `${hour % 12 || 12} ${hour < 12 ? "a.m." : "p.m."}`;

export function ProfilePreferences({
  value,
  onChange,
}: {
  value: Preferences;
  onChange: UpdatePreferences;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const change = (update: Partial<Preferences>) => setError(onChange(update));
  return (
    <>
      <section className={shell.settingsSection} aria-label="Timezone">
        <Card>
          <div className={shell.settingRow}>
            <div className={shell.settingText}>
              <label className={shell.settingLabel} htmlFor={`${id}-timezone`}>
                Timezone
              </label>
              <span className={shell.settingHint}>
                Decides when a new month starts and when your daily email
                arrives.
              </span>
            </div>
            <select
              id={`${id}-timezone`}
              className={`${batch.select} ${styles.settingSelect}`}
              value={value.timezone}
              onChange={(event) => change({ timezone: event.target.value })}
            >
              <TimezoneOptions include={value.timezone} />
            </select>
          </div>
        </Card>
      </section>
      <section
        className={shell.settingsSection}
        aria-label="Daily review email"
      >
        <h2 className={shell.settingsHeading}>Daily review email</h2>
        <p className={shell.settingsIntro}>
          One short email each morning: what’s waiting in your review list and
          any bank updates that need a look.
        </p>
        <Card>
          <label className={shell.settingRow}>
            <span className={shell.settingText}>
              <span className={shell.settingLabel}>Send the daily review</span>
              <span className={shell.settingHint}>
                Your budget and bank updates keep working when this is off.
              </span>
            </span>
            <Switch
              aria-label="Send the daily review"
              checked={value.emailEnabled}
              onCheckedChange={(emailEnabled) => change({ emailEnabled })}
            />
          </label>
          <div className={shell.settingDivider} />
          <div className={shell.settingRow}>
            <div className={shell.settingText}>
              <label className={shell.settingLabel} htmlFor={`${id}-hour`}>
                Send at
              </label>
              <span className={shell.settingHint}>
                {value.timezone.split("/").at(-1)?.replaceAll("_", " ")} time,
                your budget’s timezone.
              </span>
            </div>
            <select
              id={`${id}-hour`}
              className={`${batch.select} ${styles.settingSelect}`}
              value={value.emailHour}
              disabled={!value.emailEnabled}
              onChange={(event) =>
                change({ emailHour: Number(event.target.value) })
              }
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {hourLabel(hour)}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.nextEmail}>
            <span role="status">
              {value.emailEnabled
                ? `Daily at ${hourLabel(value.emailHour)} in your timezone.`
                : "No emails until you turn it back on."}
            </span>
            <Button
              size="sm"
              variant="quiet"
              aria-expanded={preview}
              onClick={() => setPreview(!preview)}
            >
              {preview ? "Hide the email" : "Show the email"}
              <ChevronRightIcon aria-hidden />
            </Button>
          </div>
        </Card>
        {preview && (
          <div className={styles.email} data-theme="light">
            <strong className={styles.emailSubject}>
              Your Caishen daily review
            </strong>
            <div className={styles.emailBody}>
              <p>Unresolved items are waiting in your private review inbox.</p>
              <p>
                The email includes the latest successful bank update and a link
                to review your transactions.
              </p>
            </div>
            <p className={styles.emailFooter}>
              Turn off daily emails from the footer of any review email or here
              in Settings.
            </p>
          </div>
        )}
      </section>
      {error && (
        <p className={shell.settingError} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
