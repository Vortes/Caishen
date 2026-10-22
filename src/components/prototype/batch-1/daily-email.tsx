"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Switch } from "~/components/ui/switch";
import shell from "~/components/prototype/app-shell/shell.module.css";
import { hourLabel, me, timezoneCity, timezoneLabel, timezones } from "./mock";
import { UNSUBSCRIBE_PATH } from "./routes";
import batch from "./batch.module.css";
import styles from "./settings.module.css";

export type EmailSettings = {
  on: boolean;
  hour: number;
  timezone: string;
  // Set when the email's unsubscribe link turned it off.
  unsubscribedOn: string | null;
};

export const initialEmail: EmailSettings = {
  on: true,
  hour: 8,
  timezone: "America/Los_Angeles",
  unsubscribedOn: null,
};

const hours = Array.from({ length: 24 }, (_, hour) => hour);

// The budget's timezone, a row in the Profile card beside its name. When
// this browser is somewhere else, one button moves the budget there.
export function TimezoneRow({
  timezone,
  browserZone,
  onChange,
}: {
  timezone: string;
  browserZone: string;
  onChange: (timezone: string) => void;
}) {
  const id = useId();
  return (
    <>
      <div className={shell.settingRow}>
        <div className={shell.settingText}>
          <label className={shell.settingLabel} htmlFor={id}>
            Timezone
          </label>
          <span className={shell.settingHint}>
            Decides when a new month starts, which day is today, and when the
            daily email goes out.
          </span>
        </div>
        <select
          id={id}
          className={`${batch.select} ${styles.settingSelect}`}
          value={timezone}
          onChange={(event) => onChange(event.target.value)}
        >
          {timezones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.label}
            </option>
          ))}
        </select>
      </div>
      {browserZone !== timezone && (
        <div className={styles.zoneHint}>
          <span className={shell.settingHint}>
            This browser is on {timezoneLabel(browserZone)}. If you’re only
            traveling, keep the budget on {timezoneCity(timezone)} time.
          </span>
          <Button size="sm" onClick={() => onChange(browserZone)}>
            Use {timezoneCity(browserZone)}
          </Button>
        </div>
      )}
    </>
  );
}

// Every control applies the moment it changes, like the rest of Settings;
// the line under the card says what happens next.
export function DailyEmailSection({
  email,
  onChange,
}: {
  email: EmailSettings;
  onChange: (change: Partial<EmailSettings>) => void;
}) {
  const id = useId();
  const [preview, setPreview] = useState(false);
  return (
    <section
      id="daily-email"
      className={shell.settingsSection}
      aria-labelledby={`${id}-heading`}
    >
      <h2 id={`${id}-heading`} className={shell.settingsHeading}>
        Daily review email
      </h2>
      <p className={shell.settingsIntro}>
        One short email each morning: what’s waiting in your review list and any
        bank that needs reconnecting. Missed days don’t pile up.
      </p>
      <Card>
        <label className={shell.settingRow}>
          <span className={shell.settingText}>
            <span className={shell.settingLabel}>Send the daily review</span>
            <span className={shell.settingHint}>
              {email.unsubscribedOn && !email.on
                ? `You unsubscribed from the email on ${email.unsubscribedOn}. Turn it back on any time.`
                : `To ${me.email}.`}
            </span>
          </span>
          <Switch
            checked={email.on}
            onCheckedChange={(on) =>
              onChange({ on, unsubscribedOn: on ? null : email.unsubscribedOn })
            }
          />
        </label>
        <div className={shell.settingDivider} />
        <div className={shell.settingRow}>
          <div className={shell.settingText}>
            <label className={shell.settingLabel} htmlFor={`${id}-hour`}>
              Send at
            </label>
            <span className={shell.settingHint}>
              {timezoneCity(email.timezone)} time, your budget’s timezone.
            </span>
          </div>
          <select
            id={`${id}-hour`}
            className={`${batch.select} ${styles.settingSelect}`}
            value={email.hour}
            disabled={!email.on}
            onChange={(event) => onChange({ hour: Number(event.target.value) })}
          >
            {hours.map((hour) => (
              <option key={hour} value={hour}>
                {hourLabel(hour)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.nextEmail}>
          <span role="status">
            {email.on
              ? `Next email tomorrow, Thursday, Oct 22, at ${hourLabel(email.hour)} ${timezoneCity(email.timezone)} time.`
              : "No emails until you turn it back on."}
          </span>
          <Button
            size="sm"
            variant="quiet"
            aria-expanded={preview}
            onClick={() => setPreview(!preview)}
          >
            {preview ? "Hide the email" : "Show the email"}
            <ChevronRightIcon
              className={styles.previewChevron}
              data-open={preview || undefined}
              aria-hidden
            />
          </Button>
        </div>
      </Card>
      {preview && <EmailPreview hour={email.hour} timezone={email.timezone} />}
    </section>
  );
}

// The email as a mail app shows it, in the light theme, with the new
// unsubscribe link in its footer.
function EmailPreview({ hour, timezone }: { hour: number; timezone: string }) {
  return (
    <div className={styles.email} data-theme="light">
      <div className={styles.emailMeta}>
        <span>
          <strong>Caishen</strong> &lt;review@curate.is&gt;
        </span>
        <span>
          {hourLabel(hour)} · {timezoneCity(timezone)}
        </span>
      </div>
      <p className={styles.emailSubject}>3 items to review in Caishen</p>
      <div className={styles.emailBody}>
        <p>3 unresolved items are in your private review inbox.</p>
        <p>
          Latest successful account update: today at 6:12 a.m. Bank data may
          arrive later than the transaction.
        </p>
        <p>
          <span className={styles.emailLink}>Open your inbox</span>
        </p>
        <p>
          Your inbox keeps unresolved items together, including after missed
          days.
        </p>
      </div>
      <p className={styles.emailFooter}>
        You get this because the daily review is on for {me.budgetName}.{" "}
        <span className={styles.emailLink}>Change when it arrives</span> ·{" "}
        <Link className={styles.emailLink} href={UNSUBSCRIBE_PATH}>
          Unsubscribe
        </Link>
      </p>
    </div>
  );
}
