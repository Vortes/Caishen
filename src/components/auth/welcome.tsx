"use client";

import { ArrowRightIcon, ShieldCheckIcon } from "lucide-react";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import {
  BRAND_BLADES,
  BRAND_SMALL_MARK_SCALE,
  BRAND_TILE_RADIUS,
  BRAND_TILE_STOPS,
} from "~/components/shared/brand-geometry";
import { EntryPage } from "~/components/entry/entry-page";
import { SHELL_PATH } from "~/components/workspace/routes";
import styles from "~/components/entry/welcome.module.css";

// Welcome's brand treatment allows a 96px
// display headline, violet-tinted panels, a solid primary button, and the
// brand's pinwheel drawn faintly across the story panel.
export function Welcome() {
  return (
    <EntryPage>
      <div className={styles.welcome}>
        <section className={styles.story}>
          <Pinwheel />
          <Wordmark />
          <div className={styles.storyCopy}>
            <h1 className={styles.headline}>
              A little clarity,
              <br />
              every day.
            </h1>
            <p className={styles.intro}>
              Your money has a purpose. Give it a place, keep the everyday in
              order, and make room for what matters.
            </p>
          </div>
          <p className={styles.storyFoot}>
            <ShieldCheckIcon size={15} aria-hidden />
            Personal budgets. A shared understanding.
          </p>
        </section>

        <main className={styles.form}>
          <div className={styles.column}>
            <p className={styles.eyebrow}>Your money, together</p>
            <h2 className={styles.title}>Make yourself at home.</h2>
            <p className={styles.lede}>
              A calm place for your own budget, the expenses you share, and a
              short daily review.
            </p>
            <div className={styles.actions}>
              <SignUpButton mode="modal" forceRedirectUrl="/welcome">
                <button type="button" className={styles.primary}>
                  Create your account
                  <ArrowRightIcon size={16} aria-hidden />
                </button>
              </SignUpButton>
              <SignInButton mode="modal" forceRedirectUrl={SHELL_PATH}>
                <button type="button" className={styles.secondary}>
                  Sign in
                </button>
              </SignInButton>
            </div>
            <nav className={styles.policies} aria-label="Policies">
              <a href="/privacy">Privacy policy</a>
              <a href="/terms">Terms of service</a>
            </nav>
          </div>
        </main>
      </div>
    </EntryPage>
  );
}

const markOffset = (100 - 100 * BRAND_SMALL_MARK_SCALE) / 2;

// The wordmark: the pinwheel tile and "caishen." in lowercase, the
// period in the brand's violet.
function Wordmark() {
  return (
    <span className={styles.wordmark}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <defs>
          <linearGradient id="welcome-tile" x1="0" y1="0" x2="0" y2="1">
            {BRAND_TILE_STOPS.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
        <rect
          width="100"
          height="100"
          rx={BRAND_TILE_RADIUS}
          fill="url(#welcome-tile)"
        />
        <g
          fill="#fff"
          transform={`translate(${markOffset} ${markOffset}) scale(${BRAND_SMALL_MARK_SCALE})`}
        >
          {BRAND_BLADES.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>
      <span>
        caishen<span className={styles.period}>.</span>
      </span>
    </span>
  );
}

// The story panel's atmosphere: the brand's own pinwheel, drawn huge in the
// panel's hue and cropped by its edge, instead of a generic glow.
function Pinwheel() {
  return (
    <svg className={styles.pinwheel} viewBox="0 0 100 100" aria-hidden>
      {BRAND_BLADES.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
