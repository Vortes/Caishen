"use client";

import { ArrowRightIcon, RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
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
}[] = [
  {
    title: "Welcome",
    where: "curate.is",
    href: WELCOME_PATH,
    covers:
      "The public landing. Create your account and Sign in go to app.curate.is; a visitor who’s already signed in gets Open your budget. Privacy and Terms.",
    variants: [
      "How much it sells: shows the product, tells the story (legacy, restyled), or just the door",
    ],
  },
  {
    title: "Onboarding",
    where: "app.curate.is/welcome",
    href: ONBOARDING_PATH,
    covers:
      "Its own page after sign-up. Budget name, timezone, daily email, joining a partner by code, categories, accounts (Plaid or by hand), and Ready to Assign. Errors for a failed create, a bad code, and a bank that closes or fails.",
    variants: [
      "Pacing: guided steps, or one step and then a checklist",
      "Categories from: a few questions, or a starter list",
    ],
  },
  {
    title: "Settings › Profile",
    where: "Settings",
    href: settingsPath("profile"),
    covers:
      "Manage account: change email with a code, add or change a password, connected accounts, and deleting the account inline with a typed confirmation.",
    variants: [
      "Who draws it: our rows, Clerk’s UserProfile in the page, or Clerk’s window",
    ],
  },
  {
    title: "Settings › Partner",
    where: "Settings",
    href: settingsPath("partner"),
    covers:
      "Join with a partner’s code beside the existing invite. Expired, used, and your-own-code errors; the connected state.",
    variants: ["Joining is: a row beside inviting, or behind a link"],
  },
  {
    title: "Settings › Notifications",
    where: "Settings",
    href: settingsPath("notifications"),
    covers:
      "Daily email on or off, the hour, and the budget’s timezone, all applying at once. Unsubscribed-from-email state, a traveling-browser hint, and a preview of the email with its new unsubscribe link.",
    variants: [],
  },
  {
    title: "Unsubscribe",
    where: "app.curate.is/email/unsubscribe",
    href: UNSUBSCRIBE_PATH,
    covers:
      "The page the email’s footer link opens, signed out. Unsubscribed, turned back on, already off, and a broken link.",
    variants: ["Takes effect: on the button, or on opening the link"],
  },
  {
    title: "Bank return",
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
    where: "The app",
    href: LOAD_ERROR_PATH,
    covers:
      "The first load fails: server error or offline, Try again, failing again, and loading.",
    variants: ["Around the message: the app’s frame, or nothing (today)"],
  },
];

export function BatchIndex() {
  const [theme] = useTheme();
  return (
    <div className={batch.page} data-theme={theme}>
      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h1 className={styles.title}>Batch 1: account and entry</h1>
            <p className={styles.lede}>
              Design prototypes with hardcoded data; nothing here is wired to
              Clerk, Plaid, or your budget. On each screen, the Prototype panel
              at the bottom left switches variants (each named by the one
              variable it moves), states, and the theme. Reset puts every screen
              back to its start.
            </p>
          </div>
          <Button onClick={resetPrototype}>
            <RotateCcwIcon aria-hidden />
            Reset all
          </Button>
        </header>
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
              </Card>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
