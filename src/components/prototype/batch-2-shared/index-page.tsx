import Link from "next/link";
import { LegacyShots, SchemeTheme, type Shot } from "./legacy-shots";
import { choices } from "./choices";
import styles from "./index-page.module.css";

const base = "/prototype/batch-2-shared/play";

const shot = (name: string, alt: string): Shot => ({
  src: `/prototype/legacy/legacy-${name}.webp`,
  alt,
});
const statement = shot(
  "shared-statement",
  "Partner section with per-category balances",
);

const flows: {
  title: string;
  href: string;
  try: string;
  legacy: string;
  shots: Shot[];
}[] = [
  {
    title: "Share a category",
    href: `${base}?scenario=owe&select=dining&open=share`,
    try: "Pick a split, watch the dollar example update, then Share category. Dining & coffee's row gains the shared icon and the Shared tab lists it.",
    legacy: "Was the “Share with your partner” dialog.",
    shots: [shot("share-category", "“Share with your partner” dialog")],
  },
  {
    title: "Edit a shared split",
    href: `${base}?scenario=owe&select=groceries&open=split`,
    try: "Change Groceries from 40/60. Stop sharing isn't offered: Groceries has purchases, so the engine keeps it shared.",
    legacy: "Was the “Edit shared category” dialog.",
    shots: [shot("shared-split-edit", "“Edit shared category” dialog")],
  },
  {
    title: "Stop sharing (delete a shared category)",
    href: `${base}?scenario=owe&select=weekend-projects&open=split`,
    try: "Weekend projects has no activity, so Stop sharing is there. Flip “Stop-sharing confirmation” to compare inline, dialog, and undo-only.",
    legacy: "Was “Delete shared category?” behind the edit dialog.",
    shots: [shot("shared-delete", "“Delete shared category?” dialog")],
  },
  {
    title: "Shared statement detail",
    href: `${base}?scenario=owe`,
    try: "Open Groceries in the Shared tab: who paid each purchase, your share, and what it adds. Whole Foods shows its 34/66 exception and Safeway is pending.",
    legacy: "Was a popover beside the inspector.",
    shots: [
      statement,
      shot(
        "shared-statement-detail",
        "Groceries purchases with who paid and each share",
      ),
    ],
  },
  {
    title: "Settle up",
    href: `${base}?scenario=owe&open=settle`,
    try: "Record the $1,104.64 net payment, or less with the editable amount. Try $2,000 to see the limit, and Saves fail for the offline error.",
    legacy: "Was the “Record a net repayment” dialog.",
    shots: [shot("settle-up", "“Record a net repayment” dialog")],
  },
  {
    title: "Confirm receipt",
    href: `${base}?scenario=owed&open=receive`,
    try: "Jordan's $500.00 is waiting. Pick the account and the day it arrived; a date before Oct 18 is refused. Ready to Assign goes up.",
    legacy: "Was the “Record money received” dialog.",
    shots: [shot("confirm-receipt", "“Record money received” dialog")],
  },
  {
    title: "Opening amount owed",
    href: `${base}?scenario=first-month&open=opening`,
    try: "Enter what you already owed each other before Caishen, already split. It appears as an Opening amounts line.",
    legacy: "Was the Partner ⋯ menu, then a dialog.",
    shots: [
      shot("partner-menu", "Partner ⋯ menu with Add opening amount"),
      shot("opening-amount", "“Opening amount owed” dialog"),
    ],
  },
];

const states: { label: string; href: string; note: string; shots: Shot[] }[] = [
  {
    label: "You owe",
    shots: [statement],
    href: `${base}?scenario=owe`,
    note: "Settle up is the tab's main action",
  },
  {
    label: "Owed to you",
    shots: [],
    href: `${base}?scenario=owed`,
    note: "Jordan settles; you confirm",
  },
  {
    label: "Settled",
    shots: [],
    href: `${base}?scenario=settled`,
    note: "Everything paid and confirmed",
  },
  {
    label: "First month",
    shots: [],
    href: `${base}?scenario=first-month`,
    note: "Shared, nothing recorded yet",
  },
  {
    label: "Nothing shared",
    shots: [],
    href: `${base}?scenario=nothing-shared`,
    note: "Empty Shared tab",
  },
  {
    label: "No partner",
    shots: [
      shot("partner-section", "Partner section with Create invitation code"),
    ],
    href: `${base}?scenario=no-partner&select=rent`,
    note: "Category card invites a partner; no Shared tab",
  },
  {
    label: "Past month",
    shots: [],
    href: `${base}?scenario=past-month`,
    note: "September, read-only",
  },
];

export function Batch2Index() {
  return (
    <SchemeTheme className={styles.page}>
      <header className={styles.header}>
        <h1>Batch 2: shared expenses</h1>
        <p>
          Design prototype for porting the legacy shared-expense features into
          the app shell. Hardcoded data for Alex and Jordan in October 2026;
          nothing here reads or writes a budget. Everything happens in place in
          the details panel, with no dialogs except the one variant that tests
          one.
        </p>
      </header>

      <section className={styles.section} aria-labelledby="flows">
        <h2 id="flows">Flows</h2>
        <ul className={styles.list}>
          {flows.map((flow) => (
            <li key={flow.title} className={styles.item}>
              <Link href={flow.href} className={styles.row}>
                <strong>{flow.title}</strong>
                <span>{flow.try}</span>
                <small>{flow.legacy}</small>
              </Link>
              <LegacyShots shots={flow.shots} />
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="states">
        <h2 id="states">States</h2>
        <ul className={styles.list}>
          {states.map((state) => (
            <li key={state.label} className={styles.item}>
              <Link href={state.href} className={styles.row}>
                <strong>{state.label}</strong>
                <span>{state.note}</span>
              </Link>
              <LegacyShots shots={state.shots} />
            </li>
          ))}
        </ul>
        <p className={styles.footnote}>
          Every screen also has Saves fail (the offline error each editor
          shows), a light theme, and Reset in the bar at the top.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="choices">
        <h2 id="choices">Design choices to make</h2>
        <p className={styles.footnote}>
          Each toggle in the bar moves one variable. The first option is the
          recommendation.
        </p>
        <ul className={styles.list}>
          {Object.values(choices).map((choice) => (
            <li key={choice.variable} className={styles.choice}>
              <strong>{choice.variable}</strong>
              <span>
                {choice.options.map(([, label]) => label).join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </SchemeTheme>
  );
}
