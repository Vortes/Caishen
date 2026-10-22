import Link from "next/link";
import {
  ItemNotes,
  ReviewNotesBar,
  ReviewNotesProvider,
} from "~/components/prototype/review-notes";
import { LegacyPreview, SavedTheme } from "./legacy-preview";
import { SCENARIOS, type ScenarioId } from "./scenarios";
import styles from "./batch-4.module.css";

const PLAN = "/prototype/batch-4-plan/plan";

const features: {
  title: string;
  summary: string;
  variable: string;
  variants: [string, string][];
  states: ScenarioId[];
}[] = [
  {
    title: "Snooze a target for this month",
    summary:
      "Select a category with a target. Snoozing skips it until next month: its pill turns green or gray, it leaves Underfunded and Cost to Be Me, and it shows in the Snoozed view. Only the current month can be snoozed, and card payment targets can't be, as in YNAB.",
    variable: "Where the control lives",
    variants: [
      [
        "Target tab (recommended)",
        "A switch under the target's progress, YNAB web's placement",
      ],
      [
        "⋯ menu",
        "An item in the category card's menu, with Unsnooze in the tab once snoozed",
      ],
    ],
    states: [
      "snoozed",
      "snooze-now",
      "card-payment",
      "future-month",
      "past-snoozed",
      "snoozed-view",
    ],
  },
  {
    title: "Expected income in Cost to Be Me",
    summary:
      "With nothing selected, the Cost to Be Me tab compares what your targets ask for with what you expect to earn this month.",
    variable: "How the amount is edited",
    variants: [
      [
        "Click to edit (recommended)",
        "Reads as text with a pencil; opens a field with Save, like the target editor and YNAB web",
      ],
      [
        "Always a field",
        "An amount field that saves on Enter or leaving it, like legacy",
      ],
    ],
    states: ["no-income", "income-short", "income-covers"],
  },
  {
    title: "Expected income in a new month",
    summary:
      "Caishen stores expected income per month; YNAB carries it forward. This choice decides what a month without one shows.",
    variable: "Whether last month's amount is offered",
    variants: [
      [
        "Offer last month's (recommended)",
        "One click copies the latest earlier month's amount",
      ],
      ["Blank", "Every month starts empty"],
    ],
    states: ["no-income"],
  },
  {
    title: "Find a category (Filter, F)",
    summary:
      "The toolbar's Filter button, inert in the shell today, finds categories by their name or their group's. F opens it from anywhere on the plan.",
    variable: "What search does",
    variants: [
      [
        "Narrows the plan (recommended)",
        "The button opens into a field and the plan shows only matches, with group totals of what's shown",
      ],
      [
        "Jumps to one",
        "The button opens a finder; picking a category selects it and scrolls to it, and the plan never narrows",
      ],
    ],
    states: ["search-none"],
  },
  {
    title: "Month picker",
    summary:
      "The arrows stay. The month label opens a dropdown that reaches any month from the budget's first, March 2024, to December 2031. This month is marked, and This month returns to it.",
    variable: "How year and month are laid out",
    variants: [
      [
        "Year grid (recommended)",
        "Year arrows over a 4 × 3 grid of months, like the date calendar and YNAB mobile",
      ],
      [
        "Two lists",
        "Every year in one column, the chosen year's months in the next",
      ],
    ],
    states: ["first-month", "far-future"],
  },
];

const labelOf = (id: ScenarioId) => SCENARIOS.find((item) => item.id === id)!;

export function Batch4Index() {
  return (
    <SavedTheme>
      <main className={styles.index}>
        <ReviewNotesProvider storageKey="batch-4" title="Batch 4: Plan">
          <header className={styles.indexHeader}>
            <h1>Batch 4: Plan</h1>
            <p>
              Prototype for owner review, with hardcoded data and none of it
              saved. Each choice moves one variable; switch variants in the bar
              above the shell. The recommended variant is on by default.
            </p>
            <p>
              <Link className={styles.indexPrimary} href={PLAN}>
                Open the plan prototype
              </Link>
            </p>
          </header>
          <ReviewNotesBar />
          {features.map((feature) => (
            <section key={feature.title} className={styles.indexSection}>
              <h2>{feature.title}</h2>
              <p>{feature.summary}</p>
              <ItemNotes id={feature.title} title={feature.title} />
              <h3>Variable: {feature.variable}</h3>
              <ul className={styles.indexList}>
                {feature.variants.map(([name, detail]) => (
                  <li key={name}>
                    <strong>{name}.</strong> {detail}
                  </li>
                ))}
              </ul>
              <ItemNotes
                id={`${feature.title} / choice`}
                title={`${feature.title}, choice: ${feature.variable}`}
              />
              <h3>States to try, beside what legacy did</h3>
              <ul className={styles.indexLinks}>
                {feature.states.map((id) => (
                  <li key={id}>
                    <LegacyPreview state={id} />
                    <span className={styles.stateText}>
                      <Link href={`${PLAN}?state=${id}`}>
                        {labelOf(id).label}
                      </Link>
                      <span>{labelOf(id).hint}</span>
                    </span>
                    <div className={styles.stateReview}>
                      <ItemNotes
                        id={`${feature.title} / ${id}`}
                        title={`${feature.title}, state: ${labelOf(id).label}`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className={styles.indexSection}>
            <h2>Keyboard</h2>
            <ul className={styles.indexList}>
              <li>
                <strong>F</strong> finds a category. In the field, Down or Enter
                moves into the results; Escape clears, then closes.
              </li>
              <li>
                In the month grid, arrows move by month and row, Page Up and
                Page Down by year, Enter picks, Escape closes. In two lists,
                Left and Right move between years and months.
              </li>
              <li>
                The snooze switch toggles with Space. Expected income saves with
                Enter; Escape cancels.
              </li>
            </ul>
            <ItemNotes id="Keyboard" title="Keyboard" />
          </section>
        </ReviewNotesProvider>
      </main>
    </SavedTheme>
  );
}
