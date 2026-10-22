"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  LandmarkIcon,
  LogInIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { ShellSkeleton } from "~/components/prototype/app-shell/shell-skeleton";
import { defaults } from "~/components/prototype/app-shell/settings";
import { SHELL_PATH } from "~/components/prototype/app-shell/settings-pages";
import { Brand, useBrandName } from "./brand";
import { chaseAccounts, money } from "./mock";
import {
  Choice,
  PrototypeBar,
  PrototypePage,
  useNotice,
  useStored,
  useTheme,
} from "./prototype";
import batch from "./batch.module.css";
import page from "./unsubscribe.module.css";
import styles from "./bank-oauth.module.css";

// The variable the variants move: where the bank's redirect lands. On its
// own page (as today), or on the app shell loading behind the same bank
// dialog the shell uses when no redirect happens.
type Variant = "shell" | "page";

type Phase =
  | "signed-out"
  | "plaid"
  | "saving"
  | "syncing"
  | "setup"
  | "adding"
  | "added"
  | "sync-failed"
  | "failed"
  | "missing";

type Play = "play" | Phase;
type Outcome = "connects" | "update-fails" | "save-fails";

const order: Phase[] = ["plaid", "saving", "syncing"];

// app.curate.is/banks/oauth, the address registered with Plaid. Big banks
// (Chase, Wells Fargo, Capital One) send people to their own site to log in
// and back here; this page picks the Plaid session up where it stopped.
export function BankOAuthPrototype() {
  const [theme, setTheme] = useTheme();
  const [name] = useBrandName();
  const [variant, setVariant] = useStored<Variant>("oauth.variant", "shell");
  const [play, setPlay] = useStored<Play>("oauth.state", "play");
  const [outcome, setOutcome] = useStored<Outcome>("oauth.outcome", "connects");
  const [phase, setPhase] = useState<Phase>("plaid");
  const [run, setRun] = useState(0);
  const notice = useNotice();
  const timers = useRef<number[]>([]);

  // "Play" walks the real sequence; any other choice holds one state.
  useEffect(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    if (play !== "play") {
      setPhase(play);
      return;
    }
    const durations = [1600, 900, 1500];
    let at = 0;
    setPhase(order[0]!);
    order.forEach((step, index) => {
      if (index === 0) return;
      at += durations[index - 1]!;
      timers.current.push(window.setTimeout(() => setPhase(step), at));
    });
    at += durations[durations.length - 1]!;
    timers.current.push(
      window.setTimeout(
        () =>
          setPhase(
            outcome === "connects"
              ? "setup"
              : outcome === "update-fails"
                ? "sync-failed"
                : "failed",
          ),
        at,
      ),
    );
    return () => timers.current.forEach((timer) => window.clearTimeout(timer));
  }, [play, outcome, run]);

  const back = () => notice.show("Goes to the plan at app.curate.is");
  const replay = () => {
    setPlay("play");
    setRun((value) => value + 1);
  };

  const card = (
    <ReturnCard
      phase={phase}
      onBack={back}
      onRetry={replay}
      onAdd={() => {
        setPhase("adding");
        timers.current.push(window.setTimeout(() => setPhase("added"), 800));
      }}
      onLater={back}
    />
  );

  const controls = (
    <PrototypeBar
      title="Bank return (/banks/oauth)"
      theme={theme}
      onTheme={setTheme}
    >
      <Choice
        label="Variant: lands on"
        value={variant}
        options={[
          ["shell", "The app, loading behind"],
          ["page", "Its own page"],
        ]}
        onChange={setVariant}
      />
      <Choice
        label="State"
        value={play}
        options={[
          ["play", "Play the flow"],
          ["signed-out", "Signed out"],
          ["plaid", "In Plaid"],
          ["saving", "Saving"],
          ["syncing", "Updating"],
          ["setup", "Set up accounts"],
          ["added", "Added"],
          ["sync-failed", "Update failed"],
          ["failed", "Connection failed"],
          ["missing", "Session missing"],
        ]}
        onChange={(next) => {
          setPlay(next);
          setRun((value) => value + 1);
        }}
      />
      <Choice
        label="When played, it"
        value={outcome}
        options={[
          ["connects", "Connects"],
          ["update-fails", "Connects, update fails"],
          ["save-fails", "Fails to save"],
        ]}
        onChange={(next) => {
          setOutcome(next);
          replay();
        }}
      />
    </PrototypeBar>
  );

  // Signed out, there's no budget to load, so both variants use the page.
  const onShell = variant === "shell" && phase !== "signed-out";
  // Over the app, adding closes the dialog and confirms in a toast, as the
  // shell's bank dialog does; the page keeps a final card instead.
  const closed = onShell && phase === "added";
  const { show } = notice;
  // The dialog takes focus as each state arrives, as Radix's does.
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (onShell) dialog.current?.focus();
  }, [onShell, phase]);
  useEffect(() => {
    if (closed) show("Added 3 accounts from Chase");
  }, [closed, show]);

  return (
    <>
      {onShell ? (
        <ShellSkeleton
          settings={{
            ...defaults,
            theme,
            inspector: { ...defaults.inspector, collapsed: true },
          }}
          month="October 2026"
        >
          {!closed && (
            <>
              <div className={styles.overlay} aria-hidden />
              <div
                ref={dialog}
                tabIndex={-1}
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="bank-title"
              >
                {card}
              </div>
            </>
          )}
          {controls}
          {notice.region}
        </ShellSkeleton>
      ) : (
        <PrototypePage theme={theme} controls={controls}>
          <main className={page.page}>
            <Brand name={name} />
            <div className={`${page.card} ${styles.pageCard}`}>{card}</div>
          </main>
          {notice.region}
        </PrototypePage>
      )}
    </>
  );
}

function ReturnCard({
  phase,
  onBack,
  onRetry,
  onAdd,
  onLater,
}: {
  phase: Phase;
  onBack: () => void;
  onRetry: () => void;
  onAdd: () => void;
  onLater: () => void;
}) {
  switch (phase) {
    case "signed-out":
      return (
        <Panel
          icon={<LogInIcon size={18} aria-hidden />}
          title="Sign in to finish connecting Chase"
          body="Chase sent you back here, but this browser isn’t signed in. Use the account you started with and the connection picks up where it stopped."
        >
          <Button variant="primary" asChild>
            <Link href="/sign-in?redirect_url=/banks/oauth">
              Sign in to continue
            </Link>
          </Button>
        </Panel>
      );
    case "plaid":
    case "saving":
    case "syncing":
      return (
        <Panel
          icon={<LandmarkIcon size={18} aria-hidden />}
          title="Connecting Chase"
          body={
            phase === "plaid"
              ? "Finish in the Plaid window. It reopens on its own after your bank’s sign-in."
              : phase === "saving"
                ? "Saving your connection…"
                : "Bringing in your accounts and recent activity. This can take a minute."
          }
          status
        >
          <div className={styles.progress}>
            <div className={batch.progress} aria-hidden />
          </div>
        </Panel>
      );
    case "setup":
    case "adding":
      return (
        <Setup busy={phase === "adding"} onAdd={onAdd} onLater={onLater} />
      );
    case "added":
      return (
        <Panel
          icon={<CircleCheckIcon size={18} aria-hidden />}
          tone="done"
          title="Chase is connected"
          body="Total Checking, Premier Savings, and Sapphire Preferred are in your budget. New activity arrives each morning for you to review."
        >
          <Button variant="primary" onClick={onBack}>
            Back to your budget
          </Button>
        </Panel>
      );
    case "sync-failed":
      return (
        <Panel
          icon={<CircleAlertIcon size={18} aria-hidden />}
          tone="attention"
          title="Chase is connected"
          body="Its accounts couldn’t update yet, so there’s nothing to add to your budget. Try again in a moment, or later from Banks in the sidebar."
        >
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
          <Button onClick={onBack}>Later</Button>
        </Panel>
      );
    case "failed":
      return (
        <Panel
          icon={<CircleAlertIcon size={18} aria-hidden />}
          tone="attention"
          title="Chase couldn’t be connected"
          body="The connection didn’t save, so nothing changed in your budget. Try again; if it keeps failing, connect again later from Banks in the sidebar."
        >
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
          <Button onClick={onBack}>Back to your budget</Button>
        </Panel>
      );
    case "missing":
      return (
        <Panel
          icon={<CircleAlertIcon size={18} aria-hidden />}
          tone="attention"
          title="This bank connection can’t continue"
          body="The connection was started in another browser, or this page was opened twice. Nothing was saved. Start again from Banks in your budget."
        >
          <Button variant="primary" asChild>
            <Link href={SHELL_PATH}>Back to your budget</Link>
          </Button>
        </Panel>
      );
  }
}

function Panel({
  icon,
  tone,
  title,
  body,
  status,
  children,
}: {
  icon: ReactNode;
  tone?: "done" | "attention";
  title: string;
  body: string;
  status?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={page.message} data-tone={tone}>
      <span className={page.icon}>{icon}</span>
      <div className={page.text}>
        <h1 id="bank-title" className={page.title}>
          {title}
        </h1>
        <p className={page.body} role={status ? "status" : undefined}>
          {body}
        </p>
        {children && <div className={batch.actions}>{children}</div>}
      </div>
    </div>
  );
}

// The shell's bank setup form, as BankDialog draws it.
function Setup({
  busy,
  onAdd,
  onLater,
}: {
  busy: boolean;
  onAdd: () => void;
  onLater: () => void;
}) {
  const [picked, setPicked] = useState(["chk", "sav", "csp"]);
  return (
    <div className={styles.setup}>
      <div className={styles.setupHead}>
        <h1 id="bank-title" className={page.title}>
          Add Chase to your budget
        </h1>
        <p className={page.body}>
          Checking and savings go in Cash, credit cards in Credit. Each starts
          at the bank’s current balance.
        </p>
      </div>
      <ul className={styles.setupList}>
        {chaseAccounts.map((account) => (
          <li key={account.id}>
            <label
              className={styles.setupRow}
              data-disabled={!account.kind || undefined}
            >
              <Checkbox
                disabled={!account.kind || busy}
                checked={Boolean(account.kind) && picked.includes(account.id)}
                onCheckedChange={(on) =>
                  setPicked((current) =>
                    on === true
                      ? [...current, account.id]
                      : current.filter((id) => id !== account.id),
                  )
                }
              />
              <span className={styles.setupName}>
                {account.name}{" "}
                <span className={styles.mask}>••{account.mask}</span>
                {!account.kind && (
                  <span className={styles.reason}>{account.reason}</span>
                )}
              </span>
              <span className={styles.balance}>
                {account.kind ? money(account.balance) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className={batch.actions} data-end>
        <Button disabled={busy} onClick={onLater}>
          Later
        </Button>
        <Button
          variant="primary"
          disabled={busy || !picked.length}
          onClick={onAdd}
        >
          {busy ? "Adding…" : `Add ${picked.length} accounts`}
        </Button>
      </div>
    </div>
  );
}
