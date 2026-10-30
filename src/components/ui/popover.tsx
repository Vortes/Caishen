"use client";

import { Popover as Primitive } from "radix-ui";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import {
  SURFACE_COLLISION_PADDING,
  SURFACE_GAP,
  usePortalContainer,
  useSurfaceMotion,
  type SurfaceMotion,
} from "./surface";
import styles from "./surface.module.css";

export type PopoverSize = "form" | "wide" | "trigger";

type Placement = {
  label: string;
  // For a field that names the popover in aria-controls.
  id?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  // Without a size, the content sets the width.
  size?: PopoverSize;
  motion?: SurfaceMotion;
  // A small arrow pointing at the trigger or anchor, for forms that act on
  // the one thing they hang from.
  arrow?: boolean;
  children: ReactNode;
};

// A button that opens and closes the popover. It hangs from the trigger, or
// from a separate anchor, such as the border of the bar the trigger sits in.
type TriggerProps = Placement & {
  trigger: ReactElement;
  anchor?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Off when the content places focus itself.
  autoFocus?: boolean;
  // Called as it closes; preventDefault() keeps focus from returning to the
  // trigger, for a site that focuses what the popover just made.
  onCloseAutoFocus?: (event: Event) => void;
};

// An element the popover hangs from, such as an input, while the site
// controls when it opens. Focus never moves for it, and the site handles
// Escape; a click outside both still closes it.
type AnchorProps = Placement & {
  anchor: ReactElement;
  trigger?: never;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoFocus?: never;
  onCloseAutoFocus?: never;
};

export function Popover(props: TriggerProps | AnchorProps) {
  const {
    label,
    id,
    open: controlled,
    onOpenChange,
    side = "bottom",
    align = "start",
    size,
    motion = "frequent",
    arrow = false,
    children,
  } = props;
  const anchorRef = useRef<HTMLDivElement>(null);
  const container = usePortalContainer();
  const [uncontrolled, setUncontrolled] = useState(false);
  const open = controlled ?? uncontrolled;
  const setOpen = (next: boolean) => {
    if (controlled === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };
  const motionProps = useSurfaceMotion(open, motion);
  // An anchor without a trigger: the site opens it and keeps focus.
  const anchored = props.trigger === undefined;
  const prevent = (event: Event) => event.preventDefault();
  const className = [styles.surface, styles.motion, size && styles[size]]
    .filter(Boolean)
    .join(" ");
  return (
    <Primitive.Root open={open} onOpenChange={setOpen}>
      {props.trigger && (
        <Primitive.Trigger asChild>{props.trigger}</Primitive.Trigger>
      )}
      {/* After the trigger, so it replaces the trigger as the anchor. */}
      {props.anchor && (
        <Primitive.Anchor asChild ref={anchorRef}>
          {props.anchor}
        </Primitive.Anchor>
      )}
      <Primitive.Portal container={container}>
        <Primitive.Content
          {...motionProps}
          id={id}
          className={className}
          aria-label={label}
          side={side}
          align={align}
          sideOffset={SURFACE_GAP}
          collisionPadding={collisionPadding(side, align)}
          onOpenAutoFocus={
            anchored || props.autoFocus === false ? prevent : undefined
          }
          onCloseAutoFocus={anchored ? prevent : props.onCloseAutoFocus}
          onEscapeKeyDown={(event) => {
            // Escape closes an open list inside the popover before the
            // popover itself.
            const target = event.target as Element | null;
            if (
              anchored ||
              (target?.getAttribute("role") === "combobox" &&
                target.getAttribute("aria-expanded") === "true")
            )
              event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node))
              event.preventDefault();
          }}
        >
          {children}
          {arrow && (
            <Primitive.Arrow className={styles.arrow} width={14} height={7} />
          )}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

// Clear of the window edge on every side but the one the surface aligns to:
// a trigger near the edge, like Banks in the sidebar, keeps its surface
// flush with it rather than pushed off it.
function collisionPadding(
  side: NonNullable<Placement["side"]>,
  align: NonNullable<Placement["align"]>,
) {
  const padding = {
    top: SURFACE_COLLISION_PADDING,
    right: SURFACE_COLLISION_PADDING,
    bottom: SURFACE_COLLISION_PADDING,
    left: SURFACE_COLLISION_PADDING,
  };
  if (align === "center") return padding;
  const vertical = side === "top" || side === "bottom";
  const edge = vertical
    ? align === "start"
      ? "left"
      : "right"
    : align === "start"
      ? "top"
      : "bottom";
  return { ...padding, [edge]: 0 };
}
