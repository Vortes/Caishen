"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  KeyRoundIcon,
  MailIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  XIcon,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { useId, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { IconButton } from "~/components/ui/icon-button";
import { Tag } from "~/components/ui/tag";
import { usePortalContainer } from "~/components/ui/tooltip";
import shell from "~/components/prototype/app-shell/shell.module.css";
import { me, partner } from "./mock";
import {
  Choice,
  PrototypeBar,
  useNotice,
  useStored,
  useTheme,
} from "./prototype";
import {
  DailyEmailSection,
  initialEmail,
  TimezoneRow,
  type EmailSettings,
} from "./daily-email";
import { SettingsFrame } from "./settings-frame";
import batch from "./batch.module.css";
import styles from "./settings.module.css";

// The variable the variants move: who draws the account controls. Ours are
// rows in the settings card; Clerk's UserProfile can sit inline in the page,
// or open in Clerk's own window from one button.
type Variant = "ours" | "clerk-inline" | "clerk-window";
type SignIn = "google" | "password";

export function ProfileSettingsPrototype() {
  const [theme, setTheme] = useTheme();
  const [variant, setVariant] = useStored<Variant>("profile.variant", "ours");
  const [signIn, setSignIn] = useStored<SignIn>("profile.sign-in", "google");
  const [hasPartner, setHasPartner] = useStored("profile.partner", true);
  const [codeRight, setCodeRight] = useStored("profile.code-right", true);
  const [email, setEmail] = useStored<EmailSettings>(
    "profile.email",
    initialEmail,
  );
  const [browserZone, setBrowserZone] = useStored(
    "profile.browser-zone",
    "America/Los_Angeles",
  );
  const notice = useNotice();
  const changeEmail = (change: Partial<EmailSettings>) =>
    setEmail((current) => ({ ...current, ...change }));

  return (
    <SettingsFrame
      page="profile"
      theme={theme}
      controls={
        <PrototypeBar
          title="Settings › Profile"
          theme={theme}
          onTheme={setTheme}
        >
          <Choice
            label="Variant: who draws Account"
            value={variant}
            options={[
              ["ours", "Our rows"],
              ["clerk-inline", "Clerk, in the page"],
              ["clerk-window", "Clerk, in its window"],
            ]}
            onChange={setVariant}
          />
          <Choice
            label="Signs in with"
            value={signIn}
            options={[
              ["google", "Google only"],
              ["password", "Email and password"],
            ]}
            onChange={setSignIn}
          />
          <Choice
            label="Partner"
            value={hasPartner ? "yes" : "no"}
            options={[
              ["yes", "Connected"],
              ["no", "None"],
            ]}
            onChange={(value) => setHasPartner(value === "yes")}
          />
          <Choice
            label="Email code entered"
            value={codeRight ? "right" : "wrong"}
            options={[
              ["right", "Right"],
              ["wrong", "Wrong"],
            ]}
            onChange={(value) => setCodeRight(value === "right")}
          />
          <Choice
            label="Daily email"
            value={
              email.on ? "on" : email.unsubscribedOn ? "unsubscribed" : "off"
            }
            options={[
              ["on", "On"],
              ["off", "Turned off here"],
              ["unsubscribed", "Unsubscribed from the email"],
            ]}
            onChange={(value) =>
              changeEmail({
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
        <section className={shell.settingsSection} aria-label="Profile">
          <Card>
            <div className={shell.settingRow}>
              <div className={shell.settingLead}>
                <span className={shell.avatar} data-size="large" aria-hidden>
                  A
                </span>
                <div className={shell.settingText}>
                  <span className={shell.settingLabel}>Profile picture</span>
                  <span className={shell.settingHint}>
                    Shown beside your budget’s name in the sidebar.
                  </span>
                </div>
              </div>
              <Button>Upload photo</Button>
            </div>
            <div className={shell.settingDivider} />
            <div className={shell.settingRow}>
              <div className={shell.settingText}>
                <label className={shell.settingLabel} htmlFor="budget-name">
                  Budget name
                </label>
                <span className={shell.settingHint}>
                  Shown at the top of the sidebar. Your partner’s budget keeps
                  its own name.
                </span>
              </div>
              <input
                id="budget-name"
                className={shell.settingInput}
                defaultValue={me.budgetName}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className={shell.settingDivider} />
            <TimezoneRow
              timezone={email.timezone}
              browserZone={browserZone}
              onChange={(timezone) => changeEmail({ timezone })}
            />
          </Card>
        </section>

        <DailyEmailSection email={email} onChange={changeEmail} />

        {variant === "ours" && (
          <OurAccount signIn={signIn} codeRight={codeRight} />
        )}
        {variant === "clerk-inline" && (
          <section className={shell.settingsSection}>
            <h2 className={shell.settingsHeading}>Account</h2>
            <p className={shell.settingsIntro}>
              Clerk’s account manager, themed with our colors. It updates itself
              as Clerk adds sign-in features. Deleting the account stays ours,
              below.
            </p>
            <ClerkProfile signIn={signIn} />
          </section>
        )}
        {variant === "clerk-window" && <ClerkWindow signIn={signIn} />}

        <DeleteAccount
          hasPartner={hasPartner}
          onDeleted={() =>
            notice.show(
              "Account deleted. Signs out and returns to the Welcome page",
            )
          }
        />
      </div>
      {notice.region}
    </SettingsFrame>
  );
}

// ---------- Our rows ----------

function OurAccount({
  signIn,
  codeRight,
}: {
  signIn: SignIn;
  codeRight: boolean;
}) {
  const [google, setGoogle] = useState(true);
  // Without a password, Google is the only way in and can't be removed.
  const onlyGoogle = signIn === "google";
  return (
    <>
      <section className={shell.settingsSection}>
        <h2 className={shell.settingsHeading}>Account</h2>
        <Card>
          <EmailRow codeRight={codeRight} />
          <div className={shell.settingDivider} />
          <PasswordRow key={signIn} signIn={signIn} />
          <div className={shell.settingDivider} />
          <div className={styles.methods}>
            <div className={shell.settingText}>
              <span className={shell.settingLabel}>Connected accounts</span>
              <span className={shell.settingHint}>
                Sign in with one click instead of a password.
              </span>
            </div>
            <ul className={styles.methodList}>
              <li className={styles.method}>
                <GoogleMark />
                <span className={styles.methodText}>
                  <span>Google</span>
                  <span className={shell.settingHint}>
                    {google ? me.email : "Not connected"}
                  </span>
                </span>
                {google ? (
                  <Button
                    size="sm"
                    disabled={onlyGoogle}
                    onClick={() => setGoogle(false)}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setGoogle(true)}>
                    Connect
                  </Button>
                )}
              </li>
              <li className={styles.method}>
                <AppleMark />
                <span className={styles.methodText}>
                  <span>Apple</span>
                  <span className={shell.settingHint}>Not connected</span>
                </span>
                <Button size="sm">Connect</Button>
              </li>
            </ul>
            {onlyGoogle && google && (
              <p className={shell.settingHint}>
                Google is how you sign in. Add a password before disconnecting
                it.
              </p>
            )}
          </div>
        </Card>
      </section>
    </>
  );
}

type EmailPhase = "idle" | "entering" | "sending" | "code" | "verifying";

function EmailRow({ codeRight }: { codeRight: boolean }) {
  const id = useId();
  const [email, setEmail] = useState(me.email);
  const [phase, setPhase] = useState<EmailPhase>("idle");
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  const cancel = () => {
    setPhase("idle");
    setDraft("");
    setCode("");
    setError(null);
  };
  const send = () => {
    if (!/^\S+@\S+\.\S+$/.test(draft.trim()))
      return setError("Enter an email address, like you@example.com.");
    if (draft.trim() === email) return setError("That’s already your email.");
    setError(null);
    setPhase("sending");
    window.setTimeout(() => setPhase("code"), 700);
  };
  const verify = () => {
    if (code.trim().length !== 6)
      return setError("Enter the 6-digit code from the email.");
    setError(null);
    setPhase("verifying");
    window.setTimeout(() => {
      if (!codeRight) {
        setPhase("code");
        setError(
          "That code doesn’t match. Check the newest email, or send a new code.",
        );
        return;
      }
      setEmail(draft.trim());
      setChanged(true);
      cancel();
    }, 700);
  };

  return (
    <div className={styles.expandRow}>
      <div className={shell.settingRow}>
        <div className={shell.settingText}>
          <span className={shell.settingLabel}>Email</span>
          <span className={shell.settingHint}>
            {email} · for signing in and the daily email
          </span>
          {changed && phase === "idle" && (
            <span className={batch.success} role="status">
              <CircleCheckIcon size={13} aria-hidden />
              Email changed. Your old address no longer signs in.
            </span>
          )}
        </div>
        {phase === "idle" && (
          <Button onClick={() => setPhase("entering")}>Change email</Button>
        )}
      </div>
      {phase !== "idle" && (
        <form
          className={styles.inlineForm}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (phase === "entering") send();
            else if (phase === "code") verify();
          }}
        >
          {phase === "entering" || phase === "sending" ? (
            <div className={batch.field}>
              <label className={batch.fieldLabel} htmlFor={`${id}-email`}>
                New email
              </label>
              <input
                id={`${id}-email`}
                className={batch.input}
                type="email"
                autoComplete="email"
                autoFocus
                value={draft}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) => setDraft(event.target.value)}
              />
              <span className={batch.fieldHint}>
                We’ll send a code there to make sure it’s yours.
              </span>
            </div>
          ) : (
            <div className={batch.field}>
              <label className={batch.fieldLabel} htmlFor={`${id}-code`}>
                Code sent to {draft}
              </label>
              <input
                id={`${id}-code`}
                className={`${batch.input} ${styles.codeInput}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={code}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
              />
            </div>
          )}
          {error && (
            <span id={`${id}-error`} className={batch.error} role="alert">
              <CircleAlertIcon size={13} aria-hidden />
              {error}
            </span>
          )}
          <div className={batch.actions} data-end>
            {(phase === "code" || phase === "verifying") && (
              <Button variant="quiet" onClick={() => setPhase("entering")}>
                Use a different email
              </Button>
            )}
            <Button onClick={cancel}>Cancel</Button>
            <Button
              variant="primary"
              type="submit"
              disabled={phase === "sending" || phase === "verifying"}
            >
              {phase === "entering"
                ? "Send code"
                : phase === "sending"
                  ? "Sending…"
                  : phase === "code"
                    ? "Verify and change"
                    : "Verifying…"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function PasswordRow({ signIn }: { signIn: SignIn }) {
  const id = useId();
  const [hasPassword, setHasPassword] = useState(signIn === "password");
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = () => {
    if (hasPassword && !current)
      return setError("Enter your current password.");
    if (next.length < 8)
      return setError("Use at least 8 characters for the new password.");
    setError(null);
    setSaving(true);
    window.setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setHasPassword(true);
      setOpen(false);
      setCurrent("");
      setNext("");
    }, 800);
  };

  return (
    <div className={styles.expandRow}>
      <div className={shell.settingRow}>
        <div className={shell.settingText}>
          <span className={shell.settingLabel}>Password</span>
          <span className={shell.settingHint}>
            {saved
              ? "Changed just now."
              : hasPassword
                ? "Last changed Aug 14, 2026."
                : "You sign in with Google. Add a password to sign in with your email too."}
          </span>
        </div>
        {!open && (
          <Button onClick={() => setOpen(true)}>
            {hasPassword ? "Change password" : "Add password"}
          </Button>
        )}
      </div>
      {open && (
        <form
          className={styles.inlineForm}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {/* Lets password managers file the new password under the right
              account. */}
          <input
            type="email"
            autoComplete="username"
            value={me.email}
            readOnly
            hidden
          />
          <div className={styles.passwordFields}>
            {hasPassword && (
              <div className={batch.field}>
                <label className={batch.fieldLabel} htmlFor={`${id}-current`}>
                  Current password
                </label>
                <input
                  id={`${id}-current`}
                  className={batch.input}
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                />
              </div>
            )}
            <div className={batch.field}>
              <label className={batch.fieldLabel} htmlFor={`${id}-new`}>
                New password
              </label>
              <input
                id={`${id}-new`}
                className={batch.input}
                type="password"
                autoComplete="new-password"
                autoFocus={!hasPassword}
                value={next}
                aria-invalid={Boolean(error)}
                aria-describedby={`${id}-hint`}
                onChange={(event) => setNext(event.target.value)}
              />
              <span id={`${id}-hint`} className={batch.fieldHint}>
                At least 8 characters.
              </span>
            </div>
          </div>
          {hasPassword && (
            <label className={styles.checkRow}>
              <Checkbox
                checked={signOutOthers}
                onCheckedChange={(on) => setSignOutOthers(on === true)}
              />
              Sign out on your other devices
            </label>
          )}
          {error && (
            <span className={batch.error} role="alert">
              <CircleAlertIcon size={13} aria-hidden />
              {error}
            </span>
          )}
          <div className={batch.actions} data-end>
            <Button
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving
                ? "Saving…"
                : hasPassword
                  ? "Change password"
                  : "Add password"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// Inline, not a dialog: the consequences and the typed confirmation open in
// place under the row, and the red button only exists inside that space.
function DeleteAccount({
  hasPartner,
  onDeleted,
}: {
  hasPartner: boolean;
  onDeleted: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const matches = typed.trim().toLowerCase() === me.email;

  return (
    <section className={shell.settingsSection} aria-label="Delete account">
      <Card>
        <div className={shell.settingRow}>
          <div className={shell.settingText}>
            <span className={shell.settingLabel}>
              Delete your account and budget
            </span>
            <span className={shell.settingHint}>
              Permanent. There’s no undo and no export after this.
            </span>
          </div>
          {!open && (
            <Button onClick={() => setOpen(true)}>Delete account…</Button>
          )}
        </div>
        {open && (
          <form
            className={styles.inlineForm}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!matches) return;
              setDeleting(true);
              window.setTimeout(() => {
                setDeleting(false);
                setOpen(false);
                setTyped("");
                onDeleted();
              }, 900);
            }}
          >
            <ul className={styles.consequences}>
              <li>
                Your budget, its categories, transactions, and history are
                deleted.
              </li>
              <li>
                Bank connections are removed, and Plaid stops sharing data.
              </li>
              <li>The daily email stops, and {me.email} can sign up again.</li>
              {hasPartner && (
                <li>
                  {partner.fullName} keeps their budget. What you owe each other
                  freezes at today’s amounts, and your shared categories stop
                  splitting new spending.
                </li>
              )}
            </ul>
            <div className={batch.field}>
              <label className={batch.fieldLabel} htmlFor={`${id}-confirm`}>
                Type {me.email} to confirm
              </label>
              <input
                id={`${id}-confirm`}
                className={batch.input}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </div>
            <div className={batch.actions} data-end>
              <Button
                onClick={() => {
                  setOpen(false);
                  setTyped("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                type="submit"
                disabled={!matches || deleting}
              >
                {deleting ? "Deleting…" : "Delete account permanently"}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </section>
  );
}

// ---------- Clerk's UserProfile ----------

// A stand-in for Clerk's <UserProfile />, laid out like the real component
// with our tokens passed through its `appearance` variables. The real one
// handles verification codes, passwords, connected accounts, and deletion
// itself.
function ClerkProfile({ signIn }: { signIn: SignIn }) {
  const [tab, setTab] = useState<"profile" | "security">("profile");
  return (
    <div className={styles.clerk}>
      <nav className={styles.clerkNav} aria-label="Account">
        <span className={styles.clerkTitle}>Account</span>
        <span className={styles.clerkSubtitle}>Manage your account info.</span>
        <button
          type="button"
          className={styles.clerkTab}
          aria-current={tab === "profile" ? "page" : undefined}
          onClick={() => setTab("profile")}
        >
          <UserRoundIcon size={14} aria-hidden />
          Profile
        </button>
        <button
          type="button"
          className={styles.clerkTab}
          aria-current={tab === "security" ? "page" : undefined}
          onClick={() => setTab("security")}
        >
          <ShieldCheckIcon size={14} aria-hidden />
          Security
        </button>
        <span className={styles.clerkSecured}>Secured by Clerk</span>
      </nav>
      <div className={styles.clerkBody}>
        {tab === "profile" ? (
          <>
            <h3 className={styles.clerkHeading}>Profile details</h3>
            <ClerkLine label="Profile">
              <span className={styles.clerkValue}>
                <span className={shell.avatar} aria-hidden>
                  A
                </span>
                {me.fullName}
              </span>
              <button type="button" className={styles.clerkLink}>
                Update profile
              </button>
            </ClerkLine>
            <ClerkLine label="Email addresses">
              <span className={styles.clerkValue}>
                {me.email} <Tag>Primary</Tag>
              </span>
              <button type="button" className={styles.clerkLink}>
                + Add email address
              </button>
            </ClerkLine>
            <ClerkLine label="Connected accounts">
              <span className={styles.clerkValue}>
                <GoogleMark /> Google · {me.email}
              </span>
              <button type="button" className={styles.clerkLink}>
                + Connect account
              </button>
            </ClerkLine>
          </>
        ) : (
          <>
            <h3 className={styles.clerkHeading}>Security</h3>
            <ClerkLine label="Password">
              <span className={styles.clerkValue}>
                {signIn === "password" ? "••••••••••" : "Not set"}
              </span>
              <button type="button" className={styles.clerkLink}>
                {signIn === "password" ? "Update password" : "Set password"}
              </button>
            </ClerkLine>
            <ClerkLine label="Active devices">
              <span className={styles.clerkValue}>
                Macintosh · Chrome · This device
              </span>
              <span className={styles.clerkValue}>iPhone · Safari</span>
            </ClerkLine>
          </>
        )}
      </div>
    </div>
  );
}

function ClerkLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.clerkLine}>
      <span className={styles.clerkLabel}>{label}</span>
      <div className={styles.clerkValues}>{children}</div>
    </div>
  );
}

function ClerkWindow({ signIn }: { signIn: SignIn }) {
  const container = usePortalContainer();
  return (
    <section className={shell.settingsSection}>
      <h2 className={shell.settingsHeading}>Account</h2>
      <Card>
        <div className={shell.settingRow}>
          <div className={shell.settingLead}>
            <MailIcon size={15} className={styles.rowIcon} aria-hidden />
            <div className={shell.settingText}>
              <span className={shell.settingLabel}>{me.email}</span>
              <span className={shell.settingHint}>
                {signIn === "google"
                  ? "Signs in with Google"
                  : "Signs in with a password or Google"}
              </span>
            </div>
          </div>
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <Button>
                <KeyRoundIcon aria-hidden />
                Manage account
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal container={container}>
              <Dialog.Overlay className={styles.clerkOverlay} />
              <Dialog.Content
                className={styles.clerkModal}
                aria-describedby={undefined}
              >
                <Dialog.Title className="sr-only">Account</Dialog.Title>
                <div className={styles.clerkClose}>
                  <Dialog.Close asChild>
                    <IconButton label="Close">
                      <XIcon aria-hidden />
                    </IconButton>
                  </Dialog.Close>
                </div>
                <ClerkProfile signIn={signIn} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
        <div className={shell.settingDivider} />
        <p className={shell.settingHint}>
          Email, password, connected accounts, and devices are in Clerk’s
          account window. Deleting the account is below.
        </p>
      </Card>
    </section>
  );
}

function GoogleMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.4a4.62 4.62 0 0 1-2 3.03v2.5h3.24c1.9-1.75 2.96-4.33 2.96-7.34ZM12 22c2.7 0 4.98-.9 6.64-2.43l-3.24-2.5c-.9.61-2.06.96-3.4.96-2.6 0-4.82-1.76-5.6-4.12H3.04v2.58A10 10 0 0 0 12 22Zm-5.6-8.1a6 6 0 0 1 0-3.8V7.52H3.04a10 10 0 0 0 0 8.96L6.4 13.9ZM12 5.98c1.47 0 2.8.5 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.52L6.4 10.1C7.18 7.74 9.4 5.98 12 5.98Z"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg className={styles.mark} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M16.37 12.66c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76a4.25 4.25 0 0 0-3.59 2.18c-1.53 2.66-.39 6.6 1.1 8.75.73 1.05 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13a9.4 9.4 0 0 0 1.2-2.47 3.84 3.84 0 0 1-2.29-3.51ZM14.2 6.2c.6-.74 1.01-1.75.9-2.77-.87.04-1.93.58-2.55 1.31-.56.65-1.05 1.69-.92 2.68.97.08 1.97-.49 2.57-1.22Z"
      />
    </svg>
  );
}
