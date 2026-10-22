"use client";

import { useRef, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { useSavedSettings } from "../app-shell/settings";
import type { ScenarioId } from "./scenarios";
import styles from "./batch-4.module.css";

type Shot = {
  src: string;
  caption: string;
  // The part of the screenshot the thumbnail zooms into, in percent.
  focus: { x: number; y: number; zoom: number };
};

const SNOOZE = "/prototype/legacy/legacy-target-snooze.webp";
const INCOME = "/prototype/legacy/legacy-expected-income.webp";
const SEARCH = "/prototype/legacy/legacy-category-search.webp";
const MONTH = "/prototype/legacy/legacy-month-picker.webp";

const toggle = { x: 88, y: 57, zoom: 3 };

// What the legacy app showed for each state, or null where it had none.
const legacy: Record<ScenarioId, Shot | null> = {
  snoozed: {
    src: SNOOZE,
    caption: "A “Snooze target for this month” toggle under the target",
    focus: toggle,
  },
  "snooze-now": {
    src: SNOOZE,
    caption: "The same toggle, off, under a funded target",
    focus: toggle,
  },
  "card-payment": null,
  "future-month": null,
  "past-snoozed": null,
  "snoozed-view": {
    src: SNOOZE,
    caption: "A “Snoozed 1” filter chip above the plan",
    focus: { x: 42, y: 14, zoom: 2.6 },
  },
  "no-income": {
    src: INCOME,
    caption: "An Expected income field in Cost to Be Me, saved on Enter",
    focus: { x: 50, y: 36, zoom: 1 },
  },
  "income-short": {
    src: INCOME,
    caption: "The same field; legacy showed no comparison with the targets",
    focus: { x: 50, y: 36, zoom: 1 },
  },
  "income-covers": {
    src: INCOME,
    caption: "The same field; legacy showed no comparison with the targets",
    focus: { x: 50, y: 36, zoom: 1 },
  },
  "first-month": {
    src: MONTH,
    caption: "A “Go to month” input under the month, with Today beside it",
    focus: { x: 28, y: 14, zoom: 2.2 },
  },
  "far-future": {
    src: MONTH,
    caption: "The same “Go to month” input",
    focus: { x: 28, y: 14, zoom: 2.2 },
  },
  "search-none": {
    src: SEARCH,
    caption:
      "“Find a category” narrowing the plan to Groceries (no-match state not captured)",
    focus: { x: 62, y: 22, zoom: 1.8 },
  },
};

// A legacy thumbnail beside a state; it opens full size.
export function LegacyPreview({ state }: { state: ScenarioId }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const shot = legacy[state];
  if (!shot)
    return (
      <span className={styles.legacyNone}>
        <span className={styles.legacyTag}>Legacy</span>
        No legacy equivalent
      </span>
    );
  const { x, y, zoom } = shot.focus;
  // Zoomed in, the image is offset so its focus sits mid-thumbnail, kept
  // inside the edges. Unzoomed, it covers the thumbnail around the focus.
  const offset = (focus: number) =>
    `${-Math.min(Math.max(((focus / 100) * zoom - 0.5) * 100, 0), (zoom - 1) * 100)}%`;
  const style =
    zoom > 1
      ? { width: `${zoom * 100}%`, left: offset(x), top: offset(y) }
      : { objectPosition: `${x}% ${y}%` };
  return (
    <>
      <button
        type="button"
        className={styles.legacyThumb}
        aria-label={`Enlarge legacy screenshot: ${shot.caption}`}
        onClick={() => dialog.current?.showModal()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a
            prototype thumbnail, cropped by transform */}
        <img
          src={shot.src}
          alt=""
          loading="lazy"
          data-zoomed={zoom > 1 || undefined}
          style={style}
        />
        <span className={styles.legacyTag}>Legacy</span>
      </button>
      <dialog
        ref={dialog}
        className={styles.lightbox}
        aria-label="Legacy screenshot"
        onClick={(event) => {
          // A click on the backdrop, outside the figure, closes it.
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element -- full size */}
          <img src={shot.src} alt={`Legacy: ${shot.caption}`} />
          <figcaption>
            <span className={styles.legacyTag}>Legacy</span>
            {shot.caption}
            <Button size="sm" onClick={() => dialog.current?.close()}>
              Close
            </Button>
          </figcaption>
        </figure>
      </dialog>
    </>
  );
}

// The index follows the theme saved for the shell on this device.
export function SavedTheme({ children }: { children: ReactNode }) {
  const { theme } = useSavedSettings();
  return (
    <div data-theme={theme} className={styles.themed}>
      {children}
    </div>
  );
}
