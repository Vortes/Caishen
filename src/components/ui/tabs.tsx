"use client";

import { Tabs as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import styles from "./tabs.module.css";

type Clean<T> = Omit<T, "className" | "style" | "asChild">;

// <Tabs defaultValue="target">
//   <TabsList aria-label="Category details">
//     <TabsTrigger value="target">Target</TabsTrigger>
//   </TabsList>
//   <TabsContent value="target">…</TabsContent>
// </Tabs>
export function Tabs(props: Clean<ComponentProps<typeof Primitive.Root>>) {
  return <Primitive.Root {...props} />;
}

export function TabsList(props: Clean<ComponentProps<typeof Primitive.List>>) {
  return <Primitive.List className={styles.list} {...props} />;
}

export function TabsTrigger(
  props: Clean<ComponentProps<typeof Primitive.Trigger>>,
) {
  return <Primitive.Trigger className={styles.trigger} {...props} />;
}

export function TabsContent(
  props: Clean<ComponentProps<typeof Primitive.Content>>,
) {
  return <Primitive.Content {...props} />;
}
