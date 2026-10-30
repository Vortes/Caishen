"use client";

import { Tooltip as Primitive } from "radix-ui";
import type { FocusEvent, ReactNode } from "react";
import {
  SURFACE_COLLISION_PADDING,
  SURFACE_GAP,
  usePortalContainer,
} from "./surface";
import styles from "./tooltip.module.css";

// Kept for the sites not yet on Popover, Menu or Dialog.
export { usePortalContainer };

// Wraps one focusable element. The shortcut is shown as written, e.g. "⌘K".
// Props a wrapping trigger gives it, like a popover's, pass to that element.
export function Tooltip({
  label,
  shortcut,
  children,
  ...trigger
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
}) {
  const container = usePortalContainer();
  return (
    <Primitive.Root>
      <Primitive.Trigger
        {...trigger}
        asChild
        // Focus opens the tooltip only when the user moved it there with the
        // keyboard. Focus put back after an editor or menu closes has no
        // element it came from, and a click doesn't show the focus ring.
        onFocus={(event) => {
          trigger.onFocus?.(event);
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
          sideOffset={SURFACE_GAP}
          collisionPadding={SURFACE_COLLISION_PADDING}
        >
          {label}
          {shortcut && <kbd>{shortcut}</kbd>}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
