"use client";

import { ArrowLeftIcon } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { Button } from "~/components/ui/button";
import {
  FundingBar,
  FundingSwatch,
  type FundingBarCategory,
} from "../funding-bar";
import { money, type Funding } from "../model";
import shell from "../shell.module.css";
import { AvailablePill } from "../views";
import { ButtonSpecimens } from "./button-specimens";
import { SkeletonSpecimens } from "./skeleton-specimens";
import { TagSpecimens } from "./tag-specimens";
import { ToastSpecimens } from "./toast-specimens";
import styles from "./design-system.module.css";

// The app shell's components with hardcoded examples, so every state can be
// seen whether or not a real budget happens to be in it.

type Specimen = FundingBarCategory & {
  name: string;
  assigned: number;
  carryover: number;
};

// Amounts in cents. Available is what last month left plus this month's
// assigned and activity, as in the plan. Sections are the target's progress
// bar sections; none means no target.
function specimen(
  name: string,
  funding: Funding,
  status: string,
  {
    assigned = 0,
    activity = 0,
    carryover = 0,
    sections,
  }: {
    assigned?: number;
    activity?: number;
    carryover?: number;
    sections?: number[];
  },
): Specimen {
  return {
    name,
    funding,
    status,
    assigned,
    activity,
    carryover,
    available: carryover + assigned + activity,
    target: sections ? { sections } : undefined,
  };
}

const groups: { title: string; description: string; rows: Specimen[] }[] = [
  {
    title: "Funded",
    description:
      "The target is met, it's snoozed, or there's no target and money is available. Unspent money is solid; spent money is a darker, striped shade of the same color. Weekly targets get a section per week, and “set aside another” targets that carried money over get a first section for it.",
    rows: [
      specimen("Rent", "funded", "Funded", {
        assigned: 152_000,
        sections: [152_000],
      }),
      specimen("Groceries", "funded", "Spent $529.11 of $800.00", {
        assigned: 80_000,
        activity: -52_911,
        sections: [80_000],
      }),
      specimen("Netflix", "funded", "Fully spent", {
        assigned: 1_549,
        activity: -1_549,
      }),
      specimen("Phone", "funded", "Funded", {
        carryover: 4_500,
        assigned: 4_500,
        sections: [4_500, 4_500],
      }),
      specimen("Coffee", "funded", "Spent $60.00 of $125.00", {
        assigned: 12_500,
        activity: -6_000,
        sections: [2_500, 2_500, 2_500, 2_500, 2_500],
      }),
    ],
  },
  {
    title: "Underfunded",
    description:
      "Money is assigned but the target isn't met yet. Assigned money is yellow; the empty track is what's still needed. With nothing assigned or spent, the bar is just the track.",
    rows: [
      specimen(
        "Car insurance",
        "underfunded",
        "$80.00 more needed this month",
        {
          assigned: 6_000,
          sections: [14_000],
        },
      ),
      specimen("Internet", "underfunded", "$40.00 more needed this month", {
        assigned: 4_500,
        activity: -4_500,
        sections: [8_500],
      }),
      specimen("Macbook Air", "underfunded", "$76.66 more needed this month", {
        carryover: 7_666,
        sections: [7_666, 7_666],
      }),
      specimen("Gifts", "underfunded", "$60.00 more needed this month", {
        sections: [6_000],
      }),
    ],
  },
  {
    title: "Overspent",
    description:
      "Spending went past the money assigned. Covered spending keeps its color and the overspent amount is striped red, cash or credit alike; only the Available amount tells them apart, red for cash and amber for credit. With nothing assigned, the bar is all red.",
    rows: [
      specimen("Dining out", "overspent", "Overspent. $334.42 of $254.27", {
        assigned: 25_427,
        activity: -33_442,
        sections: [25_427],
      }),
      specimen("Apartment living", "overspent", "Overspent. $105.30 of $0.00", {
        activity: -10_530,
      }),
      specimen(
        "Clothing",
        "credit",
        "Overspent on credit. $145.00 of $100.00",
        { assigned: 10_000, activity: -14_500, sections: [10_000] },
      ),
      specimen(
        "Groceries, weekly",
        "overspent",
        "Overspent. $500.00 of $400.00",
        {
          assigned: 40_000,
          activity: -50_000,
          sections: [10_000, 10_000, 10_000, 10_000],
        },
      ),
    ],
  },
];

const key: (ComponentProps<typeof FundingSwatch> & { label: string })[] = [
  {
    kind: "available",
    tone: "funded",
    label: "Available: assigned, not yet spent",
  },
  { kind: "spent", tone: "funded", label: "Spent: assigned and already spent" },
  {
    kind: "needed",
    tone: "funded",
    label: "Still needed: what the target asks for",
  },
  {
    kind: "over",
    tone: "overspent",
    label: "Overspent: spent past what was assigned",
  },
];

export function DesignSystem() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  return (
    <div className={shell.root} data-theme={theme}>
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Caishen app shell</p>
            <h1>Design system</h1>
            <p>
              The shell&rsquo;s components, with hardcoded examples of every
              state.
            </p>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.theme} role="group" aria-label="Theme">
              {(["dark", "light"] as const).map((option) => (
                <Button
                  key={option}
                  aria-pressed={theme === option}
                  onClick={() => setTheme(option)}
                >
                  {option === "dark" ? "Dark" : "Light"}
                </Button>
              ))}
            </div>
            <a className={styles.back} href="/prototype/app-shell">
              <ArrowLeftIcon size={14} aria-hidden />
              App shell
            </a>
          </div>
        </header>

        <ButtonSpecimens />

        <TagSpecimens />

        <ToastSpecimens />

        <SkeletonSpecimens />

        <section className={styles.section} aria-labelledby="funding-bar">
          <h2 id="funding-bar">Funding bar</h2>
          <p className={styles.lead}>
            Under each category, one track splits this month&rsquo;s money by
            what happened to it, in the category&rsquo;s status color. The
            status at the bar&rsquo;s end says the same thing in words.
          </p>
          <ul className={styles.key}>
            {key.map((item) => (
              <li key={item.label}>
                <FundingSwatch kind={item.kind} tone={item.tone} />
                {item.label}
              </li>
            ))}
          </ul>

          {groups.map((group) => (
            <div key={group.title} className={styles.group}>
              <h3>{group.title}</h3>
              <p>{group.description}</p>
              <div className={styles.table}>
                <div
                  className={`${shell.columns} ${shell.columnHeader}`}
                  aria-hidden
                >
                  <span>Category</span>
                  <span className={shell.numeric} data-optional>
                    Assigned
                  </span>
                  <span className={shell.numeric} data-optional>
                    Activity
                  </span>
                  <span className={shell.numeric}>Available</span>
                </div>
                {group.rows.map((row) => (
                  <div
                    key={row.name}
                    className={`${shell.columns} ${shell.row} ${styles.row}`}
                  >
                    <span className={shell.rowName}>
                      <FundingBar category={row}>
                        <span className={shell.truncate}>{row.name}</span>
                      </FundingBar>
                    </span>
                    <span
                      className={`${shell.numeric} ${shell.muted}`}
                      data-optional
                    >
                      {money(row.assigned)}
                    </span>
                    <span
                      className={`${shell.numeric} ${shell.muted}`}
                      data-optional
                    >
                      {money(row.activity)}
                    </span>
                    <span className={shell.numeric}>
                      <AvailablePill category={row} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
