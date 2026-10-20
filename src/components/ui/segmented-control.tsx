"use client";

import { RadioGroup as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import styles from "./segmented-control.module.css";

type Clean<T> = Omit<T, "className" | "style" | "asChild">;

// Picks one of a few options that change how the same content is shown.
// For switching between different content, use Tabs.
//
// <SegmentedControl aria-label="Group by" value={value} onValueChange={set}>
//   <SegmentedControlItem value="categories">Categories</SegmentedControlItem>
//   <SegmentedControlItem value="groups">Groups</SegmentedControlItem>
// </SegmentedControl>
export function SegmentedControl(
  props: Clean<ComponentProps<typeof Primitive.Root>>,
) {
  return (
    <Primitive.Root
      className={styles.root}
      orientation="horizontal"
      {...props}
    />
  );
}

export function SegmentedControlItem(
  props: Clean<ComponentProps<typeof Primitive.Item>>,
) {
  return <Primitive.Item className={styles.item} {...props} />;
}
