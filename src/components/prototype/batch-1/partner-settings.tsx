"use client";

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
import {
  CodeDisplay,
  CodeField,
  codeError,
  isComplete,
  useLock,
  type CodeResult,
} from "./invite-code";
import { SettingsFrame } from "./settings-frame";
import styles from "./settings.module.css";

// The variable the variants move: how prominent joining is next to
// inviting. Most people invite; the person invited usually joins during
// onboarding, so here joining is for someone who already has a budget.
type Variant = "rows" | "link";

export function PartnerSettingsPrototype() {
  const [theme, setTheme] = useTheme();
  const [variant, setVariant] = useStored<Variant>("partner.variant", "rows");
  const [connected, setConnected] = useStored("partner.connected", false);
  const [result, setResult] = useStored<CodeResult>("partner.join", "valid");
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
              ["expired", "Expired"],
              ["used", "Already used"],
              ["full", "Partner already has one"],
              ["own", "Your own code"],
              ["invalid", "No match"],
              ["rate-limited", "Too many tries"],
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
  const create = (next: string) => {
    setCreating(true);
    window.setTimeout(() => {
      setCreating(false);
      setCode(next);
    }, 600);
  };
  return (
    <>
      <div className={shell.settingRow}>
        <div className={shell.settingText}>
          <span className={shell.settingLabel}>Invite your partner</span>
          <span className={shell.settingHint}>
            {code
              ? "Read it out or send it. They enter it in their own account, when they sign up or later in Settings."
              : "Create a code for them to enter in their own account. It works once, for 24 hours."}
          </span>
        </div>
        {!code && (
          <Button
            variant="primary"
            disabled={creating}
            onClick={() => create(myInviteCode)}
          >
            {creating ? "Creating code…" : "Create code"}
          </Button>
        )}
      </div>
      {code && (
        <CodeDisplay
          code={code}
          expires="tomorrow at 9:41 a.m."
          // A new code replaces the old one, which stops working.
          onNew={() =>
            create(code === myInviteCode ? "R2VN-8HTK" : myInviteCode)
          }
        />
      )}
    </>
  );
}

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
  const [outcome, setOutcome] = useState<CodeResult | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const locked = useLock(outcome === "rate-limited");
  useEffect(() => setOpen(variant === "rows"), [variant]);
  const error = incomplete
    ? "Enter all 8 characters."
    : outcome
      ? codeError(outcome, code)
      : null;

  const join = () => {
    if (!isComplete(code)) return setIncomplete(true);
    setIncomplete(false);
    setOutcome(null);
    setJoining(true);
    window.setTimeout(() => {
      setJoining(false);
      if (result === "valid") onJoined();
      else setOutcome(result);
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
        <span className={shell.settingLabel}>Join your partner</span>
        <span className={shell.settingHint}>
          Got a code from them? Your budget stays yours; you’ll both see the
          categories you share and who owes whom.
        </span>
      </div>
      <CodeField
        id={`${id}-code`}
        label="Their code"
        value={code}
        error={error}
        locked={locked}
        onChange={(next) => {
          setCode(next);
          setIncomplete(false);
          if (outcome !== "rate-limited") setOutcome(null);
        }}
        action={
          <Button type="submit" disabled={joining || Boolean(locked)}>
            {joining ? "Joining…" : "Join"}
          </Button>
        }
      />
    </form>
  );
}
