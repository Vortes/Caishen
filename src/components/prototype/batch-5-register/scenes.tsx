"use client";

import { XIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
  ItemNotes,
  ReviewNotesBar,
  ReviewNotesProvider,
} from "~/components/prototype/review-notes";
import { useMediaQuery } from "~/components/shared/use-media-query";
import shell from "~/components/prototype/app-shell/shell.module.css";
import styles from "./scenes.module.css";

const APP = "/prototype/batch-5-register/app";

type Legacy = { src: string; caption: string } | { none: string };

type Scene = { title: string; note: string; query: string; legacy: Legacy };

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
        legacy: {
          src: "legacy-transaction-history",
          caption:
            "The Transaction history dialog, opened from a payee: a list of revisions.",
        },
      },
      {
        title: "An automatic match, with Unmatch",
        note: "Blue Bottle: entered by hand, matched with the next day’s import.",
        query: "edit=t-bluebottle&panel=history",
        legacy: {
          none: "No legacy equivalent: legacy never matched on its own and had no Unmatch.",
        },
      },
      {
        title: "History variant: row popover",
        note: "Hover any row in American Express and open History beside the payee.",
        query: "history=popover&account=amex",
        legacy: {
          src: "legacy-transaction-history",
          caption:
            "The same history dialog, which this variant replaces with a popover.",
        },
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
        legacy: {
          src: "legacy-bank-import-match",
          caption: "Review dialog with an “Already recorded?” picker.",
        },
      },
      {
        title: "Suggested: a day apart",
        note: "BART posted Oct 14; you entered it Oct 13.",
        query: "review=1&select=i-bart",
        legacy: {
          none: "No legacy equivalent: legacy only offered matches on the same date.",
        },
      },
      {
        title: "Select both: amounts differ",
        note: "Safeway imported at $61.07, you entered $58.23. Only manual pairing reaches it.",
        query: "match=select&account=amex&select=i-safeway,t-safeway",
        legacy: {
          none: "No legacy equivalent: legacy only offered matches for the same amount.",
        },
      },
      {
        title: "Unmatch",
        note: "The import goes back to To review and your amount comes back.",
        query: "select=t-bluebottle",
        legacy: { none: "No legacy equivalent: a match couldn’t be undone." },
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
        legacy: {
          src: "legacy-bank-import-review",
          caption: "Review dialog with “Ignore this bank transaction”.",
        },
      },
      {
        title: "Dismiss one the bank removed",
        note: "A pending Uber trip that disappeared before it posted.",
        query: "review=1&select=i-uber",
        legacy: {
          src: "legacy-bank-import-review",
          caption:
            "The same review dialog; a removed import showed a note above it.",
        },
      },
    ],
  },
];

// Follows the system theme, like the shell's own pages.
export function Batch5Index() {
  const light = useMediaQuery("(prefers-color-scheme: light)");
  const dialog = useRef<HTMLDialogElement>(null);
  const [enlarged, setEnlarged] = useState<{
    src: string;
    caption: string;
    title: string;
  } | null>(null);
  return (
    <div
      className={`${shell.root} ${styles.page}`}
      data-theme={light ? "light" : "dark"}
    >
      <main className={styles.main}>
        <ReviewNotesProvider
          storageKey="batch-5"
          title="Batch 5: register and bank imports"
        >
          <header className={styles.header}>
            <h1>Register and bank imports</h1>
            <p>
              Batch 5 prototype on hardcoded data. Nothing here saves. Each link
              opens the shell in one state; the Reset control in the corner
              returns to it, and the variant toggles sit beside it. Beside each
              one is what the legacy app did.
            </p>
            <a className={styles.open} href={APP}>
              Open the register
            </a>
          </header>
          <ReviewNotesBar />
          {sections.map((section) => (
            <section key={section.title} className={styles.section}>
              <h2>{section.title}</h2>
              <p className={styles.intro}>{section.intro}</p>
              <ul>
                {section.scenes.map((scene) => (
                  <li key={scene.title} className={styles.scene}>
                    {"src" in scene.legacy ? (
                      <button
                        type="button"
                        className={styles.thumb}
                        aria-label={`Enlarge the legacy screen for ${scene.title}`}
                        onClick={() => {
                          if (!("src" in scene.legacy)) return;
                          setEnlarged({ ...scene.legacy, title: scene.title });
                          dialog.current?.showModal();
                        }}
                      >
                        {/* A prototype-only asset; next/image adds nothing here. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/prototype/legacy/${scene.legacy.src}.webp`}
                          alt=""
                          width={1440}
                          height={900}
                          loading="lazy"
                          decoding="async"
                        />
                        <span className={styles.legacyLabel}>Legacy</span>
                      </button>
                    ) : (
                      <div className={styles.noLegacy}>
                        <span className={styles.legacyLabel}>Legacy</span>
                        <span>None</span>
                      </div>
                    )}
                    <a href={`${APP}?${scene.query}`}>
                      <span>{scene.title}</span>
                      <span>{scene.note}</span>
                      <span className={styles.legacyNote}>
                        {"src" in scene.legacy
                          ? `Legacy: ${scene.legacy.caption}`
                          : scene.legacy.none}
                      </span>
                    </a>
                    <div className={styles.review}>
                      <ItemNotes
                        id={`${section.title} / ${scene.title}`}
                        title={`${section.title}: ${scene.title}`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </ReviewNotesProvider>
      </main>
      <dialog
        ref={dialog}
        className={styles.lightbox}
        aria-label={enlarged ? `Legacy: ${enlarged.title}` : "Legacy screen"}
        onClose={() => setEnlarged(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        {enlarged && (
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/prototype/legacy/${enlarged.src}.webp`}
              alt={`Legacy app: ${enlarged.caption}`}
              width={1440}
              height={900}
            />
            <figcaption>
              <span>
                <strong>Legacy</strong> · {enlarged.caption}
              </span>
              <button
                type="button"
                className={styles.close}
                aria-label="Close"
                onClick={() => dialog.current?.close()}
              >
                <XIcon size={16} aria-hidden />
              </button>
            </figcaption>
          </figure>
        )}
      </dialog>
    </div>
  );
}
