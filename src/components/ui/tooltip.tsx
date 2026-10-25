"use client";

import { Tooltip as Primitive } from "radix-ui";
import { createContext, useContext, type ReactNode } from "react";
import { POPOVER_GAP } from "~/components/ui/tokens";
import { PopoverMotionProvider } from "./popover-motion";
import styles from "./tooltip.module.css";

// Tooltips and popovers render through a portal so panels that clip their
// overflow can't cut them off. The portal targets the themed root rather than
// <body>, so a data-theme set there still applies to what's portaled.
const PortalContainer = createContext<HTMLElement | null>(null);

export function TooltipProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}) {
  return (
    <PortalContainer.Provider value={container}>
      <PopoverMotionProvider>
        <Primitive.Provider delayDuration={500} skipDelayDuration={300}>
          {children}
        </Primitive.Provider>
      </PopoverMotionProvider>
    </PortalContainer.Provider>
  );
}

export function usePortalContainer() {
  return useContext(PortalContainer);
}

// Wraps one focusable element. The shortcut is shown as written, e.g. "⌘K".
export function Tooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  const container = useContext(PortalContainer);
  return (
    <Primitive.Root>
      <Primitive.Trigger
        asChild
        // Focus opens the tooltip only when the user moved it there with the
        // keyboard. Focus put back after an editor or menu closes has no
        // element it came from, and a click doesn't show the focus ring.
        onFocus={(event) => {
          if (
            !event.relatedTarget ||
            !event.currentTarget.matches(":focus-visible")
          )
            event.preventDefault();
        }}
      >
        {children}
      </Primitive.Trigger>
      <Primitive.Portal container={container}>
        <Primitive.Content
          className={styles.tooltip}
          sideOffset={POPOVER_GAP}
          collisionPadding={8}
        >
          {label}
          {shortcut && <kbd>{shortcut}</kbd>}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
