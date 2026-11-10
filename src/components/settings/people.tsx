"use client";

import { useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Field, FormError } from "~/components/ui/field";
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
import { money, type Account } from "~/components/app-shell/model";
import { owedSentence, usePeople } from "~/components/app-shell/people";
import { personRole } from "~/domain/person-role";
import { useTransactionEntry } from "~/components/app-shell/transaction-entry";
import { newId } from "~/components/budget/format";
import { api } from "~/trpc/react";
import additions from "~/components/entry/settings.module.css";

// Every person you share costs with (ADR 0014). The one on Caishen sees
// what you share in their own budget; everyone else is yours alone.
export function PeopleSettings() {
  const { accounts } = useShellData();
  const others = accounts
    .filter((person) => personRole(person) === "person")
    .sort((a, b) => a.name.localeCompare(b.name));
  const former = accounts.filter(
    (person) => personRole(person) === "former-partner",
  );
  return (
    <SettingsPage>
      <SettingsSection
        heading="On Caishen"
        intro="Someone on Caishen sees what you share in their own budget, and you settle up through both banks. A budget has room for one."
      >
        <PartnerRows />
      </SettingsSection>
      <SettingsSection
        heading="Other people"
        intro="Everyone else who owes you, or whom you owe. Only you see them, and each has an envelope in People."
      >
        {others.map((person) => (
          <div key={person.id}>
            <PersonRow person={person} />
            <SettingsDivider />
          </div>
        ))}
        <AddPerson />
      </SettingsSection>
      {former.length > 0 && (
        <SettingsSection heading="Former partners">
          {former.map((person, index) => (
            <div key={person.id}>
              {index > 0 && <SettingsDivider />}
              <SettingRow
                label={person.name}
                description={`${closedSentence(person)} Closed ${new Date(
                  person.closed!.at,
                ).toLocaleDateString("en-US", {
                  ...DAY,
                  year: "numeric",
                })}, frozen as it stood.`}
              />
            </div>
          ))}
        </SettingsSection>
      )}
    </SettingsPage>
  );
}

function closedSentence(person: Account) {
  if (person.balance > 0)
    return `${person.name} owed you ${money(person.balance)}.`;
  if (person.balance < 0)
    return `You owed ${person.name} ${money(-person.balance)}.`;
  return "You were even.";
}

function balanceSentence(person: Account) {
  const sentence = owedSentence(person.name, person.balance);
  return person.balance
    ? `${sentence} ${money(Math.abs(person.balance))}.`
    : `${sentence}.`;
}

// One person: their balance and a new name.
function PersonRow({ person }: { person: Account }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <SettingRow
      label={person.name}
      description={balanceSentence(person)}
      below={
        renaming ? (
          <RenamePerson person={person} onDone={() => setRenaming(false)} />
        ) : undefined
      }
    >
      <Button aria-expanded={renaming} onClick={() => setRenaming(!renaming)}>
        Rename
      </Button>
    </SettingRow>
  );
}

function RenamePerson({
  person,
  onDone,
}: {
  person: Account;
  onDone: () => void;
}) {
  const { saveCommand } = useTransactionEntry();
  const [name, setName] = useState(person.name);
  const [error, setError] = useState("");
  return (
    <form
      className={additions.inlineForm}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const next = name.trim().replace(/\s+/g, " ");
        if (!next) return setError("Enter their name.");
        if (next === person.name) return onDone();
        const failure = saveCommand(
          {
            type: "person.rename",
            id: newId(),
            accountId: person.id,
            name: next,
          },
          `Renamed ${person.name} to ${next}`,
        );
        if (failure) return setError(failure);
        onDone();
      }}
    >
      <Field label="Name" hint="Their account and envelope take it too.">
        <div className={additions.joinRow}>
          <TextInput
            maxLength={120}
            value={name}
            onChange={(value) => {
              setName(value);
              setError("");
            }}
          />
          <Button onClick={onDone}>Cancel</Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </Field>
      {error && <FormError>{error}</FormError>}
    </form>
  );
}

// Someone new, before anything is shared with them.
function AddPerson() {
  const { addPerson } = usePeople();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <SettingRow
      label="Add a person"
      description="Someone you pay for, or who pays for you. You can also add them from a transaction’s Share."
      below={
        open ? (
          <form
            className={additions.inlineForm}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const next = name.trim().replace(/\s+/g, " ");
              if (!next) return setError("Enter their name.");
              const added = addPerson(next);
              if (added.failure !== undefined) return setError(added.failure);
              setName("");
              setOpen(false);
            }}
          >
            <Field label="Name" error={error || undefined}>
              <div className={additions.joinRow}>
                <TextInput
                  maxLength={120}
                  value={name}
                  placeholder="Name or company"
                  onChange={(value) => {
                    setName(value);
                    setError("");
                  }}
                />
                <Button onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary">
                  Add
                </Button>
              </div>
            </Field>
          </form>
        ) : undefined
      }
    >
      {!open && <Button onClick={() => setOpen(true)}>Add person…</Button>}
    </SettingRow>
  );
}

// The person on Caishen: connected, or invited, or not yet. Onboarding
// shows this part alone.
export function PartnerSettings() {
  return (
    <SettingsPage>
      <SettingsSection aria-label="Partner">
        <PartnerRows />
      </SettingsSection>
    </SettingsPage>
  );
}

function PartnerRows() {
  const { partner, disconnectedBy } = useShellData();
  return (
    <>
      {partner ? (
        <SettingRow
          label={`Connected with ${partner.name}`}
          description="What you share with them shows in both budgets."
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
    </>
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
  return (
    <SettingRow
      label="Invite someone to Caishen"
      below={
        <InviteForm
          label="Their email"
          initialEmail={initialEmail}
          onSent={onSent}
        />
      }
    />
  );
}

// The email and the invitation card it sends.
function InviteForm({
  label,
  initialEmail = "",
  onSent,
}: {
  label: string;
  initialEmail?: string;
  onSent: (sent: { email: string; expiresAt: Date }) => void;
}) {
  const { user } = useUser();
  const utils = api.useUtils();
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
      return "Enter their full email address, like name@example.com.";
    if (own?.includes(address.toLowerCase()))
      return "That’s your own email. Enter theirs.";
    return null;
  };

  return (
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
        <Field label={label} error={error ?? undefined}>
          <div className={additions.joinRow}>
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
              const sent = await send.mutateAsync({
                email: email.trim(),
                washi: invitation.washi,
                signature: invitation.signature,
              });
              utils.budget.invitation.setData(undefined, {
                ...sent,
                expired: false,
              });
              onSent(sent);
            }}
          />
        </>
      )}
    </>
  );
}
