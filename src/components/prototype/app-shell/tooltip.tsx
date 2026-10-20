"use client";

import { Tooltip } from "radix-ui";
import { createContext, useContext, type ReactNode } from "react";
import styles from "./shell.module.css";

// Tooltips render through a portal so panels that clip their overflow (the
// collapsing sidebar) can't cut them off. The portal targets the shell root,
// not <body>, so the theme tokens defined there still apply.
const Container = createContext<HTMLElement | null>(null);

export function TooltipLayer({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <Container.Provider value={container}>
      <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
        {children}
      </Tooltip.Provider>
    </Container.Provider>
  );
}

export function Tip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  const container = useContext(Container);
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal container={container}>
        <Tooltip.Content
          className={styles.tooltip}
          sideOffset={6}
          collisionPadding={8}
        >
          {label}
          {shortcut && <kbd>{shortcut}</kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
