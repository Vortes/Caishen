"use client";

import { createContext, useId, type ReactNode } from "react";
import { Card } from "./card";
import styles from "./settings.module.css";

// One centered column of sections, each a heading over a card of rows.
export function SettingsPage({ children }: { children: ReactNode }) {
  return <div className={styles.page}>{children}</div>;
}

// A section is named by its heading, or by aria-label when the page shows
// none.
type SectionName =
  | { heading: ReactNode; "aria-label"?: never }
  | { heading?: never; "aria-label": string };

export function SettingsSection({
  heading,
  "aria-label": label,
  intro,
  action,
  card = true,
  after,
  children,
}: SectionName & {
  intro?: ReactNode;
  // Sits at the heading's end, like the theme filter.
  action?: ReactNode;
  // False for content that lays itself out, like the theme grid.
  card?: boolean;
  // Follows the card, like the daily email's preview.
  after?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  const title = heading && (
    <h2 id={headingId} className={styles.heading}>
      {heading}
    </h2>
  );
  return (
    <section
      className={styles.section}
      aria-label={label}
      aria-labelledby={heading ? headingId : undefined}
    >
      {action ? (
        <div className={styles.headingRow}>
          {title}
          {action}
        </div>
      ) : (
        title
      )}
      {intro && <p className={styles.intro}>{intro}</p>}
      {card ? <Card>{children}</Card> : children}
      {after}
    </section>
  );
}

// What a row tells the control inside it: the ids of the text that names
// and describes it. Switch reads it when it has no aria-label of its own.
export const SettingRowContext = createContext<{
  labelId: string;
  describedBy: string | undefined;
} | null>(null);

// A label and description first, the control at the row's end. Only the
// control acts; clicking the text does nothing.
export function SettingRow({
  label,
  description,
  lead,
  error,
  htmlFor,
  below,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  // Drawn before the label, like the profile picture's avatar.
  lead?: ReactNode;
  // An action that failed, like a photo upload. An error about what someone
  // typed belongs to its field.
  error?: string | null;
  // Names a native control by id, and gives the row's error the id
  // `${htmlFor}-error`. Goes away in #223's second phase.
  htmlFor?: string;
  // Spans the card under a thin line, like a form that opens.
  below?: ReactNode;
  // The control, or several side by side.
  children?: ReactNode;
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy =
    [description && descriptionId, error && errorId]
      .filter(Boolean)
      .join(" ") || undefined;
  const text = (
    <div className={styles.text}>
      {htmlFor ? (
        <label id={labelId} className={styles.label} htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span id={labelId} className={styles.label}>
          {label}
        </span>
      )}
      {description && (
        <span id={descriptionId} className={styles.description}>
          {description}
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
  return (
    <div className={styles.item}>
      <div className={styles.row}>
        {lead ? (
          <div className={styles.lead}>
            {lead}
            {text}
          </div>
        ) : (
          text
        )}
        <SettingRowContext value={{ labelId, describedBy }}>
          {children}
        </SettingRowContext>
      </div>
      {below && <div className={styles.below}>{below}</div>}
    </div>
  );
}

// A full-bleed line between rows. Placed by hand, since a card can also hold
// things that aren't rows.
export function SettingsDivider() {
  return <div className={styles.divider} />;
}
