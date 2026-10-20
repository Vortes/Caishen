import type { ReactNode } from "react";
import styles from "./card.module.css";

// A raised surface that groups related details, like one section of the
// inspector.
export function Card({ children }: { children: ReactNode }) {
  return <section className={styles.card}>{children}</section>;
}
