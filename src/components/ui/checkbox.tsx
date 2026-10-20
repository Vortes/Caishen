"use client";

import { CheckIcon, MinusIcon } from "lucide-react";
import { Checkbox as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import styles from "./checkbox.module.css";

// Name it with aria-label, or put it inside a <label> with its text. A label
// also widens the area that toggles it.
export function Checkbox(
  props: Omit<
    ComponentProps<typeof Primitive.Root>,
    "className" | "style" | "asChild"
  >,
) {
  return (
    <Primitive.Root className={styles.checkbox} {...props}>
      <Primitive.Indicator className={styles.indicator}>
        {props.checked === "indeterminate" ? (
          <MinusIcon size={10} strokeWidth={3} aria-hidden />
        ) : (
          <CheckIcon size={10} strokeWidth={3} aria-hidden />
        )}
      </Primitive.Indicator>
    </Primitive.Root>
  );
}
