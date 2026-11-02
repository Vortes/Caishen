"use client";

import { Popover as Primitive } from "radix-ui";
import { useRef, type ReactElement, type ReactNode } from "react";
import {
  SURFACE_GAP,
  collisionPadding,
  useOpenState,
  usePortalContainer,
  useSurfaceMotion,
  type SurfaceAlign,
  type SurfaceMotion,
  type SurfaceSide,
} from "./surface";
import styles from "./surface.module.css";

export type PopoverSize = "form" | "wide" | "trigger";

type Placement = {
  label: string;
  // For a field that names the popover in aria-controls.
  id?: string;
  side?: SurfaceSide;
  align?: SurfaceAlign;
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
// controls when it opens. Focus stays in the anchor, and the site handles
// Escape; a click outside both still closes it.
type AnchorProps = Placement & {
  anchor: ReactElement;
  trigger?: never;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // On for a form or panel opened by something other than a button, like a
  // field's New row or a chart slice: it takes focus and closes on Escape as
  // a trigger popover does, and a click on the anchor closes it too.
  autoFocus?: boolean;
  onCloseAutoFocus?: (event: Event) => void;
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
  const [open, setOpen] = useOpenState(controlled, onOpenChange);
  const motionProps = useSurfaceMotion(open, motion);
  // An anchor without a trigger, unless it takes focus: the site opens it
  // and keeps focus in the anchor.
  const autoFocus = props.autoFocus ?? props.trigger !== undefined;
  const anchored = props.trigger === undefined && !autoFocus;
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
          onOpenAutoFocus={autoFocus ? undefined : prevent}
          onCloseAutoFocus={anchored ? prevent : props.onCloseAutoFocus}
          onEscapeKeyDown={(event) => {
            // A control that uses Escape itself first, such as an open list
            // or a search with text to clear, carries data-holds-escape
            // while it does, and the popover stays open for that press.
            const target = event.target as Element | null;
            if (anchored || target?.hasAttribute("data-holds-escape"))
              event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (
              (anchored || props.trigger !== undefined) &&
              anchorRef.current?.contains(event.target as Node)
            )
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
