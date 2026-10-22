"use client";

import { CheckIcon, CircleAlertIcon, CopyIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import shell from "~/components/prototype/app-shell/shell.module.css";
import { myInviteCode, partner } from "./mock";
import {
  Choice,
  PrototypeBar,
  useNotice,
  useStored,
  useTheme,
} from "./prototype";
import { SettingsFrame } from "./settings-frame";
import batch from "./batch.module.css";
import styles from "./settings.module.css";

// The variable the variants move: how prominent joining is next to
// inviting. Most people invite; the person invited usually joins during
// onboarding, so here joining is for someone who already has a budget.
type Variant = "rows" | "link";
type CodeResult = "valid" | "expired" | "own";

export function PartnerSettingsPrototype() {
  const [theme, setTheme] = useTheme();
  const [variant, setVariant] = useStored<Variant>("partner.variant", "rows");
  const [connected, setConnected] = useStored("partner.connected", false);
  const [result, setResult] = useStored<CodeResult>("partner.code", "valid");
  const notice = useNotice();

  return (
    <SettingsFrame
      page="partner"
      theme={theme}
      controls={
        <PrototypeBar
          title="Settings › Partner"
          theme={theme}
          onTheme={setTheme}
        >
          <Choice
            label="Variant: joining is"
            value={variant}
            options={[
              ["rows", "A row beside inviting"],
              ["link", "Behind a link"],
            ]}
            onChange={setVariant}
          />
          <Choice
            label="Partner"
            value={connected ? "yes" : "no"}
            options={[
              ["no", "None yet"],
              ["yes", "Connected"],
            ]}
            onChange={(value) => setConnected(value === "yes")}
          />
          <Choice
            label="Code entered"
            value={result}
            options={[
              ["valid", "Valid"],
              ["expired", "Expired or used"],
              ["own", "Your own code"],
            ]}
            onChange={setResult}
          />
        </PrototypeBar>
      }
    >
      <div className={shell.settingsPage}>
        <section className={shell.settingsSection} aria-label="Partner">
          <p className={shell.settingsIntro}>
            Split categories like rent with one partner. They see shared
            expenses, allocations, and repayments; your other transactions and
            balances stay private.
          </p>
          <Card>
            {connected ? (
              <div className={shell.settingRow}>
                <div className={shell.settingLead}>
                  <span className={styles.partnerAvatar} aria-hidden>
                    J
                  </span>
                  <div className={shell.settingText}>
                    <span className={shell.settingLabel}>
                      Connected with {partner.fullName}
                    </span>
                    <span className={shell.settingHint}>
                      Since {partner.connectedOn}. A budget has room for one
                      partner.
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <Invite />
                <div className={shell.settingDivider} />
                <Join
                  variant={variant}
                  result={result}
                  onJoined={() => {
                    setConnected(true);
                    notice.show(`Connected with ${partner.fullName}`);
                  }}
                />
              </>
            )}
          </Card>
        </section>
      </div>
      {notice.region}
    </SettingsFrame>
  );
}

function Invite() {
  const [code, setCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <div className={shell.settingRow}>
        <div className={shell.settingText}>
          <span className={shell.settingLabel}>Invite your partner</span>
          <span className={shell.settingHint}>
            They enter the code in their own account. It works once and expires
            in 24 hours.
          </span>
        </div>
        {!code && (
          <Button
            variant="primary"
            disabled={creating}
            onClick={() => {
              setCreating(true);
              window.setTimeout(() => {
                setCreating(false);
                setCode(myInviteCode);
              }, 600);
            }}
          >
            {creating ? "Creating code…" : "Create code"}
          </Button>
        )}
      </div>
      {code && (
        <div className={shell.inviteCode}>
          <code>{code}</code>
          <Button size="sm" onClick={() => setCopied(true)}>
            {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </>
  );
}

const errors: Record<Exclude<CodeResult, "valid">, string> = {
  expired:
    "This code is expired or already used. Ask your partner for a new one; each works once, for 24 hours.",
  own: "That’s the code you created. Give it to your partner to enter in their own account.",
};

function Join({
  variant,
  result,
  onJoined,
}: {
  variant: Variant;
  result: CodeResult;
  onJoined: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(variant === "rows");
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOpen(variant === "rows"), [variant]);

  const join = () => {
    if (code.trim().length < 20)
      return setError("Paste the whole code. It’s 32 letters and numbers.");
    setError(null);
    setJoining(true);
    window.setTimeout(() => {
      setJoining(false);
      if (result === "valid") onJoined();
      else setError(errors[result]);
    }, 900);
  };

  if (!open)
    return (
      <div>
        <Button variant="quiet" onClick={() => setOpen(true)}>
          Have a code from your partner?
        </Button>
      </div>
    );

  return (
    <form
      className={styles.joinForm}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        join();
      }}
    >
      <div className={shell.settingText}>
        <label className={shell.settingLabel} htmlFor={`${id}-code`}>
          Join your partner
        </label>
        <span className={shell.settingHint}>
          Got a code from them? Your budget stays yours; you’ll both see the
          categories you share and who owes whom.
        </span>
      </div>
      <div className={styles.joinRow}>
        <input
          id={`${id}-code`}
          className={`${batch.input} ${batch.code}`}
          value={code}
          placeholder="Paste their code"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button type="submit" disabled={joining}>
          {joining ? "Joining…" : "Join"}
        </Button>
      </div>
      {error && (
        <span id={`${id}-error`} className={batch.error} role="alert">
          <CircleAlertIcon size={13} aria-hidden />
          {error}
        </span>
      )}
    </form>
  );
}
