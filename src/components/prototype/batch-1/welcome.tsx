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
import {
  BRAND_BLADES,
  BRAND_SMALL_MARK_SCALE,
  BRAND_TILE_RADIUS,
  BRAND_TILE_STOPS,
} from "~/components/shared/brand-geometry";
import {
  Choice,
  PrototypeBar,
  PrototypePage,
  useNotice,
  useStored,
  useTheme,
} from "./prototype";
import { ONBOARDING_PATH } from "./routes";
import styles from "./welcome.module.css";

// The legacy Welcome, kept as the base and allowed past the app's design
// system limits. Each variant changes one thing from the faithful port:
// "display" moves the headline's scale, "atmosphere" moves the story
// panel's surface. Everything else is identical across all three.
type Variant = "port" | "display" | "atmosphere";

const facts = [
  { icon: WalletCardsIcon, text: "A cash-backed plan that you control" },
  {
    icon: UsersRoundIcon,
    text: "Shared costs, with personal spending kept private",
  },
  { icon: InboxIcon, text: "One inbox for the things that need a look" },
];

export function WelcomePrototype() {
  const [theme, setTheme] = useTheme();
  const [variant, setVariant] = useStored<Variant>("welcome.look", "port");
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
      controls={
        <PrototypeBar title="Welcome" theme={theme} onTheme={setTheme}>
          <Choice
            label="Variant (one change from A)"
            value={variant}
            options={[
              ["port", "A: faithful port"],
              ["display", "B: headline scale"],
              ["atmosphere", "C: story panel surface"],
            ]}
            onChange={setVariant}
          />
        </PrototypeBar>
      }
    >
      <div className={styles.welcome} data-variant={variant}>
        <section className={styles.story}>
          {variant === "atmosphere" && <Pinwheel />}
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
              <a className={styles.primary} href="/sign-up" onClick={signUp}>
                Create your account
                <ArrowRightIcon size={16} aria-hidden />
              </a>
              <a className={styles.secondary} href="/sign-in" onClick={signIn}>
                Sign in
              </a>
            </div>
            <ul className={styles.facts}>
              {facts.map(({ icon: Icon, text }) => (
                <li key={text}>
                  <Icon size={18} aria-hidden />
                  {text}
                </li>
              ))}
            </ul>
            <nav className={styles.policies} aria-label="Policies">
              <a href="/privacy">Privacy policy</a>
              <a href="/terms">Terms of service</a>
            </nav>
          </div>
        </main>
      </div>
      {notice.region}
    </PrototypePage>
  );
}

const markOffset = (100 - 100 * BRAND_SMALL_MARK_SCALE) / 2;

// The legacy wordmark: the pinwheel tile and "caishen." in lowercase, the
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

// Variant C's atmosphere: the brand's own pinwheel, drawn huge in the
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
