"use client";

import { useReverification, useUser } from "@clerk/nextjs";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import type { EmailAddressResource, UserResource } from "@clerk/nextjs/types";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FormError } from "~/components/ui/field";
import {
  SettingRow,
  SettingsDivider,
  SettingsSection,
} from "~/components/ui/settings";
import { TextInput } from "~/components/ui/text-input";
import { deleteStoredBudgets } from "~/components/sync/indexed-db";
import { useShellData } from "~/components/app-shell/shell-data";
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
      <SettingsSection heading="Account">
        <EmailRow user={user} />
        <SettingsDivider />
        <PasswordRow user={user} />
        <SettingsDivider />
        <ConnectedAccounts user={user} />
      </SettingsSection>
      <DeleteAccount user={user} />
    </>
  );
}

function EmailRow({ user }: { user: UserResource }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  // What to fix in the address or the code before anything is sent.
  const [draftError, setDraftError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
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
    <SettingRow
      label="Email address"
      description={user.primaryEmailAddress?.emailAddress}
      below={
        open && (
          <form
            className={styles.inlineForm}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (address) {
                const problem = code.trim() ? null : "Enter the code.";
                setCodeError(problem);
                if (!problem) void verify();
              } else {
                const problem = draft.trim()
                  ? null
                  : "Enter your new email address.";
                setDraftError(problem);
                if (!problem) void send();
              }
            }}
          >
            <Field label="New email address" error={draftError ?? undefined}>
              <TextInput
                type="email"
                autoComplete="email"
                value={draft}
                disabled={Boolean(address)}
                onChange={(value) => {
                  setDraft(value);
                  if (draftError && value.trim()) setDraftError(null);
                }}
              />
            </Field>
            {address && (
              <>
                <div className={styles.codeField}>
                  <Field
                    label="Verification code"
                    hint={`Sent to ${address.emailAddress}.`}
                    error={codeError ?? undefined}
                  >
                    <TextInput
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(value) => {
                        setCode(value);
                        if (codeError && value.trim()) setCodeError(null);
                      }}
                    />
                  </Field>
                </div>
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
            {error && <FormError>{error}</FormError>}
            <div className={batch.actions} data-end>
              <Button
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setAddress(null);
                  setError(null);
                  setDraftError(null);
                  setCodeError(null);
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
        )
      }
    >
      {!open && <Button onClick={() => setOpen(true)}>Change email</Button>}
    </SettingRow>
  );
}

function PasswordRow({ user }: { user: UserResource }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setCurrent("");
    setPassword("");
    setCurrentError(null);
    setPasswordError(null);
  };
  const checkCurrent = (value: string) =>
    value ? null : "Enter your current password.";
  const checkPassword = (value: string) =>
    value.length >= 8 ? null : "Use at least 8 characters.";
  const update = useReverification(
    (input: {
      currentPassword?: string;
      newPassword: string;
      signOutOfOtherSessions: boolean;
    }) => user.updatePassword(input),
  );
  return (
    <SettingRow
      label="Password"
      description={
        user.passwordEnabled
          ? "A password is set."
          : "Add a password to sign in without a connected account."
      }
      below={
        open && (
          <form
            className={styles.inlineForm}
            noValidate
            onSubmit={async (event) => {
              event.preventDefault();
              const currentProblem = user.passwordEnabled
                ? checkCurrent(current)
                : null;
              const passwordProblem = checkPassword(password);
              setCurrentError(currentProblem);
              setPasswordError(passwordProblem);
              if (currentProblem || passwordProblem) return;
              setBusy(true);
              setError(null);
              try {
                await update({
                  ...(user.passwordEnabled ? { currentPassword: current } : {}),
                  newPassword: password,
                  signOutOfOtherSessions: signOutOthers,
                });
                await user.reload();
                close();
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
                <Field
                  label="Current password"
                  error={currentError ?? undefined}
                >
                  <TextInput
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    onChange={(value) => {
                      setCurrent(value);
                      // Once wrong, it's checked as they fix it.
                      if (currentError) setCurrentError(checkCurrent(value));
                    }}
                  />
                </Field>
              )}
              <Field label="New password" error={passwordError ?? undefined}>
                <TextInput
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(value) => {
                    setPassword(value);
                    if (passwordError) setPasswordError(checkPassword(value));
                  }}
                />
              </Field>
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
            {error && <FormError>{error}</FormError>}
            <div className={batch.actions} data-end>
              <Button disabled={busy} onClick={close}>
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
        )
      }
    >
      {!open && (
        <Button onClick={() => setOpen(true)}>
          {user.passwordEnabled ? "Change password" : "Add password"}
        </Button>
      )}
    </SettingRow>
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
    <SettingRow
      label="Connected accounts"
      description={
        <>
          {google
            ? `Google · ${google.emailAddress}`
            : "Sign in with Google instead of a password."}
          {google && onlyWayIn && (
            <span className={styles.descriptionLine}>
              Add a password before removing your only sign-in method.
            </span>
          )}
        </>
      }
      error={error}
    >
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
    </SettingRow>
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
    <SettingsSection aria-label="Delete account">
      <SettingRow
        label="Delete your account and budget"
        description="Permanent. There’s no undo and no export after this."
        below={
          open && (
            <form
              className={styles.inlineForm}
              onSubmit={async (event) => {
                event.preventDefault();
                if (typed.trim().toLowerCase() !== email?.toLowerCase()) return;
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
              <Field label={`Type ${email ?? "your email"} to confirm`}>
                <TextInput value={typed} onChange={setTyped} />
              </Field>
              {error && <FormError>{error}</FormError>}
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
                    busy || typed.trim().toLowerCase() !== email?.toLowerCase()
                  }
                >
                  {busy ? "Deleting…" : "Delete account permanently"}
                </Button>
              </div>
            </form>
          )
        }
      >
        {!open && (
          <Button
            disabled={!user.deleteSelfEnabled}
            onClick={() => setOpen(true)}
          >
            Delete account…
          </Button>
        )}
      </SettingRow>
    </SettingsSection>
  );
}
