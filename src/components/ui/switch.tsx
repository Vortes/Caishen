"use client";

import { Switch as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import styles from "./switch.module.css";

// Turns a setting on or off, and the change takes effect at once. For picking
// items to act on later, use Checkbox. Name it with aria-label, or put it
// inside a <label> with its text.
export function Switch(
  props: Omit<
    ComponentProps<typeof Primitive.Root>,
    "className" | "style" | "asChild"
  >,
) {
  return (
    <Primitive.Root className={styles.switch} {...props}>
      <Primitive.Thumb className={styles.thumb} />
    </Primitive.Root>
  );
}
