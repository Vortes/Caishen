"use client";

import { SignIn, SignUp, useAuth, useClerk, useUser } from "@clerk/nextjs";
import { CircleAlertIcon, MailIcon, Volume2, VolumeOff } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Brand } from "~/components/entry/brand";
import { EntryPage } from "~/components/entry/entry-page";
import { useMediaQuery } from "~/components/shared/use-media-query";
import { useBrowserValue } from "~/components/shared/use-browser-value";
import {
  Onboarding,
  savedInvitation,
} from "~/components/onboarding/onboarding";
import { deleteStoredBudgets } from "~/components/sync/indexed-db";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { SHELL_PATH } from "~/components/workspace/routes";
import type { RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/react";
import { firstName } from "~/domain/invitation";
import { Scene } from "./scene";
import { useSound } from "./use-sound";
import batch from "~/components/entry/entry.module.css";
import message from "~/components/entry/unsubscribe.module.css";
import styles from "./lab.module.css";

type Opened = Exclude<
  RouterOutputs["budget"]["openInvitation"],
  { status: "joined" }
>;
type Live = Extract<Opened, { status: "live" }>;

type Visitor =
  // Signed out, choosing to create an account or sign in.
  | { signedIn: false; signIn: boolean }
  // Signed in; a newcomer has no budget yet.
  | { signedIn: true; newcomer: boolean };

// The page an invitation email links to: the card itself, or why the link
// no longer works.
export function InvitationLink(props: {
  token: string;
  path: string;
  invitation: Opened;
  visitor: Visitor;
}) {
  return (
    <EntryPage>
      <OpenedLink {...props} />
    </EntryPage>
  );
}

function OpenedLink({
  token,
  path,
  invitation,
  visitor,
}: {
  token: string;
  path: string;
  invitation: Opened;
  visitor: Visitor;
}) {
  if (invitation.status !== "live") {
    const sender = invitation.from ? firstName(invitation.from) : "They";
    const copy: Record<Exclude<Opened, Live>["status"], [string, string]> = {
      invalid: [
        "This link doesn’t work",
        "It may have been cut short when copied. Open the invitation from its email again.",
      ],
      expired: [
        "This invitation expired",
        `Invitations last seven days. Ask ${sender} to send you a new one.`,
      ],
      used: [
        "This invitation was already accepted",
        `Each invitation can be accepted once. If ${sender} meant to invite you, ask them for a new one.`,
      ],
      cancelled: [
        `${sender} cancelled this invitation`,
        "If they still want to share a budget, they can send you a new one.",
      ],
      replaced: [
        `${sender} sent a newer invitation`,
        "Open the link in the latest invitation email instead.",
      ],
      partnered: [
        "You already share a budget",
        "A budget has room for one partner, so this invitation can’t be accepted.",
      ],
      full: [
        `${sender} already shares a budget`,
        "They connected with someone else, so this invitation can’t be accepted.",
      ],
      left: [
        `${sender} isn’t using that budget anymore`,
        "So this invitation can’t be accepted. They can send you a new one.",
      ],
    };
    const [title, body] = copy[invitation.status];
    return (
      <Message title={title} body={body}>
        <Button asChild>
          <Link href={SHELL_PATH}>Go to Caishen</Link>
        </Button>
      </Message>
    );
  }
  if (!visitor.signedIn)
    return (
      <Account path={path} invitation={invitation} signIn={visitor.signIn} />
    );
  return (
    <Card
      token={token}
      path={path}
      invitation={invitation}
      newcomer={visitor.newcomer}
    />
  );
}

// Clerk's form, set flat on the page's own card and in its colors.
const appearance = {
  options: {
    elevation: "flush",
    // OAuth providers refuse to run inside mail apps' browsers, so the
    // email code comes first.
    socialButtonsPlacement: "bottom",
    logoPlacement: "none",
  },
  variables: {
    colorBackground: "var(--surface-panel)",
    colorForeground: "var(--text-primary)",
    colorMutedForeground: "var(--text-secondary)",
    colorMuted: "var(--control-bg)",
    colorPrimary: "var(--accent-solid)",
    colorPrimaryForeground: "var(--text-on-accent)",
    colorInput: "var(--control-bg)",
    colorInputForeground: "var(--text-primary)",
    colorNeutral: "var(--text-primary)",
    colorBorder: "var(--control-border)",
    colorRing: "var(--focus-ring)",
    colorDanger: "var(--danger-text)",
    fontFamily: "inherit",
    fontSize: "var(--type-body)",
    borderRadius: "var(--radius-row)",
  },
  elements: {
    rootBox: { width: "100%" },
    cardBox: {
      width: "100%",
      maxWidth: "none",
      boxShadow: "none",
      border: "none",
    },
    card: { padding: 0, background: "transparent" },
    footer: { background: "transparent" },
    otpCodeFieldInput: { border: "1px solid var(--border-strong)" },
  },
} as const;

// Signed out: create an account, or sign in, without leaving the link. The
// invited address is filled in, Clerk's own heading says which it is, and
// either way back is this page.
function Account({
  path,
  invitation,
  signIn,
}: {
  path: string;
  invitation: Live;
  signIn: boolean;
}) {
  return (
    <div className={message.page}>
      <Brand />
      <main className={message.card}>
        <div className={message.message}>
          <span className={message.icon}>
            <MailIcon size={20} aria-hidden />
          </span>
          <div className={message.text}>
            <h1 className={message.title}>
              {invitation.from} invited you to share a budget
            </h1>
          </div>
        </div>
        <div className={styles.account}>
          {signIn ? (
            <SignIn
              routing="hash"
              forceRedirectUrl={path}
              signUpForceRedirectUrl={path}
              signUpUrl={path}
              initialValues={{ emailAddress: invitation.email }}
              appearance={appearance}
            />
          ) : (
            <SignUp
              routing="hash"
              forceRedirectUrl={path}
              signInForceRedirectUrl={path}
              signInUrl={`${path}?sign-in`}
              initialValues={{ emailAddress: invitation.email }}
              appearance={appearance}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// Whether this tab was setting up a budget from the link, once the browser
// can say.
function useResumed(token: string) {
  const { userId } = useAuth();
  return useBrowserValue(() =>
    userId ? savedInvitation(userId) === token : undefined,
  );
}

// The invitation plays. For someone with a budget, signing it accepts it and
// joins the sender's household, and the clouds part onto the shared budget.
// For a newcomer they part onto setting one up, which accepts it.
function Card({
  token,
  path,
  invitation,
  newcomer,
}: {
  token: string;
  path: string;
  invitation: Live;
  newcomer: boolean;
}) {
  const resumed = useResumed(token);
  const [setup] = useState(() => ({
    token,
    id: invitation.id,
    from: invitation.from,
  }));
  if (!newcomer) return <Ceremony path={path} invitation={invitation} />;
  if (resumed === undefined) return null;
  if (resumed) return <Onboarding invitation={setup} />;
  return (
    <Ceremony
      path={path}
      invitation={invitation}
      next={<Onboarding invitation={setup} />}
    />
  );
}

function Ceremony({
  path,
  invitation,
  next,
}: {
  path: string;
  invitation: Live;
  // The setup a newcomer accepts the invitation in; without it, signing
  // accepts it.
  next?: ReactNode;
}) {
  const { user } = useUser();
  const clerk = useClerk();
  const join = api.budget.joinInvitation.useMutation();
  // Signed before it was sent, so long dry.
  const [card] = useState(() => ({
    ...invitation,
    signature: invitation.signature.map((stroke) => ({ ...stroke, dried: 0 })),
  }));
  const [over, setOver] = useState(false);
  const { sound, soundOn, chooseSound } = useSound(!over);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  // The link proves the invitation, whoever's account opens it; a
  // different address is only pointed out.
  const elsewhere =
    user &&
    !user.emailAddresses.some(
      (address) =>
        address.emailAddress.toLowerCase() === invitation.email.toLowerCase(),
    );

  if (join.error)
    return (
      <Message title="Your budgets weren’t connected" body={join.error.message}>
        {["CONFLICT", "INTERNAL_SERVER_ERROR", undefined].includes(
          join.error.data?.code,
        ) && (
          <Button
            variant="primary"
            disabled={join.isPending}
            onClick={() =>
              join.mutate(
                { id: invitation.id },
                { onSuccess: () => window.location.assign(SHELL_PATH) },
              )
            }
          >
            {join.isPending ? "Trying again…" : "Try again"}
          </Button>
        )}
        <Button asChild>
          <Link href={SHELL_PATH}>Go to Caishen</Link>
        </Button>
      </Message>
    );

  return (
    <>
      <Scene
        invitation={card}
        sky="day"
        reducedMotion={reducedMotion}
        sound={sound}
        onSign={
          next
            ? undefined
            : () =>
                join.mutateAsync({ id: invitation.id }).then(
                  () => true,
                  () => false,
                )
        }
        next={
          next ?? (
            <div className={message.page}>
              <p role="status" className={message.body}>
                Opening your shared budget…
              </p>
            </div>
          )
        }
        onSettled={() => {
          setOver(true);
          if (!next) window.location.assign(SHELL_PATH);
        }}
      />
      {!over && (
        <div className={styles.mute}>
          <IconButton
            variant="secondary"
            label={soundOn ? "Mute" : "Unmute"}
            pressed={!soundOn}
            onClick={() => chooseSound(!soundOn)}
          >
            {soundOn ? <Volume2 /> : <VolumeOff />}
          </IconButton>
        </div>
      )}
      {elsewhere && !join.isSuccess && !over && (
        <div className={styles.sentTo} role="note">
          <span>
            This was sent to{" "}
            <span className={styles.sentToAddress}>{invitation.email}</span>.
            Not you?
          </span>
          <Button
            size="sm"
            onClick={() =>
              void deleteStoredBudgets().finally(() =>
                clerk.signOut({ redirectUrl: path }),
              )
            }
          >
            Switch account
          </Button>
        </div>
      )}
    </>
  );
}

function Message({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div className={message.page}>
      <Brand />
      <main className={message.card}>
        <div className={message.message}>
          <span className={message.icon}>
            <CircleAlertIcon size={20} aria-hidden />
          </span>
          <div className={message.text}>
            <h1 className={message.title}>{title}</h1>
            <p className={message.body}>{body}</p>
            <div className={batch.actions}>{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
