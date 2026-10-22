"use client";

import { ArrowRightIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  ItemNotes,
  ReviewNotesBar,
  ReviewNotesProvider,
} from "~/components/prototype/review-notes";
import { IconButton } from "~/components/ui/icon-button";
import { TooltipProvider } from "~/components/ui/tooltip";
import { resetPrototype, useTheme } from "./prototype";
import {
  BANK_OAUTH_PATH,
  LOAD_ERROR_PATH,
  ONBOARDING_PATH,
  UNSUBSCRIBE_PATH,
  WELCOME_PATH,
  settingsPath,
} from "./routes";
import batch from "./batch.module.css";
import styles from "./batch-index.module.css";

const screens: {
  title: string;
  where: string;
  href: string;
  covers: string;
  variants: string[];
  // Screenshots of what the legacy app did, from public/prototype/legacy.
  legacy: Legacy[];
}[] = [
  {
    title: "Welcome",
    legacy: [
      { src: "legacy-welcome", caption: "Welcome page at “/” when signed out" },
    ],
    where: "Signed out",
    href: WELCOME_PATH,
    covers:
      "The legacy Welcome, same content and purpose, allowed past the design system’s limits: a 96px headline and the brand pinwheel on the story panel, Create your account, Sign in, Privacy policy, and Terms of service.",
    variants: [],
  },
  {
    title: "Onboarding",
    legacy: [
      {
        src: "legacy-onboarding",
        caption: "“Let’s give your money a home”: budget name and timezone",
      },
    ],
    where: "After sign-up",
    href: ONBOARDING_PATH,
    covers:
      "Its own page. Budget name, timezone, daily email, categories, accounts (Plaid or by hand), and Ready to Assign. Joining with a partner’s code shows who invited you; expired, used, full, no-match, and too-many-tries codes each have their own message.",
    variants: [
      "Pacing: guided steps, or one step and then a checklist",
      "Categories from: a few questions, or a starter list",
    ],
  },
  {
    title: "Settings › Profile",
    legacy: [
      {
        src: "legacy-settings-preferences",
        caption: "Settings › Personal preferences: name, timezone, daily email",
      },
      {
        src: "legacy-user-menu",
        caption: "User menu with Manage account and Sign out",
      },
      { src: "legacy-manage-account", caption: "Clerk’s Account dialog" },
    ],
    where: "Settings",
    href: settingsPath("profile"),
    covers:
      "Timezone beside the budget name; the daily email’s on/off and hour with a preview; Manage account (email, password, connected accounts); and deleting the account in place by typing your email.",
    variants: [
      "Who draws Account: our rows, Clerk’s UserProfile in the page, or Clerk’s window",
    ],
  },
  {
    title: "Settings › Partner",
    legacy: [
      {
        src: "legacy-partner-section",
        caption:
          "Partner section with Create invitation code and Enter partner’s code",
      },
      {
        src: "legacy-join-partner",
        caption: "“Connect with your partner” dialog",
      },
    ],
    where: "Settings",
    href: settingsPath("partner"),
    covers:
      "Short invite codes like KQ7M-4XPD: create, copy, and replace one; join with a partner’s code, formatted as you type or paste. Every error, and the connected state.",
    variants: ["Joining is: a row beside inviting, or behind a link"],
  },
  {
    title: "Unsubscribe",
    legacy: [],
    where: "app.curate.is/email/unsubscribe",
    href: UNSUBSCRIBE_PATH,
    covers:
      "The page the email’s footer link opens, signed out. Unsubscribed, turned back on, already off, and a broken link.",
    variants: ["Takes effect: on the button, or on opening the link"],
  },
  {
    title: "Bank return",
    legacy: [
      {
        src: "legacy-plaid-oauth-signed-out",
        caption: "Signed out: “Finish connecting your bank”",
      },
      {
        src: "legacy-plaid-oauth-no-session",
        caption: "Session missing: “Your bank connection needs attention”",
      },
    ],
    where: "app.curate.is/banks/oauth",
    href: BANK_OAUTH_PATH,
    covers:
      "Where Chase and other OAuth banks send people back. Signed out, in Plaid, saving, updating, set up accounts, added, update failed, connection failed, and session missing.",
    variants: [
      "Lands on: the app loading behind the bank dialog, or its own page",
    ],
  },
  {
    title: "Couldn’t load",
    legacy: [
      {
        src: "legacy-load-error",
        caption: "“Your budget couldn’t load” with Try again",
      },
    ],
    where: "The app",
    href: LOAD_ERROR_PATH,
    covers:
      "The first load fails: server error or offline, Try again, failing again, and loading.",
    variants: ["Around the message: the app’s frame, or nothing (today)"],
  },
];

export function BatchIndex() {
  const [theme] = useTheme();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setRoot} className={batch.page} data-theme={theme}>
      <TooltipProvider container={root}>
        <ReviewNotesProvider
          storageKey="batch-1"
          title="Batch 1: account and entry"
        >
          <main className={styles.main}>
            <header className={styles.header}>
              <div className={styles.headerText}>
                <h1 className={styles.title}>Batch 1: account and entry</h1>
                <p className={styles.lede}>
                  Design prototypes with hardcoded data; nothing here is wired
                  to Clerk, Plaid, or your budget. Each screen shows what the
                  legacy app did beside it; open one to try the new design. On
                  each screen, the Prototype panel at the bottom left switches
                  variants (each named by the one variable it moves), states,
                  and the theme. Reset puts every screen back to its start.
                </p>
              </div>
              <Button onClick={resetPrototype}>
                <RotateCcwIcon aria-hidden />
                Reset all
              </Button>
            </header>
            <ReviewNotesBar />
            <ul className={styles.list}>
              {screens.map((screen) => (
                <li key={screen.title}>
                  <Card>
                    <div className={styles.row}>
                      <div className={styles.rowText}>
                        <h2 className={styles.rowTitle}>
                          {screen.title}
                          <span className={styles.where}>{screen.where}</span>
                        </h2>
                        <p className={styles.covers}>{screen.covers}</p>
                        {screen.variants.length > 0 && (
                          <ul className={styles.variants}>
                            {screen.variants.map((variant) => (
                              <li key={variant}>{variant}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <Button asChild>
                        <Link href={screen.href}>
                          Open
                          <ArrowRightIcon aria-hidden />
                        </Link>
                      </Button>
                    </div>
                    <div className={styles.legacy}>
                      <span className={styles.legacyLabel}>Legacy</span>
                      {screen.legacy.length ? (
                        <ul className={styles.thumbs}>
                          {screen.legacy.map((shot) => (
                            <li key={shot.src}>
                              <LegacyShot shot={shot} container={root} />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className={styles.noLegacy}>
                          No legacy equivalent: the legacy email had no
                          unsubscribe link.
                        </p>
                      )}
                    </div>
                    <div className={styles.review}>
                      <span className={styles.legacyLabel}>Review</span>
                      <ItemNotes id={screen.title} title={screen.title} />
                      {screen.variants.map((variant) => (
                        <div key={variant} className={styles.choice}>
                          <p className={styles.choiceLabel}>{variant}</p>
                          <ItemNotes
                            id={`${screen.title} / ${variant}`}
                            title={`${screen.title}, choice: ${variant}`}
                          />
                        </div>
                      ))}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </main>
        </ReviewNotesProvider>
      </TooltipProvider>
    </div>
  );
}

type Legacy = { src: string; caption: string };

const legacyUrl = (src: string) => `/prototype/legacy/${src}.webp`;

// A thumbnail that opens the full screenshot, with its caption, in a
// dialog. Escape, the close button, or a click outside closes it.
function LegacyShot({
  shot,
  container,
}: {
  shot: Legacy;
  container: HTMLElement | null;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className={styles.thumb}>
        {/* Static prototype screenshots; next/image adds nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={legacyUrl(shot.src)}
          alt=""
          width={1440}
          height={900}
          loading="lazy"
          decoding="async"
        />
        <span className={styles.thumbCaption}>{shot.caption}</span>
      </Dialog.Trigger>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.viewer} aria-describedby={undefined}>
          <div className={styles.viewerHead}>
            <Dialog.Title className={styles.viewerTitle}>
              <span className={styles.legacyLabel}>Legacy</span>
              {shot.caption}
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close">
                <XIcon aria-hidden />
              </IconButton>
            </Dialog.Close>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.viewerImage}
            src={legacyUrl(shot.src)}
            alt={`Legacy: ${shot.caption}`}
            width={1440}
            height={900}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
