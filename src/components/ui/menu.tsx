"use client";

import { CheckIcon, ChevronRightIcon, CircleAlertIcon } from "lucide-react";
import { DropdownMenu as Primitive, Slot } from "radix-ui";
import {
  createContext,
  useContext,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
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
import surface from "./surface.module.css";
import { Tag } from "./tag";
import styles from "./menu.module.css";

// Closes the menu, for an item that stops Radix's own select.
const CloseMenu = createContext<() => void>(() => undefined);

type MenuProps = {
  label: string;
  // The button that opens and closes the menu.
  trigger: ReactElement;
  // What the menu hangs from instead of the trigger, such as the border of
  // the bar the trigger sits in. It is a frame, so the menu keeps its own
  // width rather than taking the anchor's.
  anchor?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: SurfaceSide;
  align?: SurfaceAlign;
  motion?: SurfaceMotion;
  // A refused action's reason, shown below the items while the menu stays
  // open.
  error?: string;
  children: ReactNode;
};

// A list of actions. Always non-modal: the page behind stays live, and a
// click outside both closes the menu and lands. The menu keeps its keys:
// nothing around it hears a key pressed inside it, Escape included.
export function Menu({
  label,
  trigger,
  anchor,
  open: controlled,
  onOpenChange,
  side = "bottom",
  align = "start",
  motion = "frequent",
  error,
  children,
}: MenuProps) {
  const container = usePortalContainer();
  const id = useId();
  const triggerRef = useRef<HTMLElement>(null);
  const interactedOutside = useRef(false);
  const [open, setOpenState] = useOpenState(controlled, onOpenChange);
  const setOpen = (next: boolean) => {
    if (next) interactedOutside.current = false;
    setOpenState(next);
  };
  const motionProps = useSurfaceMotion(open, motion);
  return (
    <Primitive.Root modal={false} open={open} onOpenChange={setOpen}>
      {anchor ? (
        <>
          {/* Radix hangs a menu from its trigger, so the anchor takes that
              part and the button is wired here. */}
          <Slot.Root
            ref={triggerRef}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            onClick={() => setOpen(!open)}
            onKeyDown={(event: KeyboardEvent) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                event.stopPropagation();
                setOpen(true);
              }
            }}
          >
            {trigger}
          </Slot.Root>
          <Primitive.Trigger asChild>{anchor}</Primitive.Trigger>
        </>
      ) : (
        <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
      )}
      <Primitive.Portal container={container}>
        <Primitive.Content
          {...motionProps}
          id={id}
          className={`${surface.surface} ${surface.motion} ${styles.menu}`}
          data-anchored={anchor ? "" : undefined}
          aria-label={label}
          // The trigger's text would otherwise name the menu.
          aria-labelledby={undefined}
          side={side}
          align={align}
          sideOffset={SURFACE_GAP}
          collisionPadding={collisionPadding(side, align)}
          onKeyDown={(event) => event.stopPropagation()}
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onCloseAutoFocus={
            anchor
              ? (event) => {
                  event.preventDefault();
                  if (!interactedOutside.current)
                    triggerRef.current?.focus({ preventScroll: true });
                }
              : undefined
          }
          onInteractOutside={(event) => {
            // The trigger toggles the menu itself.
            if (triggerRef.current?.contains(event.target as Node))
              event.preventDefault();
            else interactedOutside.current = true;
          }}
        >
          <CloseMenu.Provider value={() => setOpen(false)}>
            {children}
          </CloseMenu.Provider>
          {error && (
            <p className={styles.error} role="alert">
              <CircleAlertIcon aria-hidden size={14} />
              {error}
            </p>
          )}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

type ItemContent = {
  icon?: ReactNode;
  title: string;
  // A line on what the item is for, under its title.
  detail?: string;
  disabled?: boolean;
};

// What an action receives; preventDefault() keeps the menu open, for an
// action that was refused and says why in the menu's error line.
export type MenuSelectEvent = { preventDefault: () => void };

type ActionItem = ItemContent & {
  onSelect: (event: MenuSelectEvent) => void;
  href?: never;
  onNavigate?: never;
};

// A link. A plain click goes to onNavigate when the site routes in-app links
// itself; a modified click still opens the link the browser's way.
type LinkItem = ItemContent & {
  href: string;
  onNavigate?: (href: string) => void;
  onSelect?: never;
};

export function MenuItem(props: ActionItem | LinkItem) {
  const { icon, title, detail, disabled } = props;
  const close = useContext(CloseMenu);
  const className = detail ? `${styles.item} ${styles.detailed}` : styles.item;
  const content = (
    <>
      {icon}
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {detail && <span className={styles.detail}>{detail}</span>}
      </span>
    </>
  );
  if (props.href !== undefined) {
    const { href, onNavigate } = props;
    return (
      <Primitive.Item
        className={className}
        disabled={disabled}
        textValue={title}
        asChild
      >
        <a
          href={href}
          onClick={(event) => {
            if (
              !onNavigate ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            // Stopping the browser's navigation also stops the select that
            // would close the menu.
            event.preventDefault();
            close();
            onNavigate(href);
          }}
        >
          {content}
        </a>
      </Primitive.Item>
    );
  }
  const { onSelect } = props;
  return (
    <Primitive.Item
      className={className}
      disabled={disabled}
      textValue={title}
      onSelect={(event) =>
        onSelect({ preventDefault: () => event.preventDefault() })
      }
    >
      {content}
    </Primitive.Item>
  );
}

// A choose-one list; the current choice carries a check.
export function MenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <Primitive.RadioGroup value={value} onValueChange={onValueChange}>
      {children}
    </Primitive.RadioGroup>
  );
}

export function MenuRadioItem({
  value,
  title,
  tag,
  detail,
}: {
  value: string;
  title: string;
  // A short neutral label beside the title, like "Most common".
  tag?: string;
  // Lines under the title, the first more prominent than the rest.
  detail?: string | readonly string[];
}) {
  const lines = typeof detail === "string" ? [detail] : (detail ?? []);
  return (
    <Primitive.RadioItem
      value={value}
      className={`${styles.item} ${styles.detailed} ${styles.radio}`}
      textValue={title}
    >
      <span className={styles.check}>
        <Primitive.ItemIndicator>
          <CheckIcon size={13} strokeWidth={2.5} aria-hidden />
        </Primitive.ItemIndicator>
      </span>
      <span className={styles.text}>
        <span className={styles.title}>
          {title}
          {tag && (
            <span className={styles.tag}>
              <Tag>{tag}</Tag>
            </span>
          )}
        </span>
        {lines.map((line, index) => (
          <span
            key={index}
            className={
              index === 0 && lines.length > 1 ? styles.lead : styles.detail
            }
          >
            {line}
          </span>
        ))}
      </span>
    </Primitive.RadioItem>
  );
}

// An item that opens its own list beside the menu. Submenus open and close
// instantly, whatever the menu's motion.
export function MenuSub({
  title,
  label,
  disabled,
  children,
}: {
  title: string;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const container = usePortalContainer();
  return (
    <Primitive.Sub>
      <Primitive.SubTrigger
        className={styles.item}
        disabled={disabled}
        textValue={title}
      >
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
        </span>
        <ChevronRightIcon size={14} aria-hidden />
      </Primitive.SubTrigger>
      <Primitive.Portal container={container}>
        <Primitive.SubContent
          className={`${surface.surface} ${styles.menu}`}
          aria-label={label}
          aria-labelledby={undefined}
          sideOffset={SURFACE_GAP}
          collisionPadding={collisionPadding("right", "start")}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {children}
        </Primitive.SubContent>
      </Primitive.Portal>
    </Primitive.Sub>
  );
}

export function MenuSeparator() {
  return <Primitive.Separator className={styles.separator} />;
}
