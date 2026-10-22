import shell from "~/components/prototype/app-shell/shell.module.css";
import styles from "./scenes.module.css";

const APP = "/prototype/batch-5-register/app";

type Scene = { title: string; note: string; query: string };

const sections: { title: string; intro: string; scenes: Scene[] }[] = [
  {
    title: "Transaction history",
    intro:
      "Every change to a transaction, oldest first, led by the name the bank sent, which is what YNAB shows as “As imported” and what a renamed payee was renamed from.",
    scenes: [
      {
        title: "A renamed, re-priced import",
        note: "Tartine: renamed and categorized automatically, then the tip posted and the date moved.",
        query: "edit=i-tartine&panel=history",
      },
      {
        title: "An automatic match, with Unmatch",
        note: "Blue Bottle: entered by hand, matched with the next day’s import.",
        query: "edit=t-bluebottle&panel=history",
      },
      {
        title: "History variant: row popover",
        note: "Hover any row in American Express and open History beside the payee.",
        query: "history=popover&account=amex",
      },
    ],
  },
  {
    title: "Match a bank import",
    intro:
      "Like YNAB: same account, within 10 days, same amount. The bank’s amount wins; your date, payee, and category stay.",
    scenes: [
      {
        title: "Suggested: already entered",
        note: "PG&E arrived; PG&E autopay was entered on the same day.",
        query: "review=1&select=i-pge",
      },
      {
        title: "Suggested: a day apart",
        note: "BART posted Oct 14; you entered it Oct 13.",
        query: "review=1&select=i-bart",
      },
      {
        title: "Select both: amounts differ",
        note: "Safeway imported at $61.07, you entered $58.23. Only manual pairing reaches it.",
        query: "match=select&account=amex&select=i-safeway,t-safeway",
      },
      {
        title: "Unmatch",
        note: "The import goes back to To review and your amount comes back.",
        query: "select=t-bluebottle",
      },
    ],
  },
  {
    title: "Reject a bank import",
    intro:
      "YNAB’s Reject: the import leaves and won’t import again. Undo from the toast.",
    scenes: [
      {
        title: "Reject",
        note: "Safeway with no suggested match.",
        query: "review=1&select=i-safeway",
      },
      {
        title: "Dismiss one the bank removed",
        note: "A pending Uber trip that disappeared before it posted.",
        query: "review=1&select=i-uber",
      },
    ],
  },
  {
    title: "Expect money back",
    intro:
      "Starts from the purchase. No cash or card-credit choice: what arrives decides that.",
    scenes: [
      {
        title: "In the editor",
        note: "Chevron, nothing expected yet.",
        query: "edit=t-chevron&panel=expect",
      },
      {
        title: "From the selection bar",
        note: "The same, as a popover over the bar.",
        query: "expect=island&select=t-chevron",
      },
      {
        title: "Partly paid back",
        note: "Nopalito: Sam sent $20.00 of $43.20.",
        query: "edit=t-nopalito&panel=expect&account=amex",
      },
    ],
  },
  {
    title: "Receive it",
    intro:
      "An imported deposit or card credit is matched to what you expect, so a card credit needs no separate statement-credit flow.",
    scenes: [
      {
        title: "Card credit, two possible claims",
        note: "Amex Offer credit $15.00 could pay back REI or part of Nopalito.",
        query: "review=1&select=i-amexcredit",
      },
      {
        title: "Deposit from an employer",
        note: "Cedar Labs reimburses the conference hotel.",
        query: "review=1&select=i-cedar",
      },
      {
        title: "By hand, in Plan",
        note: "Cash that never imports, like Venmo moved to checking.",
        query: "screen=plan&claim=r-sam",
      },
    ],
  },
];

export function Batch5Index() {
  return (
    <div className={`${shell.root} ${styles.page}`} data-theme="dark">
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Register, bank imports, and reimbursements</h1>
          <p>
            Batch 5 prototype on hardcoded data. Nothing here saves. Each link
            opens the shell in one state; the Reset control in the corner
            returns to it, and the variant toggles sit beside it.
          </p>
          <a className={styles.open} href={APP}>
            Open the register
          </a>
        </header>
        {sections.map((section) => (
          <section key={section.title} className={styles.section}>
            <h2>{section.title}</h2>
            <p className={styles.intro}>{section.intro}</p>
            <ul>
              {section.scenes.map((scene) => (
                <li key={scene.title}>
                  <a href={`${APP}?${scene.query}`}>
                    <span>{scene.title}</span>
                    <span>{scene.note}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
