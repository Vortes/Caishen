"use client";

import {
  CalendarIcon,
  FilterIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { Button, type ButtonVariant } from "~/components/ui/button";
import styles from "./design-system.module.css";

const variants: { variant: ButtonVariant; label: string; rule: string }[] = [
  {
    variant: "primary",
    label: "Save target",
    rule: "The one committing action in a form or dialog. At most one per surface.",
  },
  {
    variant: "secondary",
    label: "Cancel",
    rule: "Every other button, and the default.",
  },
  {
    variant: "quiet",
    label: "Remove target",
    rule: "Inline actions inside rows and inspector sections.",
  },
  {
    variant: "danger",
    label: "Delete category",
    rule: "Only the confirm button of a destructive dialog, never the button that opens it.",
  },
];

export function ButtonSpecimens() {
  const [assigned, setAssigned] = useState(false);
  const [deleted, setDeleted] = useState(false);

  function reset() {
    setAssigned(false);
    setDeleted(false);
  }

  return (
    <section className={styles.section} aria-labelledby="button">
      <div className={styles.sectionHeader}>
        <h2 id="button">Button</h2>
        <div className={styles.headerActions}>
          <Button variant="quiet" size="sm" onClick={reset}>
            <RotateCcwIcon aria-hidden />
            Reset
          </Button>
        </div>
      </div>
      <p className={styles.lead}>
        Four variants, two sizes. Primary and danger are the secondary pill with
        the role&rsquo;s color in its border and label, so color only appears on
        the action that commits something.
      </p>

      <div className={styles.variantTable}>
        <div className={styles.variantHead} aria-hidden>
          <span>Variant</span>
          <span>md</span>
          <span>sm</span>
          <span>Disabled</span>
        </div>
        {variants.map(({ variant, label, rule }) => (
          <div key={variant} className={styles.variantRow}>
            <div>
              <code className={styles.code}>{variant}</code>
              <p>{rule}</p>
            </div>
            <span>
              <Button variant={variant}>{label}</Button>
            </span>
            <span>
              <Button variant={variant} size="sm">
                {label}
              </Button>
            </span>
            <span>
              <Button variant={variant} disabled>
                {label}
              </Button>
            </span>
          </div>
        ))}
      </div>

      <h3 className={styles.subheading}>In context</h3>
      <div className={styles.contexts}>
        <figure className={styles.context}>
          <div className={styles.surface}>
            <strong>Car insurance</strong>
            <p>Needs $140.00 by the 15th. $60.00 assigned so far.</p>
            <div className={styles.actions}>
              <Button variant="quiet">Remove target</Button>
              <span className={styles.spacer} />
              <Button>Cancel</Button>
              <Button variant="primary">Save target</Button>
            </div>
          </div>
          <figcaption>Inspector form: quiet, secondary, primary.</figcaption>
        </figure>

        <figure className={styles.context}>
          <div className={styles.surface}>
            {assigned ? (
              <>
                <strong>Assigned</strong>
                <p>$80.00 is in Car insurance. Ready to Assign is $412.18.</p>
                <div className={styles.actions}>
                  <Button variant="quiet" onClick={() => setAssigned(false)}>
                    Undo
                  </Button>
                </div>
              </>
            ) : (
              <>
                <strong>Ready to Assign: $492.18</strong>
                <p>Car insurance needs $80.00 more this month.</p>
                <div className={styles.actions}>
                  <Button>Another amount</Button>
                  <Button variant="primary" onClick={() => setAssigned(true)}>
                    Assign $80.00
                  </Button>
                </div>
              </>
            )}
          </div>
          <figcaption>Popover: one primary next to its alternative.</figcaption>
        </figure>

        <figure className={styles.context}>
          <div className={styles.surface}>
            {deleted ? (
              <>
                <strong>Gifts deleted</strong>
                <p>$60.00 went back to Ready to Assign.</p>
                <div className={styles.actions}>
                  <Button variant="quiet" onClick={() => setDeleted(false)}>
                    Undo
                  </Button>
                </div>
              </>
            ) : (
              <>
                <strong>Delete Gifts?</strong>
                <p>
                  Its $60.00 available goes back to Ready to Assign. Past
                  transactions keep the category name.
                </p>
                <div className={styles.actions}>
                  <Button>Cancel</Button>
                  <Button variant="danger" onClick={() => setDeleted(true)}>
                    <Trash2Icon aria-hidden />
                    Delete category
                  </Button>
                </div>
              </>
            )}
          </div>
          <figcaption>Destructive dialog: danger confirms.</figcaption>
        </figure>

        <figure className={styles.context}>
          <div className={styles.surface}>
            <strong>Chase Sapphire</strong>
            <div className={styles.actions}>
              <Button size="sm">
                <FilterIcon aria-hidden />
                Filter
              </Button>
              <Button size="sm">
                <CalendarIcon aria-hidden />
                October
              </Button>
              <span className={styles.spacer} />
              <Button variant="primary" size="sm">
                <PlusIcon aria-hidden />
                Add transaction
              </Button>
            </div>
          </div>
          <figcaption>
            Register toolbar: a primary in chrome, to judge how loud it is.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
