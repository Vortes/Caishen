"use client";

import {
  ArrowRightIcon,
  InboxIcon,
  ShieldCheckIcon,
  UsersRoundIcon,
  WalletCardsIcon,
} from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";
import { Button } from "~/components/ui/button";
import { Brand } from "./brand";
import { PrototypeBar, PrototypePage, useNotice, useTheme } from "./prototype";
import { ONBOARDING_PATH } from "./routes";
import batch from "./batch.module.css";
import styles from "./welcome.module.css";

const facts = [
  { icon: WalletCardsIcon, text: "A cash-backed plan that you control" },
  {
    icon: UsersRoundIcon,
    text: "Shared costs, with personal spending kept private",
  },
  { icon: InboxIcon, text: "One inbox for the things that need a look" },
];

// The legacy Welcome, same content and purpose, on the design system: the
// story sits in a panel like the app's main panel, the way in beside it.
// Signed-out visitors see it at "/"; both buttons open Clerk.
export function WelcomePrototype() {
  const [theme, setTheme] = useTheme();
  const notice = useNotice();

  const signUp = (event: MouseEvent) => {
    event.preventDefault();
    notice.show(
      "Opens Clerk’s sign-up, then onboarding",
      <Button size="sm" asChild>
        <Link href={ONBOARDING_PATH}>See onboarding</Link>
      </Button>,
    );
  };
  const signIn = (event: MouseEvent) => {
    event.preventDefault();
    notice.show("Opens Clerk’s sign-in, then your budget");
  };

  return (
    <PrototypePage
      theme={theme}
      fixed
      controls={
        <PrototypeBar title="Welcome" theme={theme} onTheme={setTheme} />
      }
    >
      <div className={styles.welcome}>
        <section className={styles.story}>
          <Brand />
          <div className={styles.storyCopy}>
            <h1 className={styles.headline}>
              A little clarity,
              <br />
              every day.
            </h1>
            <p className={styles.lede}>
              Your money has a purpose. Give it a place, keep the everyday in
              order, and make room for what matters.
            </p>
          </div>
          <p className={styles.storyFoot}>
            <ShieldCheckIcon size={13} aria-hidden />
            Personal budgets. A shared understanding.
          </p>
        </section>

        <main className={styles.main}>
          <div className={styles.column}>
            <div className={styles.intro}>
              <p className={styles.kicker}>Your money, together</p>
              <h2 className={styles.title}>Make yourself at home.</h2>
              <p className={styles.lede}>
                A calm place for your own budget, the expenses you share, and a
                short daily review.
              </p>
            </div>
            <div className={batch.actions}>
              <Button variant="primary" asChild>
                <a href="/sign-up" onClick={signUp}>
                  Create your account
                  <ArrowRightIcon aria-hidden />
                </a>
              </Button>
              <Button asChild>
                <a href="/sign-in" onClick={signIn}>
                  Sign in
                </a>
              </Button>
            </div>
            <ul className={styles.facts}>
              {facts.map(({ icon: Icon, text }) => (
                <li key={text}>
                  <Icon size={14} aria-hidden />
                  {text}
                </li>
              ))}
            </ul>
            <nav className={styles.policies} aria-label="Policies">
              <a className={batch.textLink} href="/privacy">
                Privacy policy
              </a>
              <a className={batch.textLink} href="/terms">
                Terms of service
              </a>
            </nav>
          </div>
        </main>
      </div>
      {notice.region}
    </PrototypePage>
  );
}
