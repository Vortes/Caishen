"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ItemNotes,
  ReviewNotesBar,
  ReviewNotesProvider,
} from "~/components/prototype/review-notes";
import { useSavedSettings } from "../app-shell/settings";
import { SCENARIOS } from "./scenarios";
import styles from "./index.module.css";

const APP = "/prototype/shared-costs/app";

type Choice = {
  // The one variable the variants move.
  variable: string;
  // Where it is in the prototype bar.
  bar: string;
  options: [string, string][];
  call: string;
  against: string;
};

type Item = {
  id: string;
  title: string;
  summary: ReactNode;
  tryThis: string[];
  states: string[];
  choice?: Choice;
};

const items: Item[] = [
  {
    id: "share-entry",
    title: "1. Entering a share",
    summary:
      "The share is the one fact the bank can't supply, so it lives where the category does: on the line, in the register's in-place editor. Share zero is Yours. Payee memory and schedules fill it in with the category, and nothing else does.",
    tryThis: [
      "A new payee (Safeway): open it, pick Half, Save and approve. Three clicks, down from six.",
      "Trader Joe's (pending): memory already filled Groceries and half to Anna, so it's open and Save and approve.",
      "Add a transaction, type Trader Joe's, then an amount: the share follows the amount.",
      "Pick Sam Ortiz or type a new name in the picker to send the share to Reimbursements instead.",
      "On the ledger, Change the equal split to 60% for you: Half becomes 60/40 in both budgets.",
    ],
    states: ["share-new", "share-memory", "share-schedule", "share-add"],
    choice: {
      variable: "Where the share is entered",
      bar: "Share entry",
      options: [
        [
          "In the row (recommended)",
          "A Share line under the transaction's own row, in the editor the register already opens in place",
        ],
        [
          "Details panel",
          "The register gets the details panel the plan has; the selected transaction's fields and share stack there",
        ],
      ],
      call: "In the row: the shell already edits transactions in place, and the share sits beside the category it belongs with.",
      against:
        "A long split receipt makes the row card tall and pushes the list down; a panel keeps the list still and has room for the explanation.",
    },
  },
  {
    id: "share-input",
    title: "1b. Choosing the share's amount",
    summary:
      "Same control, two ways to set its number. Both read out the result: Anna's share and your spending.",
    tryThis: [
      "Flip Share input in the bar, then open Safeway or Costco.",
      "Type more than the line in Amount: the error says so beside the field.",
    ],
    states: ["share-new", "split"],
    choice: {
      variable: "How the amount is chosen",
      bar: "Share input",
      options: [
        [
          "Presets (recommended)",
          "Yours · Half · Theirs · Amount, then who it's with",
        ],
        [
          "Amount",
          "Who, then their share as a number, with a Split equally button",
        ],
      ],
      call: "Presets: nearly every line is yours, half, or theirs, so one click sets it, and Half names the couple's split.",
      against:
        "It's a wider control, and an odd amount takes two steps (Amount, then type) where the amount field takes one.",
    },
  },
  {
    id: "split",
    title: "2. A mixed purchase is a split",
    summary:
      "Costco: Household for Alan alone ($72.37, share zero) and Groceries shared ($140.00, half). Only the shared line reaches Anna; her ledger shows $140.00 shared, never the $212.37 receipt.",
    tryThis: [
      "Open Costco, change line 1's amount: line 2 takes the rest of the bank's total.",
      "Switch to Anna: her ledger says $140.00 shared and mentions a private line, never its category.",
    ],
    states: ["split", "nonpayer-anna"],
  },
  {
    id: "partner-ledger",
    title: "3. The partner account",
    summary:
      "One signed balance, live, across months. Each entry: date, payee, shared amount, each person's share, who paid, who recorded it, its history. Expected entries from scheduled transactions lead, outside the balance. A link icon means matched to the payer's import; a dashed circle means recorded and waiting, with the balance already right.",
    tryThis: [
      "Viewing as Anna: the same entries, the opposite balance, her own categories.",
      "Open PG&E (recorded by Alan, paid by Anna), then Simulate › Anna's PG&E import arrives: it matches and the balance doesn't move.",
      "Record a shared cost Anna paid: it lands on both ledgers at once.",
    ],
    states: ["ledger", "ledger-anna", "unmatched"],
    choice: {
      variable: "How the balance reads",
      bar: "Balance",
      options: [
        [
          "Sentence (recommended)",
          "“Anna owes you $360.00”, and what it will be after the expected entries",
        ],
        [
          "Signed",
          "+$360.00, with Expected and After scheduled, like an account's balance strip",
        ],
      ],
      call: "Sentence: a signed number between two people is easy to read backwards; the words can't be.",
      against:
        "The signed form matches every other account, reads faster once learned, and adds up with the Expected column; the sentence's green leans on a money color.",
    },
  },
  {
    id: "non-payer",
    title: "4. The non-payer's side",
    summary:
      "An entry the partner paid arrives in your partner account, uncategorized on your side only, with your own payee memory's category proposed. Your category is yours; the partner never sees it.",
    tryThis: [
      "Alan, Nopa: Dining out is proposed from his memory. Approve it.",
      "Anna, Costco: she's never categorized Costco, so it needs her category.",
    ],
    states: ["nonpayer", "nonpayer-anna"],
  },
  {
    id: "envelopes",
    title: "5. Paired envelopes in the plan",
    summary:
      "Shared costs holds one envelope per account. Available is always the float minus the account's balance, shown as an equation. Overspending is true and shown: red when you fronted cash, amber on a card. Ready to Assign never counts a receivable.",
    tryThis: [
      "Set the float in the panel and watch Ready to Assign give or take it back.",
      "No float: rent fronted from checking turns Anna's envelope red.",
      "Reimbursements: work flights on the Amex with a $300 float, so amber.",
      "Anna's envelope holds $360.00 for what she owes, from her own categories.",
      "Cover overspending moves money like any category.",
    ],
    states: ["env-float", "env-cash", "env-credit", "env-reserve"],
  },
  {
    id: "settlement",
    title: "6. Settlement",
    summary:
      "A bank transfer between the partners is recognized as a transfer to or from the partner account: no category, not income, not spending. Both imports match by amount, date, and direction; one confirmation clears both. A partner can also pay your card directly.",
    tryThis: [
      "Confirm Anna's $200.00 Venmo in Alan's checking, then view as Anna: hers is cleared too.",
      "Simulate › Anna pays $350.00 by Zelle: the request closes once it's in.",
      "Amex: Anna's $300.00 payment cut the card debt and refilled the envelope from the card reserve.",
    ],
    states: ["settle", "settle-anna", "card-direct"],
  },
  {
    id: "reimbursements",
    title: "7. The reimbursements account",
    summary:
      "Everyone who isn't the partner, in one private account. Each entry names who owes it; per-person balance is the filter above the list. Its envelope works like the partner's; money back refills it, not Ready to Assign.",
    tryThis: [
      "Filter to Sam, then Acme Corp.",
      "Simulate › Acme Corp reimburses $412.18: the envelope goes from amber to funded, and Ready to Assign stays put. Confirm it in Chase Checking.",
    ],
    states: ["reimb", "reimb-sam", "reimb-received", "env-credit"],
  },
  {
    id: "edit-share",
    title: "8. Editing a share, and writing it off",
    summary:
      "Either partner edits a share; both budgets change at once, with no approval. The entry's history keeps who changed what, from what, to what, and when. Setting the share to zero is a write-off: you consumed it after all.",
    tryThis: [
      "Costco has one change already; change it again and read the history.",
      "Write off Trader Joe's on Oct 3, then view as Anna: it's gone from her balance and her Groceries.",
    ],
    states: ["edit-share", "writeoff"],
  },
  {
    id: "refund",
    title: "9. Refunds",
    summary:
      "Target was bought in September and settled with everything else on Sep 30. The October refund imports as its own transaction; payee memory proposed the same half, so it reverses in proportion and the balance swings back $15.00 toward Anna.",
    tryThis: ["Open the Target refund in the ledger, then on Alan's Amex."],
    states: ["refund"],
  },
  {
    id: "request",
    title: "10. Requests",
    summary:
      "An optional record: amount, date, who asked. Paid is the sum of settlements since; it closes when paid reaches the amount. No deadline, no reminder.",
    tryThis: [
      "Alan asked for $1,350.00 on Oct 2; three settlements since leave $350.00.",
      "Simulate › Anna pays $350.00 by Zelle: it closes, and Ask Anna to settle comes back.",
    ],
    states: ["request", "request-anna"],
  },
  {
    id: "opening",
    title: "11. Opening balance",
    summary:
      "Entered once when partnering, as a balance: not re-split, no category, no new spending.",
    tryThis: [
      "Read the Aug 31 entry at the bottom of the ledger.",
      "Before partnering › Partner: invite, have Anna join, enter what's owed.",
    ],
    states: ["opening", "new-partner"],
  },
  {
    id: "placement",
    title: "12. Where the accounts live, and empty states",
    summary:
      "Both accounts sit in the sidebar with their balances. Before partnering, the partner's place says Add partner and leads to the invite. Reimbursements exists from the start, empty until a share names someone.",
    tryThis: [
      "Flip Sidebar in the bar.",
      "Before partnering: Anna is off in Viewing as, and the plan has only the Reimbursements envelope.",
    ],
    states: ["new", "new-partner", "new-reimb"],
    choice: {
      variable: "Sidebar placement",
      bar: "Sidebar",
      options: [
        [
          "Own section (recommended)",
          "A Shared section after Credit; Tracking keeps the 401(k)",
        ],
        ["In Tracking", "Both join the Tracking section, as tracking accounts"],
      ],
      call: "Own section: these two behave like nothing else (a paired envelope, a partner's mirror), and a person isn't an asset to track.",
      against:
        "The model calls them tracking accounts, YNAB users look for them there, and a section heading for two rows is extra chrome.",
    },
  },
];

const scenario = (id: string) => SCENARIOS.find((item) => item.id === id)!;

const questions = [
  "Card payment reserve: the spec says it “rises by A” on a card purchase. The prototype follows YNAB and moves only what's funded; an unfunded share stays amber in the envelope instead of inflating the reserve. Which do you mean?",
  "Payee memory carries the last share as a proportion of the new amount ($52.10 at Trader Joe's proposes $26.05, not last time's $43.20). A flat amount instead?",
  "A prefilled category on the non-payer's side counts in their category right away, with a review dot, like an unapproved import. The spec says “uncategorized until they do”; should a prefill only be a suggestion until approved?",
  "Recognized settlements count in the balance as soon as they import; confirming only clears review. Should the balance wait for the confirmation?",
  "Cash overspending in a paired envelope comes out of next month's Ready to Assign. That raises the envelope's float by the same amount, so available = float − balance still holds. Is that the reading you want?",
  "The partner account exists only once partnered; the reimbursements account always exists. The spec says exactly two per budget.",
  "Opening balance and the envelope: by the invariant, entering “Anna owes me $240” makes the paired envelope −$240 at once (overspent until covered or paid back), and +$240 in the budget of the one who owes. Is that right for money fronted before Caishen?",
  "Who can write off: the prototype offers it to the payer (you consumed it after all). The other partner can still edit the share down to zero.",
];

export function SharedCostsIndex() {
  const { theme } = useSavedSettings();
  return (
    <div data-theme={theme} className={styles.themed}>
      <main className={styles.index}>
        <ReviewNotesProvider
          storageKey="shared-costs"
          title="Shared costs: partner and reimbursements accounts"
        >
          <header className={styles.indexHeader}>
            <h1>Shared costs: partner and reimbursements accounts</h1>
            <p>
              Alan and Anna&rsquo;s two budgets in October 2026, inside the app
              shell, with hardcoded data and nothing saved. Use Viewing as in
              the bar to see the mirror, Simulate to bring in bank imports, and
              Reset to start over. Each choice moves one variable; the
              recommended variant is on by default.
            </p>
            <p>
              <Link className={styles.indexPrimary} href={APP}>
                Open the prototype
              </Link>
            </p>
          </header>
          <ReviewNotesBar />
          {items.map((item) => (
            <section key={item.id} className={styles.indexSection}>
              <h2>{item.title}</h2>
              <p>{item.summary}</p>
              <h3>Try</h3>
              <ul className={styles.indexList}>
                {item.tryThis.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <h3>States</h3>
              <ul className={styles.indexLinks}>
                {item.states.map((id) => (
                  <li key={id}>
                    <span className={styles.stateText}>
                      <Link href={`${APP}?state=${id}`}>
                        {scenario(id).label}
                      </Link>
                      <span>
                        {scenario(id).viewer === "anna" ? "Anna · " : ""}
                        {scenario(id).hint}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <ItemNotes id={item.id} title={item.title} />
              {item.choice && (
                <>
                  <h3>
                    Variable: {item.choice.variable} ({item.choice.bar} in the
                    bar)
                  </h3>
                  <div className={styles.choice}>
                    <ul className={styles.indexList}>
                      {item.choice.options.map(([name, detail]) => (
                        <li key={name}>
                          <strong>{name}.</strong> {detail}
                        </li>
                      ))}
                    </ul>
                    <p className={styles.call}>{item.choice.call}</p>
                    <p className={styles.against}>
                      The case against: {item.choice.against}
                    </p>
                  </div>
                  <ItemNotes
                    id={`${item.id} / choice`}
                    title={`${item.title}, choice: ${item.choice.variable}`}
                  />
                </>
              )}
            </section>
          ))}
          <section className={styles.indexSection}>
            <h2>Questions the model leaves open</h2>
            <p>
              The prototype picks one reading for each; tell me where it&rsquo;s
              wrong.
            </p>
            <ul className={styles.indexList}>
              {questions.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <ItemNotes id="questions" title="Questions the model leaves open" />
          </section>
        </ReviewNotesProvider>
      </main>
    </div>
  );
}
