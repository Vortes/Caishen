"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { CircleAlertIcon, MailIcon, Volume2, VolumeOff } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Brand } from "~/components/entry/brand";
import { EntryPage } from "~/components/entry/entry-page";
import { useMediaQuery } from "~/components/shared/use-media-query";
import { deleteStoredBudgets } from "~/components/sync/indexed-db";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { SHELL_PATH } from "~/components/workspace/routes";
import type { RouterOutputs } from "~/trpc/react";
import { api } from "~/trpc/react";
import { firstName } from "./print";
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

// The page an invitation email links to: the card itself, or why the link
// no longer works.
export function InvitationLink(props: {
  path: string;
  invitation: Opened;
  signedIn: boolean;
}) {
  return (
    <EntryPage>
      <OpenedLink {...props} />
    </EntryPage>
  );
}

function OpenedLink({
  path,
  invitation,
  signedIn,
}: {
  path: string;
  invitation: Opened;
  signedIn: boolean;
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
  if (!signedIn)
    return (
      <Message
        icon="mail"
        title={`${invitation.from} invited you to share a budget`}
        body="Sign in to open the invitation."
      >
        <Button variant="primary" asChild>
          <Link href={`/sign-in?redirect_url=${encodeURIComponent(path)}`}>
            Sign in
          </Link>
        </Button>
      </Message>
    );
  return <Card path={path} invitation={invitation} />;
}

// The invitation plays; signing it accepts it and joins the sender's
// household, and the clouds part onto the shared budget.
function Card({ path, invitation }: { path: string; invitation: Live }) {
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
        onSign={() =>
          join.mutateAsync({ id: invitation.id }).then(
            () => true,
            () => false,
          )
        }
        next={
          <div className={message.page}>
            <p role="status" className={message.body}>
              Opening your shared budget…
            </p>
          </div>
        }
        onSettled={() => {
          setOver(true);
          window.location.assign(SHELL_PATH);
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
      {elsewhere && !join.isSuccess && (
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
  icon = "alert",
  title,
  body,
  children,
}: {
  icon?: "alert" | "mail";
  title: string;
  body: string;
  children: ReactNode;
}) {
  const Icon = icon === "mail" ? MailIcon : CircleAlertIcon;
  return (
    <div className={message.page}>
      <Brand />
      <main className={message.card}>
        <div className={message.message}>
          <span className={message.icon}>
            <Icon size={20} aria-hidden />
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
