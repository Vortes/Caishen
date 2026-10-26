"use client";

import { BrandMark } from "~/components/shared/brand-mark";
import styles from "./entry.module.css";

// The pinwheel mark from the favicon, beside the product's name.
export function Brand() {
  return (
    <span className={styles.brand}>
      <BrandMark />
      Caishen
    </span>
  );
}
