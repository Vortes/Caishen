"use client";

import { Switch as Primitive } from "radix-ui";
import { use, type ComponentProps } from "react";
import { SettingRowContext } from "./settings";
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
  const row = use(SettingRowContext);
  const named = Boolean(props["aria-label"] ?? props["aria-labelledby"]);
  return (
    <Primitive.Root
      className={styles.switch}
      aria-labelledby={named ? undefined : row?.labelId}
      aria-describedby={row?.describedBy}
      {...props}
    >
      <Primitive.Thumb className={styles.thumb} />
    </Primitive.Root>
  );
}
