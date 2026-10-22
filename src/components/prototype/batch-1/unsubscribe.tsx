"use client";

import { CircleAlertIcon, CircleCheckIcon, MailIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Brand, useBrandName } from "./brand";
import { me } from "./mock";
import {
  Choice,
  PrototypePage,
  PrototypeBar,
  useStored,
  useTheme,
} from "./prototype";
import { settingsPath } from "./routes";
import batch from "./batch.module.css";
import styles from "./unsubscribe.module.css";

// The variable the variants move: when the unsubscribe takes effect. On the
// button press, a link scanner opening the page can't unsubscribe anyone; on
// open, the footer link is truly one click. Mail apps' own Unsubscribe
// button (List-Unsubscribe-Post) is one click either way.
type Variant = "press" | "open";
type LinkState = "valid" | "already" | "broken";
type Phase = "ready" | "working" | "done" | "resubscribed";

// No sign-in: the link's token names the budget, so the address is masked
// in case the email was forwarded.
const masked = `${me.email.slice(0, 2)}••••••@${me.email.split("@")[1]}`;

export function UnsubscribePrototype() {
  const [theme, setTheme] = useTheme();
  const [name] = useBrandName();
  const [variant, setVariant] = useStored<Variant>(
    "unsubscribe.variant",
    "press",
  );
  const [link, setLink] = useStored<LinkState>("unsubscribe.link", "valid");
  const [phase, setPhase] = useState<Phase>("ready");

  // Changing a control starts the page over, as if the link were opened anew.
  useEffect(() => {
    if (variant === "open" && link === "valid") {
      setPhase("working");
      const timer = window.setTimeout(() => setPhase("done"), 700);
      return () => window.clearTimeout(timer);
    }
    setPhase("ready");
  }, [variant, link]);

  const run = (next: Phase) => {
    setPhase("working");
    window.setTimeout(() => setPhase(next), 700);
  };

  let content: ReactNode;
  if (link === "broken")
    content = (
      <Message
        icon={<CircleAlertIcon size={18} aria-hidden />}
        tone="attention"
        title="This link doesn’t work anymore"
        body="It may be from an old email, or it was cut short when copied. Sign in to turn the daily email off in Settings."
      >
        <Button variant="primary" asChild>
          <Link href={settingsPath("notifications")}>Sign in to Settings</Link>
        </Button>
      </Message>
    );
  else if (link === "already" && phase !== "resubscribed")
    content = (
      <Message
        icon={<MailIcon size={18} aria-hidden />}
        title="You’re already unsubscribed"
        body={`${masked} doesn’t get the daily review email.`}
      >
        <Button onClick={() => run("resubscribed")}>Turn it back on</Button>
      </Message>
    );
  else if (phase === "ready" || (phase === "working" && variant === "press"))
    content = (
      <Message
        icon={<MailIcon size={18} aria-hidden />}
        title="Stop the daily review email?"
        body={`We’ll stop sending it to ${masked}. Your budget stays exactly as it is.`}
      >
        <Button
          variant="primary"
          disabled={phase === "working"}
          onClick={() => run("done")}
        >
          {phase === "working" ? "Unsubscribing…" : "Unsubscribe"}
        </Button>
        <Button asChild>
          <Link href={settingsPath("notifications")}>
            Change the time instead
          </Link>
        </Button>
      </Message>
    );
  else if (phase === "working")
    content = (
      <Message
        icon={<MailIcon size={18} aria-hidden />}
        title="Unsubscribing…"
        body={`Stopping the daily review email to ${masked}.`}
        busy
      />
    );
  else if (phase === "done")
    content = (
      <Message
        icon={<CircleCheckIcon size={18} aria-hidden />}
        tone="done"
        title="You’re unsubscribed"
        body={`No more daily review emails to ${masked}. Changed your mind? Turn it back on here or in Settings.`}
      >
        <Button onClick={() => run("resubscribed")}>Turn it back on</Button>
      </Message>
    );
  else
    content = (
      <Message
        icon={<CircleCheckIcon size={18} aria-hidden />}
        tone="done"
        title="The daily email is back on"
        body="The next one arrives tomorrow at 8 a.m. Los Angeles time. Change the time in Settings."
      >
        <Button asChild>
          <Link href={settingsPath("notifications")}>Open Settings</Link>
        </Button>
      </Message>
    );

  return (
    <PrototypePage
      theme={theme}
      controls={
        <PrototypeBar title="Unsubscribe" theme={theme} onTheme={setTheme}>
          <Choice
            label="Variant: takes effect"
            value={variant}
            options={[
              ["press", "On the button"],
              ["open", "On opening the link"],
            ]}
            onChange={setVariant}
          />
          <Choice
            label="Link"
            value={link}
            options={[
              ["valid", "Valid"],
              ["already", "Already unsubscribed"],
              ["broken", "Broken or old"],
            ]}
            onChange={setLink}
          />
        </PrototypeBar>
      }
    >
      <main className={styles.page}>
        <Brand name={name} />
        <div className={styles.card} aria-live="polite">
          {content}
        </div>
        <p className={styles.footnote}>
          Every email setting, including the time it arrives, is in{" "}
          <Link className={batch.textLink} href={settingsPath("notifications")}>
            Settings › Notifications
          </Link>
          .
        </p>
      </main>
    </PrototypePage>
  );
}

function Message({
  icon,
  tone,
  title,
  body,
  busy,
  children,
}: {
  icon: ReactNode;
  tone?: "done" | "attention";
  title: string;
  body: string;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={styles.message} data-tone={tone} aria-busy={busy}>
      <span className={styles.icon}>{icon}</span>
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.body}>{body}</p>
        {busy && <div className={batch.progress} aria-hidden />}
        {children && <div className={batch.actions}>{children}</div>}
      </div>
    </div>
  );
}
