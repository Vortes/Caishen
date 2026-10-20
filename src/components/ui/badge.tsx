import type { ReactNode } from "react";
import styles from "./badge.module.css";

// A count. accent draws the eye to work waiting, like transactions to review.
// Give it an aria-label that says what the number counts.
export function Badge({
  tone = "neutral",
  children,
  "aria-label": label,
}: {
  tone?: "neutral" | "accent";
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <span className={styles.badge} data-tone={tone} aria-label={label}>
      {children}
    </span>
  );
}
