"use client";

import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { TextInput } from "~/components/ui/text-input";
import {
  SettingRow,
  SettingsDivider,
  SettingsPage,
  SettingsSection,
} from "~/components/ui/settings";
import { Skeleton } from "~/components/ui/skeleton";
import { ConfirmDialog } from "~/components/ui/dialog";
import { useUser } from "@clerk/nextjs";
import { ComposeInvitation } from "~/components/partner-invite/compose";
import { useShellData } from "~/components/app-shell/shell-data";
import { api } from "~/trpc/react";
import additions from "~/components/entry/settings.module.css";

export function PartnerSettings() {
  const { partner, disconnectedBy } = useShellData();
  return (
    <SettingsPage>
      <SettingsSection aria-label="Partner">
        {partner ? (
          <SettingRow
            label={`Connected with ${partner.name}`}
            description="A budget has room for one partner."
          >
            <Disconnect name={partner.name} />
          </SettingRow>
        ) : (
          <>
            {disconnectedBy && (
              <>
                <SettingRow
                  label={`${disconnectedBy.name} disconnected on ${new Date(
                    disconnectedBy.at,
                  ).toLocaleDateString("en-US", {
                    ...DAY,
                    year: "numeric",
                  })}; your shared history is kept.`}
                />
                <SettingsDivider />
              </>
            )}
            <Invitation />
          </>
        )}
      </SettingsSection>
    </SettingsPage>
  );
}

// Either partner can end the partnership alone. The confirmation says what
// stays and what ends, since nothing undoes it but a new invitation.
function Disconnect({ name }: { name: string }) {
  const utils = api.useUtils();
  const [open, setOpen] = useState(false);
  const disconnect = api.budget.disconnect.useMutation({
    onSuccess: async () => {
      setOpen(false);
      await utils.budget.overview.invalidate();
    },
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        disconnect.reset();
        setOpen(next);
      }}
      trigger={<Button>Disconnect…</Button>}
      title={`Disconnect from ${name}?`}
      description={`You’ll each keep a budget of your own. What you shared stays in both budgets as it stands today, under an account named after the other person, and what one of you owes the other is kept. Nothing new can be shared or settled there. ${name} will see that you disconnected, and either of you can invite a partner again.`}
      cancel="Cancel"
      confirm={disconnect.isPending ? "Disconnecting…" : "Disconnect"}
      tone="danger"
      onConfirm={() => disconnect.mutate()}
      pending={disconnect.isPending}
      error={disconnect.error?.message}
    />
  );
}

const DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
const expiry = (at: Date) => at.toLocaleDateString("en-US", DAY);

// The sender's invitation: pending, expired, or not written yet.
function Invitation() {
  const utils = api.useUtils();
  const invitation = api.budget.invitation.useQuery();
  const resend = api.budget.resendInvitation.useMutation();
  const cancel = api.budget.cancelInvitation.useMutation({
    onSuccess: () => utils.budget.invitation.setData(undefined, null),
  });
  const [rewriting, setRewriting] = useState<string | null>(null);

  if (invitation.isPending)
    return (
      <div aria-busy>
        <span role="status" className="sr-only">
          Opening your invitation…
        </span>
        <SettingRow
          label={<Skeleton width={180} />}
          description={<Skeleton width={260} />}
        />
      </div>
    );

  const sent = invitation.data;
  if (sent && rewriting === null) {
    const failure = resend.error ?? cancel.error ?? invitation.error;
    return (
      <SettingRow
        label={
          <span className={additions.address}>
            {sent.expired
              ? `Invitation to ${sent.email} expired`
              : `Invited ${sent.email}`}
          </span>
        }
        description={
          sent.expired
            ? "Invitations last seven days. Write a new one to invite them again."
            : resend.isSuccess
              ? `Sent again. The link works until ${expiry(sent.expiresAt)}.`
              : `The link in their email works until ${expiry(sent.expiresAt)}.`
        }
        error={failure?.message}
      >
        {sent.expired ? (
          <Button variant="primary" onClick={() => setRewriting(sent.email)}>
            Write a new one
          </Button>
        ) : (
          <>
            <Button
              disabled={resend.isPending || cancel.isPending}
              onClick={() => {
                cancel.reset();
                resend.mutate();
              }}
            >
              {resend.isPending ? "Sending…" : "Resend"}
            </Button>
            <Button
              disabled={resend.isPending || cancel.isPending}
              onClick={() => {
                resend.reset();
                cancel.mutate();
              }}
            >
              Cancel
            </Button>
          </>
        )}
      </SettingRow>
    );
  }

  return (
    <InviteByEmail
      initialEmail={rewriting ?? ""}
      onSent={(result) => {
        setRewriting(null);
        resend.reset();
        utils.budget.invitation.setData(undefined, {
          ...result,
          expired: false,
        });
      }}
    />
  );
}

// Invite a partner by email: they get the invitation the sender writes
// here, and it plays when they open it.
function InviteByEmail({
  initialEmail,
  onSent,
}: {
  initialEmail: string;
  onSent: (sent: { email: string; expiresAt: Date }) => void;
}) {
  const { user } = useUser();
  const send = api.budget.sendInvitation.useMutation();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const own = user?.emailAddresses.map((address) =>
    address.emailAddress.toLowerCase(),
  );
  // The card prints the sender's name; there's none to guess from an email.
  const from = user?.fullName ?? user?.firstName;

  const check = (value: string) => {
    const address = value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      return "Enter your partner’s full email address, like name@example.com.";
    if (own?.includes(address.toLowerCase()))
      return "That’s your own email. Enter your partner’s.";
    return null;
  };

  const field = (
    <TextInput
      inputRef={input}
      type="email"
      value={email}
      onChange={(value) => {
        setEmail(value);
        // Once wrong, it's checked as they fix it.
        if (error) setError(check(value));
      }}
    />
  );

  return (
    <SettingRow
      label="Invite your partner"
      below={
        <>
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
            <Field label="Partner’s email" error={error ?? undefined}>
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
            </Field>
          </form>
          {writing && from && (
            <>
              <SettingsDivider />
              <ComposeInvitation
                from={from}
                onCancel={() => setWriting(false)}
                onSend={async (invitation) => {
                  const problem = check(email);
                  if (problem) {
                    setError(problem);
                    input.current?.focus();
                    return;
                  }
                  onSent(
                    await send.mutateAsync({
                      email: email.trim(),
                      washi: invitation.washi,
                      signature: invitation.signature,
                    }),
                  );
                }}
              />
            </>
          )}
        </>
      }
    />
  );
}
