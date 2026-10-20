"use client";

import type { ReactNode } from "react";
import type { Category, Funding } from "./model";
import styles from "./funding-bar.module.css";

// What the bar needs from a category; the design system builds these by hand.
export type FundingBarCategory = Pick<
  Category,
  "funding" | "activity" | "available" | "status"
> & { target?: { sections: number[] } };

// The bar has three colors, per YNAB: red for overspending, yellow while a
// target is unmet, and green otherwise (met, snoozed, or no target).
type Tone = "funded" | "underfunded" | "overspent";

type Piece = {
  // spent: money assigned and already spent, drawn in a darker
  // shade of the tone, striped.
  // available: money assigned and still unspent, drawn solid.
  // needed: what the target still asks for, drawn as empty track.
  // over: spending past the money assigned, striped red.
  kind: "spent" | "available" | "needed" | "over";
  tone: Tone;
  size: number;
};

// YNAB's progress bar (support.ynab.com, "Progress Bars"). Sections come from
// the target; money fills them from the left, spent first because leftover
// money is always spent first, then what's still available, then the empty
// track up to the target. Money past a sectioned target adds an extra
// section, and spending past the money assigned adds a red one, so a bar is
// partly red when overspent and entirely red when nothing was assigned.
export function fundingPieces(category: FundingBarCategory): Piece[] {
  // Money the category has had this month: what's left plus what's gone.
  // Counting it this way includes inflows such as funded card spending moving
  // into a card payment category, or a refund.
  const spent = -Math.min(0, category.activity);
  const funds = Math.max(0, category.available + spent);
  const covered = Math.min(spent, funds);
  const tone: Tone =
    category.funding === "underfunded" ? "underfunded" : "funded";

  const sections = [...(category.target?.sections ?? [])].filter(
    (size) => size > 0,
  );
  const planned = sections.reduce((sum, size) => sum + size, 0);
  if (!sections.length) {
    if (funds > 0) sections.push(funds);
  } else if (funds > planned) {
    if (sections.length > 1) sections.push(funds - planned);
    else sections[0] = funds;
  }

  const pieces: Piece[] = [];
  let start = 0;
  for (const size of sections) {
    const end = start + size;
    const fill = (kind: Piece["kind"], from: number, to: number) => {
      const length = Math.min(end, to) - Math.max(start, from);
      if (length > 0) pieces.push({ kind, tone, size: length });
    };
    fill("spent", 0, covered);
    fill("available", covered, funds);
    if (spent <= funds) fill("needed", funds, Infinity);
    start = end;
  }
  if (spent > funds)
    pieces.push({ kind: "over", tone: "overspent", size: spent - funds });
  return pieces;
}

const label: Record<Funding, string> = {
  funded: "Funded",
  underfunded: "Underfunded",
  overspent: "Overspent",
  credit: "Overspent on credit",
  snoozed: "Target snoozed",
  empty: "No money assigned",
};

// The category's name line, its status at the bar's end, and the bar.
// Children are the name line's content.
export function FundingBar({
  category,
  children,
}: {
  category: FundingBarCategory;
  children: ReactNode;
}) {
  const pieces = fundingPieces(category);
  return (
    <span className={styles.stack}>
      <span className={styles.line}>
        <span className={styles.name}>{children}</span>
        {category.status && (
          <span className={styles.status}>{category.status}</span>
        )}
      </span>
      <span
        className={styles.bar}
        role="img"
        aria-label={
          category.status && category.status !== label[category.funding]
            ? `${label[category.funding]}. ${category.status}`
            : label[category.funding]
        }
      >
        {pieces.length ? (
          pieces.map((piece, index) => (
            <span
              key={index}
              className={styles.segment}
              data-kind={piece.kind}
              data-tone={piece.tone}
              style={{ flexGrow: piece.size }}
            />
          ))
        ) : (
          <span className={styles.segment} data-kind="needed" />
        )}
      </span>
    </span>
  );
}

// One part of the bar on its own, for keys that explain the encoding.
export function FundingSwatch({
  kind,
  tone,
}: {
  kind: Piece["kind"];
  tone: Tone;
}) {
  return (
    <span className={styles.swatch} aria-hidden>
      <span className={styles.segment} data-kind={kind} data-tone={tone} />
    </span>
  );
}
