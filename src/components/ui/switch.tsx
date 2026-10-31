"use client";

import { Switch as Primitive } from "radix-ui";
import { use, type ComponentProps } from "react";
import { FieldContext } from "./field";
import styles from "./switch.module.css";

// Turns a setting on or off, and the change takes effect at once. For picking
// items to act on later, use Checkbox. Inside a SettingRow, the row's label
// names it and its description describes it; elsewhere, name it with
// aria-label, or put it inside a <label> with its text.
export function Switch(
  props: Omit<
    ComponentProps<typeof Primitive.Root>,
    "className" | "style" | "asChild"
  >,
) {
  const field = use(FieldContext);
  const named = Boolean(props["aria-label"] ?? props["aria-labelledby"]);
  return (
    <Primitive.Root
      className={styles.switch}
      id={field?.id}
      aria-labelledby={named ? undefined : field?.labelledBy}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid ? true : undefined}
      {...props}
    >
      <Primitive.Thumb className={styles.thumb} />
    </Primitive.Root>
  );
}
