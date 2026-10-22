"use client";

import { XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./index-page.module.css";

export type Shot = { src: string; alt: string };

// The legacy app's screenshots of a feature, as thumbnails that open full
// size. A native modal dialog gives Escape, focus trapping, and focus return.
export function LegacyShots({ shots }: { shots: Shot[] }) {
  if (!shots.length)
    return (
      <div className={styles.legacy}>
        <span className={styles.legacyLabel}>Legacy</span>
        <p className={styles.legacyNone}>No legacy equivalent</p>
      </div>
    );
  return (
    <div className={styles.legacy}>
      <span className={styles.legacyLabel}>Legacy</span>
      <div className={styles.thumbs}>
        {shots.map((shot) => (
          <Thumb key={shot.src} shot={shot} />
        ))}
      </div>
    </div>
  );
}

function Thumb({ shot }: { shot: Shot }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        className={styles.thumb}
        aria-label={`Enlarge legacy screenshot: ${shot.alt}`}
        onClick={() => dialog.current?.showModal()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static prototype asset */}
        <img src={shot.src} alt="" width={1440} height={900} loading="lazy" />
      </button>
      <dialog
        ref={dialog}
        className={styles.viewer}
        aria-label={`Legacy: ${shot.alt}`}
        onClick={(event) => {
          // A click on the backdrop, outside the image, closes it.
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className={styles.viewerHead}>
          <span>
            <strong>Legacy</strong> {shot.alt}
          </span>
          <button
            type="button"
            className={styles.viewerClose}
            aria-label="Close"
            onClick={() => dialog.current?.close()}
          >
            <XIcon size={16} aria-hidden />
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- static prototype asset */}
        <img src={shot.src} alt={shot.alt} width={1440} height={900} />
      </dialog>
    </>
  );
}

// The index follows the system's light or dark setting.
export function SchemeTheme({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setTheme(query.matches ? "light" : "dark");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return (
    <main className={className} data-theme={theme}>
      {children}
    </main>
  );
}
