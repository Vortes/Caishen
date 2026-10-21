import type { ComponentProps, ReactNode } from "react";
import { Slot } from "radix-ui";
import styles from "./icon-button.module.css";
import { Tooltip } from "./tooltip";

// A button that is only an icon. The label is required: it names the button
// for screen readers and is shown as its tooltip. quiet sits on a surface
// with nothing around it; secondary is the bordered pill, for toolbars that
// sit next to secondary buttons.
export function IconButton({
  label,
  shortcut,
  variant = "quiet",
  size = "md",
  pressed,
  children,
  type = "button",
  asChild = false,
  ...props
}: Omit<
  ComponentProps<"button">,
  "className" | "style" | "aria-label" | "aria-pressed" | "children"
> & {
  label: string;
  shortcut?: string;
  variant?: "secondary" | "quiet";
  size?: "md" | "sm";
  pressed?: boolean;
  asChild?: boolean;
  // The icon. Its size comes from the button.
  children: ReactNode;
}) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <Comp
        {...(asChild ? {} : { type })}
        className={styles.iconButton}
        data-variant={variant}
        data-size={size}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut?.replace("⌘", "Meta+")}
        {...props}
      >
        {children}
      </Comp>
    </Tooltip>
  );
}
