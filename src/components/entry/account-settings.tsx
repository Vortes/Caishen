"use client";

import { useReverification, useUser } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import type { EmailAddressResource, UserResource } from "@clerk/nextjs/types";
import { useId, useState } from "react";
import { text } from "~/components/budget/format";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Field } from "~/components/ui/field";
import { TextInput } from "~/components/ui/text-input";
import { deleteStoredBudgets } from "~/components/sync/indexed-db";
import { useShellData } from "~/components/app-shell/shell-data";
import shell from "~/components/app-shell/shell.module.css";
import batch from "./entry.module.css";
import styles from "./settings.module.css";

function message(error: unknown) {
  if (isClerkAPIResponseError(error))
    return (
      error.errors[0]?.longMessage ??
      error.errors[0]?.message ??
      "Couldn’t update your account."
    );
  return error instanceof Error
    ? error.message
    : "Couldn’t update your account. Try again.";
}

export function AccountSettings() {
  const { user } = useUser();
  return user ? <LoadedAccountSettings user={user} /> : null;
}

function LoadedAccountSettings({ user }: { user: UserResource }) {
  return (
    <>
      <section className={shell.settingsSection} aria-label="Account">
        <h2 className={shell.settingsHeading}>Account</h2>
        <Card>
          <EmailRow user={user} />
          <div className={shell.settingDivider} />
          <PasswordRow user={user} />
          <div className={shell.settingDivider} />
          <ConnectedAccounts user={user} />
        </Card>
      </section>
      <DeleteAccount user={user} />
    </>
  );
}

function EmailRow({ user }: { user: UserResource }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState<EmailAddressResource | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = useReverification((email: string) =>
    user.createEmailAddress({ email }),
  );
  const makePrimary = useReverification((primaryEmailAddressId: string) =>
    user.update({ primaryEmailAddressId }),
  );
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const next =
        user.emailAddresses.find(
          (item) => item.emailAddress === draft.trim(),
        ) ?? (await add(draft.trim()));
      await next.prepareVerification({ strategy: "email_code" });
      setAddress(next);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const verified = await address.attemptVerification({ code });
      if (verified.verification.status !== "verified")
        throw new Error("That code wasn’t accepted. Check it and try again.");
      await makePrimary(verified.id);
      await user.reload();
      setOpen(false);
      setAddress(null);
      setCode("");
      setDraft("");
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={shell.settingRow}>
      <div className={shell.settingText}>
        <span className={shell.settingLabel}>Email address</span>
        <span className={shell.settingHint}>
          {user.primaryEmailAddress?.emailAddress}
        </span>
        {open && (
          <form
            className={styles.inlineForm}
            onSubmit={(event) => {
              event.preventDefault();
              void (address ? verify() : send());
            }}
          >
            <label className={batch.field} htmlFor={`${id}-email`}>
              New email address
              <input
                id={`${id}-email`}
                className={batch.input}
                type="email"
                autoComplete="email"
                required
                value={draft}
                disabled={Boolean(address)}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            {address && (
              <>
                <p className={batch.fieldHint}>
                  Enter the code sent to {address.emailAddress}.
                </p>
                <label className={batch.field} htmlFor={`${id}-code`}>
                  Verification code
                  <input
                    id={`${id}-code`}
                    className={`${batch.input} ${styles.codeInput}`}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </label>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => void send()}
                >
                  Resend code
                </Button>
              </>
            )}
            {error && (
              <p className={batch.error} role="alert">
                {error}
              </p>
            )}
            <div className={batch.actions} data-end>
              <Button
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setAddress(null);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy
                  ? "Saving…"
                  : address
                    ? "Verify and save"
                    : "Send verification code"}
              </Button>
            </div>
          </form>
        )}
      </div>
      {!open && <Button onClick={() => setOpen(true)}>Change email</Button>}
    </div>
  );
}

function PasswordRow({ user }: { user: UserResource }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signOutOthers, setSignOutOthers] = useState(true);
  const update = useReverification(
    (input: {
      currentPassword?: string;
      newPassword: string;
      signOutOfOtherSessions: boolean;
    }) => user.updatePassword(input),
  );
  return (
    <div className={shell.settingRow}>
      <div className={shell.settingText}>
        <span className={shell.settingLabel}>Password</span>
        <span className={shell.settingHint}>
          {user.passwordEnabled
            ? "A password is set."
            : "Add a password to sign in without a connected account."}
        </span>
        {open && (
          <form
            className={styles.inlineForm}
            onSubmit={async (event) => {
              event.preventDefault();
              const fields = new FormData(event.currentTarget);
              setBusy(true);
              setError(null);
              try {
                await update({
                  ...(user.passwordEnabled
                    ? { currentPassword: text(fields, "current") }
                    : {}),
                  newPassword: text(fields, "password"),
                  signOutOfOtherSessions: signOutOthers,
                });
                await user.reload();
                setOpen(false);
              } catch (caught) {
                setError(message(caught));
              } finally {
                setBusy(false);
              }
            }}
          >
            <input
              name="username"
              type="email"
              autoComplete="username"
              value={user.primaryEmailAddress?.emailAddress ?? ""}
              readOnly
              hidden
            />
            <div className={styles.passwordFields}>
              {user.passwordEnabled && (
                <label className={batch.field}>
                  Current password
                  <input
                    className={batch.input}
                    name="current"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
              )}
              <label className={batch.field}>
                New password
                <input
                  className={batch.input}
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
            </div>
            <label className={styles.checkRow}>
              <Checkbox
                checked={signOutOthers}
                onCheckedChange={(checked) =>
                  setSignOutOthers(checked === true)
                }
              />
              Sign out on your other devices
            </label>
            {error && (
              <p className={batch.error} role="alert">
                {error}
              </p>
            )}
            <div className={batch.actions} data-end>
              <Button disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={busy}>
                {busy
                  ? "Saving…"
                  : user.passwordEnabled
                    ? "Change password"
                    : "Add password"}
              </Button>
            </div>
          </form>
        )}
      </div>
      {!open && (
        <Button onClick={() => setOpen(true)}>
          {user.passwordEnabled ? "Change password" : "Add password"}
        </Button>
      )}
    </div>
  );
}

function ConnectedAccounts({ user }: { user: UserResource }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const google = user.externalAccounts.find(
    (account) => account.provider === "google",
  );
  const remove = useReverification(() => google!.destroy());
  const connect = useReverification(() =>
    user.createExternalAccount({
      strategy: "oauth_google",
      redirectUrl: window.location.href,
    }),
  );
  const onlyWayIn =
    !user.passwordEnabled &&
    user.externalAccounts.filter(
      (account) => account.verification?.status === "verified",
    ).length <= 1;
  return (
    <div className={shell.settingRow}>
      <div className={shell.settingText}>
        <span className={shell.settingLabel}>Connected accounts</span>
        <span className={shell.settingHint}>
          {google
            ? `Google · ${google.emailAddress}`
            : "Sign in with Google instead of a password."}
        </span>
        {google && onlyWayIn && (
          <span className={shell.settingHint}>
            Add a password before removing your only sign-in method.
          </span>
        )}
        {error && (
          <p className={batch.error} role="alert">
            {error}
          </p>
        )}
      </div>
      <Button
        disabled={busy || Boolean(google && onlyWayIn)}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            if (google) {
              await remove();
              await user.reload();
            } else {
              const account = await connect();
              const url = account.verification?.externalVerificationRedirectURL;
              if (url) window.location.assign(url.toString());
              else await user.reload();
            }
          } catch (caught) {
            setError(message(caught));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving…" : google ? "Remove Google" : "Connect Google"}
      </Button>
    </div>
  );
}

function DeleteAccount({ user }: { user: UserResource }) {
  const { partner } = useShellData();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = useReverification(() => user.delete());
  const email = user.primaryEmailAddress?.emailAddress;
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
            {open && (
              <form
                className={styles.inlineForm}
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (typed.trim().toLowerCase() !== email?.toLowerCase())
                    return;
                  setBusy(true);
                  setError(null);
                  try {
                    await remove();
                    await deleteStoredBudgets({ userId: user.id });
                    window.sessionStorage.removeItem(
                      `caishen:onboarding:${user.id}`,
                    );
                    window.location.assign("/");
                  } catch (caught) {
                    setError(message(caught));
                    setBusy(false);
                  }
                }}
              >
                <ul className={styles.consequences}>
                  <li>
                    Your personal budget, private transactions, categories, and
                    history are deleted.
                  </li>
                  <li>Bank connections are removed and daily emails stop.</li>
                  {partner && (
                    <li>
                      {partner.name} keeps their budget and the shared records
                      they need. Existing balances are frozen and shared
                      categories stop splitting new spending.
                    </li>
                  )}
                </ul>
                <Field label={`Type ${email ?? ""} to confirm`}>
                  <TextInput value={typed} onChange={setTyped} />
                </Field>
                {error && (
                  <p className={batch.error} role="alert">
                    {error}
                  </p>
                )}
                <div className={batch.actions} data-end>
                  <Button
                    disabled={busy}
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
                    disabled={
                      busy ||
                      typed.trim().toLowerCase() !== email?.toLowerCase()
                    }
                  >
                    {busy ? "Deleting…" : "Delete account permanently"}
                  </Button>
                </div>
              </form>
            )}
          </div>
          {!open && (
            <Button
              disabled={!user.deleteSelfEnabled}
              onClick={() => setOpen(true)}
            >
              Delete account…
            </Button>
          )}
        </div>
      </Card>
    </section>
  );
}
