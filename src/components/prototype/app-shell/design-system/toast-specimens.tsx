"use client";

import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Toast } from "~/components/ui/toast";
import { TooltipProvider } from "~/components/ui/tooltip";
import styles from "./design-system.module.css";

// Toasts shown in place, without the ToastRegion that pins them to the
// window's corner, and with their timers off so every state stays put.
export function ToastSpecimens() {
  const [section, setSection] = useState<HTMLElement | null>(null);
  const [undone, setUndone] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  function reset() {
    setUndone(false);
    setDismissed(false);
  }

  return (
    <section
      ref={setSection}
      className={styles.section}
      aria-labelledby="toast"
    >
      <TooltipProvider container={section}>
        <div className={styles.sectionHeader}>
          <h2 id="toast">Toast</h2>
          <div className={styles.headerActions}>
            <Button variant="quiet" size="sm" onClick={reset}>
              <RotateCcwIcon aria-hidden />
              Reset
            </Button>
          </div>
        </div>
        <p className={styles.lead}>
          Two tones. Neutral confirms a change and leaves on its own; attention
          says something failed and stays until it&rsquo;s dismissed or fixed.
          At most one action, and only while it can still run.
        </p>

        <div className={styles.contexts}>
          <figure className={styles.context}>
            <div className={styles.stage}>
              {undone ? (
                <Toast duration={null}>Action undone.</Toast>
              ) : (
                <Toast
                  duration={null}
                  action={
                    <Button size="sm" onClick={() => setUndone(true)}>
                      Undo
                    </Button>
                  }
                >
                  Moved $50.00 from Gifts to Dining
                </Toast>
              )}
            </div>
            <figcaption>
              Move saved: Undo uses the same history as ⌘Z. Press it.
            </figcaption>
          </figure>

          <figure className={styles.context}>
            <div className={styles.stage}>
              <Toast
                duration={null}
                action={
                  <Button size="sm" disabled>
                    Undo
                  </Button>
                }
              >
                Moved $12.99 from Ready to Assign to Household
              </Toast>
            </div>
            <figcaption>
              Another change is still saving: Undo waits, disabled.
            </figcaption>
          </figure>

          <figure className={styles.context}>
            <div className={styles.stage}>
              {!dismissed && (
                <Toast tone="attention" onDismiss={() => setDismissed(true)}>
                  Your partner changed the budget. Refresh and try again.
                </Toast>
              )}
            </div>
            <figcaption>A change failed: stays until dismissed.</figcaption>
          </figure>

          <figure className={styles.context}>
            <div className={styles.stage}>
              <Toast
                tone="attention"
                action={<Button size="sm">Try again</Button>}
              >
                Your budget couldn&rsquo;t refresh. Refresh before making more
                changes.
              </Toast>
            </div>
            <figcaption>
              Saving is blocked: no Dismiss, it stays as long as its cause.
            </figcaption>
          </figure>
        </div>
      </TooltipProvider>
    </section>
  );
}
