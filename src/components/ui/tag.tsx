import type { ReactNode } from "react";
import styles from "./tag.module.css";

// A short label on a row or property. attention means the user has to do
// something, like reconnect a bank or pick a category. Money states use the
// funding components, never a Tag.
export function Tag({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "attention";
  children: ReactNode;
}) {
  return (
    <span className={styles.tag} data-tone={tone}>
      {children}
    </span>
  );
}
