"use client";

import {
  ArrowRightIcon,
  HandCoinsIcon,
  MailCheckIcon,
  WalletCardsIcon,
} from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { FundingBar } from "~/components/prototype/app-shell/funding-bar";
import { AvailablePill } from "~/components/prototype/app-shell/views";
import type { Funding } from "~/components/prototype/app-shell/model";
import { Brand, useBrandName, type BrandName } from "./brand";
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
import batch from "./batch.module.css";

// The variable the variants move: how much the page sells before asking
// the visitor to sign up.
type Variant = "product" | "story" | "gate";
type Visitor = "signed-out" | "signed-in";

const APP = "https://app.curate.is";

// curate.is, the public landing. Every button leads into the app at
// app.curate.is; sign-in and sign-up are Clerk's pages there.
export function WelcomePrototype() {
  const [theme, setTheme] = useTheme();
  const [variant, setVariant] = useStored<Variant>(
    "welcome.variant",
    "product",
  );
  const [visitor, setVisitor] = useStored<Visitor>(
    "welcome.visitor",
    "signed-out",
  );
  const [name, setName] = useBrandName();
  const notice = useNotice();

  // In the prototype, leaving for app.curate.is says where it would go.
  const go = (event: MouseEvent, path: string, next?: ReactNode) => {
    event.preventDefault();
    notice.show(`Opens ${APP.replace("https://", "")}${path}`, next);
  };
  const toOnboarding = (
    <Button size="sm" asChild>
      <a href={ONBOARDING_PATH}>See onboarding</a>
    </Button>
  );
  const ctas: Ctas = {
    signedIn: visitor === "signed-in",
    signUp: (event) => go(event, "/sign-up, then onboarding", toOnboarding),
    signIn: (event) => go(event, "/sign-in, then your budget"),
    open: (event) => go(event, ", your budget"),
  };

  return (
    <PrototypePage
      theme={theme}
      fixed={variant === "story"}
      controls={
        <PrototypeBar
          title="Welcome (curate.is)"
          theme={theme}
          onTheme={setTheme}
        >
          <Choice
            label="Variant: how much it sells"
            value={variant}
            options={[
              ["product", "Shows the product"],
              ["story", "Tells the story"],
              ["gate", "Just the door"],
            ]}
            onChange={setVariant}
          />
          <Choice
            label="Visitor"
            value={visitor}
            options={[
              ["signed-out", "New visitor"],
              ["signed-in", "Already signed in"],
            ]}
            onChange={setVisitor}
          />
          <Choice
            label="Open question: name"
            value={name}
            options={[
              ["Caishen", "Caishen"],
              ["Curate", "Curate"],
            ]}
            onChange={setName}
          />
        </PrototypeBar>
      }
    >
      {variant === "product" && <ProductLanding name={name} ctas={ctas} />}
      {variant === "story" && <StoryLanding name={name} ctas={ctas} />}
      {variant === "gate" && <GateLanding name={name} ctas={ctas} />}
      {notice.region}
    </PrototypePage>
  );
}

type Ctas = {
  signedIn: boolean;
  signUp: (event: MouseEvent) => void;
  signIn: (event: MouseEvent) => void;
  open: (event: MouseEvent) => void;
};

// A signed-in visitor gets one way in, not a sign-up pitch.
function PrimaryActions({ ctas }: { ctas: Ctas }) {
  if (ctas.signedIn)
    return (
      <div className={batch.actions}>
        <Button variant="primary" asChild>
          <a href={APP} onClick={ctas.open}>
            Open your budget
            <ArrowRightIcon aria-hidden />
          </a>
        </Button>
      </div>
    );
  return (
    <div className={batch.actions}>
      <Button variant="primary" asChild>
        <a href={`${APP}/sign-up`} onClick={ctas.signUp}>
          Create your account
        </a>
      </Button>
      <Button asChild>
        <a href={`${APP}/sign-in`} onClick={ctas.signIn}>
          Sign in
        </a>
      </Button>
    </div>
  );
}

function SignedInAs({ ctas }: { ctas: Ctas }) {
  if (!ctas.signedIn) return null;
  return <p className={styles.signedIn}>Signed in as alex.rivera@gmail.com</p>;
}

function PolicyLinks() {
  return (
    <nav className={styles.policies} aria-label="Policies">
      <a className={batch.textLink} href="/privacy">
        Privacy
      </a>
      <a className={batch.textLink} href="/terms">
        Terms
      </a>
    </nav>
  );
}

const promises = [
  {
    icon: WalletCardsIcon,
    title: "Every dollar has a job",
    body: "Plan with the cash you have today. Give each dollar a category before you spend it, and see what’s left in every one.",
  },
  {
    icon: HandCoinsIcon,
    title: "Shared, not merged",
    body: "Split rent and groceries with your partner. They see shared costs and who owes whom; the rest of your spending stays yours.",
  },
  {
    icon: MailCheckIcon,
    title: "One review a day",
    body: "Bank activity arrives overnight. A short morning email says what needs a look, and the review list keeps it until it’s done.",
  },
];

// Variant 1: a header, the promise, the product itself, and three reasons.
function ProductLanding({ name, ctas }: { name: BrandName; ctas: Ctas }) {
  return (
    <div className={styles.product}>
      <header className={styles.siteHeader}>
        <Brand name={name} />
        <nav className={styles.headerActions} aria-label="Account">
          {ctas.signedIn ? (
            <Button size="sm" variant="primary" asChild>
              <a href={APP} onClick={ctas.open}>
                Open your budget
              </a>
            </Button>
          ) : (
            <>
              <Button size="sm" variant="quiet" asChild>
                <a href={`${APP}/sign-in`} onClick={ctas.signIn}>
                  Sign in
                </a>
              </Button>
              <Button size="sm" asChild>
                <a href={`${APP}/sign-up`} onClick={ctas.signUp}>
                  Create account
                </a>
              </Button>
            </>
          )}
        </nav>
      </header>

      <main className={styles.productMain}>
        <section className={styles.hero}>
          <h1 className={styles.headline}>A little clarity, every day.</h1>
          <p className={styles.lede}>
            A budget for each of you, the costs you share, and one short review
            each morning. Give every dollar a job before you spend it.
          </p>
          <PrimaryActions ctas={ctas} />
          <SignedInAs ctas={ctas} />
        </section>

        <PlanGlimpse />

        <section className={styles.promises} aria-label={`Why ${name}`}>
          {promises.map(({ icon: Icon, title, body }) => (
            <div key={title} className={styles.promise}>
              <Icon size={15} aria-hidden />
              <h2>{title}</h2>
              <p>{body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className={styles.siteFooter}>
        <span>© 2026 {name}</span>
        <PolicyLinks />
      </footer>
    </div>
  );
}

const glimpse: {
  name: string;
  assigned: number;
  activity: number;
  available: number;
  funding: Funding;
  status: string;
  sections: number[];
}[] = [
  {
    name: "Rent",
    assigned: 160000,
    activity: -160000,
    available: 0,
    funding: "funded",
    status: "Fully spent",
    sections: [160000],
  },
  {
    name: "Groceries",
    assigned: 60000,
    activity: -38214,
    available: 21786,
    funding: "funded",
    status: "$217.86 left",
    sections: [60000],
  },
  {
    name: "Dining out",
    assigned: 20000,
    activity: -23480,
    available: -3480,
    funding: "overspent",
    status: "Overspent $34.80",
    sections: [20000],
  },
  {
    name: "Car insurance",
    assigned: 9000,
    activity: 0,
    available: 27000,
    funding: "underfunded",
    status: "$270.00 of $540.00 by Dec",
    sections: [54000],
  },
  {
    name: "Gifts",
    assigned: 5000,
    activity: -1299,
    available: 12701,
    funding: "funded",
    status: "$127.01 left",
    sections: [14000],
  },
];

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

// The plan as it looks in the app, drawn with the app's own funding bar and
// pill so it can't drift from the real thing. A picture to screen readers.
function PlanGlimpse() {
  return (
    <div
      className={styles.glimpse}
      role="img"
      aria-label="The plan: categories with what’s assigned, spent, and available, and Ready to Assign at the top"
    >
      <div className={styles.glimpseHeader}>
        <span>Plan</span>
        <span className={styles.glimpseMonth}>October 2026</span>
        <span className={styles.glimpseReady}>
          <span>Ready to Assign</span>
          <strong>$1,240.00</strong>
        </span>
      </div>
      <div className={styles.glimpseColumns} aria-hidden>
        <span>Category</span>
        <span>Assigned</span>
        <span>Available</span>
      </div>
      {glimpse.map((row) => (
        <div key={row.name} className={styles.glimpseRow}>
          <FundingBar
            category={{
              funding: row.funding,
              activity: row.activity,
              available: row.available,
              status: row.status,
              target: { sections: row.sections },
            }}
          >
            {row.name}
          </FundingBar>
          <span className={styles.glimpseAmount}>{money(row.assigned)}</span>
          <span className={styles.glimpseAvailable}>
            <AvailablePill
              category={{ funding: row.funding, available: row.available }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

// Variant 2: the legacy Welcome's story, restyled on the design system.
function StoryLanding({ name, ctas }: { name: BrandName; ctas: Ctas }) {
  return (
    <div className={styles.story}>
      <section className={styles.storyPanel}>
        <Brand name={name} />
        <div className={styles.storyCopy}>
          <h1 className={styles.headline}>A little clarity, every day.</h1>
          <p className={styles.lede}>
            Your money has a purpose. Give it a place, keep the everyday in
            order, and make room for what matters.
          </p>
        </div>
        <p className={styles.storyFoot}>
          Personal budgets. A shared understanding.
        </p>
      </section>
      <main className={styles.storyMain}>
        <div className={styles.storyColumn}>
          <div className={styles.storyIntro}>
            <h2 className={styles.title}>Make yourself at home.</h2>
            <p className={styles.lede}>
              A calm place for your own budget, the expenses you share, and a
              short daily review.
            </p>
          </div>
          <PrimaryActions ctas={ctas} />
          <SignedInAs ctas={ctas} />
          <ul className={styles.facts}>
            {promises.map(({ icon: Icon, title, body }) => (
              <li key={title}>
                <Icon size={15} aria-hidden />
                <span>
                  <strong>{title}.</strong> {body}
                </span>
              </li>
            ))}
          </ul>
          <PolicyLinks />
        </div>
      </main>
    </div>
  );
}

// Variant 3: only the way in. The pitch lives elsewhere, or nowhere yet.
function GateLanding({ name, ctas }: { name: BrandName; ctas: Ctas }) {
  return (
    <main className={styles.gate}>
      <div className={styles.gateCard}>
        <Brand name={name} />
        <div className={styles.storyIntro}>
          <h1 className={styles.title}>A little clarity, every day.</h1>
          <p className={styles.lede}>
            Your budget, the costs you share with your partner, and one short
            review each morning.
          </p>
        </div>
        <PrimaryActions ctas={ctas} />
        <SignedInAs ctas={ctas} />
      </div>
      <PolicyLinks />
    </main>
  );
}
