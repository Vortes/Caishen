"use client";

import { useId, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { useUser } from "@clerk/nextjs";
import { ComposeInvitation } from "~/components/partner-invite/compose";
import { useShellData } from "~/components/app-shell/shell-data";
import styles from "~/components/app-shell/shell.module.css";
import additions from "~/components/entry/settings.module.css";
import batch from "~/components/entry/entry.module.css";

export function PartnerSettings() {
  const { partner } = useShellData();
  return (
    <div className={styles.settingsPage}>
      <section className={styles.settingsSection} aria-label="Partner">
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
            <InviteByEmail />
          )}
        </Card>
      </section>
    </div>
  );
}

// Invite a partner by email: they get the invitation the sender writes
// here, and it plays when they open it.
function InviteByEmail() {
  const id = useId();
  const { user } = useUser();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const own = user?.emailAddresses.map((address) =>
    address.emailAddress.toLowerCase(),
  );
  const from =
    user?.fullName ??
    user?.firstName ??
    user?.primaryEmailAddress?.emailAddress;

  const check = (value: string) => {
    const address = value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      return "Enter your partner’s full email address, like name@example.com.";
    if (own?.includes(address.toLowerCase()))
      return "That’s your own email. Enter your partner’s.";
    return null;
  };

  if (sent)
    return (
      <div className={styles.settingRow}>
        <div className={styles.settingText}>
          <span className={styles.settingLabel}>Invitation sent</span>
          <span className={styles.settingHint}>
            {sent} gets it by email. It brings them into your budget when they
            open it.
          </span>
        </div>
        <Button onClick={() => setSent(null)}>Cancel invitation</Button>
      </div>
    );

  const field = (
    <input
      ref={input}
      id={`${id}-email`}
      className={batch.input}
      // Alone in the row while writing, it takes the button's column too.
      style={writing ? { gridColumn: "1 / -1" } : undefined}
      type="email"
      autoComplete="off"
      spellCheck={false}
      data-1p-ignore
      value={email}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      onChange={(event) => {
        setEmail(event.target.value);
        // Once wrong, it's checked as they fix it.
        if (error) setError(check(event.target.value));
      }}
    />
  );

  return (
    <>
      <div className={styles.settingText}>
        <span className={styles.settingLabel}>Invite your partner</span>
        <form
          className={additions.inlineForm}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const problem = check(email);
            setError(problem);
            if (!problem) setWriting(true);
          }}
        >
          <div className={batch.field}>
            <label className={batch.fieldLabel} htmlFor={`${id}-email`}>
              Partner’s email
            </label>
            <div className={additions.joinRow}>
              {field}
              {/* While the invitation is being written, its Send is the
                  card's one primary action. */}
              {!writing && (
                <Button type="submit" variant="primary" disabled={!from}>
                  Write invitation
                </Button>
              )}
            </div>
            {error && (
              <span id={`${id}-error`} className={styles.settingError}>
                {error}
              </span>
            )}
          </div>
        </form>
      </div>
      {writing && from && (
        <>
          <div className={styles.settingDivider} />
          <ComposeInvitation
            from={from}
            onCancel={() => setWriting(false)}
            onSend={async () => {
              const problem = check(email);
              if (problem) {
                setError(problem);
                input.current?.focus();
                return;
              }
              // Not wired to the server yet: the invitation isn't stored or
              // emailed.
              setWriting(false);
              setSent(email.trim());
              setEmail("");
            }}
          />
        </>
      )}
    </>
  );
}
