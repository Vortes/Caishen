"use client";

import Link from "next/link";
import { useId } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Switch } from "~/components/ui/switch";
import shell from "~/components/prototype/app-shell/shell.module.css";
import { useBrandName } from "./brand";
import { hourLabel, me, timezoneCity, timezoneLabel, timezones } from "./mock";
import { Choice, PrototypeBar, useStored, useTheme } from "./prototype";
import { UNSUBSCRIBE_PATH } from "./routes";
import { SettingsFrame } from "./settings-frame";
import batch from "./batch.module.css";
import styles from "./settings.module.css";

type Email = {
  on: boolean;
  hour: number;
  timezone: string;
  // Set when the email's unsubscribe link turned it off.
  unsubscribedOn: string | null;
};

const initialEmail: Email = {
  on: true,
  hour: 8,
  timezone: "America/Los_Angeles",
  unsubscribedOn: null,
};

const hours = Array.from({ length: 24 }, (_, hour) => hour);

// Every control applies the moment it changes, like the rest of Settings;
// the line under the card says what happens next.
export function NotificationSettingsPrototype() {
  const [theme, setTheme] = useTheme();
  const [name] = useBrandName();
  const [email, setEmail] = useStored<Email>(
    "notifications.email",
    initialEmail,
  );
  const [browserZone, setBrowserZone] = useStored(
    "notifications.browser-zone",
    "America/Los_Angeles",
  );
  const id = useId();
  const change = (next: Partial<Email>) =>
    setEmail((current) => ({ ...current, ...next }));

  return (
    <SettingsFrame
      page="notifications"
      theme={theme}
      controls={
        <PrototypeBar
          title="Settings › Notifications"
          theme={theme}
          onTheme={setTheme}
        >
          <Choice
            label="Email"
            value={
              email.on ? "on" : email.unsubscribedOn ? "unsubscribed" : "off"
            }
            options={[
              ["on", "On"],
              ["off", "Turned off here"],
              ["unsubscribed", "Unsubscribed from the email"],
            ]}
            onChange={(value) =>
              change({
                on: value === "on",
                unsubscribedOn: value === "unsubscribed" ? "Oct 20" : null,
              })
            }
          />
          <Choice
            label="This browser’s timezone"
            value={browserZone}
            options={[
              ["America/Los_Angeles", "Same as budget"],
              ["America/New_York", "New York (traveling)"],
            ]}
            onChange={setBrowserZone}
          />
        </PrototypeBar>
      }
    >
      <div className={shell.settingsPage}>
        <section className={shell.settingsSection}>
          <h2 className={shell.settingsHeading}>Daily review email</h2>
          <p className={shell.settingsIntro}>
            One short email each morning: what’s waiting in your review list and
            any bank that needs reconnecting. Missed days don’t pile up.
          </p>
          <Card>
            <label className={shell.settingRow}>
              <span className={shell.settingText}>
                <span className={shell.settingLabel}>
                  Send the daily review
                </span>
                <span className={shell.settingHint}>
                  {email.unsubscribedOn && !email.on
                    ? `You unsubscribed from the email on ${email.unsubscribedOn}. Turn it back on any time.`
                    : `To ${me.email}.`}
                </span>
              </span>
              <Switch
                checked={email.on}
                onCheckedChange={(on) =>
                  change({
                    on,
                    unsubscribedOn: on ? null : email.unsubscribedOn,
                  })
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
                  In your budget’s timezone, below.
                </span>
              </div>
              <select
                id={`${id}-hour`}
                className={`${batch.select} ${styles.settingSelect}`}
                value={email.hour}
                disabled={!email.on}
                onChange={(event) =>
                  change({ hour: Number(event.target.value) })
                }
              >
                {hours.map((hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </select>
            </div>
            <p className={styles.nextEmail} role="status">
              {email.on
                ? `Next email tomorrow, Thursday, Oct 22, at ${hourLabel(email.hour)} ${timezoneCity(email.timezone)} time.`
                : "No emails until you turn it back on."}
            </p>
          </Card>
        </section>

        <section className={shell.settingsSection}>
          <h2 className={shell.settingsHeading}>Timezone</h2>
          <Card>
            <div className={shell.settingRow}>
              <div className={shell.settingText}>
                <label className={shell.settingLabel} htmlFor={`${id}-zone`}>
                  Budget timezone
                </label>
                <span className={shell.settingHint}>
                  Decides when a new month starts, which day today is, and when
                  the daily email goes out.
                </span>
              </div>
              <select
                id={`${id}-zone`}
                className={`${batch.select} ${styles.settingSelect}`}
                value={email.timezone}
                onChange={(event) => change({ timezone: event.target.value })}
              >
                {timezones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.label}
                  </option>
                ))}
              </select>
            </div>
            {browserZone !== email.timezone && (
              <>
                <div className={shell.settingDivider} />
                <div className={shell.settingRow}>
                  <span className={shell.settingHint}>
                    This browser is on {timezoneLabel(browserZone)}. Keep the
                    budget on {timezoneCity(email.timezone)} time if you’re
                    traveling.
                  </span>
                  <Button
                    size="sm"
                    onClick={() => change({ timezone: browserZone })}
                  >
                    Use {timezoneCity(browserZone)}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </section>

        <section className={shell.settingsSection}>
          <h2 className={shell.settingsHeading}>Preview</h2>
          <p className={shell.settingsIntro}>
            The email as it lands, with the new unsubscribe link in its footer.
            Mail apps also show their own Unsubscribe button for it.
          </p>
          <EmailPreview
            name={name}
            hour={email.hour}
            timezone={email.timezone}
          />
        </section>
      </div>
    </SettingsFrame>
  );
}

function EmailPreview({
  name,
  hour,
  timezone,
}: {
  name: string;
  hour: number;
  timezone: string;
}) {
  return (
    <div className={styles.email} data-theme="light">
      <div className={styles.emailMeta}>
        <span>
          <strong>{name}</strong> &lt;review@curate.is&gt;
        </span>
        <span>
          {hourLabel(hour)} · {timezoneCity(timezone)}
        </span>
      </div>
      <p className={styles.emailSubject}>3 items to review in {name}</p>
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
