"use client";

import { useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Card } from "~/components/ui/card";
import { Field } from "~/components/ui/field";
import { Select } from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { timezoneOptions } from "~/components/settings/timezone-options";
import type { Budget } from "~/domain/engine";
import shell from "~/components/app-shell/shell.module.css";
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
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const change = (update: Partial<Preferences>) => setError(onChange(update));
  return (
    <>
      <section className={shell.settingsSection} aria-label="Timezone">
        <Card>
          <div className={shell.settingRow}>
            <div className={shell.settingText}>
              <span className={shell.settingLabel}>Timezone</span>
              <span className={shell.settingHint}>
                Decides when a new month starts and when your daily email
                arrives.
              </span>
            </div>
            <div className={styles.settingControl}>
              <Field label="Timezone" labelHidden>
                <Select
                  value={value.timezone}
                  onChange={(timezone) => change({ timezone })}
                  options={timezoneOptions(value.timezone)}
                />
              </Field>
            </div>
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
              <span className={shell.settingLabel}>Send at</span>
              <span className={shell.settingHint}>
                {value.timezone.split("/").at(-1)?.replaceAll("_", " ")} time,
                your budget’s timezone.
              </span>
            </div>
            <div className={styles.settingControl}>
              <Field label="Send at" labelHidden>
                <Select
                  value={String(value.emailHour)}
                  disabled={!value.emailEnabled}
                  onChange={(hour) => change({ emailHour: Number(hour) })}
                  options={Array.from({ length: 24 }, (_, hour) => ({
                    value: String(hour),
                    label: hourLabel(hour),
                  }))}
                />
              </Field>
            </div>
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
