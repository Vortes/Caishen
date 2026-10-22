"use client";

import { useRef, useState } from "react";
import {
  ItemNotes,
  ReviewNotesBar,
  ReviewNotesProvider,
} from "~/components/prototype/review-notes";
import { Button } from "~/components/ui/button";
import styles from "./loans.module.css";

const base = "/prototype/batch-3-loans/shell";
const legacyPath = "/prototype/legacy";

type Legacy = { src: string; caption: string } | { none: string };

type Item = { href: string; label: string; detail: string; legacy: Legacy };

const groups: { title: string; links: Item[] }[] = [
  {
    title: "Flows",
    links: [
      {
        href: base,
        label: "Loans screen",
        detail:
          "The list and details panel with four loans. Pick a loan to see its payoff, payments, and rates.",
        legacy: {
          src: "legacy-loans.webp",
          caption: "Loans page, one card per loan",
        },
      },
      {
        href: `${base}?open=add`,
        label: "Add a loan",
        detail:
          "Opens Add loan. Submit it empty to see every field’s error; type terms to watch the payoff fill in.",
        legacy: {
          src: "legacy-loan-add.webp",
          caption: "“Add a loan” dialog",
        },
      },
      {
        href: `${base}?loan=sofi&open=rate`,
        label: "Update a confirmed rate",
        detail:
          "SoFi’s variable rate, due for a check. Try 7.62% again, a new rate, Feb 1, 2026 (taken), or a future date.",
        legacy: {
          src: "legacy-loan-rate.webp",
          caption: "“Update a confirmed loan rate” dialog",
        },
      },
      {
        href: `${base}?loan=nelnet&tab=extra`,
        label: "Preview an extra payment",
        detail:
          "Nelnet, fixed 5.50%. Enter 2,000 to see the new payoff and interest saved; more than the balance caps it.",
        legacy: {
          src: "legacy-loan-extra-payment.webp",
          caption: "$200 extra moves Nelnet’s payoff from Dec 2034 to Nov 2034",
        },
      },
      {
        href: `${base}?loan=nelnet&open=payment`,
        label: "Record a lender payment",
        detail:
          "October’s Nelnet payment, from the details panel. Leave interest empty or above the payment to see errors.",
        legacy: {
          src: "legacy-loan-payment.webp",
          caption: "Lender payment dialog from the loan card",
        },
      },
      {
        href: `${base}?loan=nelnet&open=payment&pay=register`,
        label: "Record a lender payment in the register",
        detail:
          "The same payment handed to Chase Total Checking’s register, in the shell’s transaction editor.",
        legacy: {
          src: "legacy-loan-payment.webp",
          caption:
            "Legacy only had the dialog from the loan card, not a register handoff",
        },
      },
    ],
  },
  {
    title: "States",
    links: [
      {
        href: `${base}?scenario=empty`,
        label: "No loans",
        detail: "The empty Loans screen and its Add loan action.",
        legacy: { none: "No legacy screenshot of the empty Loans page." },
      },
      {
        href: `${base}?loan=honda&tab=payments`,
        label: "Paid off",
        detail: "Honda, paid off in June 2025: totals and its payment history.",
        legacy: { none: "Legacy had no paid-off view or payment history." },
      },
      {
        href: `${base}?loan=sofi&tab=rates`,
        label: "Variable rate due for an update",
        detail:
          "Last confirmed eight months ago: a tag in the list, Update rate as the primary action, and a note in Rates.",
        legacy: { none: "Legacy never flagged a rate as due." },
      },
      {
        href: `${base}?scenario=underwater&loan=sofi`,
        label: "Payment below interest",
        detail:
          "SoFi reset to 17.25%, so $225 a month never pays it off. No payoff date, and the preview says why.",
        legacy: {
          none: "Not captured in legacy; its forecast said only that the payment didn’t cover interest.",
        },
      },
      {
        href: `${base}?loan=nelnet&tab=extra&cadence=both`,
        label: "Extra payment, one time or monthly",
        detail:
          "The cadence variant, with a monthly extra on top of the payment.",
        legacy: {
          src: "legacy-loan-extra-payment.webp",
          caption: "Legacy previewed a one-time extra payment only",
        },
      },
    ],
  },
];

export function LoansIndex() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<{ src: string; caption: string } | null>(
    null,
  );
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const enlarge = (image: { src: string; caption: string }) => {
    setOpen(image);
    dialog.current?.showModal();
  };
  return (
    <main className={styles.index} data-theme={theme}>
      <ReviewNotesProvider storageKey="batch-3" title="Batch 3: loans">
        <div className={styles.indexInner}>
          <header className={styles.indexHead}>
            <div>
              <h1>Batch 3 · Loans</h1>
              <p>
                Add a loan, confirm a variable rate, preview an extra payment,
                and record a lender payment, on the shell’s Loans screen.
                Hardcoded data for October 21, 2026; nothing reaches a budget.
                Every page has prototype controls along the bottom: scenario,
                the four variants, theme, and Reset. Hover a control to see the
                variable it moves. Each item shows what the legacy app did;
                click it to enlarge.
              </p>
            </div>
            <Button
              size="sm"
              aria-pressed={theme === "light"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              Light theme
            </Button>
          </header>
          <ReviewNotesBar />
          {groups.map((group) => (
            <section key={group.title}>
              <h2>{group.title}</h2>
              <ul className={styles.links}>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>
                      {link.label}
                      <span>{link.detail}</span>
                    </a>
                    <LegacyThumb legacy={link.legacy} onOpen={enlarge} />
                    <div className={styles.review}>
                      <ItemNotes
                        id={`${group.title}:${link.label}`}
                        title={`${group.title === "Flows" ? "Flow" : "State"}: ${link.label}`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </ReviewNotesProvider>
      <dialog
        ref={dialog}
        className={styles.lightbox}
        aria-label={open ? `Legacy: ${open.caption}` : "Legacy screenshot"}
        onClose={() => setOpen(null)}
        onClick={(event) => {
          // A click on the backdrop, outside the figure, closes it.
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        {open && (
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element -- a prototype screenshot shown at its own size */}
            <img
              src={`${legacyPath}/${open.src}`}
              alt={`Legacy: ${open.caption}`}
              width={1440}
              height={900}
            />
            <figcaption>
              <span className={styles.legacyLabel}>Legacy</span>
              {open.caption}
              <form method="dialog">
                <button type="submit" className={styles.lightboxClose}>
                  Close
                </button>
              </form>
            </figcaption>
          </figure>
        )}
      </dialog>
    </main>
  );
}

function LegacyThumb({
  legacy,
  onOpen,
}: {
  legacy: Legacy;
  onOpen: (image: { src: string; caption: string }) => void;
}) {
  if ("none" in legacy)
    return (
      <div className={styles.legacy}>
        <span className={styles.legacyLabel}>Legacy</span>
        <p className={styles.legacyNone}>{legacy.none}</p>
      </div>
    );
  return (
    <div className={styles.legacy}>
      <span className={styles.legacyLabel}>Legacy</span>
      <button
        type="button"
        className={styles.thumb}
        aria-label={`Enlarge legacy screenshot: ${legacy.caption}`}
        onClick={() => onOpen(legacy)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a prototype thumbnail of a static screenshot */}
        <img
          src={`${legacyPath}/${legacy.src}`}
          alt=""
          width={1440}
          height={900}
          loading="lazy"
        />
      </button>
      <p className={styles.legacyCaption}>{legacy.caption}</p>
    </div>
  );
}
