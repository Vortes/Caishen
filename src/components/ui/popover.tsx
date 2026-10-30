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
  children: ReactNode;
};

// A button that opens and closes the popover.
type TriggerProps = Placement & {
  trigger: ReactElement;
  anchor?: never;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Off when the content places focus itself.
  autoFocus?: boolean;
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
  const anchored = props.anchor !== undefined;
  const prevent = (event: Event) => event.preventDefault();
  const className = [styles.surface, styles.motion, size && styles[size]]
    .filter(Boolean)
    .join(" ");
  return (
    <Primitive.Root open={open} onOpenChange={setOpen}>
      {anchored ? (
        <Primitive.Anchor asChild ref={anchorRef}>
          {props.anchor}
        </Primitive.Anchor>
      ) : (
        <Primitive.Trigger asChild>{props.trigger}</Primitive.Trigger>
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
          collisionPadding={SURFACE_COLLISION_PADDING}
          onOpenAutoFocus={
            anchored || props.autoFocus === false ? prevent : undefined
          }
          onCloseAutoFocus={anchored ? prevent : undefined}
          onEscapeKeyDown={anchored ? prevent : undefined}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node))
              event.preventDefault();
          }}
        >
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
