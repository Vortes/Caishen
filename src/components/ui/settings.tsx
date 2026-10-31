"use client";

import { CircleAlertIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Card } from "./card";
import { FieldContext } from "./field";
import fieldStyles from "./field.module.css";
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

// A label and description first, the control at the row's end. The row
// names and describes the ui control inside it (TextInput, Select, Switch)
// the way a Field does, but its label is plain text: only the control acts,
// and clicking the text does nothing.
export function SettingRow({
  label,
  description,
  lead,
  error,
  fieldError,
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
  // What's wrong with what was typed into the row's TextInput, as a Field's
  // error: it describes the control and marks it invalid, and is read when
  // someone reaches the control rather than announced.
  fieldError?: string | null;
  // Spans the card under a thin line, like a form that opens.
  below?: ReactNode;
  // The control, or several side by side.
  children?: ReactNode;
}) {
  const id = useId();
  const [reported, report] = useState<string | null>(null);
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const fieldErrorId = `${id}-field-error`;
  // The screen's field error wins over the control's own message.
  const shown = fieldError ?? reported;
  const describedBy =
    [description && descriptionId, shown && fieldErrorId, error && errorId]
      .filter(Boolean)
      .join(" ") || undefined;
  const text = (
    <div className={styles.text}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      {description && (
        <span id={descriptionId} className={styles.description}>
          {description}
        </span>
      )}
      {shown && (
        <span id={fieldErrorId} className={fieldStyles.error}>
          <CircleAlertIcon size={13} aria-hidden />
          {shown}
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
        <FieldContext
          value={{
            id,
            label: typeof label === "string" ? label : "",
            labelledBy: labelId,
            describedBy,
            invalid: Boolean(shown),
            report,
          }}
        >
          {children}
        </FieldContext>
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
