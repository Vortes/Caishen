"use client";

import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  CloudOffIcon,
  InfoIcon,
  PanelLeftIcon,
  WalletCardsIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { IconButton } from "~/components/ui/icon-button";
import { TooltipProvider } from "~/components/ui/tooltip";
import shell from "~/components/prototype/app-shell/shell.module.css";
import { ShellSkeleton } from "~/components/prototype/app-shell/shell-skeleton";
import { defaults } from "~/components/prototype/app-shell/settings";
import { Choice, PrototypeBar, useStored, useTheme } from "./prototype";
import styles from "./load-error.module.css";

// The variable the variants move: how much of the app stays around the
// message. Inside the frame, Try again returns to the loading skeleton in
// the same place; on a bare page, the message stands alone, as today.
type Variant = "frame" | "bare";
type Cause = "server" | "offline";
type Retry = "loads" | "fails";
type Phase = "failed" | "retrying" | "failed-again" | "loaded";

export function LoadErrorPrototype() {
  const [theme, setTheme] = useTheme();
  const [variant, setVariant] = useStored<Variant>("load.variant", "frame");
  const [cause, setCause] = useStored<Cause>("load.cause", "server");
  const [retry, setRetry] = useStored<Retry>("load.retry", "fails");
  const [phase, setPhase] = useState<Phase>("failed");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setPhase("failed");
    return () => window.clearTimeout(timer.current);
  }, [variant, cause, retry]);

  const tryAgain = () => {
    setPhase("retrying");
    timer.current = window.setTimeout(
      () => setPhase(retry === "loads" ? "loaded" : "failed-again"),
      1600,
    );
  };

  const controls = (
    <PrototypeBar title="Couldn’t load" theme={theme} onTheme={setTheme}>
      <Choice
        label="Variant: around the message"
        value={variant}
        options={[
          ["frame", "The app’s frame"],
          ["bare", "Nothing (today)"],
        ]}
        onChange={setVariant}
      />
      <Choice
        label="Cause"
        value={cause}
        options={[
          ["server", "Server error"],
          ["offline", "Offline"],
        ]}
        onChange={setCause}
      />
      <Choice
        label="Try again"
        value={retry}
        options={[
          ["fails", "Fails again"],
          ["loads", "Loads"],
        ]}
        onChange={setRetry}
      />
    </PrototypeBar>
  );

  // Inside the frame, trying again is the first load again: the skeleton.
  if (variant === "frame" && phase === "retrying")
    return (
      <ShellSkeleton
        settings={{
          ...defaults,
          theme,
          inspector: { ...defaults.inspector, collapsed: true },
        }}
        month="October 2026"
      >
        {controls}
      </ShellSkeleton>
    );

  const message =
    phase === "loaded" ? (
      <p className={styles.loaded}>The plan opens here.</p>
    ) : (
      <Message cause={cause} phase={phase} onRetry={tryAgain} />
    );

  return (
    <Root theme={theme}>
      {variant === "frame" ? <Frame>{message}</Frame> : message}
      {controls}
    </Root>
  );
}

function Root({
  theme,
  children,
}: {
  theme: "dark" | "light";
  children: React.ReactNode;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setRoot} className={shell.root} data-theme={theme}>
      <TooltipProvider container={root}>{children}</TooltipProvider>
    </div>
  );
}

const lastTried = "9:41 a.m.";

function Message({
  cause,
  phase,
  onRetry,
}: {
  cause: Cause;
  phase: Phase;
  onRetry: () => void;
}) {
  const offline = cause === "offline";
  const retrying = phase === "retrying";
  const Icon = offline ? CloudOffIcon : InfoIcon;
  return (
    <div className={`${shell.empty} ${styles.message}`} role="alert">
      <Icon size={18} aria-hidden />
      <div className={shell.emptyBody}>
        <p>
          <strong>
            {offline ? "You’re offline." : "Your budget couldn’t load."}
          </strong>
          {offline
            ? "It opens on its own as soon as this device is back online."
            : phase === "failed-again"
              ? `Tried again at ${lastTried} with no answer. Nothing is lost: every change you made is saved.`
              : "The server didn’t answer. Nothing is lost: every change you made is saved."}
        </p>
        <div>
          <Button disabled={retrying} onClick={onRetry}>
            {retrying ? "Trying again…" : "Try again"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const nav: { icon: LucideIcon; label: string }[] = [
  { icon: WalletCardsIcon, label: "Plan" },
  { icon: ChartPieIcon, label: "Reflect" },
  { icon: ArrowLeftRightIcon, label: "All accounts" },
  { icon: ChartNoAxesCombinedIcon, label: "Loans" },
];

// The shell's frame with nothing that depends on the budget: the same
// sidebar and panel the skeleton draws, minus the bones. Inert until the
// budget loads, so nothing that looks like navigation can take focus.
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <aside className={shell.sidebar} style={{ width: 320 }} aria-hidden inert>
        <div className={shell.sidebarInner} style={{ width: 320 }}>
          <div className={shell.sidebarNav}>
            <div className={shell.sidebarHeader}>
              <span />
              <IconButton label="Hide sidebar">
                <PanelLeftIcon aria-hidden />
              </IconButton>
            </div>
            <div className={shell.sidebarScroll}>
              <ul className={`${shell.navList} ${styles.dimNav}`}>
                {nav.map(({ icon: Icon, label }) => (
                  <li key={label}>
                    <span className={shell.navItem}>
                      <Icon size={14} className={shell.navIcon} aria-hidden />
                      <span className={shell.navLabel}>{label}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </aside>
      <div className={shell.main}>
        <div className={shell.panel}>
          <header className={shell.header} aria-hidden inert>
            <div className={shell.titleGroup}>
              <span className={shell.headerTitle}>Plan</span>
            </div>
          </header>
          <div className={styles.panelBody}>{children}</div>
        </div>
      </div>
    </>
  );
}
